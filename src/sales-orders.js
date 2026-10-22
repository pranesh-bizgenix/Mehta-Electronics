import crypto from 'node:crypto';
import {transaction,id,validDate,customerDetail,itemDetail} from './crm-modules.js';
import {quoteDetail,quoteForDocument,quotePolicy,costAccess} from './quotation-workflow.js';
import {calculateQuotation,scaled,money} from '../public/quotation-math.js';
import {hasPermission} from './rbac.js';
import {writeAudit} from './db.js';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const can=(u,p)=>{if(!hasPermission(u,p))fail(403,'Permission denied.');};
const text=(v,max=1000)=>{if(typeof v!=='string'||v.length>max)fail(422,`Enter text of at most ${max} characters.`);return v.trim();};
const why=b=>{const v=text(b.reason??'',2000);if(v.length<3)fail(422,'A reason of at least three characters is required.');return v;};
const decimal=(v)=>{try{scaled(v);return String(v);}catch(e){fail(422,e.message);}};
const cents=v=>{const s=String(v);if(!/^-?\d+(?:\.\d{1,2})?$/.test(s))fail(422,'Enter an amount with at most two decimal places.');const n=s.startsWith('-'),[w,f='']=(n?s.slice(1):s).split('.');return (BigInt(w)*100n+BigInt(f.padEnd(2,'0')))*(n?-1n:1n);};
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const fingerprint=v=>hash(JSON.stringify(v));
const json=v=>JSON.stringify(v);
async function work(db,user,reason,fn){return transaction(db,user,reason,async()=>{
 // Shared with quotation policy/cost changes. No network calls occur while locked.
 await db.prepare("SELECT pg_advisory_xact_lock(812731),set_config('mehta.order_write','authorized',true)").get();return fn();
});}
async function row(db,orderId){const r=await db.prepare('SELECT * FROM crm_order_workflows WHERE sales_order_id=?').get(id(orderId));if(!r)fail(404,'Workflow sales order not found.');return r;}
export async function managedOrder(db,orderId){return !!await db.prepare('SELECT id FROM crm_order_workflows WHERE sales_order_id=?').get(id(orderId));}
export async function legacyOrderDetail(db,orderId,user){const o=await orderDetail(db,orderId,user),base=await db.prepare('SELECT status FROM sales_orders WHERE id=?').get(o.id);
 return {...o,status:base.status,workflowStatus:o.status,customer_po_number:o.poNumber,customer_po_date:o.poDate,promised_date:o.promisedDate,quotation_id:o.quotationId,subtotal:o.subtotal,tax_total:money(cents(o.cgst)+cents(o.sgst)+cents(o.igst)),lines:o.lines.map(l=>({...l,part_code:l.partCode,ordered_quantity:l.quantity,fulfilled_quantity:l.fulfilledQuantity,unit_price:l.unitPrice,discount_percent:l.discountPercent,tax_percent:l.taxPercent}))};
}
async function event(db,r,user,action,reason,detail={},privateDetail={}){
 await db.prepare('INSERT INTO crm_order_events(sales_order_id,version,action,reason,public_detail,private_detail,created_by) VALUES(?,?,?,?,?::text::jsonb,?::text::jsonb,?)').run(r.sales_order_id,r.version,action,reason,json(detail),json(privateDetail),user.id);
 await writeAudit(db,{userId:user.id,entity:'SALES_ORDER_WORKFLOW',recordId:r.sales_order_id,action,reason,newValue:detail});
}
function redactVerification(v,user){const {private:pricing,credit,fingerprint:ignored,...publicFields}=v;
 return {...publicFields,...(costAccess(user)?{pricing}:{}),credit:['OWNER','ACCOUNTS'].includes(user.role)?credit:{available:credit.available,exceeded:credit.exceeded,note:'Credit figures restricted to financial roles.'}};
}
export async function orderQuoteSource(db,quoteId,user){can(user,'orders.create');const q=await quoteDetail(db,quoteId,user),doc=await quoteForDocument(db,quoteId,user);
 if(!['APPROVED','SENT','WON'].includes(q.status)||doc.status==='DRAFT')fail(409,'Select a current approved, sent or won quotation.');
 const {pricing,...out}=q;return out;
}
async function snapshot(db,b){
 const policy=await quotePolicy(db);if(!policy)fail(409,'The owner must configure quotation pricing policy and seller state first.');
 const customer=await db.prepare("SELECT id,name FROM customers WHERE id=? AND status='ACTIVE'").get(id(b.customerId));if(!customer)fail(422,'Select an active customer.');
 const po=text(b.poNumber??'',100);if(!po)fail(422,'Customer PO number is required.');
 if(!validDate(b.poDate)||b.promisedDate&&!validDate(b.promisedDate))fail(422,'Enter valid PO and promised dates.');
 if(!/^(0[1-9]|[12][0-9]|3[0-8])$/.test(b.placeOfSupply??''))fail(422,'Enter a valid place-of-supply state code.');
 if(b.supplyType!=='DOMESTIC_STANDARD')fail(422,'Confirm standard domestic tax treatment. Special supplies require separate review.');
 if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100)fail(422,'Enter between 1 and 100 PO lines.');
 const lines=[];
 for(const input of b.lines){const part=text(input.partCode??'',200);if(!part)fail(422,'Every PO line needs its original part code.');
 let item=null;if(input.itemId)item=await db.prepare("SELECT id,part_code,uom,description FROM items WHERE id=? AND status='ACTIVE'").get(id(input.itemId));
 else item=await db.prepare("SELECT id,part_code,uom,description FROM items WHERE part_code=? AND status='ACTIVE'").get(part);
 if(input.itemId&&!item)fail(422,'Mapped item must be active.');
 lines.push({itemId:item?.id??null,partCode:part,crmPartCode:item?.part_code??null,description:text(input.description??item?.description??part,1000),uom:text(input.uom??item?.uom??'',30),quantity:decimal(input.quantity),unitPrice:decimal(input.unitPrice),discountPercent:decimal(input.discountPercent??'0'),taxPercent:decimal(input.taxPercent??'0')});
 if(!lines.at(-1).uom)fail(422,'Every PO line needs a UOM.');
 }
 let calc;try{calc=calculateQuotation(lines,policy.seller_state,b.placeOfSupply);}catch(e){fail(422,e.message);}
 if(cents(calc.total)>99999999999900n)fail(422,'Order total exceeds the supported limit.');
 const declared=cents(b.poTotal);if(declared<0n)fail(422,'PO total cannot be negative.');
 return {customerId:customer.id,customer_name:customer.name,quotationId:b.quotationId?id(b.quotationId):null,poNumber:po,poDate:b.poDate,promisedDate:b.promisedDate||null,placeOfSupply:b.placeOfSupply,sellerState:policy.seller_state,supplyType:b.supplyType,poTotal:money(declared),notes:text(b.notes??'',10000),...calc};
}
export async function saveOrder(db,orderId,b,user){can(user,orderId?'orders.update':'orders.create');const reason=why(b);
 return work(db,user,reason,async()=>{
 const old=orderId?await row(db,orderId):null;
 if(old){if(b.version!==old.version)fail(409,'Order changed. Reload before editing.');if(['CANCELLED','DELIVERED'].includes(old.status)||await db.prepare('SELECT id FROM crm_shipments WHERE sales_order_id=?').get(old.sales_order_id))fail(409,'Dispatched or terminal orders cannot be revised.');}
 const s=await snapshot(db,b);if(old&&(s.customerId!==old.customer_id||s.poNumber.toUpperCase()!==old.po_key))fail(422,'Customer and PO identity cannot change. Cancel with a reason and create a new order.');
 if(!old&&await db.prepare('SELECT id FROM crm_order_workflows WHERE customer_id=? AND po_key=?').get(s.customerId,s.poNumber.toUpperCase()))fail(409,'An order already exists for this customer and PO number. Revise that order instead.');
 if(s.quotationId&&await db.prepare('SELECT id FROM sales_orders WHERE quotation_id=? AND id<>?').get(s.quotationId,old?.sales_order_id??0))fail(409,'This quotation already has an order.');
 let source=null;if(s.quotationId){source=await orderQuoteSource(db,s.quotationId,user);if(source.customerId!==s.customerId)fail(422,'Quotation and order customer must match.');}
 let oid=old?.sales_order_id;
 if(!oid){const number=`SO-${new Date().getUTCFullYear()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;oid=(await db.prepare('INSERT INTO sales_orders(order_number,quotation_id,customer_id,customer_po_number,customer_po_date,promised_date,notes,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?)').run(number,s.quotationId,s.customerId,s.poNumber,s.poDate,s.promisedDate,s.notes,user.id,user.id)).insertedId;s.order_number=number;}
 else {s.order_number=old.public_snapshot.order_number;await db.prepare("UPDATE sales_orders SET quotation_id=?,customer_po_date=?,promised_date=?,notes=?,updated_by=?,updated_at=now(),status='CONFIRMED' WHERE id=?").run(s.quotationId,s.poDate,s.promisedDate,s.notes,user.id,oid);}
 await db.prepare("UPDATE sales_order_lines SET status='ARCHIVED',is_deleted=true WHERE sales_order_id=? AND NOT is_deleted").run(oid);
 for(const [position,l]of s.lines.entries()){l.id=(await db.prepare('INSERT INTO sales_order_lines(sales_order_id,item_id,description,uom,ordered_quantity,unit_price,discount_percent,tax_percent,position) VALUES(?,?,?,?,?,?,?,?,?)').run(oid,l.itemId,l.description,l.uom,l.quantity,l.unitPrice,l.discountPercent,l.taxPercent,position)).insertedId;}
 if(old)await db.prepare("UPDATE crm_order_workflows SET version=version+1,status='DRAFT',source_quote_version=?,source_quote_snapshot=?::text::jsonb,public_snapshot=?::text::jsonb,private_snapshot='{}',approval_fingerprint=NULL,approved_by=NULL,approved_version=NULL WHERE sales_order_id=?").run(source?.version??null,json(source),json(s),oid);
 else await db.prepare('INSERT INTO crm_order_workflows(sales_order_id,customer_id,po_key,source_quote_version,source_quote_snapshot,public_snapshot,private_snapshot,created_by) VALUES(?,?,?, ?,?::text::jsonb,?::text::jsonb,?::text::jsonb,?)').run(oid,s.customerId,s.poNumber.toUpperCase(),source?.version??null,json(source),json(s),'{}',user.id);
 const r=await row(db,oid),verification=await verifyOrder(db,r);
 await db.prepare('INSERT INTO crm_order_versions(sales_order_id,version,public_snapshot,private_snapshot,reason,created_by) VALUES(?,?,?::text::jsonb,?::text::jsonb,?,?)').run(oid,r.version,json(s),json(verification.private),reason,user.id);
 await event(db,r,user,old?'REVISED':'CREATED',reason,{version:r.version,quotationId:s.quotationId,total:s.total});return orderDetail(db,oid,user);
 });
}
function compareQuote(order,quote){const flags=[],comparisons=[];
 if(!quote)return {flags:['MANUAL_ORDER'],comparisons};
 const used=new Set();for(const l of order.lines){const candidates=quote.lines.map((q,i)=>({q,i})).filter(({q})=>q.partCode===l.partCode||q.itemId===l.itemId&&l.itemId!=null);
 const match=candidates.find(({i})=>!used.has(i));if(!match){comparisons.push({partCode:l.partCode,issues:['PART_NOT_IN_QUOTE'],po:l,quote:null});flags.push('PART_NOT_IN_QUOTE');continue;}
 used.add(match.i);const q=match.q,issues=[];
 for(const [field,code]of [['unitPrice','RATE_DIFFERENCE'],['quantity','QUANTITY_DIFFERENCE'],['taxPercent','TAX_DIFFERENCE'],['discountPercent','DISCOUNT_DIFFERENCE']])if(scaled(l[field])!==scaled(q[field]))issues.push(code);
 if(l.uom!==q.uom)issues.push('UOM_DIFFERENCE');comparisons.push({partCode:l.partCode,issues,po:l,quote:q});flags.push(...issues);
 }
 if(used.size!==quote.lines.length)flags.push('QUOTE_ITEMS_MISSING');
 if(order.placeOfSupply!==quote.placeOfSupply||order.sellerState!==quote.sellerState)flags.push('TAX_JURISDICTION_DIFFERENCE');
 const delta=cents(order.poTotal)-cents(quote.total);if(delta>100n||delta< -100n)flags.push('QUOTE_TOTAL_DIFFERENCE_OVER_1');
 return {flags,comparisons,quoteTotal:quote.total,quoteDifference:money(delta)};
}
function stockNumber(value,uom){const m=String(value??'').trim().match(/^(-?\d{1,12}(?:\.\d{1,6})?)\s+(.+)$/);if(!m||m[2].trim().toUpperCase()!==String(uom).trim().toUpperCase())return null;const n=m[1].startsWith('-');try{return scaled(n?m[1].slice(1):m[1])*(n?-1n:1n);}catch{return null;}}
const quantity=n=>`${n<0n?'-':''}${(n<0n?-n:n)/1000000n}.${String((n<0n?-n:n)%1000000n).padStart(6,'0')}`;
export async function verifyOrder(db,r){const s=r.public_snapshot,flags=[],costs={},costInputs={},stock=[];
 const policy=await quotePolicy(db);if(!policy)flags.push('MISSING_POLICY');if(policy&&policy.seller_state!==s.sellerState)flags.push('SELLER_STATE_CHANGED');
 const fulfilled=await db.prepare('SELECT id,fulfilled_quantity::text AS fulfilled FROM sales_order_lines WHERE sales_order_id=? AND NOT is_deleted').all(r.sales_order_id),fulfill=new Map(fulfilled.map(l=>[l.id,scaled(l.fulfilled)]));
 const demanded=new Map();for(const l of s.lines){if(l.itemId)demanded.set(l.itemId,(demanded.get(l.itemId)??0n)+scaled(l.quantity)-(fulfill.get(l.id)??0n));}
 for(const l of s.lines){
 const item=l.itemId?await db.prepare("SELECT id,part_code,uom,status FROM items WHERE id=?").get(l.itemId):null;
 if(!item)flags.push('UNKNOWN_PART_CODE');else if(item.status!=='ACTIVE')flags.push('INACTIVE_ITEM');else if(item.part_code!==l.partCode){const mapping=await db.prepare("SELECT id FROM crm_customer_part_mappings WHERE customer_id=? AND item_id=? AND customer_part_number=? AND status='ACTIVE' AND NOT is_deleted").get(s.customerId,l.itemId,l.partCode);if(!mapping)flags.push('UNKNOWN_PART_CODE');}
 const c=item?await db.prepare('SELECT unit_cost::text AS value FROM crm_quotation_costs WHERE item_id=?').get(l.itemId):null;
 if(item&&item.uom!==l.uom)flags.push('UOM_MISMATCH');
 costs[String(l.itemId)]=item?.uom===l.uom?c?.value??null:null;costInputs[String(l.itemId)]=costs[String(l.itemId)];
 if(item&&!stock.some(x=>x.itemId===item.id)){
 const detail=await itemDetail(db,item.id),v=detail.stock,stored=stockNumber(v.closing_quantity_text,l.uom),required=demanded.get(item.id)??0n;
 const since=v.fetched_at?await db.prepare('SELECT COALESCE(sum(si.quantity),0)::text AS quantity FROM crm_shipment_items si JOIN crm_shipments sh ON sh.id=si.shipment_id JOIN sales_order_lines ol ON ol.id=si.order_line_id WHERE ol.item_id=? AND sh.created_at>?::timestamptz').get(item.id,v.fetched_at):{quantity:'0'};
 const localDispatched=scaled(since.quantity),available=stored===null?null:stored-localDispatched;
 let check='AVAILABLE';if(available===null||item.uom!==l.uom)check='STOCK_UNAVAILABLE';else if(available<required)check='STOCK_SHORT';
 if(check!=='AVAILABLE'&&required>0n)flags.push(check);stock.push({itemId:item.id,partCode:l.partCode,quantity:v.closing_quantity_text??null,crmDispatchedSinceImport:quantity(localDispatched),availableAfterCrmDispatch:available===null?null:quantity(available),uom:l.uom,required:quantity(required),fetchedAt:v.fetched_at??null,check,note:'Stored Tally stock minus CRM dispatches since its fetch time. No live check, reservation, unit conversion or stock write.'});
 }}
 let pricing;try{pricing=calculateQuotation(s.lines,s.sellerState,s.placeOfSupply,costs,policy?.floor_percent??'0',policy?.margin_basis??'LINE_AND_TOTAL');}catch(e){fail(422,e.message);}
 if(pricing.missingCost)flags.push('MISSING_COST');if(pricing.belowFloor&&!pricing.missingCost)flags.push('MARGIN_BELOW_FLOOR');
 const customer=await customerDetail(db,s.customerId,{financial:true});if(customer.status!=='ACTIVE')flags.push('INACTIVE_CUSTOMER');
 const others=await db.prepare("SELECT o.id,w.public_snapshot->>'total' AS total FROM sales_orders o LEFT JOIN crm_order_workflows w ON w.sales_order_id=o.id WHERE o.customer_id=? AND o.id<>? AND o.status NOT IN ('CANCELLED','COMPLETED')").all(s.customerId,r.sales_order_id);
 let exposure=0n;for(const o of others){if(o.total!=null)exposure+=cents(o.total);else{const lines=await db.prepare('SELECT ordered_quantity::text AS quantity,unit_price::text AS rate,discount_percent::text AS discount,tax_percent::text AS tax FROM sales_order_lines WHERE sales_order_id=? AND NOT is_deleted').all(o.id);const calc=calculateQuotation(lines.map(l=>({quantity:l.quantity,unitPrice:l.rate,discountPercent:l.discount,taxPercent:l.tax})),s.sellerState,s.placeOfSupply);exposure+=cents(calc.total);}}
 const [limitWhole,limitFraction='']=String(customer.credit_limit).split('.'),limit=BigInt(limitWhole)*1000000n+BigInt(limitFraction.padEnd(6,'0')),balance=customer.dues.available?cents(customer.dues.closingBalance):null;
 const used=(balance!==null&&balance>0n?balance:0n)+exposure+cents(s.total),exceeded=used*10000n>limit;
 if(balance===null)flags.push('CREDIT_BALANCE_UNAVAILABLE');if(exceeded)flags.push('CREDIT_EXCEEDED');
 const credit={available:balance!==null,closingBalance:balance===null?null:money(balance),openOrderExposure:money(exposure),thisOrder:s.total,exposure:balance===null?null:money(used),knownExposure:money(used),limit:customer.credit_limit,exceeded,fetchedAt:customer.dues.fetchedAt??null,note:'Conservative Tally debit balance plus open CRM orders. Already-invoiced open orders may overlap; this is not bill-level credit reconciliation. Missing balances make total exposure unavailable and require Owner review.'};
 const comparison=compareQuote(s,r.source_quote_snapshot);flags.push(...comparison.flags);
 if(s.quotationId&&!await db.prepare('SELECT id FROM crm_shipments WHERE sales_order_id=? LIMIT 1').get(r.sales_order_id)){const q=await db.prepare('SELECT version,status FROM crm_quotation_workflows WHERE quotation_id=?').get(s.quotationId);if(!q||q.version!==r.source_quote_version||!['APPROVED','SENT','WON'].includes(q.status))flags.push('QUOTE_CHANGED_OR_UNAPPROVED');}
 const delta=cents(s.poTotal)-cents(s.total);if(delta>100n||delta< -100n)flags.push('PO_TOTAL_DIFFERENCE_OVER_1');
 const document=await db.prepare("SELECT id,sha256 FROM crm_order_documents WHERE sales_order_id=? AND kind='CUSTOMER_PO' AND status='ACTIVE'").get(r.sales_order_id);if(!document)flags.push('MISSING_PO_FILE');
 const privateData={cost:pricing.missingCost?null:pricing.cost,knownCost:pricing.cost,marginPercent:pricing.marginPercent,missingCost:pricing.missingCost,belowFloor:pricing.belowFloor,floorPercent:policy?.floor_percent??null,lines:pricing.lines.map(l=>({itemId:l.itemId,unitCost:l.unitCost,cost:l.cost,marginPercent:l.marginPercent}))};
 const unique=[...new Set(flags)].sort(),digest=fingerprint({version:r.version,flags:unique,policyRevision:policy?.revision??null,costInputs,credit:{balance:credit.closingBalance,limit:credit.limit,other:credit.openOrderExposure},file:document?.sha256??null,quoteVersion:r.source_quote_version});
 return {flags:unique,held:unique.length>0,comparison,poTotal:s.poTotal,calculatedTotal:s.total,totalDifference:money(delta),stock,credit,private:privateData,fingerprint:digest,reviewValid:r.approved_version===r.version&&r.approval_fingerprint===digest};
}
export async function orderDetail(db,orderId,user){can(user,'orders.read');const r=await row(db,orderId),verification=await verifyOrder(db,r);
 const lines=await db.prepare('SELECT id,fulfilled_quantity::text AS fulfilled_quantity FROM sales_order_lines WHERE sales_order_id=? AND NOT is_deleted ORDER BY position,id').all(r.sales_order_id);
 const documents=await db.prepare('SELECT id,kind,shipment_id,original_name,mime_type,sha256,byte_count,status,created_at FROM crm_order_documents WHERE sales_order_id=? ORDER BY id DESC').all(r.sales_order_id);
 const shipments=await db.prepare('SELECT * FROM crm_shipments WHERE sales_order_id=? ORDER BY id DESC').all(r.sales_order_id);
 for(const shipment of shipments)shipment.lines=await db.prepare('SELECT order_line_id,quantity::text AS quantity FROM crm_shipment_items WHERE shipment_id=? ORDER BY id').all(shipment.id);
 const terminal=['CANCELLED','DELIVERED','DISPATCHED'].includes(r.status);
 return {...r.public_snapshot,id:r.sales_order_id,version:r.version,status:r.status,effectiveStatus:!terminal&&!verification.reviewValid&&r.approved_version?'HELD':r.status,created_by:r.created_by,lines:r.public_snapshot.lines.map(l=>({...l,fulfilledQuantity:lines.find(x=>x.id===l.id)?.fulfilled_quantity??'0'})),verification:redactVerification(verification,user),documents,shipments};
}
export async function orderList(db,url,user){can(user,'orders.read');const page=Number(url.searchParams.get('page')||1);if(!Number.isSafeInteger(page)||page<1||page>1000000)fail(422,'Invalid page.');const search=String(url.searchParams.get('search')||'').slice(0,200),status=url.searchParams.get('status')||'';
 const where="WHERE (?='' OR o.order_number ILIKE ? OR c.name ILIKE ? OR o.customer_po_number ILIKE ?) AND (?='' OR w.status=?)",args=[search,'%'+search+'%','%'+search+'%','%'+search+'%',status,status];
 const total=(await db.prepare(`SELECT count(*) AS n FROM crm_order_workflows w JOIN sales_orders o ON o.id=w.sales_order_id JOIN customers c ON c.id=o.customer_id ${where}`).get(...args)).n;
 const data=await db.prepare(`SELECT w.sales_order_id AS id,w.version,w.status,w.public_snapshot->>'order_number' AS order_number,w.public_snapshot->>'customer_name' AS customer_name,w.public_snapshot->>'poNumber' AS poNumber,w.public_snapshot->>'total' AS total,w.updated_at FROM crm_order_workflows w JOIN sales_orders o ON o.id=w.sales_order_id JOIN customers c ON c.id=o.customer_id ${where} ORDER BY w.updated_at DESC,w.id DESC LIMIT 25 OFFSET ?`).all(...args,(page-1)*25);
 return {data,pagination:{page,pageSize:25,total,pages:Math.ceil(total/25)},legacyCount:(await db.prepare('SELECT count(*) AS n FROM sales_orders o WHERE NOT EXISTS(SELECT 1 FROM crm_order_workflows w WHERE w.sales_order_id=o.id)').get()).n};
}
export async function orderHistory(db,orderId,user){can(user,'orders.read');await row(db,orderId);const events=await db.prepare('SELECT e.*,u.name AS actor FROM crm_order_events e JOIN users u ON u.id=e.created_by WHERE sales_order_id=? ORDER BY e.id DESC').all(id(orderId)),versions=await db.prepare('SELECT * FROM crm_order_versions WHERE sales_order_id=? ORDER BY version DESC').all(id(orderId));
 return {events:events.map(({private_detail,...r})=>({...r,...(costAccess(user)?{pricing:private_detail?.verification?{verification:redactVerification(private_detail.verification,user)}:private_detail}:{})})),versions:versions.map(({private_snapshot,...r})=>({...r,...(costAccess(user)?{pricing:private_snapshot}:{})}))};
}
export async function orderAction(db,orderId,b,user){const reason=why(b),action=b.action;can(user,action==='APPROVE'?'orders.review':'orders.update');
 return work(db,user,reason,async()=>{const r=await row(db,orderId);if(b.version!==r.version)fail(409,'Order changed. Reload.');if(['CANCELLED','DELIVERED','DISPATCHED'].includes(r.status))fail(409,'Terminal or fully dispatched orders cannot be re-verified, approved or cancelled.');
 if(action==='CANCEL'){if(await db.prepare('SELECT id FROM crm_shipments WHERE sales_order_id=?').get(r.sales_order_id))fail(409,'Dispatched orders cannot be cancelled.');await db.prepare("UPDATE crm_order_workflows SET status='CANCELLED' WHERE sales_order_id=?").run(r.sales_order_id);await db.prepare("UPDATE sales_orders SET status='CANCELLED',updated_by=?,updated_at=now() WHERE id=?").run(user.id,r.sales_order_id);}
 else {const v=await verifyOrder(db,r);if(action==='VERIFY'){await db.prepare("UPDATE crm_order_workflows SET status='HELD',approval_fingerprint=NULL,approved_by=NULL,approved_version=NULL WHERE sales_order_id=?").run(r.sales_order_id);}
 else if(action==='APPROVE'){
 if(r.status!=='HELD')fail(409,'Verify the order before reviewer approval.');
 const last=await db.prepare('SELECT created_by FROM crm_order_versions WHERE sales_order_id=? AND version=?').get(r.sales_order_id,r.version);
 if(r.created_by===user.id||last.created_by===user.id)fail(403,'A different manager or owner must review this order.');
 if(v.flags.includes('MISSING_PO_FILE'))fail(422,'Upload the original customer PO before approval.');
 if(v.flags.some(f=>['CREDIT_EXCEEDED','CREDIT_BALANCE_UNAVAILABLE'].includes(f))&&!hasPermission(user,'orders.credit.review'))fail(403,'Owner review is required for financial credit exceptions.');
 if(v.flags.includes('QUOTE_CHANGED_OR_UNAPPROVED')||v.flags.includes('SELLER_STATE_CHANGED')||v.flags.includes('INACTIVE_CUSTOMER')||v.flags.includes('INACTIVE_ITEM')||v.flags.includes('MISSING_COST')||v.flags.includes('MISSING_POLICY'))fail(409,'Correct the source quotation, seller state, inactive records or missing item costs before approval.');
 if(v.flags.length&&b.acceptExceptions!==true)fail(422,'Explicitly accept the listed exceptions and record a review reason.');
 await db.prepare("UPDATE crm_order_workflows SET status=?,approval_fingerprint=?,approved_by=?,approved_version=version,private_snapshot=?::text::jsonb WHERE sales_order_id=?").run(await db.prepare('SELECT id FROM crm_shipments WHERE sales_order_id=?').get(r.sales_order_id)?'PARTIALLY_DISPATCHED':'APPROVED',v.fingerprint,user.id,json(v.private),r.sales_order_id);
 }else fail(422,'Unknown order action.');
 await event(db,r,user,action,reason,{flags:v.flags,version:r.version},action==='APPROVE'?{verification:v}:{});return orderDetail(db,orderId,user);
 }await event(db,r,user,action,reason,{version:r.version});return orderDetail(db,orderId,user);
 });
}
export function validateOriginal(b){const name=text(b.name??'',200);if(!name||/[\x00-\x1f\\/]/.test(name))fail(422,'Provide an original filename without path separators.');
 if(typeof b.base64!=='string'||b.base64.length>13981016||b.base64.length%4!==0||/[^A-Za-z0-9+/=]/.test(b.base64))fail(422,'Provide a valid base64 original, up to 10 MB.');
 const bytes=Buffer.from(b.base64,'base64');if(!bytes.length||bytes.length>10485760)fail(422,'Original must be between 1 byte and 10 MB.');
 if(bytes.toString('base64')!==b.base64)fail(422,'Provide canonical base64 without malformed padding.');
 let mime;if(bytes.subarray(0,5).toString()==='%PDF-')mime='application/pdf';else if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217)mime='image/jpeg';else fail(422,'Only PDF, PNG and JPEG originals are supported.');
 return {name,bytes,mime,sha256:hash(bytes)};
}
export async function uploadOriginal(db,orderId,b,user,shipmentId=null){can(user,shipmentId?'orders.dispatch':'orders.update');const reason=why(b),file=validateOriginal(b);
 return work(db,user,reason,async()=>{const r=await row(db,orderId);if(b.version!==r.version)fail(409,'Order changed. Reload before uploading.');if(r.status==='CANCELLED')fail(409,'Cancelled order cannot accept uploads.');
 if(shipmentId){const s=await db.prepare('SELECT id,status FROM crm_shipments WHERE id=? AND sales_order_id=?').get(id(shipmentId),r.sales_order_id);if(!s)fail(404,'Shipment not found.');if(s.status==='DELIVERED')fail(409,'Delivered shipment proof is immutable.');}
 else if(await db.prepare('SELECT id FROM crm_shipments WHERE sales_order_id=?').get(r.sales_order_id))fail(409,'Customer PO is immutable after dispatch.');
 const kind=shipmentId?'DELIVERY_PROOF':'CUSTOMER_PO';
 if(!shipmentId&&await db.prepare("SELECT id FROM crm_order_documents WHERE customer_id=? AND po_key=? AND sha256=? AND kind='CUSTOMER_PO'").get(r.customer_id,r.po_key,file.sha256))fail(409,'This original file hash and PO number have already been uploaded.');
 const archived=await db.prepare("SELECT id FROM crm_order_documents WHERE sales_order_id=? AND kind=? AND status='ACTIVE' AND (?::integer IS NULL OR shipment_id=?)").all(r.sales_order_id,kind,shipmentId?Number(shipmentId):null,shipmentId?Number(shipmentId):null);
 await db.prepare("UPDATE crm_order_documents SET status='ARCHIVED',is_deleted=true WHERE sales_order_id=? AND kind=? AND status='ACTIVE' AND (?::integer IS NULL OR shipment_id=?)").run(r.sales_order_id,kind,shipmentId?Number(shipmentId):null,shipmentId?Number(shipmentId):null);
 const doc=(await db.prepare('INSERT INTO crm_order_documents(sales_order_id,shipment_id,customer_id,po_key,kind,original_name,mime_type,sha256,byte_count,original_bytes,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(r.sales_order_id,shipmentId?id(shipmentId):null,r.customer_id,r.po_key,kind,file.name,file.mime,file.sha256,file.bytes.length,file.bytes,user.id)).insertedId;
 if(!shipmentId){await db.prepare("UPDATE crm_order_workflows SET version=version+1,status='DRAFT',approval_fingerprint=NULL,approved_by=NULL,approved_version=NULL WHERE sales_order_id=?").run(r.sales_order_id);const updated=await row(db,orderId),v=await verifyOrder(db,updated);await db.prepare('INSERT INTO crm_order_versions(sales_order_id,version,public_snapshot,private_snapshot,reason,created_by) VALUES(?,?,?::text::jsonb,?::text::jsonb,?,?)').run(updated.sales_order_id,updated.version,json(updated.public_snapshot),json(v.private),reason,user.id);}
 const updated=await row(db,orderId);await event(db,updated,user,'ORIGINAL_UPLOADED',reason,{documentId:doc,kind,sha256:file.sha256,archivedDocumentIds:archived.map(x=>x.id),shipmentId:shipmentId?Number(shipmentId):null});return {id:doc,sha256:file.sha256,version:updated.version};
 });
}
export async function downloadOriginal(db,documentId,user){can(user,'orders.read');const d=await db.prepare('SELECT original_name,mime_type,original_bytes,sha256 FROM crm_order_documents WHERE id=?').get(id(documentId));if(!d)fail(404,'Original not found.');return d;}
export async function dispatchOrder(db,orderId,b,user){can(user,'orders.dispatch');const reason=why(b);
 if(typeof b.requestKey!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestKey))fail(422,'A UUID dispatch retry key is required.');
 if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100)fail(422,'Select at least one pick-list line.');
 const requestHash=fingerprint({vehicle:text(b.vehicleNumber??'',100),lr:text(b.lrNumber??'',100),transporter:text(b.transporter??'',200),eway:text(b.ewayBillNumber??'',100),notes:text(b.notes??'',2000),lines:b.lines.map(l=>({id:id(l.lineId),quantity:scaled(decimal(l.quantity)).toString()})).sort((a,b)=>a.id-b.id)});
 return work(db,user,reason,async()=>{const r=await row(db,orderId);
 const receipt=await db.prepare("SELECT public_detail FROM crm_order_events WHERE sales_order_id=? AND action='DISPATCHED' AND public_detail->>'requestKey'=?").get(r.sales_order_id,b.requestKey);
 if(receipt){if(receipt.public_detail.requestHash!==requestHash)fail(409,'This retry key was already used for different dispatch details.');return {shipmentId:receipt.public_detail.shipmentId,replayed:true,order:await orderDetail(db,orderId,user)};}
 if(r.version!==b.version||!['APPROVED','PARTIALLY_DISPATCHED'].includes(r.status))fail(409,'Order must be approved before dispatch.');const v=await verifyOrder(db,r);if(!v.reviewValid)fail(409,'Order verification changed. Verify and obtain review again.');
 if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100)fail(422,'Select at least one pick-list line.');
 const vehicle=text(b.vehicleNumber??'',100),lr=text(b.lrNumber??'',100),transporter=text(b.transporter??'',200),eway=text(b.ewayBillNumber??'',100);
 if(!vehicle||!lr||!transporter)fail(422,'Vehicle, LR number and transporter are required.');
 const picked=[],seen=new Set();for(const l of b.lines){const lid=id(l.lineId);if(seen.has(lid))fail(422,'Duplicate pick-list line.');seen.add(lid);const current=await db.prepare('SELECT *,ordered_quantity::text AS ordered,fulfilled_quantity::text AS fulfilled FROM sales_order_lines WHERE id=? AND sales_order_id=? AND NOT is_deleted FOR UPDATE').get(lid,r.sales_order_id);
 if(!current)fail(422,'Pick-list line does not belong to this order.');const q=scaled(decimal(l.quantity));if(q<=0n||q>scaled(current.ordered)-scaled(current.fulfilled))fail(422,'Dispatch quantity exceeds the remaining order quantity.');picked.push({id:lid,quantity:String(l.quantity),fulfilled:quantity(scaled(current.fulfilled)+q)});}
 const shipment=(await db.prepare('INSERT INTO crm_shipments(sales_order_id,vehicle_number,lr_number,transporter,eway_bill_number,notes,created_by) VALUES(?,?,?,?,?,?,?)').run(r.sales_order_id,vehicle,lr,transporter,eway||null,text(b.notes??'',2000),user.id)).insertedId;
 for(const l of picked){await db.prepare('INSERT INTO crm_shipment_items(shipment_id,order_line_id,quantity,created_by) VALUES(?,?,?,?)').run(shipment,l.id,l.quantity,user.id);await db.prepare('UPDATE sales_order_lines SET fulfilled_quantity=? WHERE id=?').run(l.fulfilled,l.id);}
 const remaining=await db.prepare('SELECT id FROM sales_order_lines WHERE sales_order_id=? AND NOT is_deleted AND fulfilled_quantity<ordered_quantity LIMIT 1').get(r.sales_order_id);
 const next=remaining?'PARTIALLY_DISPATCHED':'DISPATCHED';await db.prepare('UPDATE crm_order_workflows SET status=? WHERE sales_order_id=?').run(next,r.sales_order_id);await db.prepare('UPDATE sales_orders SET status=?,updated_by=?,updated_at=now() WHERE id=?').run(next,user.id,r.sales_order_id);
 await event(db,r,user,'DISPATCHED',reason,{shipmentId:shipment,lrNumber:lr,requestKey:b.requestKey,requestHash,lines:picked.map(l=>({lineId:l.id,quantity:l.quantity}))});return {shipmentId:shipment,order:await orderDetail(db,orderId,user)};
 });
}
export async function markDelivered(db,shipmentId,b,user){can(user,'orders.dispatch');const reason=why(b);
 return work(db,user,reason,async()=>{const s=await db.prepare('SELECT * FROM crm_shipments WHERE id=?').get(id(shipmentId));if(!s)fail(404,'Shipment not found.');if(s.status==='DELIVERED')fail(409,'Shipment already delivered.');
 const r=await row(db,s.sales_order_id);if(b.version!==r.version)fail(409,'Order changed. Reload.');if(!await db.prepare("SELECT id FROM crm_order_documents WHERE shipment_id=? AND kind='DELIVERY_PROOF' AND status='ACTIVE'").get(s.id))fail(422,'Upload delivery proof before confirming delivery.');
 await db.prepare("UPDATE crm_shipments SET status='DELIVERED' WHERE id=?").run(s.id);
 const pending=await db.prepare("SELECT id FROM crm_shipments WHERE sales_order_id=? AND status<>'DELIVERED' LIMIT 1").get(r.sales_order_id);
 if(r.status==='DISPATCHED'&&!pending){await db.prepare("UPDATE crm_order_workflows SET status='DELIVERED' WHERE sales_order_id=?").run(r.sales_order_id);await db.prepare("UPDATE sales_orders SET status='COMPLETED',updated_by=?,updated_at=now() WHERE id=?").run(user.id,r.sales_order_id);}
 await event(db,r,user,'DELIVERED',reason,{shipmentId:s.id});return orderDetail(db,r.sales_order_id,user);
 });
}
export async function logisticsSearch(db,url,user){can(user,'orders.read');const query=text(url.searchParams.get('lr')||'',100),page=Number(url.searchParams.get('page')||1);if(!Number.isSafeInteger(page)||page<1)fail(422,'Invalid page.');const pattern='%'+query.replace(/[\\%_]/g,'\\$&')+'%';
 const from="FROM crm_shipments s JOIN sales_orders o ON o.id=s.sales_order_id JOIN customers c ON c.id=o.customer_id WHERE s.lr_number ILIKE ? ESCAPE '\\'";
 return {data:await db.prepare(`SELECT s.*,o.order_number,c.name AS customer_name ${from} ORDER BY s.id DESC LIMIT 25 OFFSET ?`).all(pattern,(page-1)*25),pagination:{page,pageSize:25,total:(await db.prepare(`SELECT count(*) AS n ${from}`).get(pattern)).n}};
}
