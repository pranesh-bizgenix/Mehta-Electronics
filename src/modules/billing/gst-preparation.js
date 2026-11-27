import {s,validate} from '../../core/schema.js';
import {TransactionRunner,AuditRepository,fingerprint} from '../../core/runtime.js';
import {financeAccess} from './service.js';
import {forbidden,conflict,notFound,validationFailed} from '../../core/errors.js';
import {calculateQuotation} from '../../../public/quotation-math.js';
import {decimal,add,compare} from '../../../public/money.js';
import {documentComparison,purchaseRecord} from '../../procurement.js';
import {validateTax} from '../../crm-modules.js';
import {renderPdf} from './pdf.js';
const additional=s.object({sellerPincode:s.string({max:6}).default(''),buyerPincode:s.string({max:6}).default(''),dispatchPincode:s.string({max:6}).default(''),shipPincode:s.string({max:6}).default(''),transportMode:s.string({max:30}).default(''),distanceKm:s.string({max:8}).default(''),transporterReference:s.string({max:100}).default(''),vehicleNumber:s.string({max:30}).default('')});
const request=s.object({requestKey:s.uuid(),kind:s.enum(['IRN','EWAY','PURCHASE_TAX']),sourceId:s.string({min:1,max:50}),additional,reason:s.reason()});
export function gstPreparationIssues(kind,source,extra={}){
 const issues=[];
 if(kind==='PURCHASE_TAX'){if(source.status!=='REVIEWED'||source.kind!=='DISPATCH_INVOICE')issues.push('Select an independently reviewed supplier invoice.');if(!source.receiptMatch?.matched)issues.push('Supplier invoice quantities must match posted accepted goods.');return issues;}
 if(source.source!=='CRM'||!['APPROVED','ISSUED'].includes(source.status))issues.push('Select an approved or issued CRM invoice snapshot.');
 const p=source.payload||{};
 for(const [name,value,state] of [['Seller GSTIN',p.company?.gstin,p.company?.stateCode],['Buyer GSTIN',p.customer?.gstin,null]]){try{if(typeof value!=='string'||!value.trim())throw new Error('Missing GSTIN');validateTax(value,state||value.slice(0,2));}catch{issues.push(name+' is missing, malformed or inconsistent with its recorded state.');}}
 try{if(!p.placeOfSupply)throw new Error('Missing supply state');validateTax(null,p.placeOfSupply);}catch{issues.push('Confirm a valid recorded place-of-supply state.');}
 for(const name of ['sellerPincode','buyerPincode'])if(!/^[1-9][0-9]{5}$/.test(extra[name]||''))issues.push(name+' requires a six-digit postcode.');
 if(!p.billTo||!p.shipTo)issues.push('Confirm invoice billing and shipping addresses.');
 if(!Array.isArray(p.lines)||!p.lines.length)issues.push('Invoice item and tax lines are missing.');
 else{
  if(p.lines.some(l=>!/^\d{4,8}$/.test(l.hsn||'')||!l.uom))issues.push('Every invoice item requires a recorded HSN and unit.');
  try{const state=p.company?.stateCode||p.company?.gstin?.slice(0,2),calc=calculateQuotation(p.lines,state,p.placeOfSupply);for(const key of ['subtotal','cgst','sgst','igst'])if(compare(decimal(calc[key]),decimal(p.totals?.[key]))!==0)issues.push('Saved '+key+' does not reconcile with invoice lines.');if(compare(add(decimal(calc.total),decimal(p.totals?.roundOff||'0')),decimal(p.totals?.total))!==0)issues.push('Invoice total and round-off do not reconcile.');}catch{issues.push('Invoice quantities, tax rates, states or totals require correction.');}
 }
 if(kind==='EWAY'){
  for(const key of ['dispatchPincode','shipPincode'])if(!/^[1-9][0-9]{5}$/.test(extra[key]||''))issues.push(key+' requires a six-digit postcode.');
  if(!['ROAD','RAIL','AIR','SHIP'].includes(extra.transportMode))issues.push('Select a transport mode.');
  if(!/^[1-9]\d{0,5}$/.test(extra.distanceKm||''))issues.push('Enter a positive whole-number transport distance.');
  if(!extra.transporterReference)issues.push('Record the transporter or transport-document reference.');
  if(extra.transportMode==='ROAD'&&!extra.vehicleNumber)issues.push('Record the road vehicle number.');
 }
 return [...new Set(issues)];
}
export class GstPreparationService{
 constructor({db}){this.db=db;this.tx=new TransactionRunner(db);this.audit=new AuditRepository(db);}
 one(sql,...args){return this.db.prepare(sql).get(...args);}
 all(sql,...args){return this.db.prepare(sql).all(...args);}
 event(actor,id,action,reason,detail={}){return this.audit.record({actorId:actor.id,entity:'GST_PREPARATION',recordId:id,action,reason,newValue:detail});}
 write(actor,reason,fn){return this.tx.run(actor,reason,async()=>{await this.one("SELECT pg_advisory_xact_lock(73429982),set_config('mehta.gst_write','authorized',true)");return fn();});}
 async source(actor,kind,id){
  if(kind==='PURCHASE_TAX'){if(!/^[1-9]\d*$/.test(String(id)))throw validationFailed('Enter the existing supplier document ID.');const comparison=await documentComparison(this.db,Number(id),actor),source=await purchaseRecord(this.db,'documents',Number(id),actor);return {...source,receiptMatch:comparison.receiptMatch,comparisonFingerprint:comparison.fingerprint};}
  const row=await this.one('SELECT * FROM billing_documents WHERE id=?',validate(s.uuid(),id));if(!row)throw notFound('Invoice document not found.');return row;
 }
 async preview(actor,body){financeAccess(actor,true);const b=validate(request,body),source=await this.source(actor,b.kind,b.sourceId);return {sourceId:b.sourceId,kind:b.kind,issues:gstPreparationIssues(b.kind,source,b.additional),sourceFingerprint:fingerprint(source),provider:{status:'NOT_CONFIGURED',note:'External GST submission is excluded. This preparation does not generate an IRN, e-Way bill or tax-credit entitlement.'}};}
 async create(actor,body){financeAccess(actor,true);const b=validate(request,body),requestHash=fingerprint(b);return this.write(actor,b.reason,async()=>{
  const retry=await this.one('SELECT * FROM crm_gst_preparations WHERE request_key=?',b.requestKey);if(retry){if(retry.request_hash!==requestHash||retry.created_by!==actor.id)throw conflict('GST retry key already identifies different source details.');return retry;}
  const source=await this.source(actor,b.kind,b.sourceId),issues=gstPreparationIssues(b.kind,source,b.additional);if(issues.length)throw validationFailed(issues.join(' '));
  const active=await this.one("SELECT id FROM crm_gst_preparations WHERE kind=? AND status IN ('PENDING_REVIEW','READY_FOR_PROVIDER') AND (billing_document_id=?::uuid OR supplier_document_id=?::integer)",b.kind,b.kind==='PURCHASE_TAX'?null:source.id,b.kind==='PURCHASE_TAX'?source.id:null);if(active)throw conflict('An active GST preparation already exists for this document. Open it, or cancel it before preparing a replacement.');
  const row=await this.one('INSERT INTO crm_gst_preparations(request_key,request_hash,kind,billing_document_id,supplier_document_id,snapshot,source_fingerprint,created_by,reason) VALUES(?,?,?,?,?,?::text::jsonb,?,?,?) RETURNING *',b.requestKey,requestHash,b.kind,b.kind==='PURCHASE_TAX'?null:source.id,b.kind==='PURCHASE_TAX'?source.id:null,JSON.stringify({source,additional:b.additional}),fingerprint(source),actor.id,b.reason);
  await this.event(actor,row.id,'PREPARED',b.reason,{kind:b.kind,sourceId:b.sourceId});return row;
 });}
 async list(actor){financeAccess(actor);return this.all('SELECT id,kind,billing_document_id,supplier_document_id,status,version,created_by,reviewed_by,created_at FROM crm_gst_preparations ORDER BY created_at DESC,id LIMIT 200');}
 async detail(actor,id){financeAccess(actor);const row=await this.one('SELECT * FROM crm_gst_preparations WHERE id=?',validate(s.uuid(),id));if(!row)throw notFound();return {...row,providerStatus:'NOT_CONFIGURED'};}
 async current(actor,row){const source=await this.source(actor,row.kind,row.billing_document_id||String(row.supplier_document_id));if(fingerprint(source)!==row.source_fingerprint)throw conflict('The source invoice or receipt evidence changed; cancel and prepare a fresh GST record.');const issues=gstPreparationIssues(row.kind,source,row.snapshot.additional);if(issues.length)throw conflict(issues.join(' '));}
 async decide(actor,id,body){const b=validate(s.object({version:s.int({min:1}),decision:s.enum(['APPROVE','REJECT','CANCEL']),reason:s.reason()}),body);financeAccess(actor,true,b.decision!=='CANCEL');return this.write(actor,b.reason,async()=>{
  const row=await this.one('SELECT * FROM crm_gst_preparations WHERE id=? FOR UPDATE',validate(s.uuid(),id));if(!row)throw notFound();if(row.version!==b.version)throw conflict('GST preparation changed. Reload.');
  if(b.decision==='CANCEL'){if(!['PENDING_REVIEW','READY_FOR_PROVIDER'].includes(row.status))throw conflict('This preparation is already closed.');}
  else{if(row.status!=='PENDING_REVIEW')throw conflict('This preparation is already reviewed.');if(row.created_by===actor.id)throw forbidden('Another authorised person must review GST preparation.');if(b.decision==='APPROVE')await this.current(actor,row);}
  const status={APPROVE:'READY_FOR_PROVIDER',REJECT:'REJECTED',CANCEL:'CANCELLED'}[b.decision];await this.db.prepare('UPDATE crm_gst_preparations SET status=?,version=version+1,reviewed_by=?,review_reason=? WHERE id=?').run(status,b.decision==='CANCEL'?row.reviewed_by:actor.id,b.reason,id);await this.event(actor,id,b.decision,b.reason,{status});return this.detail(actor,id);
 });}
 async export(actor,id,body){financeAccess(actor);const reason=validate(s.reason(),body?.reason),row=await this.detail(actor,id);if(row.status!=='READY_FOR_PROVIDER')throw conflict('An independently reviewed preparation is required before export.');await this.current(actor,row);await this.event(actor,id,'JSON_EXPORT',reason,{kind:row.kind,version:row.version});return {schemaVersion:'CRM_GST_PREPARATION_1',documentId:row.id,kind:row.kind,providerStatus:'NOT_CONFIGURED',statutorySubmission:false,requiresFinalNumberConfirmation:row.kind!=='PURCHASE_TAX'&&!row.snapshot.source.number,note:'Provider-neutral preparation only. An integration must validate the provider schema and return verified government acknowledgement before any statutory success is recorded.',sourceFingerprint:row.source_fingerprint,data:row.snapshot};}
 async pdf(actor,id,body){financeAccess(actor);const reason=validate(s.reason(),body?.reason),row=await this.detail(actor,id);const source=row.snapshot.source;const bytes=await renderPdf({title:'GST preparation register',subtitle:row.kind+' | '+row.status,sections:[{label:'Source',value:String(source.number||source.payload?.reference||source.id)},{label:'External status',value:'Not configured. This is an internal preparation record, not an IRN certificate, e-Way bill or confirmation of input-tax credit.'}],columns:[{label:'Field',fraction:.4},{label:'Recorded value',fraction:.6}],rows:Object.entries(row.snapshot.additional).filter(([,value])=>Boolean(value)).map(([key,value])=>[key,String(value)])});await this.event(actor,id,body?.preview?'PDF_PREVIEW':'PDF_DOWNLOAD',reason,{version:row.version});return {bytes,filename:'gst-preparation.pdf'};}
}
