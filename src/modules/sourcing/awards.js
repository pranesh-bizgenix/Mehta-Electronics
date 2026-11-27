import crypto from 'node:crypto';
import {s,validate} from '../../core/schema.js';
import {TransactionRunner,AuditRepository,fingerprint} from '../../core/runtime.js';
import {hasPermission} from '../../rbac.js';
import {conflict,forbidden,notFound,validationFailed} from '../../core/errors.js';
import {purchaseRecord,purchaseSource,procurementNumber} from '../../procurement.js';
import {quotePolicy} from '../../quotation-workflow.js';
import {SourcingService} from './service.js';
import {splitAwardGroups,splitAwardDecision} from './award-domain.js';
import {tallyWriteActive,notifyTallyWrite} from '../tally-write/module.js';
import {renderPdf} from '../billing/pdf.js';
const allocation=s.object({replyId:s.id(),itemId:s.id(),quantity:s.string({pattern:/^\d{1,12}(?:\.\d{1,6})?$/}),promisedOn:s.date()});
const request=s.object({requestKey:s.uuid(),rfqVersion:s.int({min:1}),comparisonFingerprint:s.string({pattern:/^[a-f0-9]{64}$/}),termsConfirmed:s.bool(),evidence:s.string({min:3,max:2000}),reason:s.reason(),allocations:s.array(allocation,{min:1,max:300})});
const decision=s.object({version:s.int({min:1}),action:s.enum(['APPROVE','REJECT','CANCEL','CREATE_ORDERS']),reason:s.reason()});

export class SplitAwardService{
 constructor({db}){this.db=db;this.sourcing=new SourcingService({db});this.transactions=new TransactionRunner(db);this.audit=new AuditRepository(db);}
 one(sql,...args){return this.db.prepare(sql).get(...args);}
 all(sql,...args){return this.db.prepare(sql).all(...args);}
 access(actor,permission='purchasing.read'){if(!hasPermission(actor,permission))throw forbidden();}
 write(actor,reason,fn){this.access(actor,'purchasing.write');return this.transactions.run(actor,reason,async()=>{await this.one("SELECT pg_advisory_xact_lock(812731),set_config('mehta.procurement_write','authorized',true)");return fn();});}
 async source(actor,rfqId){
  const c=await this.sourcing.comparison(actor,rfqId);
  if(c.rfq.status!=='OPEN')throw conflict('Split awards require an open RFQ without an ordinary winner.');
  const existing=await this.one("SELECT id FROM crm_supplier_pos WHERE rfq_id=? AND split_award_id IS NULL AND status<>'CANCELLED'",c.rfq.id);if(existing)throw conflict('An ordinary supplier PO already consumes this RFQ.');
  const request=await purchaseRecord(this.db,'requests',c.rfq.request_id,actor),policy=await quotePolicy(this.db);if(!policy)throw conflict('Confirm the company purchasing state first.');
  const sourceOrder=request.sales_order_id?await purchaseSource(this.db,request.sales_order_id,actor):null;
  const offers=[];
  for(const offer of c.offers){
   const reply=c.replies.find(r=>r.id===offer.id),vendor=await purchaseRecord(this.db,'vendors',offer.vendorId,actor);
   offers.push({...offer,status:reply.status,vendor:vendor.payload,vendorVersion:vendor.version,vendorStatus:vendor.status,terms:reply.payload.terms,commercial:reply.payload.commercial,
    flagsByItem:Object.fromEntries(c.landedRows.map(r=>[r.item.itemId,r.offers.find(o=>o.replyId===offer.id)?.flags||['ITEM_NOT_OFFERED']])),
    lines:offer.lines.map(l=>({...l,taxPercent:reply.payload.lines.find(p=>p.itemId===l.itemId)?.taxPercent}))});
  }
  const sourceFingerprint=fingerprint({rfqVersion:c.rfq.version,offers,policyRevision:policy.revision,sourceOrder:sourceOrder?.source||null});
  return {comparison:c,offers,policy,sourceOrder,sourceFingerprint};
 }
 async list(actor,rfqId){this.access(actor);await purchaseRecord(this.db,'rfqs',rfqId,actor);return this.all("SELECT a.*,u.name AS creator_name,v.name AS reviewer_name,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'number',p.number,'vendor_id',p.vendor_id,'status',p.status) ORDER BY p.id) FROM crm_supplier_pos p WHERE p.split_award_id=a.id),'[]'::jsonb) AS orders FROM sourcing_awards a JOIN users u ON u.id=a.created_by LEFT JOIN users v ON v.id=a.approved_by WHERE a.rfq_id=? ORDER BY a.created_at DESC,a.id LIMIT 100",rfqId);}
 async detail(actor,id){this.access(actor);const plan=await this.one('SELECT * FROM sourcing_awards WHERE id=?',validate(s.uuid(),id));if(!plan)throw notFound('Split award not found.');return {...plan,allocations:await this.all('SELECT id,reply_id,vendor_id,item_id,quantity::text AS quantity,promised_on FROM sourcing_award_allocations WHERE award_id=? ORDER BY vendor_id,item_id',id),orders:await this.all('SELECT id,number,vendor_id,status,version FROM crm_supplier_pos WHERE split_award_id=? ORDER BY id',id)};}
 async create(actor,rfqId,body){this.access(actor,'purchasing.write');const b=validate(request,body),requestHash=fingerprint({rfqId,request:b});return this.write(actor,b.reason,async()=>{
  const retry=await this.one('SELECT * FROM sourcing_awards WHERE request_key=?',b.requestKey);if(retry){if(retry.request_hash!==requestHash||retry.created_by!==actor.id)throw conflict('Retry key already identifies different split details.');return this.detail(actor,retry.id);}
  const source=await this.source(actor,rfqId),c=source.comparison;
  if(c.rfq.version!==b.rfqVersion||c.comparisonFingerprint!==b.comparisonFingerprint)throw conflict('Supplier comparison changed. Reload before allocating.');
  if(await this.one("SELECT id FROM sourcing_awards WHERE rfq_id=? AND status IN ('PENDING_APPROVAL','APPROVED','ORDERED')",rfqId))throw conflict('Resolve the existing active split award first.');
  const allocations=b.allocations.map(a=>({...a,lineKey:crypto.randomUUID()}));
  const preview=splitAwardGroups({requested:c.rfq.payload.lines,offers:source.offers,allocations,today:this.sourcing.today(),buyerState:source.policy.seller_state,termsConfirmed:b.termsConfirmed});
  const snapshot={allocations,preview,buyerState:source.policy.seller_state,policyRevision:source.policy.revision,sourceOrder:source.sourceOrder?.source||null};
  const plan=await this.one('INSERT INTO sourcing_awards(rfq_id,request_key,request_hash,source_fingerprint,snapshot,evidence,created_by) VALUES(?,?,?,?,?::text::jsonb,?,?) RETURNING *',rfqId,b.requestKey,requestHash,source.sourceFingerprint,JSON.stringify(snapshot),b.evidence,actor.id);
  for(const a of allocations){const offer=source.offers.find(o=>o.id===a.replyId);await this.db.prepare('INSERT INTO sourcing_award_allocations(id,award_id,reply_id,vendor_id,item_id,quantity,promised_on) VALUES(?,?,?,?,?,?,?)').run(a.lineKey,plan.id,a.replyId,offer.vendorId,a.itemId,a.quantity,a.promisedOn);}
  await this.audit.record({actorId:actor.id,entity:'SUPPLIER_SPLIT_AWARD',recordId:plan.id,action:'REQUESTED',reason:b.reason,newValue:{rfqId,allocationCount:allocations.length,total:preview.total,sourceFingerprint:source.sourceFingerprint}});return this.detail(actor,plan.id);
 });}
 async current(actor,plan){const source=await this.source(actor,plan.rfq_id);if(source.sourceFingerprint!==plan.source_fingerprint)throw conflict('Split source, supplier terms, customer order or pricing policy changed. Cancel this plan and request a fresh review.');splitAwardGroups({requested:source.comparison.rfq.payload.lines,offers:source.offers,allocations:plan.snapshot.allocations,today:this.sourcing.today(),buyerState:source.policy.seller_state,termsConfirmed:true});return source;}
 async act(actor,id,body){const b=validate(decision,body);this.access(actor,['APPROVE','REJECT'].includes(b.action)?'purchasing.approve':'purchasing.write');
  const result=await this.write(actor,b.reason,async()=>{
   const plan=await this.one('SELECT * FROM sourcing_awards WHERE id=? FOR UPDATE',validate(s.uuid(),id));if(!plan)throw notFound();
   if(b.action==='CREATE_ORDERS'&&plan.status==='ORDERED'){if(b.version!==plan.version&&b.version!==plan.version-1)throw conflict('Reload the split plan.');return this.detail(actor,id);}
   const next=splitAwardDecision(plan,b.action,actor.id,b.version);
   if(b.action==='APPROVE')await this.current(actor,plan);
   if(b.action==='CANCEL'&&await this.one("SELECT id FROM crm_supplier_pos WHERE split_award_id=? AND status<>'CANCELLED' LIMIT 1",id))throw conflict('Cancel the generated supplier POs through their normal workflow before cancelling the split.');
   if(b.action==='CREATE_ORDERS'){
    const reviewer=await this.one("SELECT u.id,u.role FROM users u JOIN roles r ON r.key=u.role WHERE u.id=? AND u.status='ACTIVE' AND r.status='ACTIVE'",plan.approved_by);if(!reviewer||!hasPermission(reviewer,'purchasing.approve'))throw conflict('Split reviewer no longer has current approval authority.');
    const source=await this.current(actor,plan);
    for(const g of plan.snapshot.preview.groups){
     const payload={vendor:g.vendor,deliveryBy:g.deliveryBy,terms:g.terms,notes:'Approved split award '+id,sourceOrder:source.sourceOrder?.source||null,sourceReply:{id:g.replyId,version:g.replyVersion,validUntil:g.validUntil},buyer:source.policy.letterhead,vendorState:g.vendor.stateCode,buyerState:source.policy.seller_state,policyRevision:source.policy.revision,...g.totals,deliverySchedule:g.lines.map(l=>({poLineKey:l.lineKey,date:l.promisedOn,quantity:l.quantity})),_editor:actor.id};
     const po=await this.one('INSERT INTO crm_supplier_pos(number,vendor_id,rfq_id,sales_order_id,split_award_id,payload,created_by) VALUES(?,?,?,?,?,?::text::jsonb,?) RETURNING id,number',procurementNumber('SPO'),g.vendorId,plan.rfq_id,source.sourceOrder?.orderId||null,id,JSON.stringify(payload),actor.id);
     await this.audit.record({actorId:actor.id,entity:'SUPPLIER_PO',recordId:po.id,action:'SPLIT_DRAFT_CREATED',reason:b.reason,newValue:{splitAwardId:id,vendorId:g.vendorId,number:po.number,total:g.total}});
    }
   }
   await this.db.prepare('UPDATE sourcing_awards SET status=?,version=version+1,approved_by=?,decision_reason=? WHERE id=?').run(next,b.action==='APPROVE'?actor.id:plan.approved_by,b.reason,id);
   await this.audit.record({actorId:actor.id,entity:'SUPPLIER_SPLIT_AWARD',recordId:id,action:b.action,reason:b.reason,newValue:{from:plan.status,to:next,version:plan.version+1}});return this.detail(actor,id);
  });
  if(b.action==='CREATE_ORDERS'&&tallyWriteActive(this.db,'PURCHASE_ORDER'))for(const po of result.orders)await notifyTallyWrite(this.db,'PURCHASE_ORDER',po.id,actor);
  return result;
 }
 async pdf(actor,id,reason,preview){validate(s.reason(),reason);const plan=await this.detail(actor,id);const rows=plan.snapshot.preview.groups.flatMap(g=>g.lines.map(l=>[g.vendor.name,l.partCode,l.quantity,l.uom,l.promisedOn,l.unitPrice]));const bytes=await renderPdf({title:'Supplier split award',subtitle:`${plan.status} | Version ${plan.version}`,sections:[{label:'Award ID',value:plan.id},{label:'Evidence',value:plan.evidence},{label:'Control',value:'Each generated supplier PO remains subject to its independent approval and goods-receipt checks.'}],columns:[{label:'Supplier',fraction:.24},{label:'Item',fraction:.22},{label:'Qty',fraction:.12},{label:'UoM',fraction:.1},{label:'Delivery',fraction:.16},{label:'Base rate INR',fraction:.16}],rows});await this.audit.record({actorId:actor.id,entity:'SUPPLIER_SPLIT_AWARD',recordId:id,action:preview?'PDF_PREVIEW':'PDF_DOWNLOAD',reason,newValue:{version:plan.version}});return {bytes,filename:'supplier-split-'+id+'.pdf'};}
}
