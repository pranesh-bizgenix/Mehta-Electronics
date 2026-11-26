import {createHash} from 'node:crypto';
import {transaction,id} from './crm-modules.js';
import {hasPermission} from './rbac.js';
import {isLogisticsRole} from './logistics-policy.js';
import {orderDetail} from './sales-orders.js';
import {quotePolicy} from './quotation-workflow.js';
import {writeAudit} from './db.js';
import {format,lineNet} from '../public/money.js';
import {referenceOrderPdf} from './supplier-purchase-order-pdf.js';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const missing='[Not supplied]';
const clean=value=>typeof value==='string'&&value.trim()?value.trim():missing;
const date=value=>value?new Date(value).toLocaleDateString('en-GB',{timeZone:'Asia/Kolkata'}):missing;
export function requireSalesOrderPdfAccess(user){
 if(isLogisticsRole(user)||!hasPermission(user,'orders.read'))fail(403,'Commercial sales-order PDF access requires order read permission.');
}

/** Saved order amounts only; quotation list prices, costs and margins stay private. */
export function salesOrderPdfModel(order,{company={},customer={},quote={},createdAt,approved=false}={}){
 approved=approved&&['APPROVED','PARTIALLY_DISPATCHED','DISPATCHED','DELIVERED'].includes(order.effectiveStatus||order.status);
 const companyName=clean(company.name),billTo=clean(quote.customerAddress!==undefined?quote.customerAddress:customer.billing_address),shipTo=clean(customer.shipping_address);
 const gstin=clean(quote.customerGstin!==undefined?quote.customerGstin:customer.gstin);
 const lines=order.lines.map(line=>{
  const matches=(quote.lines||[]).filter(source=>source.partCode===line.partCode&&(!line.itemId||source.itemId===line.itemId));
  return {partCode:line.partCode,description:line.description,uom:line.uom,hsn:line.hsn||(matches.length===1?matches[0].hsn:'')||missing,
   quantity:line.quantity,unitPrice:line.unitPrice,discountPercent:line.discountPercent,taxPercent:line.taxPercent,
   netRate:format(lineNet({quantity:'1',unit_price:line.unitPrice,discount_percent:line.discountPercent})),
   net:line.net,cgst:line.cgst,sgst:line.sgst,igst:line.igst,total:line.total,delivery:order.promisedDate||missing};
 });
 const record={kind:'SO',number:order.order_number,status:approved?order.status:'DRAFT',payload:{date:date(createdAt),
  company:{name:companyName,address:clean(company.address),contact:[company.phone,company.email].filter(Boolean).join(' | '),gstin:clean(company.gstin),showListPriceDiscount:false},
  supplier:{},billTo,shipTo,signatory:missing,terms:[quote.terms,order.notes].filter(Boolean).join('\n\n')||missing,
  lines,totals:{subtotal:order.subtotal,cgst:order.cgst,sgst:order.sgst,igst:order.igst,localTaxLabel:order.localTaxLabel||'SGST',roundOff:order.roundOff||'0.00',total:order.total}
 }};
 const presentation={title:'Sales Order',deliveryColumn:true,termsLabel:'Notes / Sales terms (as recorded)',bank:'[Bank details not supplied]',
  metadata:[[
   ['Sales Order-ID',order.order_number],['Order Date',date(createdAt)],['Payment Terms','See recorded sales terms'],['Expected Shipment Date',missing],['Quote-ID',quote.quotation_number||missing],['Promised delivery date',order.promisedDate||missing]
  ],[
   ['Place Of Supply',order.placeOfSupply],['Sales Executive',missing],['Delivery Method',missing],['Customer PO-ID',order.poNumber],['Carrier',missing],['Customer instructions',missing],['Order Status',String(order.effectiveStatus||order.status).replaceAll('_',' ')]
  ]],parties:[{label:'Bill To',value:[clean(order.customer_name),billTo,`GSTIN: ${gstin}`].join('\n')},{label:'Ship To',value:[clean(order.customer_name),shipTo,`GSTIN: ${gstin}`].join('\n')}]
 };
 return {record,presentation,draft:!approved};
}
export function salesOrderPdf(order,context={},options={}){
 const model=salesOrderPdfModel(order,context);return referenceOrderPdf(model.record,{...options,draft:model.draft,presentation:model.presentation});
}

export async function downloadSalesOrderPdf(db,orderId,body,user){
 requireSalesOrderPdfAccess(user);
 if(typeof body?.reason!=='string'||body.reason.trim().length<3||body.reason.length>2000)fail(422,'Enter a PDF access reason of 3 to 2000 characters.');
 if(body.preview!==undefined&&typeof body.preview!=='boolean')fail(422,'Choose preview or download.');
 return transaction(db,user,body.reason.trim(),async()=>{
  // Same lock as order review/pricing changes: no stale approval is printed.
  await db.prepare('SELECT pg_advisory_xact_lock(812731)').get();
  const row=await db.prepare('SELECT * FROM crm_order_workflows WHERE sales_order_id=? FOR UPDATE').get(id(orderId));
  if(!row)fail(404,'Workflow sales order not found.');
  if(body.version!==row.version)fail(409,'Order changed. Reload before downloading.');
  if(row.status==='CANCELLED')fail(409,'Cancelled orders cannot generate a sales-order document.');
  const order=await orderDetail(db,orderId,user),customer=await db.prepare('SELECT billing_address,shipping_address,gstin FROM customers WHERE id=?').get(order.customerId);
  const quote=row.source_quote_snapshot||{},policy=quote.letterhead?null:await quotePolicy(db);
  const approved=['APPROVED','PARTIALLY_DISPATCHED','DISPATCHED','DELIVERED'].includes(order.effectiveStatus)&&order.verification.reviewValid===true;
  const bytes=await salesOrderPdf(order,{company:quote.letterhead||policy?.letterhead||{},customer:customer||{},quote,createdAt:row.created_at,approved});
  await writeAudit(db,{userId:user.id,entity:'SALES_ORDER_WORKFLOW',recordId:String(row.sales_order_id),action:body.preview?'PDF_PREVIEW':'PDF_DOWNLOAD',reason:body.reason.trim(),newValue:{version:row.version,draft:!approved,sha256:createHash('sha256').update(bytes).digest('hex')}});
  return {bytes,filename:`sales-order-${String(order.order_number).replace(/[^A-Za-z0-9_-]/g,'-')}.pdf`};
 });
}
