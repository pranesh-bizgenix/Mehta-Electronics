import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withAuthorizedRdsRollbackVerification} from '../test-support/transaction.js';
import {salesIntakeFixture} from '../test-support/sales-intake-fixture.js';
import {saveQuote,quoteAction,quoteDetail,requireQuotationApproval} from '../src/quotation-workflow.js';
import {requestAvailability,requireAvailability,invalidateAvailability} from '../src/modules/sales-intake/availability.js';
import {installPermissionProvider} from '../src/rbac.js';
import {saveCustomer,decideCustomerOnboarding} from '../src/crm-modules.js';
import {TransactionRunner} from '../src/core/runtime.js';

// No automatic migration, deployment, live policy adoption, outbound delivery,
// additional listener, or committed test fixture is permitted by this verifier.
const output=path.resolve('verification-output/sales-intake'),report={startedAt:new Date().toISOString(),environment:'authorized RDS rollback',transactionMode:'production workflow errors; guarded outer rollback',scenarios:[],cleanup:'NOT_STARTED',limitations:['Independent-connection race verification is separate; Promise.all on the rollback harness is serialized.','Browser checks are reported separately.']};
const check=async(id,description,fn)=>{const started=Date.now();try{const result=await fn();report.scenarios.push({id,description,status:'PASS',elapsedMs:Date.now()-started,...result});console.log('PASS',id,description);}catch(e){report.scenarios.push({id,description,status:'FAIL',elapsedMs:Date.now()-started,error:e.message});throw e;}};
let tag,fixturesStarted=false;
let interrupted=false;for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{interrupted=true;});
try{
 await withAuthorizedRdsRollbackVerification(async db=>{
  const schema=await db.prepare("SELECT to_regclass('crm_sales_intakes')::text AS name").get();
  if(!schema.name)throw new Error('BLOCKED: migration 0063 has not been applied. Obtain a complete verified backup within the unchanged freshness guard, then rerun. No test fixtures were created.');
  const correction=await db.prepare("SELECT name FROM mehta_schema_migrations WHERE name='0064_sales_intake_guard_record_shape.sql'").get();if(!correction)throw new Error('BLOCKED: corrective migration 0064 must be applied through the guarded runner before fixtures can run.');
  const prepare=db.prepare.bind(db);let queries=0;
  db.prepare=statement=>{const prepared=prepare(statement);return Object.fromEntries(['get','all','run'].map(method=>[method,async(...args)=>{if(interrupted||fs.existsSync(path.join(output,'.stop-verification')))throw new Error('Verification interrupted; rolling back fixtures.');const n=++queries;if(n%25===0)console.log('DB PROGRESS',n,method,(statement.match(/\b(?:FROM|INTO|UPDATE)\s+([a-z_]+)/i)?.[1]??'transaction'),new Date().toISOString());return prepared[method](...args);}]))};
  fixturesStarted=true;const f=await salesIntakeFixture(db,{progress:(message,meta)=>{if(meta?.tag){tag=meta.tag;report.fixtureTag=tag;report.fixtureCompany=meta.company;}console.log('SETUP',message);}});tag=f.tag;const {intake,availability}=f.services,{owner,sales,store,otherStore,lead,manager}=f.users,records=[];
  const row=id=>db.prepare('SELECT * FROM crm_sales_intakes WHERE id=?').get(id);
  const warehouse=async(qid)=>{let v=await availability.forQuote(owner,qid);v=await availability.command(lead,v.id,f.company,{action:'ASSIGN',version:v.version,assignedStoreId:store.id,reason:tag+' assign check'});v=await availability.command(store,v.id,f.company,{action:'CHECK',version:v.version,reason:tag+' actual fixture check',lines:v.lines.map(l=>({id:l.id,warehouse:tag+'_warehouse',quantity:l.quantity,evidence:tag+' retained receipt reference'}))});return v;};
  for(let i=0;i<10;i++)await check(`PO-${i+1}`,'Persist PO, one draft, full warehouse request and explainable tier',async()=>{
   const p=f.payload(i),receipt=await intake.receive(f.principal,p),r=await row(receipt.id);assert.equal(r.status,'PREPARED');assert.ok(r.customer_po_id);assert.ok(r.quotation_id);assert.equal(r.classification,'EXISTING');assert.equal(r.tier.tier,i<4?'EARLY_BIRD':'ELITE');assert.equal(r.tier.state,'CLASSIFIED');
   const lines=await db.prepare("SELECT id FROM customer_po_lines WHERE customer_po_id=? AND status='ACTIVE'").all(r.customer_po_id);assert.equal(lines.length,1);const v=await availability.forQuote(owner,r.quotation_id);assert.equal(v.lines.length,1);assert.equal(v.status,'REQUESTED');records.push({p,r});return {intakeId:r.id,quotationId:r.quotation_id,customerPoId:r.customer_po_id,availabilityId:v.id};
  });
  for(const [i,{p,r}]of records.entries())await check(`RETRY-${i+1}`,'Same event/source/business PO reuses records; changed payload conflicts',async()=>{
   assert.equal((await intake.receive(f.principal,p)).id,r.id);
   assert.equal((await intake.receive(f.principal,{...p,eventId:tag+'_retry_'+i,source:{...p.source,messageId:tag+'_resend_'+i}})).id,r.id);
   const changed=structuredClone(p);changed.items[0].quantity='2';await assert.rejects(()=>intake.receive(f.principal,changed),{status:409});
   const count=await db.prepare('SELECT count(*)::integer AS n FROM crm_sales_intakes WHERE company_id=? AND quotation_id=?').get(f.company,r.quotation_id);assert.equal(count.n,1);return {intakeId:r.id};
  });
  const missingCases=[
   ['price',p=>{p.items[0].unitPrice=null;},'QUOTE_PREPARATION:1:unitPrice'],
   ['tax',p=>{p.items[0].gstRate=null;},'QUOTE_PREPARATION:1:gstRate'],
   ['discount',p=>{p.items[0].discount=null;},'QUOTE_PREPARATION:1:discount'],
   ['quantity',p=>{p.items[0].quantity=null;},'MISSING:items.1.quantity'],
   ['HSN',p=>{p.items[0].hsn='9999';},'HSN_REVIEW:1'],
   ['unit',p=>{p.items[0].uom='BOX';},'UNIT_REVIEW:1'],
   ['total',p=>{p.header.totalPoValue='119';},'DECLARED_TOTAL_MISMATCH'],
   ['taxable',p=>{p.items[0].taxableAmount='101';},'TAXABLE_AMOUNT_MISMATCH:1'],
   ['customer',p=>{delete p.header.customerId;p.header.gstin='33XXXXX1234X1Z5';},'CUSTOMER_ONBOARDING_REQUIRED'],
   ['PO date',p=>{delete p.header.poDate;},'MISSING:header.poDate']
  ];
  for(const [i,[label,change,blocker]]of missingCases.entries())await check(`REVIEW-${i+1}`,'Persist incomplete/mismatched '+label+' for review without a quotation',async()=>{
   const p=f.payload(300+i);change(p);const received=await intake.receive(f.principal,p),r=await row(received.id);assert.equal(r.status,'NEEDS_REVIEW');assert.equal(r.quotation_id,null);assert.ok(r.blockers.includes(blocker),JSON.stringify(r.blockers));assert.ok(r.original_payload);return {intakeId:r.id,blocker};
  });
  for(const [i,{r}]of records.entries())await check(`GATES-${i+1}`,'Assigned-only stock checks, financial redaction, independent availability and commercial gates',async()=>{
   await assert.rejects(()=>quoteAction(db,r.quotation_id,{action:'SUBMIT',version:1,reason:tag+' premature submit'},owner),{status:409});
   let v=await warehouse(r.quotation_id);assert.equal(v.status,'READY_FOR_REVIEW');await assert.rejects(()=>availability.detail(otherStore,v.id,f.company),{status:404});
   const safe=await availability.detail(store,v.id,f.company);assert.equal(/"(?:unitPrice|unit_price|cost|margin|total|creditBalance)"/.test(JSON.stringify(safe)),false);
   await assert.rejects(()=>availability.command(store,v.id,f.company,{action:'APPROVE',version:v.version,reason:tag+' Store cannot approve'}),{status:403});
   v=await availability.command(lead,v.id,f.company,{action:'APPROVE',version:v.version,reason:tag+' independent source review'});assert.equal(v.status,'AVAILABILITY_APPROVED');
   await assert.rejects(()=>quoteAction(db,r.quotation_id,{action:'APPROVE',version:1,reason:tag+' Store commercial refusal'},store),{status:403});
   const submitted=await quoteAction(db,r.quotation_id,{action:'SUBMIT',version:1,reason:tag+' submitted after warehouse review'},owner);assert.equal(submitted.status,'PENDING_APPROVAL');
   const approved=await quoteAction(db,r.quotation_id,{action:'APPROVE',version:submitted.version,reason:tag+' independent commercial review'},manager);assert.equal(approved.status,'APPROVED');
   const n=await db.prepare("SELECT count(*)::integer AS n FROM notifications WHERE payload->>'entityType'='QUOTATION' AND payload->>'entityId'=? AND payload->>'type'='AVAILABILITY_APPROVE'").get(String(r.quotation_id));assert.equal(n.n,1);return {quotationId:r.quotation_id,reservations:v.lines.length};
  });
  for(let i=0;i<10;i++)await check(`REQUESTS-${i+1}`,'Quotation request and lead use canonical enquiry without inventing a PO',async()=>{
   const type=i%2?'LEAD_ENQUIRY':'QUOTATION_REQUEST',receipt=await intake.receive(f.principal,f.payload(100+i,type)),r=await row(receipt.id);assert.ok(r.enquiry_id);assert.equal(r.customer_po_id,null);const d=await intake.detail(owner,r.id,f.company);assert.ok(d.first_assigned_at);assert.equal(d.timing.sla,'NOT_CONFIGURED');
   await assert.rejects(()=>intake.respond(sales,r.id,f.company,{version:r.version,responseAction:'OPENED_SCREEN',evidence:tag+' opened',reason:tag+' not a response'}),{status:409});
   const response=await intake.respond(sales,r.id,f.company,{version:r.version,responseAction:'CUSTOMER_RESPONSE_REFERENCE',evidence:tag+' response reference '+i,reason:tag+' qualifying response'});assert.ok(response.first_response_at);assert.equal(new Date(response.first_assigned_at).getTime(),new Date(d.first_assigned_at).getTime());return {intakeId:r.id,enquiryId:r.enquiry_id};
  });
  for(let i=0;i<10;i++)await check(`SHORTAGE-${i+1}`,'Multi-line request preserves short and available lines; stale observations cannot approve',async()=>{
   const p=f.payload(200+i);p.items.push({...p.items[0],lineId:'2',itemId:f.items[1].id,productCode:f.items[1].part_code,quantity:'2000',taxableAmount:'200000'});p.header.totalPoValue='236118';
   const received=await intake.receive(f.principal,p),r=await row(received.id);let v=await warehouse(r.quotation_id);assert.equal(v.lines.length,2);assert.equal(v.lines.find(l=>l.sourceLineId==='1').ready,true);assert.equal(v.lines.find(l=>l.sourceLineId==='2').shortageQuantity,'1000.000000');assert.equal(v.ready,false);
   await assert.rejects(()=>availability.command(lead,v.id,f.company,{action:'APPROVE',version:v.version,reason:tag+' shortage cannot pass'}),{status:409});return {intakeId:r.id,availabilityId:v.id};
  });
  const ops=f.modules.services.operations,controls=await ops.controls(owner,f.customer.id);
  await ops.controls(owner,f.customer.id,{classification:'DO_NOT_QUOTE',creditExempt:false,version:controls.version,reason:tag+' apply restriction'});
  for(let i=0;i<10;i++)await check(`RESTRICTED-${i+1}`,'Restricted customer intake remains visible and cannot prepare or approve a quotation',async()=>{
   const received=await intake.receive(f.principal,f.payload(400+i)),r=await row(received.id);assert.equal(r.classification,'DO_NOT_QUOTE');assert.equal(r.quotation_id,null);assert.ok(r.blockers.includes('DO_NOT_QUOTE'));await assert.rejects(()=>requireQuotationApproval(db,records[i].r.quotation_id),{code:'DO_NOT_QUOTE'});return {intakeId:r.id};
  });
  const restricted=await ops.controls(owner,f.customer.id);await ops.controls(f.users.reviewer,f.customer.id,{classification:'EXISTING',creditExempt:false,version:restricted.version,reason:tag+' independent restriction removal'});
  await check('NEW-CUSTOMER','New PO remains in review until canonical onboarding and independent commercial review',async()=>{
   const p=f.payload(500);delete p.header.customerId;p.header.gstin='33ZZNEW9001Z1Z5';p.header.buyerName=tag+'_new_customer';
   const received=await intake.receive(f.principal,p);let r=await row(received.id);assert.equal(r.classification,'NEW');assert.equal(r.quotation_id,null);
   const c=await saveCustomer(db,null,{name:p.header.buyerName,gstin:p.header.gstin,stateCode:'33',creditLimit:'0',creditDays:0,ownerId:sales.id,reason:tag+' canonical new onboarding'},owner);
   // NOW() in the outer rollback is fixed before this scenario. Preserve the
   // actual later creation chronology, otherwise the harness makes every new
   // customer appear to predate its source request.
   await new TransactionRunner(db).run(owner,tag+' fixture chronology',()=>db.prepare('UPDATE customers SET created_at=clock_timestamp() WHERE id=?').run(c.id));
   let detail=await intake.resolve(owner,r.id,f.company,{version:r.version,resolutions:{customerId:c.id},reason:tag+' confirm newly onboarded identity'});assert.equal(detail.quotation_id,null);assert.ok(detail.blockers.includes('CUSTOMER_APPROVAL_REQUIRED'));
   await decideCustomerOnboarding(db,c.id,{decision:'APPROVE',version:c.onboarding.version,reason:tag+' independent new customer approval'},f.users.reviewer);
   detail=await intake.resolve(owner,r.id,f.company,{version:detail.version,resolutions:{},reason:tag+' prepare after onboarding approval'});assert.equal(detail.classification,'NEW');assert.ok(detail.quotation_id);
   let v=await warehouse(detail.quotation_id);v=await availability.command(lead,v.id,f.company,{action:'APPROVE',version:v.version,reason:tag+' independent new customer warehouse review'});
   const submitted=await quoteAction(db,detail.quotation_id,{action:'SUBMIT',version:1,reason:tag+' new customer commercial submission'},owner);const approved=await quoteAction(db,detail.quotation_id,{action:'APPROVE',version:submitted.version,reason:tag+' independent new customer commercial approval'},manager);assert.equal(approved.status,'APPROVED');return {intakeId:r.id,customerId:c.id,quotationId:approved.id};
  });
  await check('OWNER-EXCEPTION','Only the documented Owner exception permits acknowledged self-approval',async()=>{
   const received=await intake.receive(f.principal,f.payload(501)),r=await row(received.id);let v=await warehouse(r.quotation_id);await availability.command(lead,v.id,f.company,{action:'APPROVE',version:v.version,reason:tag+' independent Owner quote stock review'});
   const submitted=await quoteAction(db,r.quotation_id,{action:'SUBMIT',version:1,reason:tag+' Owner quote submission'},owner);
   await assert.rejects(()=>quoteAction(db,r.quotation_id,{action:'APPROVE',version:submitted.version,reason:tag+' missing acknowledgement'},owner),{status:422});
   const approved=await quoteAction(db,r.quotation_id,{action:'APPROVE',version:submitted.version,ownerSelfApproval:true,reason:tag+' explicit Owner acknowledgement'},owner);assert.equal(approved.status,'APPROVED');
   const source=await quoteDetail(db,approved.id,manager),q=await saveQuote(db,null,{...source,lines:source.lines,reason:tag+' Manager authored draft'},manager);v=await warehouse(q.id);await availability.command(lead,v.id,f.company,{action:'APPROVE',version:v.version,reason:tag+' independent Manager quote stock review'});await quoteAction(db,q.id,{action:'SUBMIT',version:q.version,reason:tag+' Manager submit'},manager);await assert.rejects(()=>quoteAction(db,q.id,{action:'APPROVE',version:q.version,ownerSelfApproval:true,reason:tag+' invalid Manager exception'},manager),{status:403});return {ownerQuotationId:approved.id,managerQuotationId:q.id};
  });
  for(let i=0;i<10;i++)await check(`ATOMIC-${i+1}`,'Audit failure rolls back downstream records; exact retry creates one logical workflow',async()=>{
   const p=f.payload(600+i),original=f.modules.audit.record;
   f.modules.audit.record=async function(event){if(event.entity==='WORK_ITEM')throw new Error(tag+' injected audit failure');return original.call(this,event);};
   try{await assert.rejects(()=>intake.receive(f.principal,p),/injected audit failure/);}finally{f.modules.audit.record=original;}
   const empty=await db.prepare('SELECT count(*)::integer AS n FROM crm_sales_intake_deliveries WHERE company_id=? AND event_id=?').get(f.company,p.eventId);assert.equal(empty.n,0);
   const received=await intake.receive(f.principal,p),again=await intake.receive(f.principal,p);assert.equal(received.id,again.id);const r=await row(received.id);assert.ok(r.quotation_id);return {intakeId:r.id,quotationId:r.quotation_id};
  });
  if(process.argv.includes('--browser')){const {verifySalesIntakeBrowser}=await import('../test-support/sales-intake-browser.js');await verifySalesIntakeBrowser(f,check);}
  await check('STALE-SOURCE','Source older than the explicit fixture policy cannot support an approved decision',async()=>{
   await f.receipt(f.items[0],'1000',{at:new Date(Date.now()-1441*60000).toISOString()});const v=await availability.forQuote(owner,records[0].r.quotation_id);assert.equal(v.ready,false);assert.ok(v.lines.every(l=>l.sourceStatus==='STALE'));await assert.rejects(()=>requireQuotationApproval(db,records[0].r.quotation_id),{status:409});return {quotationId:records[0].r.quotation_id};
  });
  await check('SOURCE-CHANGE','Fresh source change invalidates an approved decision and releases only local holds',async()=>{
   const r=records[0].r;await f.receipt(f.items[0],'900');await assert.rejects(async()=>requireAvailability(db,await db.prepare('SELECT * FROM crm_quotation_workflows WHERE quotation_id=?').get(r.quotation_id)),{status:409});
   let total=0;for(let n=0;n<5;n++){const result=await availability.invalidateStale();total+=result.invalidated;}assert.ok(total>=1);const holds=await db.prepare("SELECT h.id FROM crm_quote_reservations h JOIN crm_quotation_availability_lines l ON l.id=h.availability_line_id JOIN crm_quotation_availability a ON a.id=l.request_id WHERE a.quotation_id=? AND h.status='ACTIVE'").all(r.quotation_id);assert.equal(holds.length,0);return {quotationId:r.quotation_id};
  });
  await check('REVISION','Quotation revision releases the old decision and creates version-specific lines',async()=>{
   const old=await quoteDetail(db,records[1].r.quotation_id,owner);const q=await saveQuote(db,old.id,{...old,version:old.version,lines:old.lines,reason:tag+' revised quantity review'},owner);assert.equal(q.version,old.version+1);const v=await availability.forQuote(owner,q.id);assert.equal(v.quotationVersion,q.version);assert.equal(v.status,'REQUESTED');return {quotationId:q.id,version:q.version};
  });
  report.cleanup='OUTER_ROLLBACK_REQUIRED';
 },{productionTransactions:true});
 report.cleanup='OUTER_TRANSACTION_ROLLED_BACK';
}catch(error){report.error=error.message;report.status=error.message.startsWith('BLOCKED:')?'BLOCKED':error.message.startsWith('Verification interrupted')?'INTERRUPTED':'FAIL';report.cleanup=fixturesStarted?'OUTER_TRANSACTION_ROLLED_BACK':'NO_FIXTURES_CREATED';process.exitCode=1;console.error(report.error);}
finally{
 installPermissionProvider(null);
 if(tag&&report.fixtureCompany)try{await withAuthorizedRdsRollbackVerification(async db=>{const counts=await db.prepare('SELECT (SELECT count(*)::integer FROM users WHERE name LIKE ?) AS users,(SELECT count(*)::integer FROM tally_companies WHERE id=?) AS companies,(SELECT count(*)::integer FROM crm_sales_intakes WHERE company_id=?) AS intakes').get(tag+'%',report.fixtureCompany,report.fixtureCompany);assert.deepEqual(counts,{users:0,companies:0,intakes:0});report.cleanup='OUTER_TRANSACTION_ROLLED_BACK_AND_VERIFIED';report.cleanupCounts=counts;});}catch(e){report.cleanup='CLEANUP_VERIFICATION_FAILED';report.cleanupError=e.message;report.status='FAIL';process.exitCode=1;}
 report.finishedAt=new Date().toISOString();report.status??='PASS';fs.mkdirSync(output,{recursive:true});const evidence=JSON.stringify(report,null,2);fs.writeFileSync(path.join(output,'database-verification.json'),evidence);fs.writeFileSync(path.join(output,'database-'+report.startedAt.replace(/[:.]/g,'-')+'.json'),evidence);console.log(`Evidence: ${path.join(output,'database-verification.json')}`);
}
