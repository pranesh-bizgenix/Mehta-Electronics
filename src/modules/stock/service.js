import {s,validate} from '../../core/schema.js';
import {notFound,conflict,validationFailed} from '../../core/errors.js';
import {hasPermission} from '../../rbac.js';
import {workflowRule} from '../rules/workflow-rules.js';
import {requireCustomerHandler} from '../operations/customer-gates.js';
import {evaluateStock} from './availability.js';
import {fingerprint} from '../../core/runtime.js';
const requestSchema=s.object({requestId:s.uuid().optional(),itemId:s.id(),requestedQuantity:s.string({pattern:/^\d{1,24}(?:\.\d{1,6})?$/}),basis:s.enum(['FREE_STOCK','RESERVED_STOCK']),reservationKey:s.string({min:1,max:250}).optional(),salesOrderId:s.id().optional(),reason:s.reason().optional(),previewFingerprint:s.string({pattern:/^[a-f0-9]{64}$/}).optional()});
export class StockCheckService {
 constructor(dependencies){Object.assign(this,dependencies);}
 async plan(actor,company,input){
  this.access.require(actor,'items.read');const b=validate(requestSchema,input),item=await this.repository.item(b.itemId);if(!item)throw notFound('Choose an active CRM product.');
  if(b.salesOrderId){this.access.require(actor,'orders.read');const order=await this.repository.order(b.salesOrderId);if(!order)throw notFound('Order not found.');await requireCustomerHandler(this.db,order.public_snapshot.customerId,actor);if(order.public_snapshot.companyId!==company.id)throw conflict('This order has no matching confirmed source-company binding. Record an independent stock check until the order company is confirmed.');if(!order.public_snapshot.lines.some(row=>row.itemId===item.id))throw validationFailed('The product is not a line of this order.');}
  const source=await this.repository.source(company.id,item),policy=await workflowRule(this.db,'stock.availability',false),latestAttempt=await this.repository.latest(company.id);
  return {input:b,item,plan:evaluateStock({source,policy,requestedQuantity:b.requestedQuantity,basis:b.basis,reservationKey:b.reservationKey??null,now:this.clock.now(),latestAttempt})};
 }
 async preview(actor,company,input){const {item,plan}=await this.plan(actor,company,input);return {company,item,...plan,readOnly:true,note:'Stored Tally evidence only. This check neither reserves stock nor authorises dispatch.'};}
 async record(actor,company,input){
  this.access.require(actor,'orders.update');this.access.require(actor,'items.read');const reason=validate(s.reason(),input?.reason,'reason');
  const b=validate(requestSchema,input),id=validate(s.uuid(),b.requestId,'requestId'),requestHash=fingerprint({companyId:company.id,actorId:actor.id,input:b});
  return this.transactions.run(actor,reason,async()=>{
   await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,0))').get(`stock-check:${id}`);
   const existing=await this.repository.existing(id);
   if(existing){if(existing.company_id!==company.id||existing.created_by!==actor.id||existing.reservation_detail?.requestHash!==requestHash)throw conflict('This request ID was already used for a different stock check.');return {id:existing.id,status:existing.status,replayed:true};}
   const {item,plan}=await this.plan(actor,company,b);
   if(b.previewFingerprint!==plan.previewFingerprint)throw conflict('Stock evidence, mapping or freshness changed. Preview this check again.');
   const row=await this.repository.insert(company,item,b,plan,actor,requestHash);await this.audit.record({actorId:actor.id,entity:'STOCK_CHECK',recordId:row.id,action:'CHECK_RECORDED',reason,newValue:{companyId:company.id,itemId:item.id,status:plan.status,policyVersion:plan.policyVersion,sourceRecordKey:plan.sourceRecordKey}});return {id:row.id,status:plan.status};
  });
 }
 async history(actor,company,page){this.access.require(actor,'items.read');return this.repository.history(company.id,hasPermission(actor,'users.read')?null:actor.id,validate(s.int({min:1,max:100000}),page));}
 async daily(actor,company,day){this.access.require(actor,'items.read');this.access.require(actor,'users.read');return this.repository.daily(company.id,validate(s.date(),day));}
}
