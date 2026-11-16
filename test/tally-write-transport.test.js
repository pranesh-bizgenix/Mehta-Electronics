import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {transportFixture} from '../test-support/tally-write-transport-fixture.js';
const success='<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><ERRORS>0</ERRORS></RESPONSE>';

test('leased create happy path is confirmed only by read-back and creates one immutable CRM link',()=>withTestTransaction(async db=>{
  const f=await transportFixture(db);await f.queue();const {job}=await f.claim();assert.ok(job);assert.equal(job.operation,'CREATE');
  assert.equal((await f.claim()).blocked,'ACTIVE_OR_UNCERTAIN_WRITE');
  const authorized=await f.service.authorize(f.connector,f.leaseBody(job));assert.equal(authorized.authorized,true);assert.match(authorized.xml,/ACTION="Create"/);
  const result=await f.service.result(f.connector,{...f.leaseBody(job),responseXml:success,readbackXml:f.found(job.idempotencyKey)});
  assert.equal(result.status,'CONFIRMED');assert.equal((await db.sql`SELECT count(*) AS n FROM tw_document_links WHERE outbox_id=${job.id}`)[0].n,1);
  await assert.rejects(f.service.authorize(f.connector,f.leaseBody(job)),{status:409});
}));
test('old/wrong-company connectors get no jobs and a stale approved document is held before XML can be sent',()=>withTestTransaction(async db=>{
  const f=await transportFixture(db);await f.queue();
  f.service.capabilities.clear();assert.equal((await f.service.connectorConfig(f.connector)).active,false);
  await assert.rejects(f.claim(),{status:403});
  f.service.observeHeartbeat(f.connector,{writeCapability:{protocol:1,version:'1.0.0',createOnly:true},selectedCompany:'ZZTEST_wrong',selectedCompanyGuid:f.company.guid});
  await assert.rejects(f.claim(),{status:403});
  f.service.observeHeartbeat(f.connector,{writeCapability:{protocol:1,version:'1.0.0',createOnly:true},selectedCompany:f.company.name,selectedCompanyGuid:f.company.guid});
  f.state.document={...f.state.document,version:2};assert.equal((await f.claim()).blocked,'STALE_DOCUMENT_OR_MAPPING');
}));
test('a lost response becomes UNKNOWN; read-back-only resolution never authorizes another create',()=>withTestTransaction(async db=>{
  const f=await transportFixture(db);await f.queue();const {job}=await f.claim();await f.service.authorize(f.connector,f.leaseBody(job));
  assert.equal((await f.service.result(f.connector,{...f.leaseBody(job),code:'TIMEOUT_AFTER_SEND'})).status,'UNKNOWN');
  assert.equal((await f.claim()).blocked,'ACTIVE_OR_UNCERTAIN_WRITE');
  await assert.rejects(f.service.approve(f.checker,f.company.id,job.id,{reason:'ZZTEST unsafe blind retry'}),{status:409});
  await f.service.requestReadback(f.checker,f.company.id,job.id,{reason:'ZZTEST inspect uncertain create'});
  const verification=(await f.claim()).job;assert.equal(verification.operation,'VERIFY_ONLY');
  await assert.rejects(f.service.authorize(f.connector,f.leaseBody(verification)),{status:409});
  const resolved=await f.service.result(f.connector,{...f.leaseBody(verification),readbackXml:f.found(job.idempotencyKey)});assert.equal(resolved.status,'CONFIRMED');
}));
test('master kill switch stops pre-send authorization; wrong lease token cannot execute a queued create',()=>withTestTransaction(async db=>{
  const f=await transportFixture(db);await f.queue();const {job}=await f.claim();
  await assert.rejects(f.service.authorize(f.connector,{...f.leaseBody(job),leaseToken:crypto.randomUUID()}),{status:409});
  await f.service.setControl(f.maker,{masterEnabled:false,reason:'ZZTEST stop every pending create'});
  assert.deepEqual(await f.claim(),{inactive:true});await assert.rejects(f.service.authorize(f.connector,f.leaseBody(job)),{status:409});
  assert.equal((await f.service.job(f.maker,f.company.id,job.id)).status,'HELD');
}));
test('created result without matching read-back stays UNKNOWN and never links the CRM record',()=>withTestTransaction(async db=>{
  const f=await transportFixture(db);await f.queue();const {job}=await f.claim();await f.service.authorize(f.connector,f.leaseBody(job));
  const result=await f.service.result(f.connector,{...f.leaseBody(job),responseXml:success});assert.equal(result.status,'UNKNOWN');
  assert.equal((await db.sql`SELECT count(*) AS n FROM tw_document_links WHERE outbox_id=${job.id}`)[0].n,0);
}));
