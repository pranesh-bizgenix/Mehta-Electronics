import crypto from 'node:crypto';
import {hasPermission} from '../../rbac.js';
import {transaction,id,requireCustomerBillingApproval} from '../../crm-modules.js';
import {writeAudit} from '../../db.js';
import {forbidden,conflict,notFound,validationFailed} from '../../core/errors.js';
import {format,decimal,mul,div,sub} from '../../../public/money.js';
import {financialYear} from '../../purchase-document-math.js';
import {text,uuid,validateBillingSettings,invoicePayload,invoiceNumber,originalPdf,requireIssuance} from './domain.js';
import {invoicePdf} from './pdf.js';

export function financeAccess(user,write=false,approve=false){
 if(!['OWNER','ACCOUNTS'].includes(user?.role)||!hasPermission(user,approve?'collections.approve':write?'collections.write':'collections.read'))throw forbidden('Authorised Accounts and Owner users only.');
}
const audit=(db,u,record,action,reason,detail={})=>writeAudit(db,{userId:u.id,entity:'BILLING_DOCUMENT',recordId:String(record),action,reason,newValue:detail});
const guard=db=>db.prepare("SELECT pg_advisory_xact_lock(812734),set_config('mehta.billing_write','authorized',true)").get();
export const settings=db=>db.prepare('SELECT * FROM billing_document_settings WHERE id=1').get();
export async function saveSettings(db,u,b){
 if(!hasPermission(u,'rules.manage'))throw forbidden();financeAccess(u,true);
 const reason=text(b.reason,'Reason'),value=validateBillingSettings(b.value);
 return transaction(db,u,reason,async()=>{await guard(db);const old=await settings(db);if(old.version!==b.version)throw conflict('Settings changed. Reload.');
  await db.prepare('UPDATE billing_document_settings SET value=?::text::jsonb,version=version+1,updated_by=?,updated_at=now() WHERE id=1').run(JSON.stringify(value),u.id);
  await audit(db,u,'settings','SETTINGS_CHANGED',reason,{version:old.version+1,value});return settings(db);
 });
}
export async function list(db,u,{page=1,customerId='',search=''}={}){
 financeAccess(u);page=Number(page);if(!Number.isSafeInteger(page)||page<1||page>1000000)throw validationFailed('Invalid page.');
 const cid=customerId?id(customerId):null,pattern='%'+String(search).slice(0,100).replace(/[\\%_]/g,'\\$&')+'%';
 const args=[cid,cid,pattern,pattern],where="WHERE (?::integer IS NULL OR d.customer_id=?) AND (COALESCE(d.number,d.id::text) ILIKE ? ESCAPE '\\' OR c.name ILIKE ? ESCAPE '\\')";
 const total=(await db.prepare(`SELECT count(*) AS n FROM billing_documents d JOIN customers c ON c.id=d.customer_id ${where}`).get(...args)).n;
 const data=await db.prepare(`SELECT d.id,d.source,d.customer_id,d.number,d.status,d.version,d.created_by,d.invoice_date,d.created_at,c.name AS customer_name,d.payload->'totals'->>'total' AS total FROM billing_documents d JOIN customers c ON c.id=d.customer_id ${where} ORDER BY d.created_at DESC,d.id LIMIT 25 OFFSET ?`).all(...args,(page-1)*25);
 return {data,pagination:{page,pageSize:25,total,pages:Math.ceil(total/25)}};
}
export async function detail(db,u,recordId,lock=false){
 financeAccess(u);const row=await db.prepare(`SELECT * FROM billing_documents WHERE id=?${lock?' FOR UPDATE':''}`).get(uuid(recordId));if(!row)throw notFound('Invoice document not found.');
 const original=await db.prepare('SELECT id,filename,sha256,uploaded_by,verified_by,verified_at FROM billing_document_originals WHERE document_id=?').get(row.id);
 return {...row,original:original||null};
}
async function shipmentData(db,shipmentId,customerId){
 const shipment=await db.prepare(`SELECT s.*,w.customer_id,w.public_snapshot,w.status AS order_status,w.version AS order_version FROM crm_shipments s JOIN crm_order_workflows w ON w.sales_order_id=s.sales_order_id WHERE s.id=? AND NOT s.is_deleted AND w.customer_id=?`).get(id(shipmentId),customerId);
 if(!shipment||!['APPROVED','PARTIALLY_DISPATCHED','DISPATCHED','DELIVERED'].includes(shipment.order_status))throw conflict('Choose a recorded shipment from this customer’s approved order.');
 const lines=await db.prepare(`SELECT l.id,l.item_id,l.description,l.uom,l.unit_price,l.discount_percent,l.tax_percent,s.quantity,i.part_code,i.hsn FROM crm_shipment_items s JOIN sales_order_lines l ON l.id=s.order_line_id LEFT JOIN items i ON i.id=l.item_id WHERE s.shipment_id=? AND NOT s.is_deleted AND l.status='ACTIVE' ORDER BY l.position,l.id`).all(shipment.id);
 if(!lines.length)throw conflict('The shipment has no billable lines.');
 return {shipment,lines:lines.map(l=>({code:l.part_code||String(l.item_id||l.id),description:l.description,hsn:l.hsn||'',uom:l.uom,quantity:String(l.quantity),unitPrice:format(mul(decimal(l.unit_price),div(sub(decimal('100'),decimal(l.discount_percent)),decimal('100'))),6),taxPercent:String(l.tax_percent)}))};
}
export async function create(db,u,b){
 financeAccess(u,true);const reason=text(b.reason,'Reason'),key=uuid(b.requestKey),customerId=id(b.customerId);
 if(!['CRM','TALLY'].includes(b.source))throw validationFailed('Choose CRM draft or an existing Tally invoice copy.');
 return transaction(db,u,reason,async()=>{await guard(db);
  const previous=await db.prepare('SELECT id,payload FROM billing_documents WHERE request_key=?').get(key);
  const requestHash=crypto.createHash('sha256').update(JSON.stringify({...b,reason:undefined})).digest('hex');
  if(previous){if(previous.payload.requestHash!==requestHash)throw conflict('This request key was used for different invoice details.');return detail(db,u,previous.id);}
  const customer=await db.prepare('SELECT id,name,gstin,status FROM customers WHERE id=?').get(customerId);if(!customer)throw validationFailed('Choose an existing customer.');
  if(b.source==='CRM'){if(customer.status!=='ACTIVE')throw conflict('CRM invoice drafts require an active customer.');await requireCustomerBillingApproval(db,customerId);}
  const config=await settings(db);let payload,number=null,shipment=null,reference=null;
  if(b.source==='CRM'){
   let input=b;if(b.shipmentId){const data=await shipmentData(db,b.shipmentId,customerId);shipment=data.shipment;input={...b,lines:data.lines,placeOfSupply:shipment.public_snapshot.placeOfSupply};}
   payload=invoicePayload({...input,terms:input.terms||config.value.terms||''},customer,config.value);payload.shipmentVersion=shipment?.order_version??null;
  }else{
   reference=await db.prepare("SELECT * FROM crm_operations WHERE id=? AND kind='INVOICE' AND customer_id=? AND status<>'CANCELLED'").get(uuid(b.invoiceReferenceId),customerId);
   if(!reference)throw validationFailed('Choose an existing, non-cancelled invoice reference for this customer.');
   number=text(reference.payload.invoiceNumber,'Existing invoice number',100);payload={customer:{id:customer.id,name:customer.name,gstin:customer.gstin},date:reference.payload.invoiceDate,totals:{total:reference.payload.amount},sourceEvidence:text(b.sourceEvidence,'Tally source verification evidence',2000)};
   if(!payload.date)throw validationFailed('The invoice reference must contain its invoice date.');
   if(b.shipmentId)shipment=(await shipmentData(db,b.shipmentId,customerId)).shipment;
   if(await db.prepare("SELECT id FROM billing_documents WHERE customer_id=? AND lower(number)=lower(?) AND status<>'CANCELLED'").get(customerId,number))throw conflict('This customer invoice number is already registered.');
  }
  payload.requestHash=requestHash;
  const row=await db.prepare(`INSERT INTO billing_documents(request_key,source,customer_id,invoice_reference_id,sales_order_id,shipment_id,number,invoice_date,payload,created_by,settings_version) VALUES(?,?,?,?,?,?,?,?,?::text::jsonb,?,?) RETURNING id`).get(key,b.source,customerId,reference?.id||null,shipment?.sales_order_id||null,shipment?.id||null,number,payload.date,JSON.stringify(payload),u.id,config.version);
  await audit(db,u,row.id,'CREATE',reason,{source:b.source,customerId,shipmentId:shipment?.id||null});return detail(db,u,row.id);
 });
}
export async function upload(db,u,recordId,b){
 financeAccess(u,true);const reason=text(b.reason,'Reason'),file=originalPdf(b.base64),filename=text(b.filename,'Filename',160);
 if(!/\.pdf$/i.test(filename)||/[\\/\x00-\x1f]/.test(filename))throw validationFailed('Use a PDF filename without paths.');
 return transaction(db,u,reason,async()=>{await guard(db);const row=await detail(db,u,recordId,true);
  if(row.source!=='TALLY'||row.status!=='DRAFT'||row.version!==b.version)throw conflict('Upload to the current draft of a Tally-copy record.');
  if(row.original){if(row.original.sha256===file.sha256)return row;throw conflict('An original is already retained. Cancel this draft before replacing the record.');}
  await db.prepare('INSERT INTO billing_document_originals(document_id,filename,sha256,bytes,uploaded_by) VALUES(?,?,?,?,?)').run(row.id,filename,file.sha256,file.bytes,u.id);
  await db.prepare('UPDATE billing_documents SET version=version+1,updated_at=now() WHERE id=?').run(row.id);
  await audit(db,u,row.id,'UPLOAD_ORIGINAL',reason,{sha256:file.sha256,bytes:file.bytes.length});return detail(db,u,row.id);
 });
}
export async function act(db,u,recordId,b){
 financeAccess(u,true,['APPROVE','VERIFY'].includes(b.action));const reason=text(b.reason,'Reason');
 return transaction(db,u,reason,async()=>{await guard(db);const row=await detail(db,u,recordId,true);if(row.version!==b.version)throw conflict('Invoice changed. Reload.');
  const config=await settings(db);let next;
  if(b.action==='CANCEL'&&['DRAFT','PENDING_APPROVAL','APPROVED'].includes(row.status))next='CANCELLED';
  else if(b.action==='SUBMIT'&&row.source==='CRM'&&row.status==='DRAFT')next='PENDING_APPROVAL';
  else if(b.action==='APPROVE'&&row.source==='CRM'&&row.status==='PENDING_APPROVAL'){
   if(row.created_by===u.id)throw forbidden('A different authorised person must approve the invoice.');
   if(row.settings_version!==config.version)throw conflict('Billing settings changed. Cancel and recreate the draft.');next='APPROVED';
  }else if(b.action==='VERIFY'&&row.source==='TALLY'&&row.status==='DRAFT'){
   if(!row.original)throw conflict('Upload the original invoice PDF first.');
   if([row.created_by,row.original.uploaded_by].includes(u.id))throw forbidden('A different authorised person must verify the original invoice.');
   if(b.confirmMatched!==true)throw validationFailed('Confirm that customer, invoice number, date and total match the original PDF and source evidence.');
   await db.prepare('UPDATE billing_document_originals SET verified_by=?,verified_at=now() WHERE document_id=?').run(u.id,row.id);next='ISSUED';
  }else if(b.action==='ISSUE'&&row.source==='CRM'&&row.status==='APPROVED'){
   requireIssuance(config.value);if(row.settings_version!==config.version)throw conflict('Billing settings changed; approval is stale.');
   await requireCustomerBillingApproval(db,row.customer_id);
   if(!await db.prepare("SELECT id FROM customers WHERE id=? AND status='ACTIVE'").get(row.customer_id))throw conflict('Customer is no longer active.');
   if(!row.shipment_id)throw conflict('Final issuance requires a recorded shipment. Manual drafts cannot be issued.');
   const live=await shipmentData(db,row.shipment_id,row.customer_id);if(live.shipment.order_version!==row.payload.shipmentVersion)throw conflict('The source order changed. Recreate and reapprove the invoice.');
   const current=invoicePayload({...row.payload,lines:live.lines},row.payload.customer,config.value);
   if(JSON.stringify(current.lines)!==JSON.stringify(row.payload.lines))throw conflict('Shipment pricing changed. Recreate and reapprove the invoice.');
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   if(row.payload.date!==today)throw conflict('Final issuance requires today’s India date; backdating is not enabled.');
   const fy=financialYear(row.payload.date),counter=await db.prepare('INSERT INTO billing_document_counters(financial_year,next_value) VALUES(?,2) ON CONFLICT(financial_year) DO UPDATE SET next_value=billing_document_counters.next_value+1 RETURNING next_value-1 AS n').get(fy);
   row.number=invoiceNumber(config.value.prefix,row.payload.date,counter.n);next='ISSUED';
   if(await db.prepare("SELECT id FROM billing_documents WHERE customer_id=? AND lower(number)=lower(?) AND id<>? AND status<>'CANCELLED'").get(row.customer_id,row.number,row.id))throw conflict('This invoice number already belongs to a registered copy.');
  }else throw conflict('This action is not available for the current invoice state.');
  await db.prepare('UPDATE billing_documents SET status=?,number=?,approved_by=CASE WHEN ? THEN ? ELSE approved_by END,version=version+1,updated_at=now() WHERE id=?').run(next,row.number,['APPROVE','VERIFY'].includes(b.action),u.id,row.id);
  await audit(db,u,row.id,b.action,reason,{source:row.source,number:row.number,status:next});return detail(db,u,row.id);
 });
}
export async function download(db,u,recordId,b){
 financeAccess(u);const reason=text(b.reason,'Reason');
 return transaction(db,u,reason,async()=>{const row=await detail(db,u,recordId,true);if(row.version!==b.version)throw conflict('Invoice changed. Reload.');
  let bytes;if(row.source==='TALLY'){
   const reviewing=b.reviewOriginal===true&&row.status==='DRAFT'&&row.original&&hasPermission(u,'collections.approve')&&![row.created_by,row.original.uploaded_by].includes(u.id);
   if(!reviewing&&(row.status!=='ISSUED'||!row.original?.verified_by))throw conflict('Original invoice must be independently verified before retrieval.');
   const file=await db.prepare('SELECT bytes,sha256 FROM billing_document_originals WHERE document_id=?').get(row.id);bytes=Buffer.from(file.bytes);
   if(crypto.createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw conflict('Stored invoice integrity check failed.');
  }else{if(row.status==='CANCELLED')throw conflict('Cancelled draft cannot be downloaded.');bytes=await invoicePdf(row);}
  await audit(db,u,row.id,b.reviewOriginal?'ORIGINAL_REVIEW':b.preview?'PDF_PREVIEW':'PDF_DOWNLOAD',reason,{source:row.source,version:row.version,draft:row.status!=='ISSUED',sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  return {bytes,filename:`${row.status==='ISSUED'?'invoice':'DRAFT-invoice'}-${row.number||row.id}`.replace(/[^a-z0-9_-]/gi,'-')+'.pdf'};
 });
}
