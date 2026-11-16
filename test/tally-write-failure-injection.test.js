import assert from 'node:assert/strict';
import {test} from 'node:test';
import crypto from 'node:crypto';
import {withTestTransaction} from '../test-support/transaction.js';
import {transportFixture} from '../test-support/tally-write-transport-fixture.js';
import {buildCreate} from '../src/modules/tally-write/xml.js';
import {writeDocument,writeMapping} from '../test-support/tally-write-data.js';
const success='<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><ERRORS>0</ERRORS></RESPONSE>';

for(const category of ['PURCHASE_ORDER','PARTY_LEDGER'])test(`${category} create is independently reviewed and confirmed once; five result replays never create another link`,()=>withTestTransaction(async db=>{
 const f=await transportFixture(db,category);await f.queue();const {job}=await f.claim();assert.ok(job);
 await f.service.authorize(f.connector,f.leaseBody(job));
 const body={...f.leaseBody(job),responseXml:success,readbackXml:f.found(job.idempotencyKey)};
 assert.equal((await f.service.result(f.connector,body)).status,'CONFIRMED');
 for(let i=0;i<5;i++)assert.equal((await f.service.result(f.connector,body)).replay,true);
 assert.equal((await db.sql`SELECT count(*) AS n FROM tw_document_links WHERE outbox_id=${job.id}`)[0].n,1);
}));

test('identity collision, malformed absence, changed party and changed quantity block send or confirmation',()=>withTestTransaction(async db=>{
 const f=await transportFixture(db);await f.queue();const {job}=await f.claim();
 await assert.rejects(f.service.authorize(f.connector,{...f.leaseBody(job),identityProbeXml:'<ENVELOPE><COLLECTION><VOUCHER><GUID>VERIFY-existing</GUID></VOUCHER></COLLECTION></ENVELOPE>'}),/existing Tally identity/);
 await assert.rejects(f.service.authorize(f.connector,{...f.leaseBody(job),readbackXml:'<ENVELOPE/>'}),/lacks collection/);
 await f.service.authorize(f.connector,f.leaseBody(job));
 const result=await f.service.result(f.connector,{...f.leaseBody(job),responseXml:success,readbackXml:f.found(job.idempotencyKey).replace('3 NOS','4 NOS')});
 assert.equal(result.status,'UNKNOWN');assert.equal((await db.sql`SELECT count(*) AS n FROM tw_document_links WHERE outbox_id=${job.id}`)[0].n,0);
}));

test('expired unsent lease is reclaimable; expired authorized lease becomes UNKNOWN and is never automatically retried',()=>withTestTransaction(async db=>{
 const f=await transportFixture(db);await f.queue();const first=(await f.claim()).job;
 await f.service.work(f.maker,'VERIFY- inject expired pre-send lease',()=>f.service.change("UPDATE tw_outbox SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=?",first.id));
 const second=(await f.claim()).job;assert.equal(second.id,first.id);assert.notEqual(second.leaseToken,first.leaseToken);
 await assert.rejects(f.service.authorize(f.connector,f.leaseBody(first)),{status:409});
 await f.service.authorize(f.connector,f.leaseBody(second));
 await f.service.work(f.maker,'VERIFY- inject crash after send authorization',()=>f.service.change("UPDATE tw_outbox SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=?",second.id));
 assert.equal((await f.claim()).blocked,'ACTIVE_OR_UNCERTAIN_WRITE');assert.equal((await f.service.job(f.maker,f.company.id,second.id)).status,'UNKNOWN');
}));

test('pre-send failures open the configured breaker; independent review and explicit resume recover without changing the snapshot',()=>withTestTransaction(async db=>{
 const f=await transportFixture(db);await f.queue();let job=(await f.claim()).job;
 assert.equal((await f.service.result(f.connector,{...f.leaseBody(job),code:'TALLY_UNAVAILABLE'})).paused,false);
 await f.service.approve(f.checker,f.company.id,job.id,{reason:'VERIFY- independent clear pre-send failure review'});
 await f.service.work(f.maker,'VERIFY- advance fixture backoff',()=>f.service.change("UPDATE tw_outbox SET available_at=clock_timestamp()-interval '1 second' WHERE id=?",job.id));
 job=(await f.claim()).job;assert.ok(job);
 assert.equal((await f.service.result(f.connector,{...f.leaseBody(job),code:'PRE_SEND_FAILURE'})).paused,true);
 assert.deepEqual(await f.claim(),{inactive:true});
 // Recovery only changes breaker state, never silently approves or sends a job.
 const {TallyWriteReview}=await import('../src/modules/tally-write/review.js');const review=new TallyWriteReview(db);
 assert.equal((await review.resume(f.checker,'SALES_ORDER',{reason:'VERIFY- outage investigated and resolved'})).paused,false);
 assert.equal((await f.service.job(f.maker,f.company.id,job.id)).status,'FAILED');
}));

test('discount XML is blocked until the Owner maps its field and exact totals remain decimal strings',()=>{
 const document={...writeDocument,total:'31.86',lines:[{...writeDocument.lines[0],discountPercent:'10'}]},args={category:'SALES_ORDER',document,company:{name:'VERIFY- Company',guid:'VERIFY-guid'},idempotencyKey:'a'.repeat(64)};
 assert.throws(()=>buildCreate({...args,mapping:writeMapping}),/inventory.discount/);
 const output=buildCreate({...args,mapping:{...writeMapping,inventory:{...writeMapping.inventory,discount:'DISCOUNT'}}});
 assert.match(output.xml,/<DISCOUNT>10<\/DISCOUNT>/);assert.match(output.xml,/<AMOUNT>-31\.860000<\/AMOUNT>/);
});

test('a client crash during the authorization request is recorded as UNKNOWN even when the server has not authorized the lease',()=>withTestTransaction(async db=>{
 const f=await transportFixture(db);await f.queue();const {job}=await f.claim();
 assert.equal((await f.service.result(f.connector,{...f.leaseBody(job),code:'CRASH_AFTER_AUTHORIZATION'})).status,'UNKNOWN');
 assert.equal((await f.claim()).blocked,'ACTIVE_OR_UNCERTAIN_WRITE');
}));

test('automatic business-approval producer retains original authorship and records the actual triggering reviewer without self-approval',()=>withTestTransaction(async db=>{
 const f=await transportFixture(db);
 const result=await f.service.queue(f.checker,{category:'SALES_ORDER',entityId:'VERIFY-1',reason:'VERIFY- automatic post-commit business approval'},{internal:true});
 const job=await f.service.job(f.maker,f.company.id,result.id);
 assert.equal(job.status,'APPROVED');assert.equal(job.created_by,f.maker.id);assert.equal(job.approved_by,f.checker.id);
 assert.equal(job.validation_report.producedBy,f.checker.id);assert.equal(job.validation_report.automaticProducer,true);
 assert.equal(job.events[0].actor_id,f.checker.id);
}));

test('two capable connector contenders cannot claim the same job in the serialized rollback harness',()=>withTestTransaction(async db=>{
 const f=await transportFixture(db),other={...f.connector,id:crypto.randomUUID()};
 await db.sql`INSERT INTO tally_connectors(id,profile_name,expected_company_name,token_hash) VALUES(${other.id},'VERIFY-second_writer',${f.company.name},'VERIFY-not_an_access_token')`;
 f.service.observeHeartbeat(other,{writeCapability:{protocol:1,version:'1.0.0',createOnly:true},selectedCompany:f.company.name,selectedCompanyGuid:f.company.guid});
 await f.queue();const results=await Promise.all([f.claim(),f.service.claim(other,{companyId:f.company.id})]);
 assert.equal(results.filter(r=>r.job).length,1);assert.equal(results.filter(r=>r.blocked==='ACTIVE_OR_UNCERTAIN_WRITE').length,1);
}));

test('confirmed writes obey the configured rolling cap and minimum gap before another version can be claimed',()=>withTestTransaction(async db=>{
 const f=await transportFixture(db);await f.queue();const {job}=await f.claim();await f.service.authorize(f.connector,f.leaseBody(job));await f.service.result(f.connector,{...f.leaseBody(job),responseXml:success,readbackXml:f.found(job.idempotencyKey)});
 f.state.document={...f.state.document,version:2};await f.queue();
 await f.service.work(f.maker,'VERIFY- inject explicit rate-limit conditions',()=>f.service.change("UPDATE tw_categories SET per_day_cap=1,min_gap_seconds=60,last_sent_at=clock_timestamp() WHERE category='SALES_ORDER'"));
 assert.equal((await f.claim()).blocked,'ROLLING_24_HOUR_CAP');
 await f.service.work(f.maker,'VERIFY- release cap while retaining minimum gap',()=>f.service.change("UPDATE tw_categories SET per_day_cap=5 WHERE category='SALES_ORDER'"));
 assert.equal((await f.claim()).blocked,'MINIMUM_SEND_GAP');
}));

test('UNKNOWN absence needs authenticated read-back and a different Owner manual inspection before fresh approval',()=>withTestTransaction(async db=>{
 const f=await transportFixture(db);await f.queue();const {job}=await f.claim();await f.service.authorize(f.connector,f.leaseBody(job));await f.service.result(f.connector,{...f.leaseBody(job),code:'TIMEOUT_AFTER_SEND'});
 await assert.rejects(f.service.resolveAbsent(f.checker,f.company.id,job.id,{reason:'VERIFY- no proof yet',confirmManualTallyInspection:true}),{status:409});
 await f.service.requestReadback(f.checker,f.company.id,job.id,{reason:'VERIFY- verify absence only'});const verify=(await f.claim()).job;
 assert.equal((await f.service.result(f.connector,{...f.leaseBody(verify)})).code,'VERIFIED_KEY_ABSENT');
 await assert.rejects(f.service.resolveAbsent(f.maker,f.company.id,job.id,{reason:'VERIFY- creator cannot resolve',confirmManualTallyInspection:true}),{status:403});
 await f.service.resolveAbsent(f.checker,f.company.id,job.id,{reason:'VERIFY- independent manual inspection complete',confirmManualTallyInspection:true});
 const held=await f.service.job(f.checker,f.company.id,job.id);assert.equal(held.status,'HELD');assert.equal(held.approved_by,null);assert.equal(held.sent_at,null);
}));
