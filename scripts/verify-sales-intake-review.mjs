import fs from 'node:fs';
import assert from 'node:assert/strict';
import {withAuthorizedRdsRollbackVerification} from '../test-support/transaction.js';
import {salesIntakeFixture} from '../test-support/sales-intake-fixture.js';
import {installPermissionProvider} from '../src/rbac.js';

// Explicit RDS opt-in and the existing outer rollback are mandatory. No Make
// scenario, live company policy, connector, migration or deployment is changed.
const report={startedAt:new Date().toISOString(),checks:[],cleanup:'NOT_STARTED'};
let tag,company;
const check=async(name,fn)=>{await fn();report.checks.push({name,status:'PASS'});console.log('PASS',name);};
try{
 await withAuthorizedRdsRollbackVerification(async db=>{
  const f=await salesIntakeFixture(db,{progress:(message,meta)=>{if(meta?.tag){tag=meta.tag;company=meta.company;}console.log(message);}}),service=f.services.intake,{owner,store}=f.users;
  const p=f.payload('review');delete p.header.poDate;p.items[0].unitPrice=null;
  const received=await service.receive(f.principal,p);
  let detail=await service.detail(owner,received.id,f.company);
  const original=JSON.stringify(detail.original_payload);
  await check('Missing PO date and price remain in review without a quotation',async()=>{assert.equal(detail.status,'NEEDS_REVIEW');assert.equal(detail.quotation_id,null);assert.ok(detail.blockers.includes('MISSING:header.poDate'));});
  await check('Unauthorised staff cannot save corrections',()=>assert.rejects(()=>service.resolve(store,detail.id,f.company,{version:detail.version,reason:f.tag+' unauthorised',resolutions:{}}),{status:403}));
  const oldVersion=detail.version;
  await check('First correction persists separately and retains unresolved checks',async()=>{
   detail=await service.resolve(owner,detail.id,f.company,{version:detail.version,reason:f.tag+' confirm original PO date',resolutions:{header:{poDate:'2026-11-23',contactPerson:'ZZTEST confirmed contact'}}});
   assert.equal(detail.resolutions.header.contactPerson,'ZZTEST confirmed contact');assert.equal(detail.quotation_id,null);assert.equal(detail.status,'NEEDS_REVIEW');assert.equal(JSON.stringify(detail.original_payload),original);
  });
  await check('Stale correction is refused without overwriting saved fields',()=>assert.rejects(()=>service.resolve(owner,detail.id,f.company,{version:oldVersion,reason:f.tag+' stale request',resolutions:{header:{contactPerson:'ZZTEST stale'}}}),{status:409}));
  await check('Follow-up header correction preserves earlier fields',async()=>{
   detail=await service.resolve(owner,detail.id,f.company,{version:detail.version,reason:f.tag+' verify customer phone',resolutions:{header:{phone:'12345'}}});
   assert.equal(detail.resolutions.header.contactPerson,'ZZTEST confirmed contact');assert.equal(detail.resolutions.header.poDate,'2026-11-23');assert.equal(detail.resolutions.header.phone,'12345');
  });
  await check('Correct price creates one eligible draft and warehouse request',async()=>{
   const items=structuredClone(detail.normalized.items);items[0].unitPrice='100';
   detail=await service.resolve(owner,detail.id,f.company,{version:detail.version,reason:f.tag+' price verified from original',resolutions:{items}});
   assert.equal(detail.status,'PREPARED',JSON.stringify(detail.blockers));assert.ok(detail.quotation_id);assert.ok(detail.customer_po_id);assert.equal(JSON.stringify(detail.original_payload),original);
   const availability=await f.services.availability.forQuote(owner,detail.quotation_id);assert.equal(availability.status,'REQUESTED');
  });
  const quoteId=detail.quotation_id;
  await check('Refresh reuses the linked quotation and never auto-approves it',async()=>{
   detail=await service.resolve(owner,detail.id,f.company,{version:detail.version,reason:f.tag+' refresh existing checks',resolutions:{}});
   assert.equal(detail.quotation_id,quoteId);
   const quote=await db.prepare('SELECT status FROM crm_quotation_workflows WHERE quotation_id=?').get(quoteId);assert.equal(quote.status,'DRAFT');
   const count=await db.prepare('SELECT count(*)::integer AS n FROM crm_quotation_workflows WHERE quotation_id=?').get(quoteId);assert.equal(count.n,1);
  });
  await check('An existing quotation cannot be silently changed through intake',()=>assert.rejects(()=>service.resolve(owner,detail.id,f.company,{version:detail.version,reason:f.tag+' prohibited rewrite',resolutions:{header:{phone:'98765'}}}),{status:409}));
  await check('Review events retain reason and field names without source contents in audit metadata',async()=>{
   const events=await db.prepare("SELECT detail FROM crm_sales_intake_events WHERE intake_id=? AND action='REVIEWED'").all(detail.id);
   assert.equal(events.length,4);assert.ok(events.some(e=>e.detail.correctedFields.includes('header')));
   const audits=await db.prepare("SELECT new_value FROM audit_logs WHERE entity='SALES_INTAKE' AND record_id=? AND action='REVIEWED'").all(detail.id);
   assert.ok(audits.length>=4);assert.equal(JSON.stringify(audits).includes('ZZTEST confirmed contact'),false);
  });
 },{productionTransactions:true});
 report.cleanup='OUTER_TRANSACTION_ROLLED_BACK';
}catch(error){report.error=error.message;report.status='FAIL';report.cleanup='OUTER_TRANSACTION_ROLLED_BACK';console.error(error.message);process.exitCode=1;}
finally{
 installPermissionProvider(null);
 if(tag&&company)try{await withAuthorizedRdsRollbackVerification(async db=>{const counts=await db.prepare('SELECT (SELECT count(*)::integer FROM users WHERE name LIKE ?) AS users,(SELECT count(*)::integer FROM crm_sales_intakes WHERE company_id=?) AS intakes,(SELECT count(*)::integer FROM tally_companies WHERE id=?) AS companies').get(tag+'%',company,company);assert.deepEqual(counts,{users:0,intakes:0,companies:0});report.cleanup='ROLLBACK_VERIFIED';});}catch(e){report.status='FAIL';report.cleanup='VERIFICATION_FAILED';report.cleanupError=e.message;process.exitCode=1;}
 report.status??='PASS';report.finishedAt=new Date().toISOString();fs.mkdirSync('verification-output/sales-intake/review',{recursive:true});fs.writeFileSync('verification-output/sales-intake/review/database.json',JSON.stringify(report,null,2));
}
