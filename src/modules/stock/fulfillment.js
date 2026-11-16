import {randomUUID} from 'node:crypto';
import {s,validate} from '../../core/schema.js';
import {conflict,forbidden,notFound,validationFailed} from '../../core/errors.js';
import {AuditRepository,TransactionRunner,SystemClock,fingerprint} from '../../core/runtime.js';
import {hasPermission} from '../../rbac.js';
import {workflowRule} from '../rules/workflow-rules.js';
import {StockCheckRepository} from './repository.js';
import {evaluateStock} from './availability.js';
import {decimal,add,sub,compare,format} from '../../../public/money.js';

const lineBinding=s.object({basis:s.enum(['FREE_STOCK','RESERVED_STOCK']).nullable(),reservationKey:s.string({min:1,max:250}).nullable(),tallyOrderKey:s.string({min:1,max:300}).nullable()});
async function sourceOrder(db,companyId,key){const row=await db.prepare("SELECT record_key,summary_fields->>'/stored/guid' AS guid,summary_fields->>'/stored/master_id' AS master_id FROM tally_visibility_current_cache WHERE company_id=? AND entity='vouchers' AND record_key=? AND summary_fields->>'/stored/voucher_type'='Sales Order'").get(companyId,key);if(!row||!row.guid&&!row.master_id)return null;const count=await db.prepare("SELECT count(*)::integer AS n FROM tally_visibility_current_cache WHERE company_id=? AND entity='vouchers' AND summary_fields->>'/stored/voucher_type'='Sales Order' AND ((?::text IS NOT NULL AND lower(summary_fields->>'/stored/guid')=lower(?)) OR (?::text IS NULL AND summary_fields->>'/stored/master_id'=?))").get(companyId,row.guid,row.guid,row.guid,row.master_id);return count.n===1?row:null;}
export async function ownsOrderReservation(db,companyId,orderId,source,key){
 if(!orderId||!source||!(source.guid&&source.guid.toLowerCase()===key.toLowerCase()||!source.guid&&source.master_id===key))return false;
 const ids=[source.record_key,source.guid,source.master_id,source.guid?`guid:${source.guid}`:null,source.master_id?`master:${source.master_id}`:null].filter(Boolean),marks=ids.map(()=>'?').join(',');
 const links=await db.prepare(`SELECT DISTINCT crm_sales_order_id FROM tally_sync_job_items WHERE company_id=? AND entity_kind='sales_order' AND external_id IN (${marks}) AND upper(status) IN ('STORED','SUCCEEDED','SUCCESS','IN_TALLY') AND crm_sales_order_id IS NOT NULL`).all(companyId,...ids);
 return links.length===1&&links[0].crm_sales_order_id===orderId;
}

/** Explicit saved company and source IDs only. No current-header substitution. */
export async function bindOrderStock(db,body,snapshot,previous=null,orderId=null){
 const companyId=validate(s.uuid(),body.companyId??previous?.companyId,'companyId');
 if(previous?.companyId&&companyId!==previous.companyId)throw conflict('The saved order company cannot be changed. Review a new order instead.','ORDER_COMPANY_IMMUTABLE');
 if(!await db.prepare('SELECT id FROM tally_companies WHERE id=?').get(companyId))throw validationFailed('Select an existing imported company.');
 if(snapshot.quotationId){const quote=await db.prepare('SELECT public_snapshot FROM crm_quotation_workflows WHERE quotation_id=?').get(snapshot.quotationId);if(quote?.public_snapshot.companyId&&quote.public_snapshot.companyId!==companyId)throw conflict('Quotation and order source companies must match.','ORDER_QUOTE_COMPANY_MISMATCH');}
 if(!Array.isArray(body.lines)||body.lines.length!==snapshot.lines.length||body.lines.some(line=>!line||typeof line!=='object'))throw validationFailed('Stock bindings must match every reviewed order line.');
 snapshot.companyId=companyId;
 for(const [index,line]of snapshot.lines.entries()){
  const raw=body.lines[index],binding=validate(lineBinding,{basis:raw.stockBasis??null,reservationKey:raw.stockReservationKey??null,tallyOrderKey:raw.stockTallyOrderKey??null});
  if(binding.basis==='FREE_STOCK'&&(binding.reservationKey||binding.tallyOrderKey))throw validationFailed('Free-stock lines cannot claim another order reservation.');
  if(binding.basis==='RESERVED_STOCK'){
   if(!binding.reservationKey||!binding.tallyOrderKey)throw validationFailed('Reserved stock needs its exact source reservation ID and retained Tally sales-order identity.');
   if(!await ownsOrderReservation(db,companyId,orderId,await sourceOrder(db,companyId,binding.tallyOrderKey),binding.reservationKey))throw conflict('Reservation ownership is unverified. A successful retained company/order association must bind this exact Sales Order GUID/Master ID to this CRM order. New unassociated orders and allocation-only IDs remain blocked.','RESERVATION_OWNERSHIP_UNVERIFIED');
  }
  Object.assign(line,{stockBasis:binding.basis,stockReservationKey:binding.reservationKey,stockTallyOrderKey:binding.tallyOrderKey});
 }
 return snapshot;
}

export async function pendingConsumption(db,companyId,itemId){return db.prepare('SELECT c.id FROM crm_stock_consumptions c LEFT JOIN crm_stock_consumption_reviews r ON r.consumption_id=c.id WHERE c.company_id=? AND c.item_id=? AND r.id IS NULL ORDER BY c.created_at,c.id').all(companyId,itemId);}
async function legacyConsumption(db,companyId,itemId){return (await db.prepare(`SELECT count(*)::integer AS count FROM crm_shipment_items si JOIN sales_order_lines ol ON ol.id=si.order_line_id
 JOIN crm_shipments sh ON sh.id=si.shipment_id LEFT JOIN crm_order_workflows ow ON ow.sales_order_id=sh.sales_order_id
 LEFT JOIN crm_stock_consumptions c ON c.shipment_id=sh.id AND c.order_line_id=ol.id
 WHERE ol.item_id=? AND c.id IS NULL AND (ow.public_snapshot->>'companyId'=? OR ow.public_snapshot->>'companyId' IS NULL)`).get(itemId,companyId)).count;}

export async function orderStockEvidence(db,order,{picked=null,clock=new SystemClock()}={}){
 const snapshot=order.public_snapshot,companyId=snapshot.companyId,flags=[],groups=[];let company=null;
 try{validate(s.uuid(),companyId);company=await db.prepare('SELECT id,name FROM tally_companies WHERE id=?').get(companyId);}catch{/* Legacy/unconfirmed company is a visible block, never selected-header fallback. */}
 if(!company)return {company:null,groups:[],flags:['ORDER_COMPANY_NOT_CONFIRMED'],fingerprint:fingerprint({companyId:null})};
 const repo=new StockCheckRepository(db),policy=await workflowRule(db,'stock.availability',false),latest=await repo.latest(companyId),current=await db.prepare('SELECT id,fulfilled_quantity::text AS fulfilled FROM sales_order_lines WHERE sales_order_id=? AND NOT is_deleted').all(order.sales_order_id),demands=new Map(),sources=new Map();
 for(const line of snapshot.lines){
  const amount=picked?picked.find(p=>p.id===line.id)?.quantity:format(sub(decimal(line.quantity),decimal(current.find(c=>c.id===line.id)?.fulfilled??'0')),6);
  if(amount==null||compare(decimal(amount),decimal('0'))<=0)continue;
  if(!line.itemId){flags.push('UNKNOWN_PART_CODE');continue;}
  if(!['FREE_STOCK','RESERVED_STOCK'].includes(line.stockBasis)){flags.push('LINE_STOCK_BASIS_NOT_CONFIRMED');continue;}
  const key=JSON.stringify([line.itemId,line.uom,line.stockBasis,line.stockReservationKey??null,line.stockTallyOrderKey??null]);
  const group=demands.get(key)??{key,itemId:line.itemId,uom:line.uom,basis:line.stockBasis,reservationKey:line.stockReservationKey??null,tallyOrderKey:line.stockTallyOrderKey??null,requestedQuantity:'0',lineIds:[]};
  group.requestedQuantity=format(add(decimal(group.requestedQuantity),decimal(amount)),6);group.lineIds.push(line.id);demands.set(key,group);
 }
 for(const group of demands.values()){
  const item=await repo.item(group.itemId);if(!item||item.uom!==group.uom){flags.push('UOM_MISMATCH');continue;}
  if(!sources.has(item.id))sources.set(item.id,await repo.source(companyId,item));
  const source=sources.get(item.id),plan=evaluateStock({source,policy,requestedQuantity:group.requestedQuantity,basis:group.basis,reservationKey:group.reservationKey,now:clock.now(),latestAttempt:latest});
  const pending=await pendingConsumption(db,companyId,item.id),legacyCount=await legacyConsumption(db,companyId,item.id);
  const ownership=group.basis==='FREE_STOCK'||group.reservationKey&&group.tallyOrderKey&&await ownsOrderReservation(db,companyId,order.sales_order_id,await sourceOrder(db,companyId,group.tallyOrderKey),group.reservationKey);
  if(!ownership)flags.push('RESERVATION_OWNERSHIP_UNVERIFIED');
  if(pending.length)flags.push('STOCK_CONSUMPTION_REVIEW_REQUIRED');if(legacyCount)flags.push('LEGACY_STOCK_REVIEW_REQUIRED');
  if(plan.status!=='VERIFIED')flags.push(plan.status==='STALE'?'STOCK_SOURCE_STALE':'STOCK_EVIDENCE_UNVERIFIED');else if(!plan.available)flags.push('STOCK_SHORT');
  groups.push({...group,item,source,plan,pending,legacyCount,ownership});
 }
 for(const itemId of new Set(groups.map(g=>g.itemId))){const matching=groups.filter(g=>g.itemId===itemId),onHand=matching[0].plan.stockInHand,total=matching.reduce((sum,g)=>add(sum,decimal(g.requestedQuantity)),decimal('0'));if(onHand!==null&&compare(total,decimal(onHand))>0)flags.push('STOCK_SHORT');}
 return {company,groups,flags:[...new Set(flags)].sort(),fingerprint:fingerprint({companyId,flags:[...new Set(flags)].sort(),groups:groups.map(g=>({key:g.key,source:g.plan.previewFingerprint,pending:g.pending.map(p=>p.id),legacy:g.legacyCount,ownership:g.ownership}))})};
}
export function publicStockEvidence(evidence){return evidence.groups.map(g=>({itemId:g.itemId,partCode:g.item.part_code,uom:g.uom,basis:g.basis,requestedQuantity:g.requestedQuantity,stockInHand:g.plan.stockInHand,reservedQuantity:g.plan.reservedQuantity,freeQuantity:g.plan.freeQuantity,selectedReservedQuantity:g.plan.selectedReservedQuantity,status:g.plan.status,available:g.plan.available,sourceTimestamp:g.plan.sourceTimestamp,ageSeconds:g.plan.ageSeconds,issues:g.plan.issues,pendingConsumptionCount:g.pending.length,legacyReviewCount:g.legacyCount,ownershipVerified:Boolean(g.ownership),note:'Pending CRM dispatches require independent review. No subtraction or import-time reset is assumed.'}));}

/** Called inside the existing authorised dispatch transaction after exact picks. */
export async function checkDispatchStock(db,order,picked){
 const evidence=await orderStockEvidence(db,order,{picked});
 if(evidence.flags.length)throw conflict(`Dispatch blocked: ${evidence.flags.join(', ')}. Resolve stock evidence and independent reconciliation first.`,'STOCK_FULFILLMENT_BLOCKED',{flags:evidence.flags});
 return evidence;
}
export async function retainDispatchConsumption(db,order,shipmentId,picked,evidence,actor,reason){
 const repo=new StockCheckRepository(db),audit=new AuditRepository(db);
 for(const group of evidence.groups){
  const check=await repo.insert(evidence.company,group.item,{requestId:randomUUID(),salesOrderId:order.sales_order_id,requestedQuantity:group.requestedQuantity,basis:group.basis,reason},group.plan,actor,fingerprint({shipmentId,key:group.key}));
  await audit.record({actorId:actor.id,entity:'STOCK_CHECK',recordId:check.id,action:'DISPATCH_STOCK_VERIFIED',reason,newValue:{companyId:evidence.company.id,itemId:group.itemId,shipmentId}});
  for(const pick of picked.filter(p=>group.lineIds.includes(p.id))){
   const saved=await db.prepare(`INSERT INTO crm_stock_consumptions(company_id,item_id,sales_order_id,order_line_id,shipment_id,stock_check_id,quantity,uom,basis,reservation_key,source_session_id,source_observed_at,source_record_key,source_record_id,created_by,reason)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).get(evidence.company.id,group.itemId,order.sales_order_id,pick.id,shipmentId,check.id,pick.quantity,group.uom,group.basis,group.reservationKey,group.plan.sourceSessionId,group.plan.sourceTimestamp,group.plan.sourceRecordKey,group.source.record_id,actor.id,reason);
   await audit.record({actorId:actor.id,entity:'STOCK_CONSUMPTION',recordId:saved.id,action:'PENDING_INDEPENDENT_RECONCILIATION',reason,newValue:{shipmentId,itemId:group.itemId,quantity:pick.quantity,companyId:evidence.company.id}});
  }
 }
}

export class StockConsumptionService {
 constructor({db,clock=new SystemClock()}){this.db=db;this.clock=clock;this.repo=new StockCheckRepository(db);this.tx=new TransactionRunner(db);this.audit=new AuditRepository(db);}
 async owner(actor){if(actor?.role!=='OWNER'||!hasPermission(actor,'rules.manage')||!await this.db.prepare("SELECT id FROM users WHERE id=? AND role='OWNER' AND status='ACTIVE'").get(actor.id))throw forbidden('A real active Owner is required for stock reconciliation.');}
 async list(actor,companyId){await this.owner(actor);validate(s.uuid(),companyId);return this.db.prepare(`SELECT c.id,c.created_at,c.created_by,c.item_id,i.part_code,c.sales_order_id,o.order_number,c.shipment_id,c.quantity::text AS quantity,c.uom,c.source_observed_at,c.reason
 FROM crm_stock_consumptions c JOIN items i ON i.id=c.item_id JOIN sales_orders o ON o.id=c.sales_order_id LEFT JOIN crm_stock_consumption_reviews r ON r.consumption_id=c.id WHERE c.company_id=? AND r.id IS NULL ORDER BY c.created_at,c.id LIMIT 100`).all(companyId);}
 async preview(actor,id){await this.owner(actor);validate(s.uuid(),id);const movement=await this.db.prepare('SELECT * FROM crm_stock_consumptions WHERE id=?').get(id);if(!movement)throw notFound('Stock consumption not found.');
  const item=await this.repo.item(movement.item_id),source=item?await this.repo.source(movement.company_id,item):null,policy=await workflowRule(this.db,'stock.availability',false),latest=await this.repo.latest(movement.company_id);
  const plan=evaluateStock({source,policy,requestedQuantity:format(decimal(movement.quantity),6),basis:'FREE_STOCK',now:this.clock.now(),latestAttempt:latest});
  const eligible=movement.created_by!==actor.id&&plan.status==='VERIFIED'&&plan.sourceSessionId!==movement.source_session_id&&new Date(plan.sourceTimestamp)>new Date(movement.created_at);
  return {movementId:id,companyId:movement.company_id,canReview:eligible,status:plan.status,sourceSessionId:plan.sourceSessionId,sourceTimestamp:plan.sourceTimestamp,sourceRecordKey:plan.sourceRecordKey,sourceRecordId:source?.record_id??null,stockInHand:plan.stockInHand,reservedQuantity:plan.reservedQuantity,issues:plan.issues,note:'A different Owner must manually verify that this later source includes the exact dispatch movement. Availability alone does not prove that.',fingerprint:fingerprint({id,actorId:actor.id,plan:plan.previewFingerprint,recordId:source?.record_id??null,eligible})};
 }
 async review(actor,id,raw){await this.owner(actor);validate(s.uuid(),id);const body=validate(s.object({requestKey:s.uuid(),reason:s.reason(),evidenceReference:s.string({min:3,max:2000}),attestedInTally:s.bool(),sourceFingerprint:s.string({pattern:/^[a-f0-9]{64}$/})}),raw);
  if(body.attestedInTally!==true)throw validationFailed('Explicitly attest the independently checked Tally movement.');
  const hash=fingerprint({id,actorId:actor.id,body});return this.tx.run(actor,body.reason,async()=>{
   await this.db.prepare('SELECT pg_advisory_xact_lock(812731),pg_advisory_xact_lock(hashtext(?))').get(`stock-review:${body.requestKey}`);
   const existing=await this.db.prepare('SELECT id,reviewer_id,request_hash FROM crm_stock_consumption_reviews WHERE request_key=?').get(body.requestKey);if(existing){if(existing.reviewer_id!==actor.id||existing.request_hash!==hash)throw conflict('Stock review retry key was reused for another command.','IDEMPOTENCY_KEY_REUSED');return {id:existing.id,replayed:true};}
   if(await this.db.prepare('SELECT id FROM crm_stock_consumption_reviews WHERE consumption_id=?').get(id))throw conflict('This consumption was already independently reviewed.');
   const plan=await this.preview(actor,id);if(!plan.canReview)throw conflict('A different Owner and a later fresh successful stock receipt are required.','STOCK_RECONCILIATION_BLOCKED');if(plan.fingerprint!==body.sourceFingerprint)throw conflict('Stock reconciliation preview changed. Review the current evidence again.');
   const saved=await this.db.prepare('INSERT INTO crm_stock_consumption_reviews(consumption_id,source_session_id,source_observed_at,source_record_key,source_record_id,reviewer_id,evidence_reference,attested_in_tally,reason,request_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?) RETURNING id').get(id,plan.sourceSessionId,plan.sourceTimestamp,plan.sourceRecordKey,plan.sourceRecordId,actor.id,body.evidenceReference,true,body.reason,body.requestKey,hash);
   await this.audit.record({actorId:actor.id,entity:'STOCK_CONSUMPTION',recordId:id,action:'INDEPENDENT_OWNER_SOURCE_RECONCILIATION',reason:body.reason,newValue:{reviewId:saved.id,sourceSessionId:plan.sourceSessionId,evidenceReference:body.evidenceReference}});return {id:saved.id,replayed:false};
  });
 }
}

export function stockFulfillmentRoutes({db,route,json,readJson}){const service=new StockConsumptionService({db});return [
 route('GET','/api/crm/order-stock-sources','orders.update',async({res,url})=>{const companyId=validate(s.uuid(),url.searchParams.get('companyId'));const rows=await db.prepare("SELECT record_key AS id,summary_fields->>'/stored/voucher_number' AS number,summary_fields->>'/stored/party_name' AS party,summary_fields->>'/stored/guid' AS guid,summary_fields->>'/stored/master_id' AS master_id FROM tally_visibility_current_cache WHERE company_id=? AND entity='vouchers' AND summary_fields->>'/stored/voucher_type'='Sales Order' ORDER BY observed_at DESC,record_key LIMIT 100").all(companyId);json(res,200,{data:rows});}),
 route('GET','/api/crm/stock-consumptions','rules.manage',async({res,url,user})=>json(res,200,{data:await service.list(user,url.searchParams.get('companyId'))})),
 route('GET','/api/crm/stock-consumptions/:id/preview','rules.manage',async({res,params,user})=>json(res,200,{data:await service.preview(user,params.id)})),
 route('POST','/api/crm/stock-consumptions/:id/review','rules.manage',async({req,res,params,user})=>json(res,200,{data:await service.review(user,params.id,await readJson(req))}))
 ];}
