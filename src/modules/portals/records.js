import {createHash} from 'node:crypto';
import {s,validate} from '../../core/schema.js';
import {hasPermission} from '../../rbac.js';
import {fingerprint} from '../../core/runtime.js';
import {escapeLike} from '../../security.js';
import {forbidden,notFound,validationFailed,conflict} from '../../core/errors.js';
import {quotationPdf} from '../../quotation-document.js';
import {invoicePdf} from '../billing/pdf.js';
import {lineNet,format} from '../../../public/money.js';
const published="EXISTS(SELECT 1 FROM crm_quotation_events e WHERE e.quotation_id=v.quotation_id AND e.version=v.version AND e.action IN ('SEND','EMAIL_SENT') AND NOT e.is_deleted)";
const quoteScope=`FROM crm_quotation_versions v JOIN quotations q ON q.id=v.quotation_id JOIN crm_quotation_workflows w ON w.quotation_id=q.id WHERE NOT q.is_deleted AND q.customer_id=? AND v.public_snapshot->>'companyId'=? AND ${published}`;
const orderScope="FROM crm_order_workflows w JOIN sales_orders o ON o.id=w.sales_order_id WHERE w.customer_id=? AND w.public_snapshot->>'companyId'=? AND NOT o.is_deleted AND w.status IN ('APPROVED','PARTIALLY_DISPATCHED','DISPATCHED','DELIVERED')";
const invoiceScope="FROM billing_documents d LEFT JOIN crm_order_workflows w ON w.sales_order_id=d.sales_order_id LEFT JOIN crm_financial_scopes f ON f.operation_id=d.invoice_reference_id AND f.status='CONFIRMED' WHERE d.customer_id=? AND COALESCE(d.payload->>'companyId',w.public_snapshot->>'companyId',f.company_id::text)=? AND d.status='ISSUED'";
const rfqScope="FROM crm_portal_rfq_publications pub JOIN crm_rfqs r ON r.id=pub.rfq_id JOIN crm_rfq_vendors v ON v.rfq_id=r.id AND v.vendor_id=pub.vendor_id WHERE pub.vendor_id=? AND pub.company_id=? AND NOT v.is_deleted AND v.status IN ('INVITED','REPLIED') AND NOT r.is_deleted";
const poScope="FROM crm_supplier_pos p JOIN crm_order_workflows w ON w.sales_order_id=p.sales_order_id WHERE p.vendor_id=? AND w.public_snapshot->>'companyId'=? AND NOT p.is_deleted AND p.status IN ('ISSUED','PARTIALLY_RECEIVED','RECEIVED')";
export const portalLine=line=>({itemId:line.itemId,code:line.partCode||line.code||'',description:line.description||'',quantity:String(line.quantity),uom:line.uom||'',hsn:line.hsn||''});
// Match the customer PDF: expose the net rate, never list price or discount.
export const customerPortalLine=line=>({...portalLine(line),unitPrice:format(lineNet({quantity:'1',unit_price:line.unitPrice,discount_percent:line.discountPercent})),taxPercent:line.taxPercent,netAmount:line.net});
export class PortalRecords{
 constructor({access}){this.access=access;this.db=access.db;}
 one(sql,...args){return this.db.prepare(sql).get(...args);}all(sql,...args){return this.db.prepare(sql).all(...args);}
 async publishRfq(actor,id,body){
  if(!['purchasing.read','purchasing.write','purchasing.approve'].every(key=>hasPermission(actor,key)))throw forbidden();
  const b=validate(s.object({version:s.int({min:1}),vendorId:s.id(),reason:s.reason()}),body);
  return this.access.write(actor,b.reason,async()=>{
   const r=await this.one("SELECT r.*,w.public_snapshot->>'companyId' AS company_id FROM crm_rfqs r JOIN crm_purchase_requests p ON p.id=r.request_id JOIN crm_order_workflows w ON w.sales_order_id=p.sales_order_id WHERE r.id=? AND NOT r.is_deleted AND NOT p.is_deleted FOR SHARE OF r,p,w",validate(s.id(),id));
   if(!r)throw notFound('A company-scoped operational RFQ is required.');
   if(r.created_by===actor.id)throw forbidden('A different authorised buyer must review the published supplier details.');
   if(r.version!==b.version||r.status!=='OPEN')throw conflict('Reload the current open RFQ.');
   const invitation=await this.one("SELECT i.id FROM crm_rfq_vendors i JOIN crm_procurement_vendors v ON v.id=i.vendor_id WHERE i.rfq_id=? AND i.vendor_id=? AND NOT i.is_deleted AND i.status IN ('INVITED','REPLIED') AND v.status='ACTIVE' AND NOT v.is_deleted FOR SHARE OF i,v",r.id,b.vendorId);
   if(!invitation)throw validationFailed('Select an invited supplier.');
   validate(s.uuid(),r.company_id);
   const snapshot={reference:r.number,replyBy:r.payload.replyBy??null,lines:r.payload.lines.map(portalLine)},hash=fingerprint(snapshot);
   await this.one('SELECT pg_advisory_xact_lock(812741,?)',r.id);
   const existing=await this.one('SELECT id,source_hash FROM crm_portal_rfq_publications WHERE rfq_id=? AND vendor_id=? AND rfq_version=?',r.id,b.vendorId,r.version);
   if(existing){if(existing.source_hash!==hash)throw conflict('The published RFQ snapshot differs. Review a new RFQ version.');return {id:existing.id,duplicate:true};}
   const saved=await this.one('INSERT INTO crm_portal_rfq_publications(rfq_id,vendor_id,company_id,rfq_version,public_snapshot,source_hash,created_by,reason) VALUES(?,?,?,?,?::text::jsonb,?,?,?) RETURNING id',r.id,b.vendorId,r.company_id,r.version,JSON.stringify(snapshot),hash,actor.id,b.reason);
   await this.access.audit.record({actorId:actor.id,entity:'PORTAL_RFQ',recordId:saved.id,action:'PUBLISH',reason:b.reason,newValue:{rfqId:r.id,vendorId:b.vendorId,version:r.version}});return saved;
  },{review:true});
 }
 async me(actor){const m=await this.access.member(actor),company=await this.one('SELECT name FROM tally_companies WHERE id=?',m.company_id);return {kind:m.kind,party:m.party,company:{id:m.company_id,name:company.name},note:'Only published records belonging to this reviewed account and company are available. Unscoped legacy documents require staff review.'};}
 async list(actor,type,query={}){
  const m=await this.access.member(actor),page=validate(s.int({min:1,max:100000}),Number(query.page||1)),search=validate(s.string({max:100}).default(''),query.search||''),like='%'+escapeLike(search)+'%';let select,scope,args;
  if(m.kind==='CUSTOMER'){
   args=[m.customer_id,m.company_id];
   if(type==='QUOTATIONS'){select="SELECT v.quotation_id AS id,v.version,v.public_snapshot->>'quotation_number' AS reference,CASE WHEN v.version=w.version THEN w.status ELSE 'SUPERSEDED' END AS status,v.public_snapshot->>'validUntil' AS valid_until,v.public_snapshot->>'total' AS recorded_total,v.created_at";scope=quoteScope+" AND (v.public_snapshot->>'quotation_number' ILIKE ? ESCAPE '\\')";}
   else if(type==='ORDERS'){select='SELECT o.id,w.version,o.order_number AS reference,w.status,o.created_at';scope=orderScope+" AND o.order_number ILIKE ? ESCAPE '\\'";}
   else if(type==='INVOICES'){select="SELECT d.id,d.version,d.number AS reference,d.status,d.invoice_date,d.source,d.payload->'totals'->>'total' AS recorded_total,d.created_at";scope=invoiceScope+" AND d.number ILIKE ? ESCAPE '\\'";}
   else if(type==='SHIPMENTS'){select='SELECT s.id,o.order_number AS reference,s.status,s.lr_number,s.transporter,s.created_at';scope="FROM crm_shipments s JOIN crm_order_workflows w ON w.sales_order_id=s.sales_order_id JOIN sales_orders o ON o.id=s.sales_order_id WHERE w.customer_id=? AND w.public_snapshot->>'companyId'=? AND NOT s.is_deleted AND NOT o.is_deleted AND o.order_number ILIKE ? ESCAPE '\\'";}
   else throw forbidden('This record type is not available to this customer account.');
  }else{
   args=[m.vendor_id,m.company_id];
   if(type==='RFQS'){select="SELECT r.id,pub.rfq_version AS version,pub.public_snapshot->>'reference' AS reference,CASE WHEN r.version=pub.rfq_version THEN r.status ELSE 'SUPERSEDED' END AS status,pub.public_snapshot->>'replyBy' AS reply_by,pub.created_at";scope=rfqScope+" AND r.number ILIKE ? ESCAPE '\\'";}
   else if(type==='PURCHASE_ORDERS'){select="SELECT p.id,p.version,p.number AS reference,p.status,p.payload->>'deliveryBy' AS delivery_by,p.created_at";scope=poScope+" AND p.number ILIKE ? ESCAPE '\\'";}
   else throw forbidden('This record type is not available to this supplier account.');
  }
  args.push(like);const total=(await this.one('SELECT count(*)::integer AS n '+scope,...args)).n;
  const data=await this.all(select+' '+scope+' ORDER BY created_at DESC,id DESC'+(['QUOTATIONS','RFQS'].includes(type)?',version DESC':'')+' LIMIT 25 OFFSET ?',...args,(page-1)*25);return {data,pagination:{page,pageSize:25,total,pages:Math.ceil(total/25)}};
 }
 async source(actor,type,recordId,{version,lock=false}={}){
  const m=await this.access.member(actor,{lock}),numeric=()=>validate(s.id(),recordId),scope=m.kind==='CUSTOMER'?[m.customer_id,m.company_id]:[m.vendor_id,m.company_id];let row;
  if(m.kind==='CUSTOMER'&&type==='QUOTATIONS'){
   const v=version===undefined?null:validate(s.int({min:1}),Number(version));row=await this.one('SELECT v.quotation_id AS id,v.version,v.public_snapshot,v.created_at,w.version AS current_version,w.status '+quoteScope+' AND q.id=? AND (?::integer IS NULL OR v.version=?) ORDER BY v.version DESC LIMIT 1'+(lock?' FOR SHARE OF v,w,q':''),...scope,numeric(),v,v);
  }else if(m.kind==='CUSTOMER'&&type==='ORDERS')row=await this.one('SELECT o.id,o.order_number,w.version,w.status,w.public_snapshot '+orderScope+' AND o.id=?'+(lock?' FOR SHARE OF w,o':''),...scope,numeric());
  else if(m.kind==='CUSTOMER'&&type==='INVOICES')row=await this.one('SELECT d.* '+invoiceScope+' AND d.id=?'+(lock?' FOR SHARE OF d':''),...scope,validate(s.uuid(),recordId));
  else if(m.kind==='VENDOR'&&type==='RFQS'){const v=version===undefined?null:validate(s.int({min:1}),Number(version));row=await this.one('SELECT r.id,pub.public_snapshot->>\'reference\' AS number,pub.rfq_version AS version,r.version AS current_version,r.status,pub.public_snapshot AS payload '+rfqScope+' AND r.id=? AND (?::integer IS NULL OR pub.rfq_version=?) ORDER BY pub.rfq_version DESC LIMIT 1'+(lock?' FOR SHARE OF pub,r,v':''),...scope,numeric(),v,v);}
  else if(m.kind==='VENDOR'&&type==='PURCHASE_ORDERS')row=await this.one('SELECT p.id,p.number,p.version,p.status,p.payload '+poScope+' AND p.id=?'+(lock?' FOR SHARE OF p,w':''),...scope,numeric());
  else if(m.kind==='CUSTOMER'&&type==='SHIPMENTS')row=await this.one("SELECT s.id,o.order_number,s.status,s.lr_number,s.transporter,s.created_at FROM crm_shipments s JOIN crm_order_workflows w ON w.sales_order_id=s.sales_order_id JOIN sales_orders o ON o.id=s.sales_order_id WHERE s.id=? AND w.customer_id=? AND w.public_snapshot->>'companyId'=? AND NOT s.is_deleted AND NOT o.is_deleted",numeric(),...scope);
  else throw forbidden('This record type is not available to this partner.');
  if(!row)throw notFound('Published partner record not found.');return {member:m,row};
 }
 async detail(actor,type,id,query={}){
  const {member:m,row:r}=await this.source(actor,type,id,{version:query.version});
  if(type==='QUOTATIONS'){const p=r.public_snapshot;return {id:r.id,version:r.version,reference:p.quotation_number,status:r.version===r.current_version?r.status:'SUPERSEDED',validUntil:p.validUntil,lines:(p.lines||[]).map(customerPortalLine),total:p.total,terms:p.terms||'',canAcknowledge:r.version===r.current_version&&r.status==='SENT'&&p.validUntil>=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),sourceHash:fingerprint({version:r.version,status:r.status,snapshot:p})};}
  if(type==='ORDERS'){const lines=await this.all('SELECT l.id,i.part_code AS code,l.description,l.uom,l.ordered_quantity::text AS ordered,l.fulfilled_quantity::text AS supplied,(l.ordered_quantity-l.fulfilled_quantity)::text AS pending FROM sales_order_lines l LEFT JOIN items i ON i.id=l.item_id WHERE l.sales_order_id=? AND l.status=\'ACTIVE\' ORDER BY l.position,l.id',r.id);return {id:r.id,version:r.version,reference:r.order_number,status:r.status,lines,canAcknowledge:['APPROVED','PARTIALLY_DISPATCHED'].includes(r.status),sourceHash:fingerprint({version:r.version,status:r.status,snapshot:r.public_snapshot})};}
  if(type==='INVOICES')return {id:r.id,version:r.version,reference:r.number,status:r.status,date:r.invoice_date,total:r.payload.totals?.total,source:r.source};
  if(type==='SHIPMENTS')return {...r,lines:await this.all('SELECT s.id,i.part_code AS code,l.description,l.uom,s.quantity::text AS supplied FROM crm_shipment_items s JOIN sales_order_lines l ON l.id=s.order_line_id LEFT JOIN items i ON i.id=l.item_id WHERE s.shipment_id=? AND NOT s.is_deleted ORDER BY s.id',r.id)};
  if(type==='RFQS'){const own=await this.one("SELECT id,version FROM crm_rfq_vendor_replies WHERE rfq_id=? AND vendor_id=? AND NOT is_deleted AND status='RECORDED'",r.id,m.vendor_id);return {id:r.id,version:r.version,reference:r.number,status:r.version===r.current_version?r.status:'SUPERSEDED',replyBy:r.payload.replyBy,replyVersion:own?.version??null,lines:r.payload.lines.map(portalLine),canReply:r.status==='OPEN'&&r.version===r.current_version};}
  return {id:r.id,version:r.version,reference:r.number,status:r.status,deliveryBy:r.payload.deliveryBy,terms:r.payload.terms||'',lines:r.payload.lines.map(customerPortalLine),total:r.payload.total};
 }
 async document(actor,type,id,body){const b=validate(s.object({version:s.int({min:1}),reason:s.reason(),preview:s.bool().optional()}),body);return this.access.write(actor,b.reason,async()=>{
  if(!['QUOTATION','INVOICE','SUPPLIER_TERMS'].includes(type))throw validationFailed('Choose a published document.');const {row:r}=await this.source(actor,type==='INVOICE'?'INVOICES':'QUOTATIONS',id,{version:type==='INVOICE'?undefined:b.version,lock:true});if(r.version!==b.version)throw conflict('Document version changed. Reload.');let bytes;
  if(type==='SUPPLIER_TERMS'){const fs=await import('node:fs/promises');bytes=await fs.readFile(new URL('../../assets/kgep-supplier-sales-terms-v1.1.pdf',import.meta.url));}
  else if(type==='QUOTATION')bytes=await quotationPdf({...r.public_snapshot,id:r.id,version:r.version,status:'SENT',notes:[r.public_snapshot.notes,r.version!==r.current_version?'Previously issued version; superseded by a later quotation. Consult the current published version before responding.':!['SENT','WON'].includes(r.status)?`Previously issued quotation; current status: ${r.status}. Not available for acceptance.`:''].filter(Boolean).join('\n'),documentDate:r.created_at});
  else if(r.source==='TALLY'){const original=await this.one('SELECT bytes,sha256,verified_by FROM billing_document_originals WHERE document_id=?',r.id);if(!original?.verified_by)throw conflict('Original invoice has not been independently verified.');bytes=Buffer.from(original.bytes);if(createHash('sha256').update(bytes).digest('hex')!==original.sha256)throw conflict('Original invoice integrity check failed.');}
  else bytes=await invoicePdf(r);
  await this.access.audit.record({actorId:actor.id,entity:'PORTAL_DOCUMENT',recordId:String(r.id),action:b.preview?'PDF_PREVIEW':'PDF_DOWNLOAD',reason:b.reason,newValue:{type,version:r.version}});return {bytes,filename:`${type.toLowerCase()}-${r.id}-${r.version}.pdf`};
 });}
}
