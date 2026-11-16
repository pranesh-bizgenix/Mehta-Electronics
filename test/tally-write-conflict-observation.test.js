import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {test} from 'node:test';
import {XMLParser} from 'fast-xml-parser';
import {withTestTransaction} from '../test-support/transaction.js';
import {transportFixture} from '../test-support/tally-write-transport-fixture.js';
import {TallyWriteReview} from '../src/modules/tally-write/review.js';
const success='<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><ERRORS>0</ERRORS></RESPONSE>';

test('normal imported mapped values match a confirmed snapshot; differences create one audited conflict without rewriting Tally',()=>withTestTransaction(async db=>{
 const f=await transportFixture(db);await f.queue();const {job}=await f.claim();await f.service.authorize(f.connector,f.leaseBody(job));
 await f.service.result(f.connector,{...f.leaseBody(job),responseXml:success,readbackXml:f.found(job.idempotencyKey)});
 const review=new TallyWriteReview(db),record=new XMLParser({parseTagValue:false}).parse(f.found(job.idempotencyKey)).ENVELOPE.BODY.DATA.COLLECTION.VOUCHER;
 const imported=async(raw)=>{
  const id='ZZTEST_'+crypto.randomBytes(10).toString('hex');
  await db.sql`INSERT INTO tally_visibility_records(id,company_id,entity,record_key,session_id,name,raw_record,fields,content_hash,observed_at) VALUES(${id},${f.company.id},'vouchers','ZZTEST_created_key',${f.session},'ZZTEST confirmed document',${db.sql.json(raw)},tally_flatten_fields(${db.sql.json(raw)},'/xml')||jsonb_build_object('/stored/tally_guid','ZZTEST_created_voucher'),${id},clock_timestamp())`;
 };
 await imported(record);
 assert.equal((await review.reconcile(f.maker,f.company.id,'ZZTEST compare delivered normal import')).results[0].status,'MATCH');
 await imported({...record,AMOUNT:'-35.41'});
 const mismatch=await review.reconcile(f.maker,f.company.id,'ZZTEST review changed delivered amount');assert.equal(mismatch.results[0].status,'MISMATCH');
 assert.equal((await review.reconcile(f.maker,f.company.id,'ZZTEST repeated review uses open conflict')).results[0].conflictId,mismatch.results[0].conflictId);
 assert.equal((await db.sql`SELECT count(*) AS n FROM tw_conflict_observations WHERE outbox_id=${job.id}`)[0].n,1);
 assert.equal((await review.job(f.maker,f.company.id,job.id)).status,'CONFIRMED');
}));
