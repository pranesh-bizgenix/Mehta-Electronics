import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {writeFixture} from '../test-support/tally-write-fixture.js';
import {writeMapping,writeDocument,fixtureReadback} from '../test-support/tally-write-data.js';
import {TallyWriteService} from '../src/modules/tally-write/service.js';
import {verifyCompany,readback,queries} from '../src/modules/tally-write/verification.js';
import {randomUUID} from 'node:crypto';

test('producer stays inactive with flags OFF; reviewed fixture dry-run is atomic/idempotent and requires independent push approval',()=>withTestTransaction(async db=>{
  const f=await writeFixture(db),service=new TallyWriteService(db);
  let sourceCalls=0;
  service.sources={company:async()=>({id:f.company,name:'VERIFY-Write Company',guid:'VERIFY-write_company_guid'}),validateMappingImports:async()=>[],document:async()=>{sourceCalls++;return {...writeDocument,createdBy:f.maker.id,updatedBy:f.maker.id,approvedBy:f.checker.id,entityType:'SALES_ORDER'};}};
  await service.setControl(f.maker,{masterEnabled:false,reason:'VERIFY- explicit disabled fixture'});
  const body={category:'SALES_ORDER',entityId:'VERIFY-1',reason:'VERIFY- reviewed create preview'};
  assert.deepEqual(await service.queue(f.maker,body),{inactive:true});assert.equal(sourceCalls,0);
  await assert.rejects(service.setCategory(f.maker,'SALES_ORDER',{enabled:true,reason:'VERIFY- missing settings'}),/Not set/);
  const draft=await service.saveMapping(f.maker,{companyId:f.company,category:'SALES_ORDER',configuration:writeMapping,status:'DRAFT',reason:'VERIFY- explicit synthetic mapping draft'});
  const evidence=await service.mappingDrafts.evidence(f.checker,f.company,draft.id);
  const mapping=await service.saveMapping(f.checker,{companyId:f.company,category:'SALES_ORDER',parentVersionId:draft.id,sourceFingerprint:evidence.source_fingerprint,requestKey:randomUUID(),expertName:'VERIFY- Tally expert',expertReference:'VERIFY- retained fixture review',status:'APPROVED',reason:'VERIFY- independent synthetic mapping approval'});
  await service.setControl(f.maker,{masterEnabled:true,approvalMode:'SEPARATE_PUSH_APPROVAL',reason:'VERIFY- transaction-only dry-run control'});
  await service.setCategory(f.maker,'SALES_ORDER',{enabled:true,dry_run_only:true,company_id:f.company,mapping_id:mapping.id,conflict_winner:{mapped_record:'TALLY',total:'CRM',partyLedgerName:'TALLY',date:'TALLY',number:'TALLY'},tally_version:'VERIFY- fixture',xml_import_verified:true,max_attempts:2,backoff_seconds:1,failure_threshold:2,min_gap_seconds:1,per_day_cap:2,lease_seconds:30,reason:'VERIFY- complete fixture dry-run settings'});
  const first=await service.queue(f.maker,body);assert.equal(first.dryRun,true);assert.match(first.xml,/ACTION="Create"/);
  const second=await service.queue(f.maker,body);assert.equal(second.id,first.id);assert.equal(second.replay,true);
  assert.equal((await db.sql`SELECT count(*) AS n FROM tw_outbox WHERE company_id=${f.company}`)[0].n,1);
  await assert.rejects(service.approve(f.maker,f.company,first.id,{reason:'VERIFY- self approval'}),{status:403});
  const approved=await service.approve(f.checker,f.company,first.id,{reason:'VERIFY- independent dry-run review'});assert.equal(approved.status,'APPROVED');assert.equal(approved.dry_run,true);
  await service.setControl(f.maker,{masterEnabled:false,reason:'VERIFY- kill switch'});
  assert.equal((await service.job(f.maker,f.company,first.id)).status,'HELD');
}));

test('company and read-back evidence require exact IDs, correct totals and a real collection response',()=>{
  const company={name:'VERIFY- Company',guid:'VERIFY-guid'},key='a'.repeat(64);
  const companyXml='<ENVELOPE><BODY><DATA><COLLECTION><COMPANY NAME="VERIFY- Company"><GUID>VERIFY-guid</GUID></COMPANY></COLLECTION></DATA></BODY></ENVELOPE>';
  assert.equal(verifyCompany(companyXml,company),true);assert.throws(()=>verifyCompany(companyXml,{...company,guid:'VERIFY-wrong'}),/mismatch/);
  const xml=fixtureReadback(key);
  const args={key,mapping:writeMapping,document:writeDocument,category:'SALES_ORDER'};
  assert.equal(readback(xml,args).found,true);assert.throws(()=>readback(xml.replace('-35.40','-35.41'),args),/differs/);
  assert.throws(()=>readback(xml.replace('<PARTYLEDGERNAME>VERIFY- A &amp; &lt;B&gt;</PARTYLEDGERNAME>','<PARTYLEDGERNAME>VERIFY- Other party</PARTYLEDGERNAME>'),args),/differs/);
  assert.throws(()=>readback(xml.replace('<AMOUNT>-35.40</AMOUNT>','<AMOUNT>invalid</AMOUNT>'),args),/invalid exact decimal/);
  assert.throws(()=>readback('<ENVELOPE/>',args),/lacks collection evidence/);
  assert.throws(()=>readback(xml.replace('</COLLECTION>',`<VOUCHER><GUID>VERIFY-second</GUID><REFERENCE>${key}</REFERENCE><AMOUNT>-35.40</AMOUNT></VOUCHER></COLLECTION>`),args),/Multiple/);
  const q=queries({company,mapping:writeMapping,key,category:'SALES_ORDER'});assert.match(q.readbackXml,/Export Data/);assert.equal(q.readbackXml.includes('Import Data'),false);
});
