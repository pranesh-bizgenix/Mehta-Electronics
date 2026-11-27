import {tallyWriteActive,guardTallyWriteMutation,notifyTallyWrite} from './modules/tally-write/module.js';
import {workflowRule} from './modules/rules/workflow-rules.js';
import {usableSetting,requireSetting} from './modules/decisions/service.js';
import crypto from 'node:crypto';
import {transaction,id,validDate,validateTax} from './crm-modules.js';
import {hasPermission} from './rbac.js';
import {isLogisticsRole} from './logistics-policy.js';
import {operationalGrn,operationalLine} from './logistics-access.js';
import {quotePolicy} from './quotation-workflow.js';
import {orderDetail,validateOriginal} from './sales-orders.js';
import {calculateQuotation,scaled,money} from '../public/quotation-math.js';
import {writeAudit} from './db.js';
import {withCommercialCharges} from './modules/sourcing/domain.js';
import {decimal as exactDecimal,compare as exactCompare} from '../public/money.js';
import {threeWayMatch,invoiceReference} from './modules/sourcing/three-way-match.js';
import {renderPdf} from './modules/billing/pdf.js';
import {calendarDay,deliverySchedule} from './modules/sourcing/delivery-schedule.js';
import {requireNoSplitWinner,requireEditableSplitReply,splitPoSource} from './modules/sourcing/split-guards.js';
const decimalEqual=(a,b)=>exactCompare(exactDecimal(a),exactDecimal(b))===0;

const tables={vendors:'crm_procurement_vendors',requests:'crm_purchase_requests',rfqs:'crm_rfqs',replies:'crm_rfq_vendor_replies',pos:'crm_supplier_pos',grns:'crm_grns',documents:'crm_supplier_documents'};
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const can=(u,p='purchasing.read')=>{if(!hasPermission(u,p))fail(403,'Purchasing permission required.');};
const text=(v,max=2000)=>{if(typeof v!=='string'||v.length>max)fail(422,`Enter text of at most ${max} characters.`);return v.trim();};
const reason=b=>{const r=text(b.reason??'');if(r.length<3)fail(422,'A reason of at least three characters is required.');return r;};
const num=v=>{try{scaled(v);return String(v);}catch(e){fail(422,e.message);}};
const qty=n=>`${n/1000000n}.${String(n%1000000n).padStart(6,'0')}`;
const cents=v=>{const [w,f='']=String(v).split('.');return BigInt(w)*100n+BigInt(f.padEnd(2,'0'));};
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const number=prefix=>`${prefix}-${new Date().getUTCFullYear()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
export const procurementNumber=number;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const json=v=>JSON.stringify(v??null);
function table(kind){if(!tables[kind])fail(404,'Unknown purchasing module.');return tables[kind];}
const docColumns='id,supplier_po_id,kind,original_name,mime_type,sha256,byte_count,payload,version,review_fingerprint,status,created_at,updated_at,created_by,is_deleted';
export async function purchaseRecord(db,kind,recordId,user){can(user);const row=await db.prepare(`SELECT ${kind==='documents'?docColumns:'*'} FROM ${table(kind)} WHERE id=?`).get(id(recordId));if(!row)fail(404,'Purchasing record not found.');return row;}
async function internalRecord(db,kind,recordId,user){const row=await db.prepare(`SELECT ${kind==='documents'?docColumns:'*'} FROM ${table(kind)} WHERE id=?`).get(id(recordId));if(!row)fail(404,'Purchasing record not found.');return row;}
async function work(db,user,why,fn){can(user,'purchasing.write');return transaction(db,user,why,async()=>{await db.prepare("SELECT pg_advisory_xact_lock(812731),set_config('mehta.procurement_write','authorized',true)").get();return fn();});}
async function event(db,kind,old,after,user,action,why,detail={}){
 await db.prepare('INSERT INTO crm_procurement_events(entity,record_id,action,version,reason,before_snapshot,after_snapshot,detail,created_by) VALUES(?,?,?,?,?,?::text::jsonb,?::text::jsonb,?::text::jsonb,?)').run(kind,after.id,action,after.version??1,why,json(old),json(after),json(detail),user.id);
 await writeAudit(db,{userId:user.id,entity:'PROCUREMENT',recordId:`${kind}:${after.id}`,action,reason:why,newValue:{kind,id:after.id,status:after.status,version:after.version??1}});
}
function stale(old,b){if(old.version!==b.version)fail(409,'Record changed. Reload before continuing.');}
async function update(db,kind,old,payload,user,status=old.status){await db.prepare(`UPDATE ${table(kind)} SET payload=?::text::jsonb,version=version+1,status=? WHERE id=?`).run(json({...payload,_editor:user.id}),status,old.id);return purchaseRecord(db,kind,old.id,user);}
async function lines(db,inputs){if(!Array.isArray(inputs)||!inputs.length||inputs.length>100)fail(422,'Enter between 1 and 100 item lines.');const out=[],seen=new Set();
 for(const l of inputs){const item=await db.prepare("SELECT id,part_code,description,uom,hsn FROM items WHERE id=? AND status='ACTIVE'").get(id(l.itemId));if(!item)fail(422,'Select an active CRM item for every line.');if(seen.has(item.id))fail(422,'Combine duplicate item quantities into one purchasing line.');seen.add(item.id);
 const quantity=num(l.quantity);if(scaled(quantity)<=0n)fail(422,'Quantity must be positive.');const discount=num(l.discountPercent??'0'),tax=num(l.taxPercent??'0');if(scaled(discount)>100000000n||scaled(tax)>100000000n)fail(422,'Discount and tax must be within 0–100.');
 out.push({lineKey:l.lineKey&&/^[0-9a-f-]{36}$/i.test(l.lineKey)?l.lineKey:crypto.randomUUID(),itemId:item.id,partCode:text(l.partCode??item.part_code,200),crmPartCode:item.part_code,description:text(l.description??item.description,1000),uom:item.uom,hsn:item.hsn||'',quantity,unitPrice:num(l.unitPrice??'0'),discountPercent:discount,taxPercent:tax});
 }return out;
}
async function purchaseTotals(db,vendor,items){const policy=await quotePolicy(db);if(!policy)fail(409,'Configure company pricing policy/state first.');if(!vendor.payload.stateCode)fail(422,'Set the vendor state code before entering priced replies or POs.');
 let calc;try{calc=calculateQuotation(items,vendor.payload.stateCode,policy.seller_state);}catch(e){fail(422,e.message);}if(cents(calc.total)>99999999999900n)fail(422,'Purchasing total exceeds the supported limit.');return {buyer:policy.letterhead,vendorState:vendor.payload.stateCode,buyerState:policy.seller_state,policyRevision:policy.revision,...calc};
}
export async function purchaseList(db,kind,url,user){can(user);const page=Number(url.searchParams.get('page')||1);if(!Number.isSafeInteger(page)||page<1||page>1000000)fail(422,'Invalid page.');const search=String(url.searchParams.get('search')||'').slice(0,200),status=url.searchParams.get('status')||'';
 const args=[search,'%'+search+'%',status,status],where="WHERE NOT is_deleted AND (?='' OR payload::text ILIKE ?) AND (?='' OR status=?)";
 return {data:await db.prepare(`SELECT ${kind==='documents'?docColumns:'*'} FROM ${table(kind)} ${where} ORDER BY updated_at DESC,id DESC LIMIT 25 OFFSET ?`).all(...args,(page-1)*25),pagination:{page,pageSize:25,total:(await db.prepare(`SELECT count(*) AS n FROM ${table(kind)} ${where}`).get(...args)).n}};
}
export async function saveVendor(db,recordId,b,user){const why=reason(b);return work(db,user,why,async()=>{const old=recordId?await purchaseRecord(db,'vendors',recordId,user):null;if(old)stale(old,b);
 const source=b.sourcePartyId?await db.prepare("SELECT id,company_id,name,gstin,phone,email,address FROM crm_parties WHERE id=? AND party_role='VENDOR' AND status='ACTIVE' AND NOT is_deleted").get(id(b.sourcePartyId)):null;if(b.sourcePartyId&&!source)fail(422,'Select an active CRM vendor mapping.');
 if(old&&(source?.id??null)!==old.source_party_id)fail(422,'Vendor source identity cannot change.');const tax=validateTax(b.gstin??source?.gstin??'',b.stateCode??source?.gstin?.slice(0,2)??'');
 const payload={name:text(b.name??source?.name??'',200),stateCode:tax.stateCode,gstin:tax.gstin,email:text(b.email??source?.email??'',200),phone:text(b.phone??source?.phone??'',100),address:text(b.address??source?.address??'',1000),sourceCompanyId:source?.company_id??null,sourceLedgerName:source?.name??null,_editor:user.id};if(!payload.name)fail(422,'Vendor name is required.');if(payload.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email))fail(422,'Invalid vendor email.');
 const status=b.status||'ACTIVE';if(!['ACTIVE','INACTIVE','ARCHIVED'].includes(status))fail(422,'Invalid vendor status.');let after;
 if(old)after=await update(db,'vendors',old,payload,user,status);else{const r=await db.prepare('INSERT INTO crm_procurement_vendors(source_party_id,payload,created_by,status) VALUES(?,?::text::jsonb,?,?)').run(source?.id??null,json(payload),user.id,status);after=await purchaseRecord(db,'vendors',r.insertedId,user);}
 if(status==='ARCHIVED')await db.prepare('UPDATE crm_procurement_vendors SET is_deleted=true WHERE id=?').run(after.id);await event(db,'vendors',old,after,user,old?'VENDOR_REVISED':'VENDOR_CREATED',why);return after;
 });}
export async function purchaseSource(db,orderId,user){can(user);const o=await orderDetail(db,orderId,user);if(o.status==='CANCELLED')fail(409,'Cancelled sales order cannot be procured.');return {orderId:o.id,orderVersion:o.version,orderNumber:o.order_number,customerName:o.customer_name,customerPO:o.poNumber,status:o.effectiveStatus,lines:o.lines,source:{id:o.id,version:o.version,order_number:o.order_number,customer_name:o.customer_name,poNumber:o.poNumber,sellerState:o.sellerState,placeOfSupply:o.placeOfSupply,lines:o.lines,total:o.total}};}
export async function saveRequest(db,recordId,b,user){const why=reason(b);return work(db,user,why,async()=>{const old=recordId?await purchaseRecord(db,'requests',recordId,user):null;if(old){stale(old,b);if(old.status!=='DRAFT')fail(409,'Only draft purchase requests can be revised.');}
 const source=b.salesOrderId?await purchaseSource(db,b.salesOrderId,user):null;if(!validDate(b.requiredBy))fail(422,'Enter a required-by date.');const payload={subject:text(b.subject??'',200),requiredBy:b.requiredBy,notes:text(b.notes??'',10000),lines:await lines(db,b.lines),sourceOrder:source?{id:source.orderId,version:source.orderVersion,number:source.orderNumber}:null,_editor:user.id};if(!payload.subject)fail(422,'Request subject is required.');let after;
 if(old){await db.prepare('UPDATE crm_purchase_requests SET sales_order_id=? WHERE id=?').run(source?.orderId??null,old.id);after=await update(db,'requests',old,payload,user);}
 else{const r=await db.prepare('INSERT INTO crm_purchase_requests(number,sales_order_id,payload,created_by) VALUES(?,?,?::text::jsonb,?)').run(number('PR'),source?.orderId??null,json(payload),user.id);after=await purchaseRecord(db,'requests',r.insertedId,user);}
 await event(db,'requests',old,after,user,old?'REQUEST_REVISED':'REQUEST_CREATED',why);return after;
 });}
export async function createRfq(db,b,user){const why=reason(b);return work(db,user,why,async()=>{const request=await purchaseRecord(db,'requests',b.requestId,user);stale(request,{version:b.requestVersion});if(request.status==='CANCELLED')fail(409,'Request is cancelled.');if(!validDate(b.replyBy))fail(422,'Enter an RFQ reply-by date.');
 if(!Array.isArray(b.vendorIds)||!b.vendorIds.length||b.vendorIds.length>30)fail(422,'Choose between 1 and 30 vendors.');const vendors=[...new Set(b.vendorIds.map(id))];if(vendors.length!==b.vendorIds.length)fail(422,'Duplicate vendor selection.');
 for(const v of vendors){if((await purchaseRecord(db,'vendors',v,user)).status!=='ACTIVE')fail(422,'Choose active vendors.');}
 const payload={subject:request.payload.subject,replyBy:b.replyBy,notes:text(b.notes??'',10000),lines:request.payload.lines,requestVersion:request.version,_editor:user.id};const r=await db.prepare('INSERT INTO crm_rfqs(number,request_id,payload,created_by) VALUES(?,?,?::text::jsonb,?)').run(number('RFQ'),request.id,json(payload),user.id);
 for(const v of vendors)await db.prepare('INSERT INTO crm_rfq_vendors(rfq_id,vendor_id,created_by) VALUES(?,?,?)').run(r.insertedId,v,user.id);
 if(request.status==='DRAFT'){await db.prepare("UPDATE crm_purchase_requests SET status='REQUESTED' WHERE id=?").run(request.id);await event(db,'requests',request,await purchaseRecord(db,'requests',request.id,user),user,'REQUEST_RFQ_CREATED',why,{rfqId:r.insertedId});}
 const after=await purchaseRecord(db,'rfqs',r.insertedId,user);await event(db,'rfqs',null,after,user,'RFQ_CREATED',why,{vendorIds:vendors});return after;
 });}
export async function saveReply(db,rfqId,b,user){const why=reason(b);return work(db,user,why,async()=>{const rfq=await purchaseRecord(db,'rfqs',rfqId,user);if(rfq.status!=='OPEN')fail(409,'Only open RFQs accept replies.');stale(rfq,{version:b.rfqVersion});await requireEditableSplitReply(db,rfq.id);const vendor=await purchaseRecord(db,'vendors',b.vendorId,user);if(vendor.status!=='ACTIVE'||!await db.prepare('SELECT id FROM crm_rfq_vendors WHERE rfq_id=? AND vendor_id=?').get(rfq.id,vendor.id))fail(422,'Vendor was not invited or is inactive.');
 const itemLines=await lines(db,b.lines),wanted=new Map(rfq.payload.lines.map(l=>[l.itemId,l]));if(itemLines.some(l=>!wanted.has(l.itemId)))fail(422,'Reply contains an item outside the RFQ.');
 if(!validDate(b.validUntil))fail(422,'Enter reply validity.');const payload={vendorName:vendor.payload.name,validUntil:b.validUntil,leadDays:text(b.leadDays??'',100),terms:text(b.terms??'',10000),notes:text(b.notes??'',10000),...await purchaseTotals(db,vendor,itemLines),_editor:user.id};
 const old=await db.prepare('SELECT * FROM crm_rfq_vendor_replies WHERE rfq_id=? AND vendor_id=?').get(rfq.id,vendor.id);let after;
 if(old){stale(old,b);after=await update(db,'replies',old,payload,user,'RECORDED');}else{const r=await db.prepare('INSERT INTO crm_rfq_vendor_replies(rfq_id,vendor_id,payload,created_by) VALUES(?,?,?::text::jsonb,?)').run(rfq.id,vendor.id,json(payload),user.id);after=await purchaseRecord(db,'replies',r.insertedId,user);}
 await db.prepare("UPDATE crm_rfq_vendors SET status='REPLIED' WHERE rfq_id=? AND vendor_id=?").run(rfq.id,vendor.id);await event(db,'replies',old,after,user,old?'REPLY_REVISED':'REPLY_RECORDED',why);return after;
 });}
export async function rfqComparison(db,rfqId,user){const rfq=await purchaseRecord(db,'rfqs',rfqId,user),invited=await db.prepare('SELECT i.*,v.payload AS vendor FROM crm_rfq_vendors i JOIN crm_procurement_vendors v ON v.id=i.vendor_id WHERE i.rfq_id=? ORDER BY i.id').all(rfq.id),replies=await db.prepare("SELECT * FROM crm_rfq_vendor_replies WHERE rfq_id=? AND status='RECORDED' ORDER BY id").all(rfq.id);
 return {rfq,invited,replies,rows:rfq.payload.lines.map(l=>({item:l,offers:invited.map(v=>{const r=replies.find(r=>r.vendor_id===v.vendor_id),line=r?.payload.lines.find(x=>x.itemId===l.itemId);return {vendorId:v.vendor_id,vendorName:v.vendor.name,replyId:r?.id??null,line:line??null};})}))};
}
export async function selectWinner(db,rfqId,b,user){const why=reason(b);return work(db,user,why,async()=>{const old=await purchaseRecord(db,'rfqs',rfqId,user);stale(old,b);if(old.status!=='OPEN')fail(409,'RFQ winner is already frozen or RFQ is cancelled.');await requireNoSplitWinner(db,old.id);const reply=await purchaseRecord(db,'replies',b.replyId,user);if(reply.rfq_id!==old.id||reply.status!=='RECORDED'||reply.version!==b.replyVersion||reply.payload.validUntil<today())fail(409,'Select a current, valid RFQ reply.');
 if(reply.payload.lines.length!==old.payload.lines.length||old.payload.lines.some(l=>{const r=reply.payload.lines.find(r=>r.itemId===l.itemId);return !r||scaled(r.quantity)!==scaled(l.quantity);}))fail(422,'Winner must cover every requested item and quantity.');
 if((await purchaseRecord(db,'vendors',reply.vendor_id,user)).status!=='ACTIVE')fail(409,'Winning vendor is inactive.');await db.prepare("UPDATE crm_rfqs SET winner_reply_id=?,status='WINNER_SELECTED',version=version+1 WHERE id=?").run(reply.id,old.id);const after=await purchaseRecord(db,'rfqs',old.id,user);await event(db,'rfqs',old,after,user,'WINNER_SELECTED',why,{replyId:reply.id,replyVersion:reply.version});return after;
 });}
export async function saveSupplierPo(db,recordId,b,user){const why=reason(b);return work(db,user,why,async()=>{if(tallyWriteActive(db,'PURCHASE_ORDER'))await guardTallyWriteMutation(db,'PURCHASE_ORDER',recordId);const old=recordId?await purchaseRecord(db,'pos',recordId,user):null;if(old?.split_award_id)fail(409,'Approved split allocations cannot be repriced through the ordinary PO editor. Cancel and review a replacement split plan.');if(old){stale(old,b);if(!['DRAFT','PENDING_APPROVAL'].includes(old.status))fail(409,'Issued/approved supplier POs are immutable. Return a pending PO to draft before changes.');}
 const rfq=b.rfqId?await purchaseRecord(db,'rfqs',b.rfqId,user):null;let reply=null;if(rfq){if(rfq.status!=='WINNER_SELECTED')fail(409,'Select an RFQ winner first.');reply=await purchaseRecord(db,'replies',rfq.winner_reply_id,user);if(reply.payload.validUntil<today())fail(409,'Winning reply expired. Record a new RFQ before ordering.');}
 const request=rfq?await purchaseRecord(db,'requests',rfq.request_id,user):null;if(request?.sales_order_id&&b.salesOrderId&&id(b.salesOrderId)!==request.sales_order_id)fail(422,'RFQ purchase order must retain its purchase request sales-order link.');const orderId=b.salesOrderId||request?.sales_order_id||null,source=orderId?await purchaseSource(db,orderId,user):null;if(!rfq&&!source)fail(422,'Choose an RFQ winner or sales order.');
 const vendor=await purchaseRecord(db,'vendors',reply?.vendor_id??b.vendorId,user);if(vendor.status!=='ACTIVE')fail(409,'Vendor is inactive.');if(!validDate(b.deliveryBy))fail(422,'Enter supplier delivery date.');
 const itemLines=await lines(db,b.lines??reply?.payload.lines),baseTotals=await purchaseTotals(db,vendor,itemLines),pricedTotals=withCommercialCharges(baseTotals,reply?.payload.commercial,vendor.payload.stateCode,baseTotals.buyerState);const payload={vendor:vendor.payload,deliveryBy:b.deliveryBy,terms:text(b.terms??reply?.payload.terms??'',10000),notes:text(b.notes??'',10000),sourceOrder:source?.source??null,sourceReply:reply?{id:reply.id,version:reply.version,validUntil:reply.payload.validUntil}:null,...pricedTotals,_editor:user.id};let after;
 if(old){await db.prepare('UPDATE crm_supplier_pos SET vendor_id=?,rfq_id=?,sales_order_id=?,approval_fingerprint=NULL,approved_by=NULL WHERE id=?').run(vendor.id,rfq?.id??null,source?.orderId??null,old.id);after=await update(db,'pos',old,payload,user,'DRAFT');}
 else{const r=await db.prepare('INSERT INTO crm_supplier_pos(number,vendor_id,rfq_id,sales_order_id,payload,created_by) VALUES(?,?,?,?,?::text::jsonb,?)').run(number('SPO'),vendor.id,rfq?.id??null,source?.orderId??null,json(payload),user.id);after=await purchaseRecord(db,'pos',r.insertedId,user);}
 await event(db,'pos',old,after,user,old?'SUPPLIER_PO_REVISED':'SUPPLIER_PO_CREATED',why);return after;
 }).then(async result=>{if(tallyWriteActive(db,'PURCHASE_ORDER'))await notifyTallyWrite(db,'PURCHASE_ORDER',result.id,user);return result;});}
function compareLines(expected,actual){const alerts=[];for(const a of actual){const e=expected.find(x=>x.itemId===a.itemId);if(!e){alerts.push({code:'UNEXPECTED_ITEM',itemId:a.itemId});continue;}
 for(const [key,code]of [['quantity','QUANTITY_DIFFERENCE'],['unitPrice','RATE_DIFFERENCE'],['discountPercent','DISCOUNT_DIFFERENCE'],['taxPercent','TAX_DIFFERENCE']])if(scaled(a[key]??'0')!==scaled(e[key]??'0'))alerts.push({code,itemId:a.itemId,expected:e[key],actual:a[key]});
 if(e.partCode!==a.partCode)alerts.push({code:'PART_CODE_DIFFERENCE',itemId:a.itemId,expected:e.partCode,actual:a.partCode});if(e.uom!==a.uom)alerts.push({code:'UOM_DIFFERENCE',itemId:a.itemId});}
 for(const e of expected)if(!actual.some(a=>a.itemId===e.itemId))alerts.push({code:'MISSING_ITEM',itemId:e.itemId});return alerts;
}
export function exactMargin(source,purchases,policy,extraCost='0.00'){if(!policy||!purchases.length)return null;const sales=[];
 for(const p of purchases){const matches=source.lines.filter(l=>l.itemId===p.itemId);if(matches.length!==1||matches[0].uom!==p.uom)return null;sales.push({...matches[0],quantity:p.quantity});}
 const result=calculateQuotation(sales,source.sellerState,source.placeOfSupply),revenue=cents(result.subtotal),goodsCost=purchases.reduce((sum,p)=>sum+cents(p.net),0n),charges=cents(extraCost),cost=goodsCost+charges,floor=scaled(policy.floor_percent);
 const below=(net,c)=>net===0n?c>0n:(net-c)*100000000n<net*floor;
 return {percent:revenue===0n?null:money((revenue-cost)*10000n/revenue),salesNet:money(revenue),supplierCost:money(cost),floor:policy.floor_percent,belowFloor:below(revenue,cost)||(policy.margin_basis==='LINE_AND_TOTAL'&&result.lines.some((l,i)=>{const net=cents(purchases[i].net);return goodsCost===0n?charges>0n||below(cents(l.net),net):(cents(l.net)-net)*goodsCost*100000000n-charges*net*100000000n<cents(l.net)*floor*goodsCost;})),note:charges>0n?'Estimated gross margin before GST, including confirmed supplier charges allocated by line net value.':'Estimated gross margin for these quantities before GST; no additional supplier charges recorded.'};
}
export async function supplierPoCheck(db,poId,user){const po=await purchaseRecord(db,'pos',poId,user),vendor=await purchaseRecord(db,'vendors',po.vendor_id,user),policy=await quotePolicy(db),flags=[];const split=await splitPoSource(db,po);if(split)flags.push(...split.flags);
 if(!await usableSetting(db,'margin.floor_percent'))flags.push('QUOTATION_POLICY_NOT_CONFIRMED');
 const principalRule=await workflowRule(db,'procurement.principal_ordering',false);if(!principalRule)flags.push('PRINCIPAL_ORDERING_NOT_CONFIGURED');
 if(vendor.status!=='ACTIVE')flags.push('INACTIVE_VENDOR');if(!policy||policy.seller_state!==po.payload.buyerState||vendor.payload.stateCode!==po.payload.vendorState)flags.push('TAX_STATE_CHANGED');
 if(po.payload.sourceReply){const r=await purchaseRecord(db,'replies',po.payload.sourceReply.id,user);if(r.version!==po.payload.sourceReply.version||r.payload.validUntil<today()||r.status!=='RECORDED')flags.push('SOURCE_REPLY_CHANGED_OR_EXPIRED');if(compareLines(split?split.lines:r.payload.lines,po.payload.lines).length)flags.push(split?'SPLIT_ALLOCATION_DIFFERENCE':'WINNER_REPLY_DIFFERENCE');
 if(r.payload.commercial){if(digest(r.payload.commercial)!==digest(po.payload.commercial??null))flags.push('COMMERCIAL_TERMS_CHANGED');if(!r.payload.commercial.chargesConfirmed)flags.push('SUPPLIER_CHARGES_UNCONFIRMED');
 for(const line of r.payload.commercial.lines??[]){if(!line.conversionId)continue;const factor=await db.prepare("SELECT factor::text AS factor FROM item_pack_factors WHERE id=? AND item_id=? AND upper(trim(from_uom))=upper(trim(?)) AND upper(trim(to_uom))=upper(trim(?)) AND status='APPROVED' AND NOT is_deleted AND valid_from<=?::date AND (valid_to IS NULL OR valid_to>=?::date)").get(line.conversionId,line.itemId,line.supplierUom,line.baseUom,today(),today());if(!factor||!decimalEqual(factor.factor,line.factor))flags.push('PACK_CONVERSION_CHANGED_OR_EXPIRED');}}
 }
 let source=null,margin=null;
 if(po.sales_order_id){source=await orderDetail(db,po.sales_order_id,user);if(source.version!==po.payload.sourceOrder.version)flags.push('CUSTOMER_PO_CHANGED');if(!['APPROVED','PARTIALLY_DISPATCHED'].includes(source.effectiveStatus))flags.push('SALES_ORDER_NOT_APPROVED');
 margin=exactMargin(source,po.payload.lines,policy,po.payload.chargeTotals?.subtotal??'0.00');if(!margin)flags.push('MARGIN_UNAVAILABLE_UNMATCHED_OR_AMBIGUOUS_ITEMS');else if(margin.belowFloor)flags.push('MARGIN_BELOW_FLOOR');
 }
 const result={flags:[...new Set(flags)].sort(),margin};
 return {...result,principalInstructions:principalRule?.value.instructions??null,fingerprint:digest({version:po.version,result,principalRuleVersion:principalRule?.version??null,vendorVersion:vendor.version,policyRevision:policy?.revision,splitAwardVersion:split?.version??null,orderVersion:source?.version,orderStatus:source?.effectiveStatus})};
}
export async function supplierPoAction(db,poId,b,user){const why=reason(b);return work(db,user,why,async()=>{if(tallyWriteActive(db,'PURCHASE_ORDER'))await guardTallyWriteMutation(db,'PURCHASE_ORDER',poId);const old=await purchaseRecord(db,'pos',poId,user);stale(old,b);let next;const check=await supplierPoCheck(db,poId,user);
 if(['SUBMIT','APPROVE','ISSUE'].includes(b.action)){await workflowRule(db,'procurement.principal_ordering');await requireSetting(db,'margin.floor_percent');}
 if(b.action==='SUBMIT'&&old.status==='DRAFT')next='PENDING_APPROVAL';
 else if(b.action==='RETURN'&&['PENDING_APPROVAL','APPROVED'].includes(old.status)){can(user,'purchasing.approve');next='DRAFT';}
 else if(b.action==='APPROVE'&&old.status==='PENDING_APPROVAL'){can(user,'purchasing.approve');if(user.id===old.created_by||user.id===old.payload._editor)fail(403,'A different reviewer must approve the supplier PO.');if(b.fingerprint!==check.fingerprint)fail(409,'Verification changed. Reload before approving.');
 if(check.flags.some(f=>['INACTIVE_VENDOR','TAX_STATE_CHANGED','SOURCE_REPLY_CHANGED_OR_EXPIRED','CUSTOMER_PO_CHANGED','SALES_ORDER_NOT_APPROVED','SPLIT_AWARD_SOURCE_CHANGED','SPLIT_ALLOCATION_DIFFERENCE'].includes(f)))fail(409,'Correct changed/inactive sources before approval.');if(check.flags.length&&b.acceptExceptions!==true)fail(422,'Explicitly accept the listed exceptions.');next='APPROVED';}
 else if(b.action==='ISSUE'&&old.status==='APPROVED'){if(check.fingerprint!==old.approval_fingerprint)fail(409,'Approval is stale. Return/revise and review again.');next='ISSUED';}
 else if(b.action==='CANCEL'&&['DRAFT','PENDING_APPROVAL','APPROVED','ISSUED'].includes(old.status)){if(await db.prepare("SELECT id FROM crm_grns WHERE supplier_po_id=? AND status='POSTED'").get(old.id))fail(409,'Received PO cannot be cancelled.');next='CANCELLED';}
 else fail(409,'Invalid supplier PO transition.');
 await db.prepare('UPDATE crm_supplier_pos SET status=?,approval_fingerprint=?,approved_by=? WHERE id=?').run(next,next==='APPROVED'?check.fingerprint:old.approval_fingerprint,next==='APPROVED'?user.id:old.approved_by,old.id);const after=await purchaseRecord(db,'pos',old.id,user);await event(db,'pos',old,after,user,b.action,why,{check});return after;
 }).then(async result=>{if(tallyWriteActive(db,'PURCHASE_ORDER'))await notifyTallyWrite(db,'PURCHASE_ORDER',poId,user);return result;});}
function grnPermission(user,action){
 if(isLogisticsRole(user)){can(user,`logistics.grn.${action==='read'?'read':action}`);return;}
 can(user);if(action!=='read')can(user,'purchasing.write');if(action==='post')can(user,'purchasing.approve');
}
async function grnWork(db,user,why,fn){
 if(!isLogisticsRole(user))return work(db,user,why,fn);
 return transaction(db,user,why,async()=>{await db.prepare("SELECT pg_advisory_xact_lock(812731),set_config('mehta.procurement_write','authorized',true)").get();return fn();});
}
export async function grnCheck(db,grnId,user){grnPermission(user,'read');const c=await internalGrnCheck(db,grnId,user);
 if(!isLogisticsRole(user))return c;
 return {alerts:c.alerts.map(a=>({code:['RECEIPT_RATE_DIFFERENCE','RECEIPT_TAX_DIFFERENCE'].includes(a.code)?'COMMERCIAL_REVIEW_REQUIRED':a.code,itemId:a.itemId})),rows:c.rows.map(operationalLine),fingerprint:c.fingerprint,po:{id:c.po.id,number:c.po.number,status:c.po.status}};
}
async function internalGrnCheck(db,grnId,user){const grn=await internalRecord(db,'grns',grnId,user),po=await internalRecord(db,'pos',grn.supplier_po_id,user),prior=await db.prepare("SELECT id,payload FROM crm_grns WHERE supplier_po_id=? AND status='POSTED' AND id<>? ORDER BY id").all(po.id,grn.id),totals=new Map(),alerts=[];
 for(const receipt of prior)for(const l of receipt.payload.lines)totals.set(l.poLineKey,(totals.get(l.poLineKey)??0n)+scaled(l.accepted));
 const rows=grn.payload.lines.map(l=>{const p=po.payload.lines.find(p=>p.lineKey===l.poLineKey);if(!p)fail(422,'Receipt line is not in the supplier PO.');const before=totals.get(l.poLineKey)??0n,total=before+scaled(l.accepted),remaining=scaled(p.quantity)>total?scaled(p.quantity)-total:0n;
 if(total>scaled(p.quantity))alerts.push({code:'OVER_RECEIPT',itemId:p.itemId});if(l.actualPartCode!==p.partCode)alerts.push({code:'RECEIVED_PART_DIFFERENCE',itemId:p.itemId,expected:p.partCode,actual:l.actualPartCode});if(scaled(l.received)>scaled(l.accepted))alerts.push({code:'REJECTED_OR_DAMAGED',itemId:p.itemId});if(scaled(l.unitPrice)!==scaled(p.unitPrice))alerts.push({code:'RECEIPT_RATE_DIFFERENCE',itemId:p.itemId});if(scaled(l.taxPercent)!==scaled(p.taxPercent))alerts.push({code:'RECEIPT_TAX_DIFFERENCE',itemId:p.itemId});
 return {...l,itemId:p.itemId,partCode:p.partCode,ordered:p.quantity,previousAccepted:qty(before),cumulativeAccepted:qty(total),remaining:qty(remaining)};});
 return {alerts,rows,fingerprint:digest({version:grn.version,poVersion:po.version,poStatus:po.status,prior,rows}),po};
}
export async function createGrn(db,poId,b,user){grnPermission(user,'manage');if(isLogisticsRole(user)){const allowed=['requestKey','receivedDate','reference','notes','lines','reason'];if(Object.keys(b).some(k=>!allowed.includes(k))||Array.isArray(b.lines)&&b.lines.some(l=>!l||typeof l!=='object'||Array.isArray(l)||Object.keys(l).some(k=>!['poLineKey','actualPartCode','received','accepted','rejected','notes'].includes(k))))fail(422,'Only operational receipt fields are permitted.');}const why=reason(b);return grnWork(db,user,why,async()=>{const po=await internalRecord(db,'pos',poId,user);if(!['ISSUED','PARTIALLY_RECEIVED','RECEIVED'].includes(po.status))fail(409,'Receive only an issued or partially received PO.');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestKey??''))fail(422,'A receipt retry UUID is required.');const existing=await db.prepare('SELECT * FROM crm_grns WHERE request_key=?::uuid').get(b.requestKey);if(existing){if(existing.supplier_po_id!==po.id||existing.payload.requestHash!==digest(b.lines))fail(409,'Retry key already used for different receipt details.');return isLogisticsRole(user)?operationalGrn(existing):existing;}
 if(!validDate(b.receivedDate)||!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100)fail(422,'Enter receipt date and lines.');const out=[],seen=new Set();let positive=false;
 for(const l of b.lines){if(seen.has(l.poLineKey))fail(422,'Duplicate receipt line.');seen.add(l.poLineKey);const p=po.payload.lines.find(p=>p.lineKey===l.poLineKey);if(!p)fail(422,'Select a PO line.');const received=num(l.received),accepted=num(l.accepted),rejected=num(l.rejected??'0'),taxPercent=num(l.taxPercent??p.taxPercent);if(scaled(taxPercent)>100000000n)fail(422,'GST must be within 0–100.');if(scaled(accepted)+scaled(rejected)!==scaled(received))fail(422,'Accepted plus rejected must equal received quantity.');positive ||=scaled(received)>0n;out.push({poLineKey:p.lineKey,actualPartCode:text(l.actualPartCode??p.partCode,200),received,accepted,rejected,unitPrice:num(l.unitPrice??p.unitPrice),taxPercent,notes:text(l.notes??'',1000)});}
 if(!positive)fail(422,'Enter a positive received quantity.');const payload={receivedDate:b.receivedDate,reference:text(b.reference??'',200),notes:text(b.notes??'',2000),lines:out,requestHash:digest(b.lines),_editor:user.id};const r=await db.prepare('INSERT INTO crm_grns(number,supplier_po_id,payload,request_key,created_by) VALUES(?,?,?::text::jsonb,?::uuid,?)').run(number('GRN'),po.id,json(payload),b.requestKey,user.id);const after=await internalRecord(db,'grns',r.insertedId,user);await event(db,'grns',null,after,user,'GRN_CREATED',why);return isLogisticsRole(user)?operationalGrn(after):after;
 });}
export async function postGrn(db,grnId,b,user){grnPermission(user,'post');const why=reason(b);return grnWork(db,user,why,async()=>{const old=await internalRecord(db,'grns',grnId,user);stale(old,b);if(old.status!=='HELD')fail(409,'Receipt is not pending review.');if(old.created_by===user.id)fail(403,'A different reviewer must post the receipt.');const check=await internalGrnCheck(db,grnId,user);if(!['ISSUED','PARTIALLY_RECEIVED','RECEIVED'].includes(check.po.status))fail(409,'Supplier PO is not open for receipt.');if(b.fingerprint!==check.fingerprint)fail(409,'Receipt totals changed. Reload the review.');if(isLogisticsRole(user)&&check.alerts.some(a=>['RECEIPT_RATE_DIFFERENCE','RECEIPT_TAX_DIFFERENCE'].includes(a.code)))fail(409,'Commercial receipt differences require an existing purchasing reviewer.');if(check.alerts.length&&b.acceptExceptions!==true)fail(422,'Explicitly accept the receipt differences.');
 await db.prepare("UPDATE crm_grns SET status='POSTED' WHERE id=?").run(old.id);const all=await db.prepare("SELECT payload FROM crm_grns WHERE supplier_po_id=? AND status='POSTED'").all(old.supplier_po_id),sum=new Map();for(const g of all)for(const l of g.payload.lines)sum.set(l.poLineKey,(sum.get(l.poLineKey)??0n)+scaled(l.accepted));
 const complete=check.po.payload.lines.every(l=>(sum.get(l.lineKey)??0n)>=scaled(l.quantity));await db.prepare('UPDATE crm_supplier_pos SET status=? WHERE id=?').run(complete?'RECEIVED':'PARTIALLY_RECEIVED',check.po.id);const after=await internalRecord(db,'grns',grnId,user);await event(db,'grns',old,after,user,'GRN_POSTED',why,{check});await event(db,'pos',check.po,await internalRecord(db,'pos',check.po.id,user),user,'RECEIPT_STATUS',why,{grnId:old.id});return isLogisticsRole(user)?operationalGrn(after):after;
 });}
export async function uploadSupplierDocument(db,poId,b,user){const why=reason(b),file=validateOriginal(b);return work(db,user,why,async()=>{const po=await purchaseRecord(db,'pos',poId,user);if(po.status==='CANCELLED')fail(409,'PO is cancelled.');if(!['ACCEPTANCE','DISPATCH_INVOICE','PACKING_SLIP','TEST_REPORT'].includes(b.kind))fail(422,'Select a supplier document type.');
 if(await db.prepare('SELECT id FROM crm_supplier_documents WHERE supplier_po_id=? AND kind=? AND sha256=?').get(po.id,b.kind,file.sha256))fail(409,'This original has already been retained for this PO/document type.');
 let previous=null;if(b.replacesId){previous=await purchaseRecord(db,'documents',b.replacesId,user);if(previous.supplier_po_id!==po.id||previous.kind!==b.kind||previous.status==='ARCHIVED')fail(422,'Invalid document replacement.');await db.prepare("UPDATE crm_supplier_documents SET status='ARCHIVED',is_deleted=true WHERE id=?").run(previous.id);await event(db,'documents',previous,await purchaseRecord(db,'documents',previous.id,user),user,'DOCUMENT_SUPERSEDED',why);}
 const r=await db.prepare('INSERT INTO crm_supplier_documents(supplier_po_id,kind,original_name,mime_type,sha256,byte_count,original_bytes,payload,created_by) VALUES(?,?,?,?,?,?,?,?::text::jsonb,?)').run(po.id,b.kind,file.name,file.mime,file.sha256,file.bytes.length,file.bytes,json({_editor:user.id}),user.id);const after=await purchaseRecord(db,'documents',r.insertedId,user);await event(db,'documents',null,after,user,'SUPPLIER_ORIGINAL_RETAINED',why,{replacesId:previous?.id??null});return after;
 });}
export async function supplierOriginal(db,documentId,user){can(user);const d=await db.prepare('SELECT original_name,mime_type,original_bytes FROM crm_supplier_documents WHERE id=?').get(id(documentId));if(!d)fail(404,'Supplier original not found.');return d;}
export async function saveDocumentReview(db,documentId,b,user){const why=reason(b);return work(db,user,why,async()=>{const old=await purchaseRecord(db,'documents',documentId,user);stale(old,b);if(old.status==='ARCHIVED')fail(409,'Archived document is immutable.');const po=await purchaseRecord(db,'pos',old.supplier_po_id,user),vendor=await purchaseRecord(db,'vendors',po.vendor_id,user);
 if(b.manualConfirmed!==true)fail(422,'Confirm the data was checked manually against the original.');
 if(!validDate(b.documentDate))fail(422,'Enter the supplier document date.');const parsed=await lines(db,b.lines),priced=['ACCEPTANCE','DISPATCH_INVOICE'].includes(old.kind),payload={reference:text(b.reference??'',200),documentDate:b.documentDate,notes:text(b.notes??'',10000),priced,lines:parsed,...(priced?await purchaseTotals(db,vendor,parsed):{total:null}),_editor:user.id};await db.prepare('UPDATE crm_supplier_documents SET review_fingerprint=NULL WHERE id=?').run(old.id);const after=await update(db,'documents',old,payload,user,'PENDING_REVIEW');await event(db,'documents',old,after,user,'MANUAL_DOCUMENT_DATA_REVISED',why);return after;
 });}
export async function documentComparison(db,documentId,user){const doc=await purchaseRecord(db,'documents',documentId,user),po=await purchaseRecord(db,'pos',doc.supplier_po_id,user),flags=[];let customer=null,margin=null;
 if(!doc.payload.lines?.length)flags.push({code:'MANUAL_DATA_REQUIRED'});const actual=doc.payload.lines||[],priced=doc.payload.priced===true,supplierAlerts=compareLines(po.payload.lines,actual).filter(a=>priced||!['RATE_DIFFERENCE','DISCOUNT_DIFFERENCE','TAX_DIFFERENCE'].includes(a.code));flags.push(...supplierAlerts);
 if(po.sales_order_id){customer=await orderDetail(db,po.sales_order_id,user);if(customer.version!==po.payload.sourceOrder.version)flags.push({code:'CUSTOMER_PO_CHANGED'});const customerAlerts=compareLines(customer.lines,actual);flags.push(...customerAlerts.filter(a=>!['RATE_DIFFERENCE','DISCOUNT_DIFFERENCE',...(!priced?['TAX_DIFFERENCE']:[])].includes(a.code)).map(a=>({...a,code:'CUSTOMER_'+a.code})));
 if(priced){const policy=await quotePolicy(db);margin=exactMargin(customer,actual,policy);if(!margin)flags.push({code:'MARGIN_UNAVAILABLE'});else if(margin.belowFloor)flags.push({code:'MARGIN_BELOW_FLOOR'});}
 }
 let receiptMatch=null;
 if(doc.kind==='DISPATCH_INVOICE'){
  const receipts=await db.prepare("SELECT id,version,status,is_deleted,payload FROM crm_grns WHERE supplier_po_id=? AND status='POSTED' AND NOT is_deleted ORDER BY id").all(po.id);
  const invoices=await db.prepare("SELECT id,version,status,kind,is_deleted,payload FROM crm_supplier_documents WHERE supplier_po_id=? AND kind='DISPATCH_INVOICE' AND id<>? AND status='REVIEWED' AND NOT is_deleted ORDER BY id").all(po.id,doc.id);
  const duplicates=invoiceReference(doc.payload.reference)?await db.prepare("SELECT d.id,d.version FROM crm_supplier_documents d JOIN crm_supplier_pos p ON p.id=d.supplier_po_id WHERE p.vendor_id=? AND d.kind='DISPATCH_INVOICE' AND d.id<>? AND d.status<>'ARCHIVED' AND NOT d.is_deleted AND upper(trim(d.payload->>'reference'))=? ORDER BY d.id").all(po.vendor_id,doc.id,invoiceReference(doc.payload.reference)):[];
  receiptMatch=threeWayMatch({po,invoice:doc,receipts,priorInvoices:invoices,duplicateInvoices:duplicates});flags.push(...receiptMatch.blockers,...receiptMatch.differences);
 }
 const result={flags,receiptMatch,supplierPO:{id:po.id,number:po.number,lines:po.payload.lines,total:po.payload.total},customerPO:customer?{number:customer.poNumber,version:customer.version,lines:customer.lines,total:customer.total}:null,supplierDocument:{id:doc.id,reference:doc.payload.reference,lines:actual,total:doc.payload.total??null},margin};
 return {...result,fingerprint:digest({version:doc.version,poVersion:po.version,customerVersion:customer?.version,result})};
}
export async function approveDocument(db,documentId,b,user){const why=reason(b);return work(db,user,why,async()=>{can(user,'purchasing.approve');const old=await purchaseRecord(db,'documents',documentId,user);stale(old,b);if(old.status!=='PENDING_REVIEW')fail(409,'Document is not pending review.');if(old.created_by===user.id||old.payload._editor===user.id)fail(403,'A different reviewer must verify the supplier document.');const check=await documentComparison(db,documentId,user);if(b.fingerprint!==check.fingerprint)fail(409,'Comparison changed. Reload.');if(!old.payload.lines?.length)fail(422,'Enter the supplier document details manually first.');if(check.receiptMatch?.blockers.length)fail(409,'Resolve supplier invoice receipt, quantity and duplicate-reference blockers before approval.');if(check.flags.length&&b.acceptExceptions!==true)fail(422,'Explicitly accept the documented mismatches.');await db.prepare("UPDATE crm_supplier_documents SET status='REVIEWED',review_fingerprint=? WHERE id=?").run(check.fingerprint,old.id);const after=await purchaseRecord(db,'documents',documentId,user);await event(db,'documents',old,after,user,'SUPPLIER_DOCUMENT_REVIEWED',why,{check});return after;
 });}
export async function purchaseHistory(db,kind,recordId,user){await purchaseRecord(db,kind,recordId,user);return db.prepare('SELECT e.*,u.name AS actor FROM crm_procurement_events e JOIN users u ON u.id=e.created_by WHERE entity=? AND record_id=? ORDER BY e.id DESC').all(kind,id(recordId));}
export async function supplierInvoiceMatchPdf(db,documentId,body,user){
 can(user);const why=reason(body),check=await documentComparison(db,documentId,user),match=check.receiptMatch;
 if(!match)fail(422,'Receipt matching is available for supplier invoice documents only.');
 const bytes=await renderPdf({title:'Supplier invoice matching',subtitle:`${check.supplierPO.number} | Invoice ${check.supplierDocument.reference||'Not supplied'}`,sections:[{label:'Basis',value:match.note},{label:'Review result',value:match.blockers.length?'Blocked: '+match.blockers.map(f=>f.code).join(', '):match.differences.length?'Commercial review: '+match.differences.map(f=>f.code).join(', '):'Quantities and recorded prices matched'},{label:'Evidence',value:`Posted receipt IDs: ${match.receiptEvidence.map(r=>r.id).join(', ')||'None'} | Prior reviewed invoice IDs: ${match.invoiceEvidence.map(r=>r.id).join(', ')||'None'}`}],columns:[{label:'Item / UoM',fraction:.23},{label:'Ordered',fraction:.12},{label:'Accepted',fraction:.13},{label:'Rejected',fraction:.12},{label:'Prior billed',fraction:.13},{label:'This invoice',fraction:.14},{label:'Unbilled',fraction:.13}],rows:match.rows.map(r=>[r.partCode+' / '+r.uom,r.ordered,r.accepted,r.rejected,r.previouslyInvoiced,r.thisInvoice,r.remainingAccepted]),afterSections:[{label:'Evidence fingerprint',value:check.fingerprint}]});
 await writeAudit(db,{userId:user.id,entity:'PROCUREMENT',recordId:'documents:'+id(documentId),action:body.preview===true?'MATCH_PDF_PREVIEW':'MATCH_PDF_DOWNLOAD',reason:why,newValue:{fingerprint:check.fingerprint,rowCount:match.rows.length}});
 return {bytes,filename:'supplier-invoice-'+id(documentId)+'-matching.pdf'};
}
export async function supplierDeliverySchedule(db,poId,user){
 const po=await purchaseRecord(db,'pos',poId,user),receipts=await db.prepare("SELECT payload,status,is_deleted FROM crm_grns WHERE supplier_po_id=? AND status='POSTED' AND NOT is_deleted").all(po.id);
 const revision=await db.prepare("SELECT id,detail,reason FROM crm_procurement_events WHERE entity='pos' AND record_id=? AND action='DELIVERY_PROMISE_REVISED' ORDER BY id DESC LIMIT 1").get(po.id);
 const order=po.sales_order_id?await db.prepare('SELECT promised_date::text AS promised FROM sales_orders WHERE id=?').get(po.sales_order_id):null;
 return deliverySchedule({po,receipts,revision,customerDate:order?.promised??null,today:today()});
}
export async function reviseSupplierDelivery(db,poId,b,user){
 const why=reason(b),promisedDate=calendarDay(b.promisedDate),evidence=text(b.evidence??'',2000);
 if(b.supplierConfirmed!==true||evidence.length<3)fail(422,'Confirm the supplier promise and provide its evidence reference.');
 if(b.previousRevisionId!==null&&(!Number.isSafeInteger(b.previousRevisionId)||b.previousRevisionId<1))fail(422,'Reload the latest supplier delivery revision.');
 return work(db,user,why,async()=>{
  const po=await purchaseRecord(db,'pos',poId,user);stale(po,b);
  const current=await supplierDeliverySchedule(db,po.id,user);
  if(!current.canRevise)fail(409,'Only issued or partly received purchase orders accept delivery updates.');
  if(current.revisionId!==b.previousRevisionId)fail(409,'Another delivery update was saved. Reload before recording this promise.');
  await event(db,'pos',po,po,user,'DELIVERY_PROMISE_REVISED',why,{promisedDate,evidence,supplierConfirmed:true,previousRevisionId:current.revisionId,previousPromisedDate:current.promisedDate,originalDate:current.originalDate});
  return supplierDeliverySchedule(db,po.id,user);
 });
}
export async function supplierPoDetail(db,poId,user){const po=await purchaseRecord(db,'pos',poId,user);return {...po,deliverySchedule:await supplierDeliverySchedule(db,poId,user),check:await supplierPoCheck(db,poId,user),documents:await db.prepare(`SELECT ${docColumns} FROM crm_supplier_documents WHERE supplier_po_id=? ORDER BY id DESC`).all(po.id),grns:await db.prepare('SELECT * FROM crm_grns WHERE supplier_po_id=? ORDER BY id DESC').all(po.id)};}
export async function cancelPurchaseRecord(db,kind,recordId,b,user){const why=reason(b);return work(db,user,why,async()=>{if(!['requests','rfqs','grns'].includes(kind))fail(422,'Cancellation is unavailable for this record type.');const old=await purchaseRecord(db,kind,recordId,user);stale(old,b);
 if(old.status==='CANCELLED'||kind==='grns'&&old.status==='POSTED')fail(409,'Posted or cancelled record cannot be cancelled.');
 if(kind==='requests'&&await db.prepare("SELECT id FROM crm_rfqs WHERE request_id=? AND status<>'CANCELLED'").get(old.id))fail(409,'Cancel active RFQs first.');
 if(kind==='rfqs'&&await db.prepare("SELECT id FROM crm_supplier_pos WHERE rfq_id=? AND status<>'CANCELLED'").get(old.id))fail(409,'Cancel linked supplier PO first.');
 await db.prepare(`UPDATE ${table(kind)} SET status='CANCELLED',version=version+1 WHERE id=?`).run(old.id);const after=await purchaseRecord(db,kind,old.id,user);await event(db,kind,old,after,user,'CANCELLED',why);return after;
 });}
