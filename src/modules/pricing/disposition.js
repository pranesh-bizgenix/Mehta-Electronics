import {s,validate} from '../../core/schema.js';
import {conflict,forbidden,notFound,validationFailed} from '../../core/errors.js';
import {fingerprint} from '../../core/runtime.js';
import {workflowRule} from '../rules/workflow-rules.js';
import {PriceLevelRepository} from './levels.js';
import {pricingToday} from './quotation-source.js';
const type='PRICE_LIST_DISPOSITION';
const schema=s.object({listId:s.id(),action:s.enum(['RETIRE','SUPERSEDE']),replacementId:s.id().optional(),reason:s.reason().optional(),requestId:s.uuid().optional(),previewFingerprint:s.string({pattern:/^[a-f0-9]{64}$/}).optional()});
export class PriceDispositionRepository {
 constructor(db){this.db=db;}
 async source(id){
  const row=await this.db.prepare('SELECT id,name,currency,effective_from::text AS effective_from,effective_to::text AS effective_to,discount_percent::text AS discount_percent,status,is_deleted,created_by,updated_at::text AS updated_at FROM crm_price_lists WHERE id=? FOR UPDATE').get(id);
  if(!row)return null;
  const entries=await this.db.prepare(`SELECT e.id,e.item_id,e.min_quantity::text AS min_quantity,e.unit_price::text AS unit_price,e.discount_percent::text AS discount_percent,e.status,e.is_deleted,
   r.item_revision,r.uom AS approved_uom,r.part_code AS approved_part_code,i.updated_at::text AS current_item_revision,i.uom AS current_uom,i.part_code AS current_part_code,i.status AS product_status,i.is_deleted AS product_deleted
   FROM crm_price_list_items e JOIN items i ON i.id=e.item_id LEFT JOIN crm_price_import_entries r ON r.activated_entry_id=e.id
   WHERE e.price_list_id=? ORDER BY e.id FOR SHARE OF e,i`).all(id);
  const reviews=await this.db.prepare('SELECT id,status,plan_hash,created_by FROM crm_price_import_workflows WHERE target_list_id=? AND NOT is_deleted ORDER BY id FOR UPDATE').all(id);
  return {...row,entries,reviews};
 }
 async request(id){return this.db.prepare('SELECT * FROM approval_requests WHERE id=? FOR UPDATE').get(id);}
 async create(id,actor,snapshot){return this.db.prepare('INSERT INTO approval_requests(id,request_type,requested_by,payload_fingerprint,payload_snapshot) VALUES(?,?,?,?,?::text::jsonb) RETURNING id,status').get(id,type,actor.id,fingerprint(snapshot),JSON.stringify(snapshot));}
 async list(page){return this.db.prepare('SELECT id,requested_by,payload_snapshot,status,created_at FROM approval_requests WHERE request_type=? ORDER BY created_at DESC,id LIMIT 100 OFFSET ?').all(type,(page-1)*100);}
 async decisions(id){return this.db.prepare('SELECT decision,decided_by,reason,decided_at FROM approval_decisions WHERE approval_request_id=? ORDER BY decided_at,id').all(id);}
 async finish(row,actor,decision,reason){
  await this.db.prepare('INSERT INTO approval_decisions(approval_request_id,decision,decided_by,reason,payload_fingerprint) VALUES(?,?,?,?,?)').run(row.id,decision,actor.id,reason,row.payload_fingerprint);
  await this.db.prepare('UPDATE approval_requests SET status=? WHERE id=?').run(decision,row.id);
 }
 async retire(source,actor,reason){
  await this.db.prepare("UPDATE crm_price_lists SET status='ARCHIVED' WHERE id=?").run(source.id);
  // Original prices, dates, discount and source bytes remain unchanged.
  for(const review of source.reviews){
   await this.db.prepare("UPDATE crm_price_import_workflows SET status='ARCHIVED' WHERE id=?").run(review.id);
   await this.db.prepare("INSERT INTO crm_price_import_events(import_id,action,actor_id,reason,plan_hash) VALUES(?,'ARCHIVE',?,?,?)").run(review.id,actor.id,reason,review.plan_hash);
  }
 }
}
export class PriceDispositionService {
 constructor(dependencies){Object.assign(this,dependencies);}
 read(actor){this.access.require(actor,'items.read');this.access.require(actor,'items.list_price.read');}
 manage(actor){this.read(actor);this.access.require(actor,'items.update');}
 async policy(){const rule=await workflowRule(this.db,'price_lists.retirement_policy',false);if(!rule)throw conflict('Not set: price_lists.retirement_policy - blocks price-list retirement and replacement approval.');return rule;}
 async locks(){
  // Same order as quotation preview/save: global quotation lock, then levels.
  await this.db.prepare('SELECT pg_advisory_xact_lock(812731)').get();
  const levels=new PriceLevelRepository(this.db);for(const level of [1,2,3,4])await levels.lock(level);
  await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('rule:price_lists.retirement_policy');
 }
 async plan(input){
  const b=validate(schema,input);
  if(b.action==='SUPERSEDE'&&!b.replacementId)throw validationFailed('Choose an explicit approved replacement list.');
  if(b.action==='RETIRE'&&b.replacementId)throw validationFailed('Retirement has no replacement; choose SUPERSEDE to retain a replacement reference.');
  if(b.replacementId===b.listId)throw validationFailed('The replacement must be a different retained list.');
  const rule=await this.policy();
  const sources=new Map();for(const id of [...new Set([b.listId,b.replacementId].filter(Boolean))].sort((a,c)=>a-c))sources.set(id,await this.repository.source(id));
  const source=sources.get(b.listId),replacement=b.replacementId?sources.get(b.replacementId):null;
  if(!source||source.is_deleted)throw notFound('Retained source price list not found.');
  if(source.status!=='ACTIVE')throw conflict('Only an active list can be retired. Reload its current status.');
  if(source.reviews.some(r=>r.status!=='ACTIVATED')||source.reviews.length>1)throw conflict('Source approval linkage needs review before retirement.');
  if(replacement){
   if(replacement.is_deleted||replacement.status!=='ACTIVE'||replacement.reviews.length!==1||replacement.reviews[0].status!=='ACTIVATED')throw conflict('The replacement must be an independently approved active list.');
   const today=pricingToday();if(replacement.effective_from>today||replacement.effective_to&&replacement.effective_to<today)throw conflict('The replacement must be valid today.');
   if(source.currency!==replacement.currency)throw conflict('Replacement currencies differ. A currency conversion is not inferred.');
   const entries=replacement.entries.filter(e=>e.status==='ACTIVE'&&!e.is_deleted);
   if(!entries.length||entries.some(e=>e.product_deleted||e.product_status!=='ACTIVE'||e.item_revision!==e.current_item_revision||e.approved_uom!==e.current_uom||e.approved_part_code!==e.current_part_code))throw conflict('Replacement products or units changed after approval. Review a current source revision.');
  }else if(b.replacementId)throw notFound('Replacement list not found.');
  const levels=(await new PriceLevelRepository(this.db).all()).filter(row=>row.status==='CONFIRMED'&&!row.is_deleted&&row.configuration?.priceListId===source.id);
  const affectedLevels=levels.map(row=>({number:row.level_number,label:row.label,revision:fingerprint(row)}));
  const active=source.entries.filter(e=>e.status==='ACTIVE'&&!e.is_deleted),covered=new Set((replacement?.entries??[]).filter(e=>e.status==='ACTIVE'&&!e.is_deleted).map(e=>`${e.item_id}:${e.min_quantity}`));
  const uncovered= replacement?active.filter(e=>!covered.has(`${e.item_id}:${e.min_quantity}`)):[];
  const project=row=>row?{id:row.id,name:row.name,currency:row.currency,effectiveFrom:row.effective_from,effectiveTo:row.effective_to,createdBy:row.reviews[0]?.created_by??row.created_by,reviewed:row.reviews.length===1}:null;
  const result={action:b.action,list:project(source),replacement:project(replacement),policyVersion:rule.version,affectedLevels,sourceRowCount:active.length,uncoveredTierCount:uncovered.length,uncoveredTiers:uncovered.slice(0,100).map(e=>({itemId:e.item_id,minQuantity:e.min_quantity})),warning:'Approval archives the old list. Linked levels and quotations using it will block until separately revised; replacement does not switch them automatically.'};
  return {b,source,replacement,rule,result,previewFingerprint:fingerprint({...result,source,replacement})};
 }
 async preview(actor,input){this.manage(actor);return this.transactions.run(actor,'Preview price-list retirement impact',async()=>{await this.locks();const plan=await this.plan(input);return {...plan.result,previewFingerprint:plan.previewFingerprint};});}
 async request(actor,input){
  this.manage(actor);const b=validate(schema,input),reason=validate(s.reason(),b.reason),id=validate(s.uuid(),b.requestId);
  return this.transactions.run(actor,reason,async()=>{
   await this.locks();await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`price-disposition:${id}`);
   const existing=await this.repository.request(id),command={listId:b.listId,action:b.action,...(b.replacementId?{replacementId:b.replacementId}:{})};
   if(existing){if(existing.request_type!==type||existing.requested_by!==actor.id||fingerprint(existing.payload_snapshot)!==existing.payload_fingerprint||existing.payload_snapshot.reason!==reason||existing.payload_snapshot.previewFingerprint!==b.previewFingerprint||fingerprint(existing.payload_snapshot.command)!==fingerprint(command))throw conflict('This request ID was already used for a different review.');return {id,status:existing.status,replayed:true};}
   const plan=await this.plan(b);if(b.previewFingerprint!==plan.previewFingerprint)throw conflict('The source, replacement, linked levels or policy changed. Preview again.');
   const snapshot={command,reason,previewFingerprint:plan.previewFingerprint,preview:plan.result},row=await this.repository.create(id,actor,snapshot);
   await this.audit.record({actorId:actor.id,entity:type,recordId:id,action:'REQUEST',reason,newValue:snapshot});return row;
  });
 }
 async decide(actor,id,input){
  this.manage(actor);id=validate(s.uuid(),id);const b=validate(s.object({decision:s.enum(['APPROVED','REJECTED']),reason:s.reason()}),input);
  return this.transactions.run(actor,b.reason,async()=>{
   await this.locks();const row=await this.repository.request(id);if(!row||row.request_type!==type)throw notFound('Price-list retirement request not found.');
   if(fingerprint(row.payload_snapshot)!==row.payload_fingerprint)throw conflict('Retained approval evidence changed; this request cannot be decided.');
   if(row.status!=='PENDING')throw conflict('This retirement request is already complete.');
   if(row.requested_by===actor.id||row.payload_snapshot.preview.list.createdBy===actor.id)throw forbidden('The request maker or source-list creator cannot approve or reject this request.');
   const rule=await this.policy();this.access.require(actor,rule.value.reviewerPermission);
   if(b.decision==='APPROVED'){
    const plan=await this.plan(row.payload_snapshot.command);if(plan.previewFingerprint!==row.payload_snapshot.previewFingerprint)throw conflict('Source, replacement, levels or policy changed. Reject and submit a fresh preview.');
    await this.repository.retire(plan.source,actor,b.reason);
   }
   await this.repository.finish(row,actor,b.decision,b.reason);await this.audit.record({actorId:actor.id,entity:type,recordId:id,action:b.decision,reason:b.reason,newValue:{listId:row.payload_snapshot.command.listId,replacementId:row.payload_snapshot.command.replacementId??null,previewFingerprint:row.payload_snapshot.previewFingerprint}});
   return {id,status:b.decision};
  });
 }
 async list(actor,page=1){this.read(actor);return this.repository.list(validate(s.int({min:1,max:100000}),page));}
 async detail(actor,id){this.read(actor);id=validate(s.uuid(),id);const row=await this.repository.request(id);if(!row||row.request_type!==type)throw notFound('Price-list retirement request not found.');return {...row,decisions:await this.repository.decisions(id)};}
}
