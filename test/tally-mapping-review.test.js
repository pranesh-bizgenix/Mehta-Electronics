import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {writeFixture} from '../test-support/tally-write-fixture.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {writeMapping,writeDocument} from '../test-support/tally-write-data.js';
import {TallyWriteService} from '../src/modules/tally-write/service.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {testFetch} from '../test-support/http-client.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';

test('retained mapping drafts replay safely, require independent Owner and expert, and never enable switches or queue jobs',()=>withTestTransaction(async db=>{
 const f=await writeFixture(db),service=new TallyWriteService(db),review=service.mappingDrafts;
 service.sources.validateMappingImports=async()=>[];
 service.sources.document=async()=>({...writeDocument,entityType:'SALES_ORDER',createdBy:f.maker.id,updatedBy:f.maker.id,approvedBy:f.checker.id});
 const plan=await review.candidates(f.maker,f.company,'SALES_ORDER'),body={companyId:f.company,category:'SALES_ORDER',configuration:writeMapping,sourceFingerprint:plan.sourceFingerprint,requestKey:crypto.randomUUID(),reason:'ZZTEST reviewed source draft'};
 const draft=await review.draft(f.maker,body);assert.equal(draft.status,'DRAFT');assert.equal((await review.draft(f.maker,body)).id,draft.id);
 await assert.rejects(review.draft(f.maker,{...body,reason:'ZZTEST changed replay'}),{status:409});
 const draftProof=await review.evidence(f.checker,f.company,draft.id),approval={companyId:f.company,category:'SALES_ORDER',parentVersionId:draft.id,sourceFingerprint:draftProof.source_fingerprint,requestKey:crypto.randomUUID(),expertName:'ZZTEST named Tally expert',expertReference:'ZZTEST human review reference',reason:'ZZTEST independent mapping review'};
 await assert.rejects(service.saveMapping(f.maker,{companyId:f.company,category:'SALES_ORDER',configuration:writeMapping,status:'APPROVED',reason:'ZZTEST old bypass denied'}),{status:422});
 await assert.rejects(review.approved(f.maker,approval),{status:403});
 await assert.rejects(review.approved(f.checker,{...approval,expertName:''}),{status:422});
 const preview=await review.preview(f.maker,{companyId:f.company,mappingId:draft.id,entityId:'1',reason:'ZZTEST draft XML with all writes OFF'});assert.equal(preview.ready,true);assert.match(preview.xml,/ACTION="Create"/);
 const approved=await review.approved(f.checker,approval);assert.equal(approved.status,'APPROVED');assert.equal(approved.parent_version_id,draft.id);assert.equal((await review.approved(f.checker,approval)).id,approved.id);
 const proof=await review.evidence(f.checker,f.company,approved.id);assert.equal(proof.expert_name,'ZZTEST named Tally expert');assert.equal(proof.source_fingerprint,draftProof.source_fingerprint);
 await review.requireApproved(approved);
 assert.equal((await service.control()).master_enabled,false);assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM tw_outbox WHERE company_id=?').get(f.company)).count,0);
 for(const row of await db.prepare('SELECT enabled,dry_run_only,mapping_id FROM tw_categories').all()){assert.equal(row.enabled,false);assert.equal(row.dry_run_only,true);assert.equal(row.mapping_id,null);}
 await assert.rejects(db.sql`UPDATE tw_mapping_evidence SET expert_name='ZZTEST changed' WHERE mapping_id=${approved.id}`,/append-only/);
 await assert.rejects(db.sql`DELETE FROM tw_mapping_evidence WHERE mapping_id=${approved.id}`,/forbidden/);
}));

test('source drift, wrong company and audit-stage failures cannot promote or retain a misleading mapping',()=>withTestTransaction(async db=>{
 const f=await writeFixture(db),other=await tallyFixture(db,'ZZTEST Other mapping company'),service=new TallyWriteService(db),review=service.mappingDrafts;
 await db.sql`UPDATE tally_companies SET tally_guid='ZZTEST_other_company_guid' WHERE id=${other.company}`;
 await f.insert('tally_ledgers',{id:'ZZTEST_mapping_ledger_A',name:'ZZTEST Same source name',tally_guid:'ZZTEST_guid_A'});
 await other.insert('tally_ledgers',{id:'ZZTEST_mapping_ledger_B',name:'ZZTEST Same source name',tally_guid:'ZZTEST_guid_B'});
 const plan=await review.candidates(f.maker,f.company,'SALES_ORDER');assert.ok(plan.sources.some(row=>row.guid==='ZZTEST_guid_A'));assert.equal(plan.sources.some(row=>row.guid==='ZZTEST_guid_B'),false);
 const body={companyId:f.company,category:'SALES_ORDER',configuration:{},sourceFingerprint:plan.sourceFingerprint,requestKey:crypto.randomUUID(),reason:'ZZTEST retain incomplete source draft'},draft=await review.draft(f.maker,body);
 const missing=await review.preview(f.maker,{companyId:f.company,mappingId:draft.id,entityId:'1',reason:'ZZTEST incomplete preview'});assert.equal(missing.ready,false);assert.equal(missing.xml,null);
 await assert.rejects(review.preview(f.maker,{companyId:other.company,mappingId:draft.id,entityId:'1',reason:'ZZTEST wrong scope'}),{status:404});
 await assert.rejects(review.draft(f.maker,{...body,companyId:other.company,requestKey:crypto.randomUUID()}),{status:409});
 await f.insert('tally_ledgers',{id:'ZZTEST_mapping_new_source',name:'ZZTEST New retained source',tally_guid:'ZZTEST_new_guid'});
 await assert.rejects(review.approved(f.checker,{companyId:f.company,category:'SALES_ORDER',parentVersionId:draft.id,sourceFingerprint:plan.sourceFingerprint,requestKey:crypto.randomUUID(),expertName:'ZZTEST expert',expertReference:'ZZTEST source changed',reason:'ZZTEST stale promotion'}),{status:409});
 const fresh=await review.candidates(f.maker,f.company,'SALES_ORDER'),count=(await db.prepare('SELECT count(*)::integer AS count FROM tw_mapping_versions WHERE company_id=?').get(f.company)).count,retain=review.retain;
 review.retain=async()=>{throw new Error('ZZTEST evidence audit-stage failure');};
 await assert.rejects(review.draft(f.maker,{...body,sourceFingerprint:fresh.sourceFingerprint,requestKey:crypto.randomUUID()}),/audit-stage failure/);review.retain=retain;
 assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM tw_mapping_versions WHERE company_id=?').get(f.company)).count,count);
}));

test('mapping review HTTP routes require actual Owner, session, CSRF and selected company without a connector token fallback',()=>withTestTransaction(async db=>{
 const f=await writeFixture(db),[manager]=await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('ZZTEST_mapping_manager','ZZTEST_mapping_manager@example.test','MANAGER','not-a-login',0) RETURNING id,role`,tokens=new Map();
 for(const actor of [f.maker,manager]){const token=crypto.randomUUID();tokens.set(actor.id,token);await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${actor.id},${tokenDigest(token)},'ZZTEST_mapping_csrf',now()+interval '1 hour')`;}
 const app=createApp({db,config:getConfig({localReviewAccess:false,mfaEnabled:false})}),fetch=testFetch(app);
 const call=async(path,actor=f.maker,method='GET',body,csrf='ZZTEST_mapping_csrf')=>{const response=await fetch(path,{method,headers:{'content-type':'application/json',...(actor?{cookie:`crm_session=${tokens.get(actor.id)}`,'x-csrf-token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
 try{
  const path=`/api/tally-write/mapping-candidates?companyId=${f.company}&category=SALES_ORDER`;
  assert.equal((await call(path,null)).status,401);assert.equal((await call(path,manager)).status,403);assert.equal((await call('/api/tally-write/mapping-candidates?category=SALES_ORDER')).status,422);
  assert.equal((await call(path+`&companyId=${f.company}`)).status,422);
  const plan=(await call(path)).body.data,body={companyId:f.company,category:'SALES_ORDER',configuration:{},sourceFingerprint:plan.sourceFingerprint,requestKey:crypto.randomUUID(),reason:'ZZTEST HTTP draft'};
  assert.equal((await call('/api/tally-write/mapping-drafts',f.maker,'POST',body,'wrong')).status,403);assert.equal((await call('/api/tally-write/mapping-drafts',manager,'POST',body)).status,403);
  const draft=await call('/api/tally-write/mapping-drafts',f.maker,'POST',body);assert.equal(draft.status,200);const id=draft.body.data.id;
  assert.equal((await call(`/api/tally-write/mappings/${id}/evidence?companyId=${f.company}`)).status,200);
  const preview=await call(`/api/tally-write/mappings/${id}/review-preview`,f.maker,'POST',{companyId:f.company,entityId:'1',reason:'ZZTEST HTTP blocked preview'});assert.equal(preview.status,200);assert.equal(preview.body.data.ready,false);
  for(const suffix of ['review-preview','review-approve']){assert.equal((await call(`/api/tally-write/mappings/${id}/${suffix}`,null,'POST',{reason:'ZZTEST denied'})).status,401);assert.equal((await call(`/api/tally-write/mappings/${id}/${suffix}`,manager,'POST',{reason:'ZZTEST denied'})).status,403);}
 }finally{await app.close();installPermissionProvider(null);}
}));
