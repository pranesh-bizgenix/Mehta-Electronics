import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {withAuthorizedRdsRollbackVerification} from '../test-support/transaction.js';
import {saveVendor,saveRequest,createRfq,saveReply,selectWinner,saveSupplierPo,createGrn,grnCheck,postGrn,uploadSupplierDocument,saveDocumentReview,documentComparison,approveDocument,supplierInvoiceMatchPdf,supplierDeliverySchedule,reviseSupplierDelivery} from '../src/procurement.js';
import {renderPdf} from '../src/modules/billing/pdf.js';

const out='verification-output/supplier-matching',checks=[];fs.mkdirSync(out,{recursive:true});
await withAuthorizedRdsRollbackVerification(async db=>{
 const owner=await db.prepare("SELECT id,role FROM users WHERE role='OWNER' AND status='ACTIVE' ORDER BY id LIMIT 1").get();
 const reviewer=await db.prepare("SELECT id,role FROM users WHERE role IN ('OWNER','MANAGER') AND status='ACTIVE' AND id<>? ORDER BY id LIMIT 1").get(owner.id);
 assert.ok(reviewer,'An independent existing reviewer is required.');
 const item=await db.prepare("SELECT id,uom FROM items WHERE status='ACTIVE' AND NOT is_deleted AND length(trim(uom))>0 ORDER BY id LIMIT 1").get();
 const tag='ZZTEST_MATCH_'+randomUUID(),reason=tag+' rollback verification';
 const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS',name);};
 const lines=[{itemId:item.id,quantity:'10',unitPrice:'100',discountPercent:'0',taxPercent:'18'}];
 const vendor=await saveVendor(db,null,{name:tag,stateCode:'33',reason},owner);
 const request=await saveRequest(db,null,{subject:tag,requiredBy:'2026-12-15',reason,lines},owner);
 const rfq=await createRfq(db,{requestId:request.id,requestVersion:request.version,vendorIds:[vendor.id],replyBy:'2026-12-10',reason},owner);
 const reply=await saveReply(db,rfq.id,{vendorId:vendor.id,rfqVersion:rfq.version,validUntil:'2026-12-20',terms:'',leadDays:'',reason,lines},owner);
 await selectWinner(db,rfq.id,{version:rfq.version,replyId:reply.id,replyVersion:reply.version,reason},owner);
 const po=await saveSupplierPo(db,null,{rfqId:rfq.id,deliveryBy:'2026-12-15',reason},owner);
 // Controlled source-state fixture, inside the outer rollback only. This does
 // not exercise or bypass issuance on the live app, Tally, or any real order.
 await db.prepare("SELECT set_config('mehta.procurement_write','authorized',true),set_config('mehta.actor_id',?,true),set_config('mehta.audit_reason',?,true)").get(String(owner.id),reason);
 await db.prepare("UPDATE crm_supplier_pos SET status='ISSUED' WHERE id=?").run(po.id);
 const promise={version:po.version,previousRevisionId:null,promisedDate:'2026-12-16',evidence:tag+' supplier confirmation',supplierConfirmed:true,reason};
 await check('Supplier schedule requires a confirmed promise and evidence',()=>assert.rejects(reviseSupplierDelivery(db,po.id,{...promise,supplierConfirmed:false},owner),{status:422}));
 await check('Unknown role cannot record a supplier delivery promise',()=>assert.rejects(reviseSupplierDelivery(db,po.id,promise,{id:owner.id,role:'UNKNOWN'}),{status:403}));
 await check('Audited delivery revision preserves the original approved PO date and version',async()=>{const schedule=await reviseSupplierDelivery(db,po.id,promise,owner);assert.equal(schedule.promisedDate,'2026-12-16');assert.equal(schedule.originalDate,'2026-12-15');assert.ok(schedule.revisionId);const stored=await db.prepare('SELECT payload,version FROM crm_supplier_pos WHERE id=?').get(po.id);assert.equal(stored.payload.deliveryBy,'2026-12-15');assert.equal(stored.version,po.version);});
 await check('A stale delivery revision cannot replace a newer supplier promise',()=>assert.rejects(reviseSupplierDelivery(db,po.id,promise,owner),{status:409}));
 const grn=await createGrn(db,po.id,{requestKey:randomUUID(),receivedDate:'2026-11-26',reference:tag,notes:'',reason,lines:[{poLineKey:po.payload.lines[0].lineKey,actualPartCode:po.payload.lines[0].partCode,received:'10',accepted:'8',rejected:'2',unitPrice:'100',taxPercent:'18',notes:'Fictional receipt, rollback only'}]},owner);
 const receiptCheck=await grnCheck(db,grn.id,reviewer);
 await postGrn(db,grn.id,{version:grn.version,fingerprint:receiptCheck.fingerprint,acceptExceptions:true,reason},reviewer);
 await check('Supplier schedule uses posted accepted quantities, leaving rejected goods pending',async()=>{const schedule=await supplierDeliverySchedule(db,po.id,reviewer);assert.equal(schedule.lines[0].accepted,'8.000000');assert.equal(schedule.lines[0].pending,'2.000000');});
 let serial=0;
 async function invoice(quantity,reference=tag+'_'+(++serial)){
  const bytes=await renderPdf({title:reference,subtitle:'Fictional supplier invoice - rollback verification',sections:[],columns:[{label:'Fixture',fraction:1}],rows:[[reference]]});
  const original=await uploadSupplierDocument(db,po.id,{kind:'DISPATCH_INVOICE',name:reference+'.pdf',base64:bytes.toString('base64'),reason},owner);
  return saveDocumentReview(db,original.id,{version:original.version,reference,documentDate:'2026-11-26',manualConfirmed:true,notes:'Fictional test invoice',reason,lines:[{...lines[0],quantity}]},owner);
 }
 const valid=await invoice('6');let matched=await documentComparison(db,valid.id,reviewer);
 await check('Posted receipt contributes accepted 8 and rejected 2; current invoice 6 matches',async()=>{assert.equal(matched.receiptMatch.matched,true);assert.equal(matched.receiptMatch.rows[0].accepted,'8.000000');assert.equal(matched.receiptMatch.rows[0].rejected,'2.000000');});
 await check('Document creator cannot approve their own checked supplier invoice',()=>assert.rejects(approveDocument(db,valid.id,{version:valid.version,fingerprint:matched.fingerprint,acceptExceptions:true,reason},owner),{status:403}));
 await check('Unknown role cannot read supplier invoice matching',()=>assert.rejects(documentComparison(db,valid.id,{id:owner.id,role:'UNKNOWN'}),{status:403}));
 const excess=await invoice('9'),excessCheck=await documentComparison(db,excess.id,reviewer);
 await check('Invoice for rejected goods has a hard quantity blocker',async()=>assert.ok(excessCheck.receiptMatch.blockers.some(f=>f.code==='INVOICE_EXCEEDS_ACCEPTED_GOODS')));
 await check('Accepting exceptions cannot override the hard receipt blocker',()=>assert.rejects(approveDocument(db,excess.id,{version:excess.version,fingerprint:excessCheck.fingerprint,acceptExceptions:true,reason},reviewer),{status:409}));
 const dup=await invoice('1',valid.payload.reference),dupCheck=await documentComparison(db,dup.id,reviewer);
 await check('A duplicate vendor invoice reference is detected before approval',async()=>assert.ok(dupCheck.receiptMatch.blockers.some(f=>f.code==='DUPLICATE_SUPPLIER_INVOICE_REFERENCE')));
 await check('A duplicate reference cannot be accepted as an ordinary difference',()=>assert.rejects(approveDocument(db,dup.id,{version:dup.version,fingerprint:dupCheck.fingerprint,acceptExceptions:true,reason},reviewer),{status:409}));
 // Archive the duplicate fixture so that it cannot obstruct the valid document.
 await db.prepare("SELECT set_config('mehta.procurement_write','authorized',true),set_config('mehta.actor_id',?,true),set_config('mehta.audit_reason',?,true)").get(String(owner.id),reason);
 await db.prepare("UPDATE crm_supplier_documents SET status='ARCHIVED',is_deleted=true WHERE id=?").run(dup.id);
 matched=await documentComparison(db,valid.id,reviewer);
 await check('Independent reviewer persists the invoice evidence in existing audit history',async()=>{await approveDocument(db,valid.id,{version:valid.version,fingerprint:matched.fingerprint,acceptExceptions:true,reason},reviewer);const event=await db.prepare("SELECT id FROM crm_procurement_events WHERE entity='documents' AND record_id=? AND action='SUPPLIER_DOCUMENT_REVIEWED'").get(valid.id);assert.ok(event);});
 const remainder=await invoice('2'),remainderCheck=await documentComparison(db,remainder.id,reviewer);
 await check('Second invoice consumes the remaining accepted quantity exactly',async()=>{assert.equal(remainderCheck.receiptMatch.matched,true);assert.equal(remainderCheck.receiptMatch.rows[0].previouslyInvoiced,'6.000000');assert.equal(remainderCheck.receiptMatch.rows[0].remainingAccepted,'0.000000');});
 const over=await invoice('3'),overCheck=await documentComparison(db,over.id,reviewer);
 await check('Cumulative billing includes earlier independently reviewed invoices',async()=>assert.ok(overCheck.receiptMatch.blockers.some(f=>f.code==='INVOICE_EXCEEDS_ACCEPTED_GOODS')));
 await check('Changed receipt evidence invalidates an approval prepared earlier',async()=>{await db.prepare("UPDATE crm_grns SET version=version+1 WHERE id=?").run(grn.id);await assert.rejects(approveDocument(db,remainder.id,{version:remainder.version,fingerprint:remainderCheck.fingerprint,acceptExceptions:true,reason},reviewer),{status:409});});
 await check('Branded matching PDF renders and writes only metadata to download audit',async()=>{const result=await supplierInvoiceMatchPdf(db,valid.id,{reason},reviewer);assert.equal(result.bytes.subarray(0,5).toString(),'%PDF-');fs.writeFileSync(out+'/supplier-invoice-matching.pdf',result.bytes);const audit=await db.prepare("SELECT new_value FROM audit_logs WHERE entity='PROCUREMENT' AND record_id=? AND action='MATCH_PDF_DOWNLOAD' ORDER BY id DESC LIMIT 1").get('documents:'+valid.id);assert.ok(audit);assert.ok(!JSON.stringify(audit.new_value).includes('base64'));});
},{productionTransactions:true});
fs.writeFileSync(out+'/rds-report.json',JSON.stringify({checks,passed:checks.length,cleanup:'All fictional records rolled back. Existing PO issuance and real supplier payments were not tested.'},null,2));
