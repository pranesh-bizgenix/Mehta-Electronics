import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createConnectorStore,connectorConnectionState} from '../src/connector-store.js';
import {tallyInitialSyncMonitor} from '../src/tally-sync-monitor.js';

const connector={id:'VERIFY-connector',expected_company_name:'VERIFY-Mehta'};
const body={companyName:'VERIFY-Mehta',syncId:'VERIFY-package',syncFrom:'2023-04-01',syncTo:'2024-03-31'};
function protocol({chunks=[],prior={id:'VERIFY-session',sync_job_id:'VERIFY-job'},knownGuid=null}={}){
 const calls=[];
 const db=async(strings,...values)=>{
  const text=strings.join('?');calls.push({text,values});
  if(text.includes('SELECT tally_guid'))return knownGuid?[{tally_guid:knownGuid}]:[];
  if(text.includes('SELECT id,sync_job_id'))return prior?[prior]:[];
  if(text.includes('SELECT field_name'))return chunks;
  if(text.includes('SELECT id,status'))return [];
  throw new Error('Unexpected write/query in resumable path: '+text);
 };
 db.json=v=>v;
 return {db,calls};
}
test('retry resumes exact connector/package scope and reports only contiguous chunks',async()=>{
 const {db,calls}=protocol({chunks:[{field_name:'vouchersXml',n:28,first:0,last:27},{field_name:'stockXml',n:2,first:1,last:2}]});
 const result=await createConnectorStore({}, {database:db}).start(connector,body);
 assert.deepEqual(result,{sessionId:'VERIFY-session',syncJobId:'VERIFY-job',receivedChunks:{vouchersXml:28}});
 const query=calls.find(c=>c.text.includes('SELECT id,sync_job_id'));
 for(const scope of ['connector_id=','sync_id=','company_name=','sync_from=','sync_to=','company_guid IS NOT DISTINCT','collection_metadata=','read_request_ids='])assert.ok(query.text.includes(scope));
 assert.ok(query.values.includes(connector.id));assert.ok(query.values.includes(body.syncId));
 assert.equal(calls.some(c=>c.text.includes('INSERT')),false);
});
test('resume cannot bypass explicit missing job or company identity validation',async()=>{
 const {db}=protocol();
 await assert.rejects(createConnectorStore({}, {database:db}).start(connector,{...body,syncJobId:'VERIFY-other-job'}),{status:404});
 await assert.rejects(createConnectorStore({}, {database:db}).start(connector,{...body,companyName:'VERIFY-other-company'}),{status:422});
 const different=protocol({knownGuid:'VERIFY-company-guid'});
 await assert.rejects(createConnectorStore({}, {database:different.db}).start(connector,body),{status:422});
});
test('recent upload activity prevents stale heartbeat being labelled offline; revoked wins',()=>{
 const now=Date.now(),c={status:'active',last_seen_at:new Date(now-900000),heartbeat_at:new Date(now-900000),upload_progress_at:new Date(now-1000)};
 assert.equal(connectorConnectionState(c,now),'uploading');
 assert.equal(connectorConnectionState({...c,status:'revoked'},now),'revoked');
 assert.equal(connectorConnectionState({...c,upload_progress_at:new Date(now-900000)},now),'offline');
});
test('first import progress requires Tally read and returns metadata without a company selection',async()=>{
 let calls=0;const db={prepare:query=>({all:async()=>{calls++;assert.ok(!/SELECT\s+\*|token_hash|\bcontent\b/.test(query));return [];}})};
 await assert.rejects(tallyInitialSyncMonitor(db,{role:'EXECUTIVE'}));assert.equal(calls,0);
 const result=await tallyInitialSyncMonitor(db,{role:'OWNER'});
 assert.equal(calls,3);assert.deepEqual(result.uploads,[]);assert.deepEqual(result.connectors,[]);assert.deepEqual(result.jobs,[]);
});
for(const mode of ['new','same-retry','changed-retry'])test(`chunk integrity and bounded transfer: ${mode}`,async()=>{
 const queries=[];
 const db=async(strings,...values)=>{
  const text=strings.join('?');queries.push(text);
  if(text.includes("status='stored'"))return [];
  if(text.includes("status='receiving'"))return [{id:'VERIFY-session'}];
  if(text.startsWith('INSERT INTO tally_upload_chunks'))return mode==='new'?[{sequence:0}]:[];
  if(text.includes(' AS matches'))return [{matches:mode==='same-retry'}];
  if(text.startsWith('UPDATE tally_sync_jobs'))return [];
  throw new Error('Unexpected query '+text);
 };
 const operation=createConnectorStore({}, {database:db}).append(connector,{sessionId:'VERIFY-session',field:'vouchersXml',sequence:0,content:'VERIFY-source'});
 if(mode==='changed-retry')await assert.rejects(operation,{status:409});else await operation;
 assert.equal(queries.some(q=>q.startsWith('SELECT content FROM')),false);
 assert.equal(queries.some(q=>q.includes(' AS matches')),mode!=='new');
});
