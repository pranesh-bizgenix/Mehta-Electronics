import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {datasetFreshness,tallyFreshness} from '../src/tally-freshness.js';
import {collectionMetadata} from '../src/tally-collection-metadata.js';
import {withTestTransaction} from '../test-support/transaction.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {createConnectorStore} from '../src/connector-store.js';
import {getConfig} from '../src/config.js';
import crypto from 'node:crypto';

test('freshness never substitutes import time for source time or treats missing/failed/future receipts as current',()=>{
 const now=new Date('2026-11-04T08:00:00Z'),success={processed_at:'2026-11-04T07:00:00Z',status:'imported'};
 const result=datasetFreshness('stockXml',success,success,now);assert.equal(result.ageSeconds,3600);assert.equal(result.sourceTimestamp,null);assert.equal(result.state,'SOURCE_TIME_UNAVAILABLE');
 assert.equal(datasetFreshness('stockXml',{status:'failed'},success,now).state,'LAST_ATTEMPT_INCOMPLETE');
 assert.equal(datasetFreshness('stockXml',null,null,now).ageSeconds,null);
 assert.equal(datasetFreshness('stockXml',success,{processed_at:'2027-01-01'},now).lastSuccessfulSync,null);
});
test('collection evidence validates dates, extraction mode, source times and exact alteration strings',()=>{
 assert.deepEqual(collectionMetadata(),{});
 const row={mode:'ALTER_ID',from:'2026-01-01',to:'2026-11-04',after:'9007199254740993',through:'9007199254740994',capturedAt:'2026-11-04T07:00:00Z',sourceTimestamp:null};
 assert.equal(collectionMetadata({vouchersXml:row}).vouchersXml.after,row.after);
 for(const bad of [{...row,to:'2026-02-30'},{...row,after:'9007199254740995'},{...row,after:1},{...row,mode:'WRITE'},{...row,sourceTimestamp:'bad'}])assert.throws(()=>collectionMetadata({vouchersXml:bad}),{status:422});
 assert.throws(()=>collectionMetadata({arbitrary:row}),{status:422});
});
test('dataset freshness uses the last successful receipt without hiding a later failed attempt and never crosses companies',()=>withTestTransaction(async db=>{
 const a=await tallyFixture(db,'VERIFY-freshness_A'),b=await tallyFixture(db,'VERIFY-freshness_B');
 for(const source of [a,b])await db.sql`INSERT INTO tally_run_datasets(company_id,session_id,dataset,status,processed_at) VALUES(${source.company},${source.session},'stockXml',${source===a?'imported':'failed'},now()-interval '2 hours')`;
 const [own]=await tallyFreshness(db,a.company,['stockXml']);assert.ok(own.lastSuccessfulSync);assert.equal(own.sourceTimestamp,null);
 const [foreign]=await tallyFreshness(db,b.company,['stockXml']);assert.equal(foreign.lastSuccessfulSync,null);assert.equal(foreign.state,'LAST_ATTEMPT_INCOMPLETE');
 const retry=crypto.randomUUID();await db.sql`INSERT INTO tally_upload_sessions(id,connector_id,company_name,sync_from,sync_to,status) VALUES(${retry},${a.connector},'VERIFY-freshness_A','2026-01-01','2026-12-31','failed')`;
 await db.sql`INSERT INTO tally_run_datasets(company_id,session_id,dataset,status,processed_at) VALUES(${a.company},${retry},'stockXml','partial',now())`;
 const [afterFailure]=await tallyFreshness(db,a.company,['stockXml']);assert.equal(afterFailure.lastSuccessfulSync,own.lastSuccessfulSync);assert.equal(afterFailure.state,'LAST_ATTEMPT_INCOMPLETE');assert.equal(afterFailure.latestAttempt.status,'partial');
}));
test('connector stores validated per-collection evidence with the upload audit, and rejects malformed metadata before starting a job',()=>withTestTransaction(async db=>{
 const source=await tallyFixture(db,'VERIFY-metadata_company'),store=createConnectorStore(getConfig(),{database:db.sql});await store.ready();
 try{
  const connector={id:source.connector,expected_company_name:'VERIFY-metadata_company'},body={company:'VERIFY-metadata_company',from:'2026-04-01',to:'2026-11-04',collectionMetadata:{salesOrdersXml:{mode:'DATE_WINDOW',from:'2023-04-01',to:'2026-11-04',capturedAt:'2026-11-04T07:00:00Z',sourceTimestamp:null}}};
  const result=await store.start(connector,body),stored=await db.prepare('SELECT collection_metadata FROM tally_upload_sessions WHERE id=?').get(result.sessionId);assert.equal(stored.collection_metadata.salesOrdersXml.from,'2023-04-01');
  assert.ok(await db.prepare("SELECT id FROM audit_logs WHERE entity='TALLY_UPLOAD' AND record_id=? AND action='SESSION_STARTED'").get(result.sessionId));
  const before=(await db.prepare('SELECT count(*) AS n FROM tally_sync_jobs WHERE connector_id=?').get(source.connector)).n;
  await assert.rejects(store.start(connector,{...body,collectionMetadata:{salesOrdersXml:{mode:'WRITE'}}}),{status:422});
  assert.equal((await db.prepare('SELECT count(*) AS n FROM tally_sync_jobs WHERE connector_id=?').get(source.connector)).n,before);
 }finally{await store.close();}
}));
test('compiled connector verifies alteration filtering, identities, unsafe XML and large exact IDs without starting a service',()=>{
 const result=execFileSync('dotnet',['run','--no-restore','--project','connectors/tally-windows/TallyConnector.Service/TallyConnector.Service.csproj','-c','Release','--','--verify-incremental'],{encoding:'utf8',windowsHide:true});assert.match(result,/PASS: 18 pure incremental checks/);
});
