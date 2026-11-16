import {TextDecoder} from 'node:util';
import {s,validate} from '../../core/schema.js';
import {conflict,forbidden,notFound,validationFailed} from '../../core/errors.js';
import {workflowRule} from '../rules/workflow-rules.js';
import {readPriceCsv,readPriceWorkbook} from './tabular.js';
import {planPriceImport,priceFileHash} from './import-plan.js';
import {importMetadata,importUpload} from './contracts.js';
import {extractPricePdf,pdfLayoutTable} from './pdf-table.js';
export class PriceImportService {
 constructor(dependencies){Object.assign(this,dependencies);}
 read(actor){this.access.require(actor,'items.read');this.access.require(actor,'items.list_price.read');}
 manage(actor){this.read(actor);this.access.require(actor,'items.update');}
 async table(upload,mapping){
  if(upload.format==='XLSX')return readPriceWorkbook(upload.bytes,upload.sheet);
  if(upload.format==='PDF_TABLE')return pdfLayoutTable(await extractPricePdf(upload.bytes),mapping?.pdfColumns);
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(upload.bytes);}catch{throw validationFailed('CSV must be valid UTF-8.');}
  return readPriceCsv(text);
 }
 async inspect(actor,input){
  this.read(actor);const page=validate(s.int({min:1,max:200}),input.sourcePage??1,'sourcePage'),table=await this.table(importUpload(input),input.mapping);
  return {...table,...(table.rows?{sourceRows:table.rows.length,sourcePage:page,sourcePages:Math.max(1,Math.ceil(table.rows.length/100)),rows:table.rows.slice((page-1)*100,page*100)}:{})};
 }
 async list(actor){this.read(actor);return this.repository.list();}
 async detail(actor,id,page=1){this.read(actor);const row=await this.repository.detail(validate(s.uuid(),id),validate(s.int({min:1,max:150}),page));if(!row)throw notFound('Price-list review not found.');return row;}
 async plan(input,lock=false){
  const upload=importUpload(input),metadata=importMetadata(input.metadata),table=await this.table(upload,input.mapping);
  if(table.unmapped)throw validationFailed('Not set: price_import.mapping.pdfColumns. Inspect the PDF layout and set explicit character boundaries.');
  if(!table.rows)throw validationFailed('Select a worksheet before previewing prices.');
  const mapping={...input.mapping,sheet:upload.sheet??null};
  const plan=planPriceImport(table,mapping,await this.repository.items(lock),{fileSha256:priceFileHash(upload.bytes),metadata});
  return {upload,metadata,mapping,plan};
 }
 async preview(actor,input){this.read(actor);return (await this.plan(input)).plan;}
 async save(actor,input){
  this.manage(actor);const reason=validate(s.reason(),input.reason,'reason');
  return this.transactions.run(actor,reason,async()=>{
   const {upload,metadata,mapping,plan}=await this.plan(input,true);
   if(!plan.canSave)throw validationFailed('Resolve every row error before saving this review.');
   if(input.previewFingerprint!==plan.previewFingerprint)throw conflict('The file, mapping, metadata or products changed. Review a fresh preview.');
   await this.repository.lock(plan.fileSha256);
   const same=await this.repository.same(plan.fileSha256,plan.previewFingerprint);if(same)return {...same,replayed:true};
   const latest=await this.repository.latest(plan.fileSha256);
   if(latest&&(!['REJECTED','CANCELLED','ACTIVATED','ARCHIVED'].includes(latest.status)||input.replacesId!==latest.id))throw conflict('This file already has a review. Open it, or explicitly replace its completed revision.');
   if(!latest&&input.replacesId)throw validationFailed('The replacement must identify the previous review of this exact file.');
   const row=await this.repository.create(upload,metadata,mapping,plan,actor,(latest?.source_revision??0)+1,latest?.id??null);
   await this.repository.event(row,'CREATED',actor,reason);
   await this.audit.record({actorId:actor.id,entity:'PRICE_IMPORT',recordId:row.id,action:'CREATE',reason,newValue:{fileSha256:plan.fileSha256,rows:plan.rows.length,planHash:plan.previewFingerprint}});
   return {...row,replayed:false};
  });
 }
 async policy(row){
  await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('rule:price_lists.approval_policy');
  const rule=await workflowRule(this.db,'price_lists.approval_policy',false);
  if(!rule)throw conflict('Not set: price_lists.approval_policy — blocks price-list submission, approval and activation.');
  if(row.approval_rule_version&&row.approval_rule_version!==rule.version)throw conflict('Approval policy changed. Reject this review and create a new revision.');
  return rule;
 }
 async current(row){
  const input={format:row.source_format,filename:'retained-source',sheet:row.mapping.sheet,contentBase64:Buffer.from(row.original_bytes).toString('base64'),mapping:row.mapping,metadata:row.metadata};
  const {plan}=await this.plan(input,true);
  if(!plan.canSave||plan.previewFingerprint!==row.plan_hash)throw conflict('Source products or units changed after preview. Create a fresh reviewed revision.');
 }
 async decide(actor,id,input){
  this.manage(actor);id=validate(s.uuid(),id);const reason=validate(s.reason(),input.reason,'reason'),action=validate(s.enum(['SUBMIT','APPROVE','REJECT','ACTIVATE']),input.action);
  return this.transactions.run(actor,reason,async()=>{
   const row=await this.repository.record(id);if(!row)throw notFound('Price-list review not found.');
   if(action==='REJECT'){
    if(!['PENDING_REVIEW','PENDING_APPROVAL','APPROVED'].includes(row.status))throw conflict('This review is already complete.');
    await this.repository.reject(row,reason);
   }else{
    const expected={SUBMIT:'PENDING_REVIEW',APPROVE:'PENDING_APPROVAL',ACTIVATE:'APPROVED'}[action];
    if(row.status!==expected)throw conflict(`This action requires ${expected}.`);
    const rule=await this.policy(row);await this.current(row);
    if(action==='SUBMIT')await this.repository.submit(row,rule.version);
    else{
     this.access.require(actor,rule.value.reviewerPermission);
     if(row.created_by===actor.id)throw forbidden('The importer cannot approve or activate their own price list.');
     if(action==='APPROVE')await this.repository.approve(row,actor,reason);
     else{if(row.approved_hash!==row.plan_hash)throw conflict('The approved preview no longer matches.');await this.repository.lock(`price-list-name:${row.metadata.name}`);if(await this.repository.named(row.metadata.name))throw conflict('This price-list name already exists. Create a newly named reviewed revision; retained lists are not overwritten.');await this.repository.activate(row,actor);}
    }
   }
   await this.repository.event(row,action,actor,reason);
   await this.audit.record({actorId:actor.id,entity:'PRICE_IMPORT',recordId:id,action,reason,newValue:{planHash:row.plan_hash}});
   return {id,status:{SUBMIT:'PENDING_APPROVAL',APPROVE:'APPROVED',REJECT:'REJECTED',ACTIVATE:'ACTIVATED'}[action]};
  });
 }
}
