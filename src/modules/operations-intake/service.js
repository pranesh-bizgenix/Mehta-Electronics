import {s,validate} from '../../core/schema.js';
import {TransactionRunner,AuditRepository,fingerprint,SystemClock} from '../../core/runtime.js';
import {conflict,forbidden,notFound,validationFailed} from '../../core/errors.js';
import {hasPermission} from '../../rbac.js';
import {workflowRule} from '../rules/workflow-rules.js';
import {departmentOwners} from '../automation-api/department-routing.js';
import {evaluateStock} from '../stock/availability.js';
import {requireCustomerHandler} from '../operations/customer-gates.js';
import {StockCheckService} from '../stock/service.js';
import {OperationsStockRepository} from './stock-repository.js';
import {NotificationRepository,NotificationService} from '../notifications/notification-service.js';
import {saveRequest} from '../../procurement.js';
import {orderDetail} from '../../sales-orders.js';
import {decimal,sub,format} from '../../../public/money.js';
import {normalizeOperations,reviewSchema,actionSchema,readPermission,writePermission,kinds,statuses,quantity,shortageOf} from './contract.js';
import {OperationsIntakeRepository} from './repository.js';
const terminal=r=>['REJECTED','COMPLETED'].includes(r.status);
export const requirePermission=(actor,key)=>{if(!actor?.id||!hasPermission(actor,key))throw forbidden('Operations request permission required.');};
export class OperationsIntakeService {
 constructor({db,clock=new SystemClock()}){
  this.db=db;this.clock=clock;this.repo=new OperationsIntakeRepository(db);this.transactions=new TransactionRunner(db);this.audit=new AuditRepository(db);
  this.stock=new StockCheckService({db,clock,repository:new OperationsStockRepository(db),transactions:this.transactions,audit:this.audit,access:{require:requirePermission}});
 }
 async write(actor,reason,fn){validate(s.reason(),reason);return this.transactions.run(actor,reason,async()=>{await this.repo.one("SELECT pg_advisory_xact_lock(812731),set_config('mehta.operations_intake_write','authorized',true)");return fn();});}
 async event(row,actor,action,reason,detail={},credentialId=null){
  await this.repo.event(row,actor,action,reason,detail,credentialId);
  await this.audit.record({actorId:actor?.id??null,entity:'OPERATIONS_INTAKE',recordId:row.id,action,reason,newValue:{companyId:row.company_id,version:row.version,...detail,...(credentialId?{credentialId}:{})}});
 }
 receipt(row,duplicate){return {id:row.id,status:row.status,kind:row.kind,companyId:row.company_id,requiresReview:row.status==='NEEDS_REVIEW',duplicate,version:row.version};}
 async facts(principal,id){
  if(principal?.kind!=='AUTOMATION_SERVICE'||principal.scope!=='automation.read')throw forbidden();
  const row=await this.repo.get(validate(s.uuid(),id),validate(s.uuid(),principal.companyId));
  if(!row||row.credential_id!==principal.credentialId)throw notFound('Operations receipt not found for this credential.');
  const result={id:row.id,requestStatus:row.status,checkedAt:this.clock.now().toISOString(),requiresReview:true,facts:[],reviewReasons:[]};
  if(!['REVIEWED','APPROVED','COMPLETED'].includes(row.status)||!row.resolutions.sourceChecked){result.reviewReasons.push('Staff review of the original request is required.');return result;}
  const actor=await this.repo.one("SELECT id,role FROM users WHERE id=? AND status='ACTIVE'",principal.ownerId);requirePermission(actor,readPermission(row.kind));
  const check=await this.verify(actor,row),blockers=check.blockers.filter(v=>!(row.source.action==='ENQUIRY'&&v==='Order changed after review; save a fresh review.'));
  if(blockers.length){result.reviewReasons=blockers;return result;}
  if(row.kind==='ORDER_STATUS'&&check.order){const o=check.order;
   result.facts.push({id:'order.status',text:`The recorded order status is ${o.effectiveStatus??o.status}.`});
   if(['UPDATE_REQUEST','CANCEL_REQUEST'].includes(row.source.action))result.facts.push({id:'request.decision',text:`The requested change is recorded with CRM request status ${row.status}. This request status does not confirm that the order change has been applied.`});
   for(const [i,l] of o.lines.slice(0,10).entries())result.facts.push({id:'order.line.'+i,text:`${l.partCode}: ordered ${l.quantity} ${l.uom}, supplied ${l.fulfilledQuantity} ${l.uom}, pending ${format(sub(decimal(l.quantity),decimal(l.fulfilledQuantity)),6)} ${l.uom}.`});
   for(const sh of o.shipments.slice(0,5))result.facts.push({id:'order.shipment.'+sh.id,text:`Shipment status: ${sh.status}${sh.lr_number?'; LR '+sh.lr_number:''}.`});
   if(o.lines.length>10||o.shipments.length>5)result.reviewReasons.push('Additional order lines or shipments require staff follow-up.');
  }else if(['STOCK','PROCUREMENT'].includes(row.kind)){
   const stock=await this.stockPreview(actor,row.id,row.company_id);
   for(const l of stock.lines){if(l.status!=='VERIFIED'||l.freeQuantity===null){result.reviewReasons.push(`Product ${l.partCode} needs a fresh verified stock check.`);continue;}result.facts.push({id:'stock.'+l.lineId,text:`${l.partCode}: recorded free stock ${l.freeQuantity} ${l.uom}, observed ${l.sourceTimestamp}. This check does not reserve stock or confirm delivery.`});}
   if(!stock.lines.length)result.reviewReasons.push('Reviewed product lines are required.');
  }
  result.requiresReview=result.reviewReasons.length>0||!result.facts.length;
  // Do not return partial availability when any requested product is unknown.
  if(result.requiresReview)result.facts=[];
  return result;
 }
 async receive(principal,input,key){
  if(principal?.kind!=='AUTOMATION_SERVICE'||principal.scope!=='automation.write.intake')throw forbidden();
  const companyId=validate(s.uuid(),principal.companyId),source=normalizeOperations(input),expectedKey=`ops:${source.emailId}`;
  if(key!==expectedKey)throw validationFailed('Idempotency-Key must be ops: followed by email_message_id.');
  // Reply timestamps, claimed verification and other ignored Make bookkeeping
  // must not turn a retry of the same immutable source into a conflicting PO.
  const hash=fingerprint(source),actor={id:principal.ownerId};
  return this.write(actor,'Receive authenticated Operations request',async()=>{
   const existing=await this.repo.existing(companyId,source.emailId);
   if(existing){if(existing.request_hash!==hash||existing.credential_id!==principal.credentialId)throw conflict('This email was already delivered with different content or a different credential.');return this.receipt(existing,true);}
   for(const id of [principal.ownerId,principal.backupOwnerId])if(!(await this.repo.one("SELECT id FROM users WHERE id=? AND status='ACTIVE'",id)))throw conflict('Integration owner or backup is inactive.');
   const routing=await departmentOwners(this.db,principal,'OPERATIONS',[readPermission(source.kind),writePermission(source.kind)]);
   const contacts=await this.repo.contacts(source.sender),customerId=contacts.length===1?contacts[0].id:null;
   let orderId=null;if(customerId&&source.kind==='ORDER_STATUS'&&source.poNumbers.length===1){const matches=await this.repo.orders(companyId,customerId,source.poNumbers[0]);if(matches.length===1)orderId=matches[0].id;}
   const row=await this.repo.one('INSERT INTO crm_operations_intakes(company_id,credential_id,email_message_id,provider_message_id,request_hash,kind,source,customer_id,sales_order_id,assigned_to,backup_owner_id) VALUES(?,?,?,?,?,?,?::text::jsonb,?,?,?,?) RETURNING *',companyId,principal.credentialId,source.emailId,source.providerMessageId,hash,source.kind,JSON.stringify(source),customerId,orderId,routing.ownerId,routing.backupOwnerId);
   await this.event(row,actor,'RECEIVED','Receive authenticated Operations request',{customerId,orderId,routing:routing.routing},principal.credentialId);
   for(const recipientId of new Set([routing.ownerId,routing.backupOwnerId]))await new NotificationService({repository:new NotificationRepository(this.db)}).notify(recipientId,{type:'OPERATIONS_REQUEST_RECEIVED',title:'Operations request needs review',message:'Open Operations to review the received request.',entityType:'OPERATIONS_INTAKE',entityId:row.id},`operations-intake:${row.id}:received`);
   return this.receipt(row,false);
  });
 }
 async access(actor,row,write=false){
  if(!row)throw notFound('Operations request not found.');requirePermission(actor,write?writePermission(row.kind):readPermission(row.kind));
  if(!this.supervisor(actor)&&![row.assigned_to,row.backup_owner_id].includes(actor.id))throw notFound('Assigned Operations request not found.');
  if(row.customer_id)await requireCustomerHandler(this.db,row.customer_id,actor);return row;
 }
 supervisor(actor){return actor.role==='OWNER'||hasPermission(actor,'work.reassign');}
 async list(actor,params){const companyId=validate(s.uuid(),params.get('companyId')),kind=validate(s.enum(kinds),params.get('kind')),status=params.get('status')?validate(s.enum(statuses),params.get('status')):'',page=validate(s.int({min:1,max:100000}),params.get('page')??1);requirePermission(actor,readPermission(kind));return this.repo.list(companyId,kind,status,page,this.supervisor(actor)?null:actor.id);}
 async row(actor,id,companyId,write=false,lock=false){return this.access(actor,await this.repo.get(validate(s.uuid(),id),validate(s.uuid(),companyId),lock),write);}
 async verify(actor,row){
  const blockers=[],r=row.resolutions,source=row.source;
  if(!r.sourceChecked)blockers.push('Check the original email, attachments and extraction warnings.');
  if(!row.customer_id)blockers.push('Confirm the customer.');
  else if(!await this.repo.one("SELECT id FROM customers WHERE id=? AND status='ACTIVE' AND NOT is_deleted",row.customer_id))blockers.push('Customer is inactive or archived.');
  let order=null;
  if(row.sales_order_id){
   const binding=await this.repo.one("SELECT w.version,w.public_snapshot FROM crm_order_workflows w JOIN sales_orders o ON o.id=w.sales_order_id WHERE w.sales_order_id=? AND o.customer_id=? AND NOT o.is_deleted AND w.public_snapshot->>'companyId'=?",row.sales_order_id,row.customer_id,row.company_id);
   if(!binding)blockers.push('Order must belong to this customer and company.');
   else if(hasPermission(actor,'orders.read')){await requireCustomerHandler(this.db,row.customer_id,actor);order=await orderDetail(this.db,row.sales_order_id,actor);}
   if(r.orderVersion&&binding?.version!==r.orderVersion)blockers.push('Order changed after review; save a fresh review.');
  }
  if(row.kind==='ORDER_STATUS'&&!row.sales_order_id)blockers.push('Select a verified customer order.');
  if(row.kind==='OTHER')blockers.push('Choose Order status, Stock or Procurement.');
  if(['STOCK','PROCUREMENT'].includes(row.kind)&&!r.items?.length)blockers.push('Match the requested products, quantities and units.');
  if(r.items?.length){const current=await this.repo.all("SELECT id,uom FROM items WHERE id=ANY(?::integer[]) AND status='ACTIVE' AND NOT is_deleted",r.items.map(l=>l.itemId));if(r.items.some(l=>!current.some(i=>i.id===l.itemId&&i.uom===l.uom)))blockers.push('A reviewed product or its unit changed; match the current catalogue again.');}
  return {blockers,order};
 }
 async detail(actor,id,companyId){const row=await this.row(actor,id,companyId);let procurementProgress=null;
  if(row.purchase_request_id&&hasPermission(actor,'purchasing.read'))procurementProgress={request:await this.repo.one('SELECT id,number,status FROM crm_purchase_requests WHERE id=?',row.purchase_request_id),rfqs:await this.repo.all('SELECT id,number,status FROM crm_rfqs WHERE request_id=? ORDER BY id DESC LIMIT 50',row.purchase_request_id),supplierOrders:await this.repo.all("SELECT p.id,p.number,p.status,p.payload->>'deliveryBy' AS delivery_by,coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'number',g.number,'status',g.status)) FROM crm_grns g WHERE g.supplier_po_id=p.id),'[]'::jsonb) AS receipts FROM crm_supplier_pos p JOIN crm_rfqs r ON r.id=p.rfq_id WHERE r.request_id=? ORDER BY p.id DESC LIMIT 50",row.purchase_request_id)};
  return {...row,...await this.verify(actor,row),procurementProgress,events:await this.repo.events(row.id)};
 }
 async review(actor,id,companyId,input){
  const b=validate(reviewSchema,input);
  return this.write(actor,b.reason,async()=>{
   const row=await this.row(actor,id,companyId,true,true);if(row.version!==b.version||terminal(row)||row.purchase_request_id)throw conflict('Request changed, is closed or already has a linked purchase request. Reload.');
   requirePermission(actor,writePermission(b.kind));requirePermission(actor,readPermission(b.kind));
   if(b.assignedTo!==row.assigned_to&&!this.supervisor(actor))throw forbidden('Reassignment requires staff reassignment permission.');
   const assignee=await this.repo.one("SELECT id,role FROM users WHERE id=? AND status='ACTIVE'",b.assignedTo);if(!assignee||b.assignedTo===row.backup_owner_id)throw validationFailed('Choose an active assignee different from the backup.');
   if(!hasPermission(assignee,readPermission(b.kind)))throw validationFailed('The assignee needs access to this Operations section.');
   if(b.customerId){if(!await this.repo.one("SELECT id FROM customers WHERE id=? AND status='ACTIVE' AND NOT is_deleted",b.customerId))throw validationFailed('Select an active customer.');await requireCustomerHandler(this.db,b.customerId,actor);}
   let orderVersion=null;if(b.orderId){const matches=await this.repo.one("SELECT w.version FROM crm_order_workflows w JOIN sales_orders o ON o.id=w.sales_order_id WHERE w.sales_order_id=? AND o.customer_id=? AND NOT o.is_deleted AND w.public_snapshot->>'companyId'=?",b.orderId,b.customerId,row.company_id);if(!matches)throw validationFailed('Order does not belong to this customer and company.');orderVersion=matches.version;}
   const seen=new Set();for(const l of b.items){quantity(l.quantity);if(seen.has(l.itemId))throw validationFailed('Combine duplicate products before saving.');seen.add(l.itemId);const item=await this.stock.repository.item(l.itemId);if(!item||item.uom!==l.uom)throw validationFailed('Select the exact CRM product and its base unit.');}
   const r={sourceChecked:b.sourceChecked,items:b.items,orderVersion};
   const candidate={...row,kind:b.kind,customer_id:b.customerId,sales_order_id:b.orderId,resolutions:r};const check=await this.verify(actor,candidate);
   const after=await this.repo.one('UPDATE crm_operations_intakes SET kind=?,status=?,customer_id=?,sales_order_id=?,assigned_to=?,resolutions=?::text::jsonb,reviewed_by=?,approved_by=NULL,version=version+1 WHERE id=? RETURNING *',b.kind,check.blockers.length?'NEEDS_REVIEW':'REVIEWED',b.customerId,b.orderId,b.assignedTo,JSON.stringify(r),actor.id,row.id);
   await this.event(after,actor,'REVIEW_SAVED',b.reason,{customerId:b.customerId,orderId:b.orderId,assignedTo:b.assignedTo});return this.detail(actor,id,companyId);
  });
 }
 async action(actor,id,companyId,input){const b=validate(actionSchema,input);return this.write(actor,b.reason,async()=>{
  const row=await this.row(actor,id,companyId,true,true);if(row.version!==b.version||terminal(row))throw conflict('Request changed or is closed. Reload.');
  const check=await this.verify(actor,row);let status;
  if(b.action==='REJECT'){
   if(row.purchase_request_id&&(await this.repo.one('SELECT status FROM crm_purchase_requests WHERE id=?',row.purchase_request_id))?.status!=='CANCELLED')throw conflict('Cancel the linked purchase-request draft in the existing purchasing workflow before rejecting this request.');status='REJECTED';
  }
  else if(b.action==='APPROVE'){
   requirePermission(actor,row.kind==='ORDER_STATUS'?'orders.review':row.kind==='PROCUREMENT'?'purchasing.approve':'orders.review');
   if(row.status!=='REVIEWED'||check.blockers.length)throw conflict('Resolve the required checks first.');
   if(row.reviewed_by===actor.id)throw forbidden('A different authorised person must approve this reviewed request.');status='APPROVED';
  }else{
   if(check.blockers.filter(v=>!(row.kind==='ORDER_STATUS'&&row.source.action==='UPDATE_REQUEST'&&v==='Order changed after review; save a fresh review.')).length)throw conflict('Resolve the required checks first.');
   if(row.source.action!=='ENQUIRY'&&row.kind==='ORDER_STATUS'&&row.status!=='APPROVED')throw conflict('Order changes and cancellations require independent request approval.');
   if(row.kind==='ORDER_STATUS'&&row.source.action==='CANCEL_REQUEST'&&check.order?.status!=='CANCELLED')throw conflict('Cancel the order through its existing workflow before completing this request.');
   if(row.kind==='ORDER_STATUS'&&row.source.action==='UPDATE_REQUEST'&&check.order?.version===row.resolutions.orderVersion)throw conflict('Apply the reviewed change through the existing order workflow first.');
   if(row.kind==='PROCUREMENT'&&!row.purchase_request_id)throw conflict('Create the linked purchase-request draft first.');status='COMPLETED';
  }
  const after=await this.repo.one('UPDATE crm_operations_intakes SET status=?,approved_by=CASE WHEN ?=\'APPROVED\' THEN ? ELSE approved_by END,version=version+1 WHERE id=? RETURNING *',status,status,actor.id,id);
  await this.event(after,actor,b.action,b.reason);return this.detail(actor,id,companyId);
 });}
 async stockPreview(actor,id,companyId){const row=await this.row(actor,id,companyId);requirePermission(actor,'items.read');if(!['STOCK','PROCUREMENT'].includes(row.kind))throw validationFailed('This is not a stock or purchasing request.');const requested=row.resolutions.items??[],lines=[];
  const items=requested.length?await this.repo.all("SELECT id,part_code,description,uom FROM items WHERE id=ANY(?::integer[]) AND status='ACTIVE' AND NOT is_deleted",requested.map(l=>l.itemId)):[];
  if(requested.some(l=>!items.some(i=>i.id===l.itemId&&i.uom===l.uom)))throw conflict('The product or base unit changed. Save a fresh catalogue review.');
  // Share the stock service's repository and evaluator, fetching source receipts
  // once for the bounded batch rather than repeating the full source lookup.
  const sources=await this.stock.repository.batch(companyId,items),policy=await workflowRule(this.db,'stock.availability',false),latestAttempt=await this.stock.repository.latest(companyId),now=this.clock.now();
  const pending=await this.repo.all("SELECT item_id,count(*)::integer AS n FROM (SELECT item_id FROM crm_quote_reservations WHERE company_id=? AND status IN ('ACTIVE','TRANSFERRED') UNION ALL SELECT c.item_id FROM crm_stock_consumptions c LEFT JOIN crm_stock_consumption_reviews r ON r.consumption_id=c.id WHERE c.company_id=? AND r.id IS NULL UNION ALL SELECT ol.item_id FROM crm_shipment_items si JOIN sales_order_lines ol ON ol.id=si.order_line_id JOIN crm_shipments sh ON sh.id=si.shipment_id LEFT JOIN crm_order_workflows ow ON ow.sales_order_id=sh.sales_order_id LEFT JOIN crm_stock_consumptions c ON c.shipment_id=sh.id AND c.order_line_id=ol.id WHERE c.id IS NULL AND (ow.public_snapshot->>'companyId'=? OR ow.public_snapshot->>'companyId' IS NULL)) held WHERE item_id=ANY(?::integer[]) GROUP BY item_id",companyId,companyId,companyId,items.map(i=>i.id));
  for(const l of requested){const item=items.find(i=>i.id===l.itemId),p=evaluateStock({source:sources.get(item.id),policy,requestedQuantity:l.quantity,basis:'FREE_STOCK',now,latestAttempt});
   const localReview=pending.some(v=>v.item_id===item.id&&v.n>0);lines.push({lineId:l.lineId,itemId:l.itemId,partCode:item.part_code,uom:p.uom,requestedQuantity:l.quantity,stockInHand:p.stockInHand,reservedQuantity:p.reservedQuantity,freeQuantity:localReview?null:p.freeQuantity,status:localReview?'REVIEW_REQUIRED':p.status,sourceTimestamp:p.sourceTimestamp,issues:[...p.issues,...(localReview?['Local allocations or dispatch consumption require the existing order stock review.']:[])],shortage:localReview?null:shortageOf(p,l.quantity),fingerprint:p.previewFingerprint});
  }return {lines,fingerprint:fingerprint(lines),readOnly:true};
 }
 async procurement(actor,id,companyId,input){
  requirePermission(actor,'purchasing.write');requirePermission(actor,'purchasing.read');
  const b=validate(s.object({version:s.int({min:1}),reason:s.reason(),requiredBy:s.date(),stockFingerprint:s.string({pattern:/^[a-f0-9]{64}$/}),lines:s.array(s.object({itemId:s.id(),quantity:s.string({pattern:/^\d{1,18}(?:\.\d{1,6})?$/})}),{min:1,max:10})}),input);
  return this.write(actor,b.reason,async()=>{
   const row=await this.row(actor,id,companyId,true,true),commandHash=fingerprint(b);
   if(row.purchase_request_id){if(row.resolutions.procurementHash!==commandHash)throw conflict('This request already created a different purchase draft.');return {id:row.purchase_request_id,duplicate:true};}
   if(row.version!==b.version)throw conflict('Request changed. Reload.');
   if(row.kind!=='PROCUREMENT'||!['REVIEWED','APPROVED'].includes(row.status))throw conflict('Review this as a Procurement request first.');
   const check=await this.verify(actor,row);if(check.blockers.length)throw conflict('Resolve the required checks first.');
   const preview=await this.stockPreview(actor,id,companyId);if(preview.fingerprint!==b.stockFingerprint)throw conflict('Stock changed. Refresh the shortage check.');
   const seen=new Set(),lines=[];for(const l of b.lines){quantity(l.quantity);if(seen.has(l.itemId))throw validationFailed('Duplicate purchasing item.');seen.add(l.itemId);const p=preview.lines.find(v=>v.itemId===l.itemId);if(!p||p.shortage===null||p.shortage==='0.000000'||l.quantity!==p.shortage)throw conflict('Use the exact verified shortage quantity; unknown availability cannot create a shortage request.');lines.push({itemId:l.itemId,quantity:l.quantity});}
   const draft=await saveRequest(this.db,null,{subject:row.source.subject.slice(0,200),requiredBy:b.requiredBy,notes:`Operations request ${row.id}; reviewed shortage only.`,salesOrderId:row.sales_order_id,lines,reason:b.reason},actor);
   const after=await this.repo.one("UPDATE crm_operations_intakes SET purchase_request_id=?,resolutions=?::text::jsonb,version=version+1 WHERE id=? RETURNING *",draft.id,JSON.stringify({...row.resolutions,procurementHash:commandHash}),row.id);await this.event(after,actor,'PURCHASE_REQUEST_CREATED',b.reason,{purchaseRequestId:draft.id});return {id:draft.id,duplicate:false};
  });
 }
}
