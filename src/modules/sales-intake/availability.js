import {salesWork,permission,uuid,why,notifySales} from './shared.js';
import {AuditRepository,fingerprint} from '../../core/runtime.js';
import {conflict,forbidden,notFound,validationFailed} from '../../core/errors.js';
import {hasPermission} from '../../rbac.js';
import {StockCheckRepository} from '../stock/repository.js';
import {evaluateStock,stockPointer,stockQuantity} from '../stock/availability.js';
import {workflowRule} from '../rules/workflow-rules.js';
import {decimal,add,sub,compare,format} from '../../../public/money.js';
import {requireCustomerBillingApproval} from '../../crm-modules.js';

const zero=()=>decimal('0'),qty=v=>format(v,6),positive=v=>compare(decimal(v),zero())>0;
const quoteHash=q=>fingerprint({version:q.version,source:q.public_snapshot});
const lock=db=>db.prepare('SELECT pg_advisory_xact_lock(812731)').get();
const one=(db,sql,...p)=>db.prepare(sql).get(...p),all=(db,sql,...p)=>db.prepare(sql).all(...p);
async function event(db,r,user,action,reason,detail={}){
 await db.prepare('INSERT INTO crm_quotation_availability_events(request_id,action,actor_id,version,reason,detail) VALUES(?,?,?,?,?,?::text::jsonb)').run(r.id,action,user?.id??null,r.version,why(reason),JSON.stringify(detail));
 await new AuditRepository(db).record({actorId:user?.id??null,entity:'QUOTATION_AVAILABILITY',recordId:r.id,action,reason,newValue:{quotationId:r.quotation_id,quotationVersion:r.quotation_version,availabilityVersion:r.version,source:detail.source??null}});
 if(r.intake_id)await notifySales(db,r.intake_id,action,`availability:${r.id}:${r.version}:${action}`);
}
export async function requestAvailability(db,quoteId,intakeId,user){
 return salesWork(db,user,'Request pre-order availability',async()=>{
  await lock(db);const q=await one(db,'SELECT * FROM crm_quotation_workflows WHERE quotation_id=?',quoteId);if(!q)throw notFound();
  const old=await one(db,'SELECT * FROM crm_quotation_availability WHERE quotation_id=? AND quotation_version=?',quoteId,q.version);if(old){
   if(intakeId&&!old.intake_id){const source=await one(db,'SELECT id FROM crm_sales_intakes WHERE id=? AND company_id=? AND quotation_id=?',intakeId,old.company_id,quoteId);if(!source)throw conflict('Intake, quotation and company must be explicitly linked.');await db.prepare('UPDATE crm_quotation_availability SET intake_id=? WHERE id=?').run(intakeId,old.id);return {...old,intake_id:intakeId};}return old;
  }
  const companyId=uuid(q.public_snapshot.companyId);
  const r=await one(db,'INSERT INTO crm_quotation_availability(company_id,quotation_id,quotation_version,intake_id,quote_fingerprint,created_by) VALUES(?,?,?,?,?,?) RETURNING *',companyId,quoteId,q.version,intakeId,quoteHash(q),user.id);
  const lines=await all(db,'SELECT id,item_id,description,quantity::text,uom FROM quotation_lines WHERE quotation_id=? AND NOT is_deleted ORDER BY position,id',quoteId);
  const intake=intakeId?await one(db,'SELECT normalized,resolutions FROM crm_sales_intakes WHERE id=?',intakeId):null;
  for(const [index,l]of lines.entries())await one(db,'INSERT INTO crm_quotation_availability_lines(request_id,quotation_line_id,source_line_id,item_id,description,quantity,uom) VALUES(?,?,?,?,?,?,?) RETURNING id',r.id,l.id,q.public_snapshot.lines[index]?.sourceLineId??(intake?.resolutions.items??intake?.normalized.items)?.[index]?.lineId??('quote:'+l.id),l.item_id,l.description,l.quantity,l.uom);
  await event(db,r,user,'AVAILABILITY_REQUESTED','Quotation draft requires a warehouse check');return r;
 });
}

/** Quantities here come only from the retained, fresh stock-item receipt.
 * Location masters and staff observations cannot create an available balance. */
export function locationEvidence(source,plan,mapping){
 const issues=[],locations=[];if(!mapping)return {locations,issues:['LOCATION_STOCK_POLICY_REQUIRED']};
 const rows=stockPointer(source?.raw_record,mapping.balancesPointer);
 if(!Array.isArray(rows)||rows.length>2000)return {locations,issues:['VERIFIED_LOCATION_BALANCES_REQUIRED']};
 let total=zero(),reserved=zero();const keys=new Set(),reservationKeys=new Set();
 for(const row of rows){
  const key=stockPointer(row,mapping.namePointer),onHand=stockQuantity(stockPointer(row,mapping.quantityPointer),plan.uom),held=stockQuantity(stockPointer(row,mapping.reservedPointer),plan.uom),rawReservations=stockPointer(row,mapping.reservationsPointer);
  if(typeof key!=='string'||!key.trim()||key.length>250||keys.has(key)||onHand===null||held===null||compare(decimal(onHand),zero())<0||compare(decimal(held),zero())<0||!Array.isArray(rawReservations)){issues.push('INVALID_LOCATION_BALANCE');continue;}
  keys.add(key);total=add(total,decimal(onHand));reserved=add(reserved,decimal(held));
  let sum=zero();const reservations=[];
  for(const r of rawReservations){const id=r?.id,quantity=stockQuantity(r?.quantity,plan.uom);if(typeof id!=='string'||!id||id.length>250||quantity===null||!positive(quantity)||reservationKeys.has(id)){issues.push('INVALID_LOCATION_RESERVATION');continue;}reservationKeys.add(id);sum=add(sum,decimal(quantity));reservations.push({key:id,quantity});}
  if(compare(sum,decimal(held))!==0)issues.push('LOCATION_RESERVATIONS_DO_NOT_RECONCILE');
  if(compare(decimal(held),decimal(onHand))>0)issues.push('LOCATION_RESERVED_EXCEEDS_ON_HAND');
  locations.push({key,onHand,reserved:held,free:qty(sub(decimal(onHand),decimal(held))),reservations});
 }
 if(plan.stockInHand===null||compare(total,decimal(plan.stockInHand))!==0||plan.reservedQuantity===null||compare(reserved,decimal(plan.reservedQuantity))!==0)issues.push('LOCATION_TOTALS_DO_NOT_RECONCILE');
 for(const r of plan.reservations??[])if(!locations.some(l=>l.reservations.some(v=>v.key===r.key&&compare(decimal(v.quantity),decimal(r.quantity))===0)))issues.push('LOCATION_RESERVATION_IDENTITY_MISMATCH');
 return {locations,issues:[...new Set(issues)]};
}
/** Only an exact source ID and quantity prove a CRM hold is already subtracted.
 * Otherwise it stays a local hold, even after a newer import. */
export function unreflectedHolds(holds,plan,locations){return holds.map(h=>{
 const key='CRM-QUOTE:'+h.availability_line_id;
 const global=(plan.reservations??[]).filter(r=>r.key===key).reduce((s,r)=>add(s,decimal(r.quantity)),zero()),local=(locations.find(l=>l.key===h.warehouse_key)?.reservations??[]).filter(r=>r.key===key).reduce((s,r)=>add(s,decimal(r.quantity)),zero());
 const covered=compare(global,local)<0?global:local,held=decimal(h.quantity),reflected=compare(covered,held)<0?covered:held;
 return {...h,quantity:qty(sub(held,reflected)),reflectedQuantity:qty(reflected)};
}).filter(h=>positive(h.quantity));}
export function reservationReflectionIssues(holds,plan){
 if(plan.reservedQuantity==null||!positive(plan.reservedQuantity))return [];
 // A native ERP reservation cannot be guessed to be either this transferred
 // order or another order. Stop for an exact reference instead of subtracting
 // the same stock twice or crediting an unproved reflection.
 return holds.some(h=>h.status==='TRANSFERRED'&&!(plan.reservations??[]).some(r=>r.key==='CRM-QUOTE:'+h.availability_line_id))?['TRANSFERRED_RESERVATION_REFERENCE_REQUIRED']:[];
}
export async function availabilityEvidence(db,r,now=new Date(),checkingLines=new Set()){
 const q=await one(db,'SELECT * FROM crm_quotation_workflows WHERE quotation_id=?',r.quotation_id);
 const repo=new StockCheckRepository(db),policy=await workflowRule(db,'stock.availability',false),local=await one(db,'SELECT value,version FROM crm_sales_intake_policies WHERE company_id=?',r.company_id),latest=await repo.latest(r.company_id);
 const rows=await all(db,'SELECT l.*,l.quantity::text,l.checked_quantity::text,i.part_code FROM crm_quotation_availability_lines l JOIN items i ON i.id=l.item_id WHERE request_id=? ORDER BY l.quotation_line_id',r.id),lines=[],sources=new Map(),demands=new Map(),globalDemands=new Map();
 const items=await all(db,"SELECT id,part_code,uom FROM items WHERE id=ANY(?::integer[]) AND status='ACTIVE' AND NOT is_deleted",[...new Set(rows.map(l=>l.item_id))]),sourceByItem=await repo.batch(r.company_id,items);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),common=[];
 if(!q||q.version!==r.quotation_version||quoteHash(q)!==r.quote_fingerprint)common.push('QUOTATION_VERSION_CHANGED');
 if(q?.public_snapshot.validUntil<day)common.push('QUOTATION_EXPIRED');if(q&&['CANCELLED','EXPIRED','LOST'].includes(q.status))common.push('QUOTATION_CLOSED');
 const intake=r.intake_id?await one(db,'SELECT i.status,e.status AS enquiry_status FROM crm_sales_intakes i LEFT JOIN enquiries e ON e.id=i.enquiry_id WHERE i.id=?',r.intake_id):null;
 if(intake&&(intake.status==='CANCELLED'||['CANCELLED','LOST'].includes(intake.enquiry_status)))common.push('SOURCE_REQUEST_CLOSED');
 for(const l of rows){
  if(!sources.has(l.item_id)){
   const source=sourceByItem.get(l.item_id)??null;
   const plan=evaluateStock({source,policy,requestedQuantity:l.quantity,basis:'FREE_STOCK',now,latestAttempt:latest});
   const location=locationEvidence(source,plan,local?.value.locationStock);
   const holds=await all(db,"SELECT h.*,h.quantity::text FROM crm_quote_reservations h JOIN crm_quotation_availability_lines l ON l.id=h.availability_line_id WHERE h.company_id=? AND h.item_id=? AND h.status IN ('ACTIVE','TRANSFERRED') AND l.request_id<>?",r.company_id,l.item_id,r.id);
   const pending=await one(db,'SELECT count(*)::integer AS n FROM crm_stock_consumptions c LEFT JOIN crm_stock_consumption_reviews v ON v.consumption_id=c.id WHERE c.company_id=? AND c.item_id=? AND v.id IS NULL',r.company_id,l.item_id);
   const legacy=await one(db,"SELECT count(*)::integer AS n FROM crm_shipment_items si JOIN sales_order_lines ol ON ol.id=si.order_line_id JOIN crm_shipments sh ON sh.id=si.shipment_id LEFT JOIN crm_order_workflows w ON w.sales_order_id=sh.sales_order_id LEFT JOIN crm_stock_consumptions c ON c.shipment_id=sh.id AND c.order_line_id=ol.id WHERE ol.item_id=? AND c.id IS NULL AND (w.public_snapshot->>'companyId'=? OR w.public_snapshot->>'companyId' IS NULL)",l.item_id,r.company_id);
   sources.set(l.item_id,{source,plan,location,holds:unreflectedHolds(holds,plan,location.issues.length?[]:location.locations),reflectionIssues:reservationReflectionIssues(holds,plan),consumption:pending.n+legacy.n});
  }
  const e=sources.get(l.item_id),issues=[...e.plan.issues,...e.location.issues,...e.reflectionIssues];
  if(e.plan.status!=='VERIFIED')issues.push('STOCK_'+e.plan.status);if(e.consumption)issues.push('DISPATCH_RECONCILIATION_REQUIRED');issues.push(...common);
  if(l.uom!==e.plan.uom)issues.push('UNIT_REVIEW_REQUIRED');
  const loc=e.location.locations.find(v=>v.key===l.warehouse_key);if(!loc)issues.push('WAREHOUSE_CHECK_REQUIRED');
  const localHeld=e.holds.filter(h=>h.warehouse_key===l.warehouse_key).reduce((sum,h)=>add(sum,decimal(h.quantity)),zero()),allHeld=e.holds.reduce((sum,h)=>add(sum,decimal(h.quantity)),zero());
  const key=JSON.stringify([l.item_id,l.warehouse_key]),demand=add(demands.get(key)??zero(),decimal(l.quantity)),global=add(globalDemands.get(l.item_id)??zero(),decimal(l.quantity));demands.set(key,demand);globalDemands.set(l.item_id,global);
  let available=loc&&e.plan.freeQuantity!==null?qty(sub(decimal(loc.free),localHeld)):null;
  if(available!==null&&compare(decimal(available),zero())<0)available='0.000000';
  if(available!==null&&l.checked_quantity!==null&&compare(decimal(l.checked_quantity),decimal(available))<0)available=l.checked_quantity;
  const capacity=!issues.length&&available!==null?available:null,shortage=capacity===null?null:qty(compare(decimal(capacity),decimal(l.quantity))<0?sub(decimal(l.quantity),decimal(capacity)):zero());
  if(!l.checked_by||!l.evidence)issues.push('STAFF_CHECK_REQUIRED');
  if(loc&&l.checked_quantity!==null&&compare(decimal(l.checked_quantity),decimal(loc.free))>0)issues.push('CHECK_EXCEEDS_VERIFIED_FREE_STOCK');
  const enough=capacity!==null&&compare(demand,sub(decimal(loc.free),localHeld))<=0&&compare(global,sub(decimal(e.plan.freeQuantity),allHeld))<=0&&compare(decimal(capacity),decimal(l.quantity))>=0;
  if(capacity!==null&&!enough)issues.push('STOCK_SHORT');
  const sourceFingerprint=fingerprint({stock:e.plan.previewFingerprint,locations:e.location,locationPolicy:fingerprint(local?.value.locationStock??null),quote:r.quote_fingerprint,line:l.id,warehouse:l.warehouse_key,quantity:l.quantity,checkedQuantity:l.checked_quantity,checkedBy:l.checked_by,checkedAt:l.checked_at instanceof Date?l.checked_at.toISOString():l.checked_at,evidence:l.evidence});
  if(l.checked_by&&!checkingLines.has(l.id)&&l.checked_source_fingerprint!==sourceFingerprint)issues.push('STAFF_CHECK_SOURCE_CHANGED');
  lines.push({id:l.id,quotationLineId:l.quotation_line_id,sourceLineId:l.source_line_id,itemId:l.item_id,partCode:l.part_code,description:l.description,quantity:l.quantity,uom:l.uom,warehouse:l.warehouse_key,warehouses:e.location.locations.map(v=>({key:v.key,onHand:v.onHand,reserved:v.reserved,free:v.free})),onHand:e.plan.stockInHand,sourceReserved:e.plan.reservedQuantity,localReserved:qty(localHeld),availableQuantity:capacity,shortageQuantity:shortage,checkedQuantity:l.checked_quantity,checkedBy:l.checked_by,checkedAt:l.checked_at,evidence:l.evidence,sourceTimestamp:e.plan.sourceTimestamp,sourceSessionId:e.plan.sourceSessionId,sourceRecordKey:e.plan.sourceRecordKey,sourceStatus:e.plan.status,issues:[...new Set(issues)],ready:issues.length===0&&enough,sourceFingerprint});
 }
 // A later line can exceed a grouped balance. No earlier duplicate-item line is approved alone.
 const failedItems=new Set(lines.filter(l=>l.issues.includes('STOCK_SHORT')).map(l=>l.itemId));for(const l of lines)if(failedItems.has(l.itemId)&&l.ready){l.ready=false;l.issues.push('GROUPED_STOCK_SHORT');}
 return {lines,ready:lines.length>0&&lines.every(l=>l.ready),sourcePolicies:{stockVersion:policy?.version??null,location:fingerprint(local?.value.locationStock??null)},decisionFingerprint:fingerprint({quote:r.quote_fingerprint,lines:lines.map(l=>({id:l.id,source:l.sourceFingerprint}))})};
}
export async function requireAvailability(db,q){
 const r=await one(db,'SELECT * FROM crm_quotation_availability WHERE quotation_id=? ORDER BY quotation_version DESC LIMIT 1',q.quotation_id);
 if(!r){if(q.private_snapshot?.availabilityRequired)throw conflict('Save the selling company and request a warehouse check before commercial submission.','AVAILABILITY_REQUEST_REQUIRED');return;} // Retained historical quotations have no new gate retroactively added.
 await requireCustomerBillingApproval(db,q.public_snapshot.customerId);
 const evidence=await availabilityEvidence(db,r);
 const holds=await all(db,"SELECT h.availability_line_id,h.quantity::text FROM crm_quote_reservations h JOIN crm_quotation_availability_lines l ON l.id=h.availability_line_id WHERE l.request_id=? AND h.status IN ('ACTIVE','TRANSFERRED')",r.id);
 if(r.status!=='AVAILABILITY_APPROVED'||!evidence.ready||r.decision_fingerprint!==evidence.decisionFingerprint||evidence.lines.some(l=>!holds.some(h=>h.availability_line_id===l.id&&compare(decimal(h.quantity),decimal(l.quantity))===0)))throw conflict('Current warehouse availability approval and reservations are required for every line. Open Logistics & store.','AVAILABILITY_APPROVAL_REQUIRED');
}
export async function invalidateAvailability(db,quoteId,user,reason,{cancel=false}={}){
 return salesWork(db,user,reason,async()=>{await lock(db);const requests=await all(db,"SELECT * FROM crm_quotation_availability WHERE quotation_id=? AND status NOT IN ('INVALIDATED','CANCELLED') FOR UPDATE",quoteId);
  for(const r of requests){const moved=await one(db,"SELECT h.id FROM crm_quote_reservations h JOIN crm_quotation_availability_lines l ON l.id=h.availability_line_id WHERE l.request_id=? AND h.status='TRANSFERRED' LIMIT 1",r.id);if(moved)throw conflict('This quotation reservation belongs to an order. Resolve the order before revising the quotation.','RESERVATION_TRANSFERRED');
   await db.prepare("UPDATE crm_quote_reservations SET status='RELEASED' WHERE availability_line_id IN (SELECT id FROM crm_quotation_availability_lines WHERE request_id=?) AND status='ACTIVE'").run(r.id);
   await db.prepare('UPDATE crm_quotation_availability SET status=?,version=version+1 WHERE id=?').run(cancel?'CANCELLED':'INVALIDATED',r.id);await event(db,{...r,version:r.version+1},user,'AVAILABILITY_INVALIDATED',reason);
  }
 });
}
export async function transferAvailability(db,quoteId,orderId,user){
 return salesWork(db,user,'Transfer quotation reservation to order',async()=>{await lock(db);const q=await one(db,'SELECT * FROM crm_quotation_workflows WHERE quotation_id=?',quoteId);if(!q)return;await requireAvailability(db,q);
  const other=await one(db,"SELECT h.sales_order_id FROM crm_quote_reservations h JOIN crm_quotation_availability_lines l ON l.id=h.availability_line_id JOIN crm_quotation_availability r ON r.id=l.request_id WHERE r.quotation_id=? AND h.status='TRANSFERRED' AND h.sales_order_id<>? LIMIT 1",quoteId,orderId);if(other)throw conflict('The quotation stock is already assigned to another order.');
  const request=await one(db,'SELECT id FROM crm_quotation_availability WHERE quotation_id=? ORDER BY quotation_version DESC LIMIT 1',quoteId);
  if(request){
   const required=await all(db,'SELECT item_id,uom,sum(quantity)::text AS quantity FROM crm_quotation_availability_lines WHERE request_id=? GROUP BY item_id,uom',request.id),actual=await all(db,'SELECT item_id,uom,sum(ordered_quantity)::text AS quantity FROM sales_order_lines WHERE sales_order_id=? AND NOT is_deleted GROUP BY item_id,uom',orderId);
   if(required.length!==actual.length||required.some(l=>!actual.some(a=>a.item_id===l.item_id&&a.uom===l.uom&&compare(decimal(a.quantity),decimal(l.quantity))===0)))throw conflict('Order quantities or items differ from approved warehouse demand. Revise the quotation and repeat availability review.','ORDER_AVAILABILITY_MISMATCH');
   const order=await one(db,'SELECT public_snapshot FROM crm_order_workflows WHERE sales_order_id=?',orderId);if(order.public_snapshot.lines.some(l=>l.stockBasis!=='FREE_STOCK'))throw conflict('Transferred quote reservations use the reviewed free-stock allocation. Do not reserve a second source order.');
  }
  await db.prepare("UPDATE crm_quote_reservations SET status='TRANSFERRED',sales_order_id=? WHERE availability_line_id IN (SELECT l.id FROM crm_quotation_availability_lines l JOIN crm_quotation_availability r ON r.id=l.request_id WHERE r.quotation_id=?) AND status='ACTIVE'").run(orderId,quoteId);
  await db.prepare('UPDATE crm_sales_intakes SET sales_order_id=? WHERE quotation_id=? AND sales_order_id IS NULL').run(orderId,quoteId);
 });
}
export async function orderReservationAdjustment(db,companyId,itemId,orderId,plan,source){
 const policy=await one(db,'SELECT value FROM crm_sales_intake_policies WHERE company_id=?',companyId),location=locationEvidence(source,plan,policy?.value.locationStock);
 const holds=await all(db,"SELECT h.*,h.quantity::text FROM crm_quote_reservations h WHERE h.company_id=? AND h.item_id=? AND h.status IN ('ACTIVE','TRANSFERRED')",companyId,itemId);
 const unreflected=unreflectedHolds(holds,plan,location.issues.length?[]:location.locations),remainders=new Map(unreflected.map(h=>[h.id,h.quantity]));
 const other=unreflected.filter(h=>h.sales_order_id!==orderId),own=holds.filter(h=>h.sales_order_id===orderId);
 const delta=sub(own.reduce((s,h)=>add(s,sub(decimal(h.quantity),decimal(remainders.get(h.id)??'0'))),zero()),other.reduce((s,h)=>add(s,decimal(h.quantity)),zero()));
 return {delta:qty(delta),issues:reservationReflectionIssues(holds,plan),fingerprint:fingerprint(holds.map(h=>({id:h.id,quantity:h.quantity,status:h.status,orderId:h.sales_order_id,unreflected:remainders.get(h.id)??'0'})))};
}
export async function releaseOrderAvailability(db,orderId,user,reason){
 return salesWork(db,user,reason,async()=>{await lock(db);const requests=await all(db,"SELECT DISTINCT r.quotation_id FROM crm_quote_reservations h JOIN crm_quotation_availability_lines l ON l.id=h.availability_line_id JOIN crm_quotation_availability r ON r.id=l.request_id WHERE h.sales_order_id=? AND h.status='TRANSFERRED'",orderId);
  await db.prepare("UPDATE crm_quote_reservations SET status='RELEASED' WHERE sales_order_id=? AND status='TRANSFERRED'").run(orderId);
  for(const r of requests)await invalidateAvailability(db,r.quotation_id,user,reason);
 });
}
export async function consumeOrderAvailability(db,orderId,user,reason){
 return salesWork(db,user,reason,async()=>{await lock(db);const holds=await all(db,"SELECT * FROM crm_quote_reservations WHERE sales_order_id=? AND status='TRANSFERRED' ORDER BY item_id,id FOR UPDATE",orderId),remaining=new Map();
  for(const h of holds){const key=JSON.stringify([h.item_id,h.uom]);if(!remaining.has(key)){const row=await one(db,'SELECT coalesce(sum(ordered_quantity-fulfilled_quantity),0)::text AS quantity FROM sales_order_lines WHERE sales_order_id=? AND item_id=? AND uom=? AND NOT is_deleted',orderId,h.item_id,h.uom);remaining.set(key,decimal(row.quantity));}
   const needed=remaining.get(key),held=decimal(h.quantity),keep=compare(needed,held)<0?needed:held;remaining.set(key,sub(needed,keep));
   if(compare(keep,zero())===0)await db.prepare("UPDATE crm_quote_reservations SET status='CONSUMED' WHERE id=?").run(h.id);
   else if(compare(keep,held)!==0)await db.prepare('UPDATE crm_quote_reservations SET quantity=? WHERE id=?').run(qty(keep),h.id);
  }
 });
}
export class AvailabilityService{
 constructor({db,clock}){this.db=db;this.clock=clock??{now:()=>new Date()};}
 async companies(user){permission(user,'logistics.read');const owner=hasPermission(user,'logistics.assignment.manage')?null:user.id;return all(this.db,'SELECT DISTINCT c.id,c.name FROM tally_companies c LEFT JOIN crm_quotation_availability r ON r.company_id=c.id WHERE (?::integer IS NULL OR r.assigned_store_id=?) ORDER BY c.name,c.id',owner,owner);}
 async invalidateStale(){
  const rows=await all(this.db,"SELECT id FROM crm_quotation_availability WHERE status='AVAILABILITY_APPROVED' AND (?::uuid IS NULL OR id>?::uuid) ORDER BY id LIMIT 25",this.cursor??null,this.cursor??null);
  if(!rows.length){this.cursor=null;return {checked:0,invalidated:0};}let invalidated=0;
  for(const row of rows){await salesWork(this.db,null,'System revalidated current warehouse evidence',async()=>{await lock(this.db);const r=await one(this.db,"SELECT * FROM crm_quotation_availability WHERE id=? AND status='AVAILABILITY_APPROVED' FOR UPDATE",row.id);if(!r)return;
   const e=await availabilityEvidence(this.db,r,this.clock.now());if(e.ready&&e.decisionFingerprint===r.decision_fingerprint)return;
   // Transferred holds stay with the order until its reviewed cancellation or dispatch.
   await this.db.prepare("UPDATE crm_quote_reservations SET status='RELEASED' WHERE status='ACTIVE' AND availability_line_id IN (SELECT id FROM crm_quotation_availability_lines WHERE request_id=?)").run(r.id);
   await this.db.prepare("UPDATE crm_quotation_availability SET status='INVALIDATED',version=version+1 WHERE id=?").run(r.id);await event(this.db,{...r,version:r.version+1},null,'AVAILABILITY_INVALIDATED','System detected changed, expired or unverified stock evidence',{source:'SYSTEM_REVALIDATION'});invalidated++;
  });this.cursor=row.id;}
  return {checked:rows.length,invalidated};
 }
 access(user,r){if(hasPermission(user,'logistics.read')){if(!hasPermission(user,'logistics.assignment.manage')&&r.assigned_store_id!==user.id)throw notFound();return;}permission(user,'quotations.read');}
 async list(user,companyId,params=new URLSearchParams()){
  permission(user,'logistics.read');uuid(companyId);const page=Number(params.get('page')??1),search=params.get('search')??'',status=params.get('status')??'';
  if(!Number.isSafeInteger(page)||page<1||page>100000||search.length>200||status&&!['REQUESTED','CHECKING','SHORTAGE','PARTIALLY_AVAILABLE','READY_FOR_REVIEW','AVAILABILITY_APPROVED','INVALIDATED','CANCELLED'].includes(status))throw validationFailed('Invalid warehouse queue filters.');
  const owner=hasPermission(user,'logistics.assignment.manage')?null:user.id,pattern='%'+search.replace(/[\\%_]/g,'\\$&')+'%';
  return all(this.db,"SELECT r.id,r.quotation_id,r.quotation_version,r.status,r.assigned_store_id,r.created_at,r.version,u.name AS assigned_name FROM crm_quotation_availability r LEFT JOIN users u ON u.id=r.assigned_store_id WHERE r.company_id=? AND (?::integer IS NULL OR r.assigned_store_id=?) AND (?='' OR r.status=?) AND (r.quotation_id::text ILIKE ? ESCAPE '\\' OR coalesce(u.name,'') ILIKE ? ESCAPE '\\') ORDER BY r.created_at DESC,r.id LIMIT 100 OFFSET ?",companyId,owner,owner,status,status,pattern,pattern,(page-1)*100);
 }
 async detail(user,id,companyId){const r=await one(this.db,'SELECT * FROM crm_quotation_availability WHERE id=? AND company_id=?',uuid(id),uuid(companyId));if(!r)throw notFound();this.access(user,r);const e=await availabilityEvidence(this.db,r,this.clock.now());const events=await all(this.db,'SELECT action,actor_id,version,reason,created_at FROM crm_quotation_availability_events WHERE request_id=? ORDER BY id',r.id);return {id:r.id,quotationId:r.quotation_id,quotationVersion:r.quotation_version,status:r.status,version:r.version,assignedStoreId:r.assigned_store_id,reviewedBy:r.reviewed_by,reviewedAt:r.reviewed_at,...e,events};}
 async forQuote(user,id){permission(user,'quotations.read');const r=await one(this.db,'SELECT * FROM crm_quotation_availability WHERE quotation_id=? ORDER BY quotation_version DESC LIMIT 1',id);return r?this.detail(user,r.id,r.company_id):null;}
 async command(user,id,companyId,b){why(b.reason);return salesWork(this.db,user,b.reason,async()=>{
  await lock(this.db);const r=await one(this.db,'SELECT * FROM crm_quotation_availability WHERE id=? AND company_id=? FOR UPDATE',uuid(id),uuid(companyId));if(!r)throw notFound();this.access(user,r);if(r.version!==b.version)throw conflict('Availability changed. Reload.');
  if(['INVALIDATED','CANCELLED'].includes(r.status))throw conflict('Request is no longer current. Revise the quotation to request a new check.');
  let decision={};
  if(b.action==='ASSIGN'){
   permission(user,'logistics.assignment.manage');if(r.status==='AVAILABILITY_APPROVED')throw conflict('Return the decision before changing assignment.');
   const staff=await one(this.db,"SELECT id,role FROM users WHERE id=? AND status='ACTIVE'",b.assignedStoreId);if(!staff||!hasPermission(staff,'logistics.evidence.write'))throw validationFailed('Choose active warehouse staff.');
   await this.db.prepare("UPDATE crm_quotation_availability SET assigned_store_id=?,status='CHECKING',version=version+1 WHERE id=?").run(staff.id,r.id);
  }else if(b.action==='CHECK'){
   permission(user,'logistics.evidence.write');if(r.assigned_store_id!==user.id)throw forbidden('Only assigned warehouse staff may record checks.');if(r.status==='AVAILABILITY_APPROVED')throw conflict('Return the approved decision before changing evidence.');
   if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100||new Set(b.lines.map(l=>l.id)).size!==b.lines.length)throw validationFailed('Provide distinct checked lines.');
   for(const l of b.lines){uuid(l.id);if(typeof l.quantity!=='string'||!/^\d{1,14}(?:\.\d{1,6})?$/.test(l.quantity)||typeof l.warehouse!=='string'||!l.warehouse.trim()||l.warehouse.length>250)throw validationFailed('Each check needs a non-negative exact quantity and warehouse.');why(l.evidence);
    if(!await one(this.db,'SELECT id FROM crm_quotation_availability_lines WHERE id=? AND request_id=?',l.id,r.id))throw validationFailed('Line does not belong to this request.');
    await this.db.prepare('UPDATE crm_quotation_availability_lines SET warehouse_key=?,checked_quantity=?,checked_by=?,checked_at=clock_timestamp(),evidence=? WHERE id=?').run(l.warehouse,l.quantity,user.id,l.evidence,l.id);
   }
   const checked=new Set(b.lines.map(l=>l.id)),e=await availabilityEvidence(this.db,r,this.clock.now(),checked),some=e.lines.some(l=>l.availableQuantity!==null&&positive(l.availableQuantity));
   for(const l of e.lines)if(checked.has(l.id))await this.db.prepare('UPDATE crm_quotation_availability_lines SET checked_source_fingerprint=? WHERE id=?').run(l.sourceFingerprint,l.id);
   decision={checks:b.lines.map(l=>({id:l.id,quantity:l.quantity,warehouse:l.warehouse,evidence:l.evidence})),checkedBy:user.id};
   await this.db.prepare('UPDATE crm_quotation_availability SET status=?,version=version+1 WHERE id=?').run(e.ready?'READY_FOR_REVIEW':some?'PARTIALLY_AVAILABLE':'SHORTAGE',r.id);
  }else if(b.action==='APPROVE'){
   permission(user,'logistics.grn.post');if(r.created_by===user.id)throw forbidden('Availability needs an independent Logistics reviewer.');
   if(r.status!=='READY_FOR_REVIEW')throw conflict('Every line must be ready for review.');
   const e=await availabilityEvidence(this.db,r,this.clock.now());if(!e.ready)throw conflict('Stock evidence is short, stale, changed or unverified. Recheck all lines.','AVAILABILITY_NOT_READY');
   decision={decisionFingerprint:e.decisionFingerprint,sourcePolicies:e.sourcePolicies,lines:e.lines.map(l=>({id:l.id,itemId:l.itemId,quantity:l.quantity,uom:l.uom,warehouse:l.warehouse,availableQuantity:l.availableQuantity,sourceReserved:l.sourceReserved,localReserved:l.localReserved,checkedQuantity:l.checkedQuantity,checkedBy:l.checkedBy,sourceSessionId:l.sourceSessionId,sourceRecordKey:l.sourceRecordKey,sourceTimestamp:l.sourceTimestamp,sourceFingerprint:l.sourceFingerprint}))};
   for(const l of e.lines){if(l.checkedBy===user.id)throw forbidden('The staff member who checked stock cannot review that same evidence.');await one(this.db,'INSERT INTO crm_quote_reservations(availability_line_id,company_id,item_id,warehouse_key,uom,quantity,source_fingerprint,created_by) VALUES(?,?,?,?,?,?,?,?) RETURNING id',l.id,r.company_id,l.itemId,l.warehouse,l.uom,l.quantity,l.sourceFingerprint,user.id);}
   await this.db.prepare("UPDATE crm_quotation_availability SET status='AVAILABILITY_APPROVED',reviewed_by=?,reviewed_at=now(),decision_fingerprint=?,version=version+1 WHERE id=?").run(user.id,e.decisionFingerprint,r.id);
  }else if(b.action==='RETURN'){
   permission(user,'logistics.grn.post');await invalidateAvailability(this.db,r.quotation_id,user,b.reason);return this.detail(user,id,companyId);
  }else throw validationFailed('Unknown availability action.');
  await event(this.db,{...r,version:r.version+1},user,'AVAILABILITY_'+b.action,b.reason,decision);return this.detail(user,id,companyId);
 });}
}
export class AvailabilitySendGate{
 constructor(db){this.db=db;}get name(){return 'QUOTATION_AVAILABILITY';}
 async check({draft}){
  if(!draft.quotationId)return {passed:true,message:'No linked quotation on this draft.'};
  const q=await one(this.db,'SELECT * FROM crm_quotation_workflows WHERE quotation_id=?',draft.quotationId),bound=q?.private_snapshot.availabilityRequired||await one(this.db,'SELECT id FROM crm_quotation_availability WHERE quotation_id=? LIMIT 1',draft.quotationId);
  if(!bound)return {passed:true,message:'Retained historical quotation; existing sending gates apply.'};
  if(!q||q.public_snapshot.customerId!==draft.customerId||!['APPROVED','SENT','WON'].includes(q.status))return {passed:false,message:'The linked quotation must belong to this customer and have current commercial approval.'};
  try{await requireAvailability(this.db,q);return {passed:true,message:'Current warehouse decision and reservations verified.'};}catch(error){if([403,409,422].includes(error.status))return {passed:false,message:error.message};throw error;}
 }
}
