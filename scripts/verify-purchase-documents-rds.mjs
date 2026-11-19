import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Readable} from 'node:stream';
import {withAuthorizedRdsRollbackVerification} from '../test-support/transaction.js';import {getConfig} from '../src/config.js';import {createApp} from '../src/app.js';import {tokenDigest} from '../src/security.js';import {saveVendor} from '../src/procurement.js';import {connectPostgres} from '../src/postgres.js';
const out='verification-output/purchase-documents/2026-11-19',ids=[],vendorIds=[];fs.mkdirSync(out,{recursive:true});let evidence;
try{await withAuthorizedRdsRollbackVerification(async db=>{
 const users={};for(const [key,role]of [['maker','OWNER'],['reviewer','MANAGER'],['restricted','EXECUTIVE']]){const u=await db.prepare("SELECT id,role FROM users WHERE role=? AND status='ACTIVE' ORDER BY id LIMIT 1").get(role);assert.ok(u);users[key]=u;}
 const sessions={};for(const [key,u]of Object.entries(users)){const token=randomUUID(),csrf=randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${u.id},${tokenDigest(token)},${csrf},now()+interval '1 hour')`;sessions[key]={token,csrf};}
 const app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false,schedulerEnabled:false})});
 try{await app.modules.ready();console.log('RDS verification app ready; transaction will roll back.');
  async function call(who,method,url,body){const s=sessions[who],req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{method,url,headers:{host:'localhost',cookie:`crm_session=${s.token}`,'content-type':'application/json','x-csrf-token':s.csrf},socket:{remoteAddress:'127.0.0.1'}});const res={headersSent:false,setHeader(){},writeHead(status){this.status=status;this.headersSent=true;},end(data){this.body=Buffer.isBuffer(data)?data:Buffer.from(String(data||''));}};await app(req,res);return res;}
  const parsed=r=>JSON.parse(r.body).data;
  const current=parsed(await call('maker','GET','/api/crm/purchase-documents/settings'));
  const config={name:'ZZTEST_ fictional Mehta document fixture',address:'ZZTEST_ fictional address',contact:'ZZTEST_ fictional contact',gstin:'33AAAAA0000A1Z5',stateCode:'33',showListPriceDiscount:true,documents:Object.fromEntries(['RFQ','PO'].map(k=>[k,{create:'purchasing.write',approve:'purchasing.approve',download:'purchasing.read',send:'purchasing.write',prefix:`ZZTEST_${k}`,allowDraftDownload:false}]))};
  const configured=await call('maker','PUT','/api/crm/purchase-documents/settings',{version:current.version,value:config,reason:'ZZTEST_ rollback document configuration'});assert.equal(configured.status,200);
  for(const stateCode of ['33','19']){const v=await saveVendor(db,null,{name:`ZZTEST_ document supplier ${stateCode}`,stateCode,gstin:`${stateCode}AAAAA0000A1Z5`,address:'ZZTEST_ fictional vendor address',reason:'ZZTEST_ rollback fixture'},users.maker);vendorIds.push(v.id);}
  const line={partCode:'ZZTEST_PART',description:'ZZTEST_ fictional test component',make:'ZZTEST_MAKE',quantity:'2',uom:'NOS',hsn:'00000000',unitPrice:'100',discountPercent:'60',taxPercent:'18'};
  const base={date:'2026-11-18',responseDeadline:'2026-11-25',requestedTerms:{},deliveryDate:'2026-11-30',billTo:'ZZTEST_ bill to',shipTo:'ZZTEST_ ship to',paymentTerms:'ZZTEST_ payment text',freightPacking:'ZZTEST_ freight text',signatory:'ZZTEST_ signatory',terms:'ZZTEST_ fixture terms only',roundToRupee:false,lines:[line],reason:'ZZTEST_ rollback document verification'};
  const results=[];
  for(const [kind,vendorId]of [['RFQ',vendorIds[0]],['PO',vendorIds[0]],['PO',vendorIds[1]]]){
   console.log('Checking RDS document workflow:',kind);const body={...base,kind,vendorId,requestKey:randomUUID()},created=await call('maker','POST','/api/crm/purchase-documents',body);assert.equal(created.status,201);let doc=parsed(created);ids.push(doc.id);
   const replay=await call('maker','POST','/api/crm/purchase-documents',body);assert.equal(parsed(replay).id,doc.id);
   if(kind==='RFQ'){
    assert.equal((await call('restricted','POST','/api/crm/purchase-documents',{...body,requestKey:randomUUID()})).status,403);
    assert.equal((await call('restricted','POST',`/api/crm/purchase-documents/${doc.id}/pdf`,{version:doc.version,reason:base.reason})).status,403);
    assert.equal((await call('maker','PUT',`/api/crm/purchase-documents/${doc.id}`,{...body,version:doc.version,date:'2027-04-01',responseDeadline:'2027-04-05'})).status,422);
    const unchanged=parsed(await call('maker','GET',`/api/crm/purchase-documents/${doc.id}`));assert.equal(unchanged.number,doc.number);assert.equal(unchanged.version,doc.version);
   }
   if(kind==='PO'){
    assert.equal((await call('maker','POST','/api/crm/purchase-documents',{...body,requestKey:randomUUID(),lines:[{...line,discountPercent:'100.000001'}]})).status,422);
   }
   const draft=await call('maker','POST',`/api/crm/purchase-documents/${doc.id}/pdf`,{version:doc.version,reason:base.reason});assert.equal(draft.status,409);
   if(kind==='PO'){assert.equal(doc.payload.totals.total,'94.40');assert.equal(doc.payload.lines[0].netRate,'40.00');assert.equal(doc.payload.totals.igst,vendorId===vendorIds[1]?'14.40':'0.00');}
   const submitted=await call('maker','POST',`/api/crm/purchase-documents/${doc.id}/actions`,{action:'SUBMIT',version:doc.version,reason:base.reason});assert.equal(submitted.status,200);doc=parsed(submitted);
   assert.equal((await call('restricted','POST',`/api/crm/purchase-documents/${doc.id}/actions`,{action:'APPROVE',version:doc.version,reason:base.reason})).status,403);
   assert.equal((await call('reviewer','POST',`/api/crm/purchase-documents/${doc.id}/actions`,{action:'APPROVE',version:doc.version-1,reason:base.reason})).status,409);
   assert.equal((await call('maker','POST',`/api/crm/purchase-documents/${doc.id}/actions`,{action:'APPROVE',version:doc.version,reason:base.reason})).status,403);
   assert.equal((await call('restricted','GET',`/api/crm/purchase-documents/${doc.id}`)).status,403);
   const approved=await call('reviewer','POST',`/api/crm/purchase-documents/${doc.id}/actions`,{action:'APPROVE',version:doc.version,reason:base.reason});assert.equal(approved.status,200);doc=parsed(approved);
   assert.equal((await call('maker','PUT',`/api/crm/purchase-documents/${doc.id}`,{...body,version:doc.version})).status,409);
   const pdf=await call('maker','POST',`/api/crm/purchase-documents/${doc.id}/pdf`,{version:doc.version,reason:base.reason});assert.equal(pdf.status,200);assert.equal(pdf.body.subarray(0,4).toString(),'%PDF');
   if(vendorId!==vendorIds[1]){const sent=await call('maker','POST',`/api/crm/purchase-documents/${doc.id}/actions`,{action:'MARK_SENT',version:doc.version,reason:base.reason,confirmSent:true});assert.equal(sent.status,200);assert.equal(parsed(sent).status,'SENT');}
   results.push({kind,vendorId,id:doc.id,draftDownload:409,selfApproval:403,independentApproval:200,pdfBytes:pdf.body.length,total:doc.payload.totals?.total});
  }
  const events=await db.prepare("SELECT action,count(*) AS n FROM audit_logs WHERE entity='PURCHASE_DOCUMENT' AND reason=? GROUP BY action ORDER BY action").all(base.reason);assert.ok(events.some(e=>e.action==='PDF_DOWNLOAD'));assert.ok(events.some(e=>e.action==='MARK_SENT'));
  const savedSettings=parsed(configured);const changed=await call('maker','PUT','/api/crm/purchase-documents/settings',{version:savedSettings.version,value:{...config,documents:{...config.documents,RFQ:{...config.documents.RFQ,allowDraftDownload:true}}},reason:base.reason});assert.equal(changed.status,200);
  const oldSent=parsed(await call('maker','GET',`/api/crm/purchase-documents/${ids[0]}`));assert.equal((await call('maker','POST',`/api/crm/purchase-documents/${ids[0]}/pdf`,{version:oldSent.version,reason:base.reason})).status,200);
  const staleApproved=parsed(await call('maker','GET',`/api/crm/purchase-documents/${ids[2]}`));assert.equal((await call('maker','POST',`/api/crm/purchase-documents/${ids[2]}/pdf`,{version:staleApproved.version,reason:base.reason})).status,409);
  const draftBody={...base,kind:'RFQ',vendorId:vendorIds[0],requestKey:randomUUID(),date:'2027-04-01',responseDeadline:'2027-04-05'};const future=await call('maker','POST','/api/crm/purchase-documents',draftBody);assert.equal(future.status,201);const draftDoc=parsed(future);ids.push(draftDoc.id);assert.ok(draftDoc.number.includes('/2027-28/000001'));
  const enabledDraft=await call('maker','POST',`/api/crm/purchase-documents/${draftDoc.id}/pdf`,{version:draftDoc.version,reason:base.reason,preview:true});assert.equal(enabledDraft.status,200);
  const conflict=await call('maker','POST','/api/crm/purchase-documents',{...draftBody,lines:[{...line,quantity:'3'}]});assert.equal(conflict.status,409);
  const list=await call('maker','GET','/api/crm/purchase-documents?kind=RFQ&page=1&search=ZZTEST');assert.equal(list.status,200);assert.equal(JSON.parse(list.body).pagination.pageSize,25);assert.equal(JSON.parse(list.body).data.length,2);
  evidence={at:new Date().toISOString(),status:'PASS',results,events,restrictedCreateDownloadApprove:403,staleApprovalVersion:409,approvedDocumentEdit:409,invalidDiscount:422,crossFinancialYearEdit:422,crossYearFailurePreservesNumberAndVersion:true,draftDownloadWhenExplicitlyEnabled:200,staleApprovedSettingsDownload:409,sentSnapshotPreservedAfterSettingsChange:200,retryPayloadMismatch:409,newFinancialYearNumber:draftDoc.number,pagination:true,scope:'Real authenticated app handlers and existing RDS, outer rollback; MFA disabled for isolated test app only, no network send'};
 }finally{await app.close();}
});
 const sql=connectPostgres(getConfig().databaseUrl);try{for(const record of ids)assert.equal((await sql`SELECT id FROM purchase_documents WHERE id=${record}`).length,0);for(const record of vendorIds)assert.equal((await sql`SELECT id FROM crm_procurement_vendors WHERE id=${record}`).length,0);}finally{await sql.end({timeout:5});}
 fs.writeFileSync(out+'/api-rollback-verification.json',JSON.stringify({...evidence,cleanup:'PASS - all temporary documents and vendors absent; settings rolled back; identity sequences may advance'},null,2));console.log('PASS: purchasing document API, PDF, approval, permissions, audit and rollback cleanup.');
}catch(e){console.error('Purchasing document verification failed:',e.name,e.message?.slice(0,300));process.exitCode=1;}
