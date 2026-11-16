import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {withTestTransaction} from '../test-support/transaction.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';

test('sync monitor scopes evidence, distinguishes unknown queues and gates audited read/retry requests',()=>withTestTransaction(async db=>{
 const a=await tallyFixture(db,'VERIFY-Monitor A'),b=await tallyFixture(db,'VERIFY-Monitor B'),jobs=[];
 for(const source of [a,b]){
  const job=crypto.randomUUID();jobs.push(job);
  await db.sql`INSERT INTO tally_sync_jobs(id,connector_id,company_name,status,message) VALUES(${job},${source.connector},${source===a?'VERIFY-Monitor A':'VERIFY-Monitor B'},'failed',${source===a?'VERIFY-A_failure':'VERIFY-B_failure'})`;
  await db.sql`INSERT INTO tally_raw_payloads(id,company_id,session_id,dataset,content_hash,content) VALUES(${crypto.randomUUID()},${source.company},${source.session},'godownsXml','VERIFY-hash','<ENVELOPE>VERIFY- original</ENVELOPE>')`;
  await db.sql`INSERT INTO tally_run_datasets(company_id,session_id,dataset,status,processed_at) VALUES(${source.company},${source.session},'godownsXml','imported',now())`;
 }
 const users=[];for(const role of ['OWNER','MANAGER','EXECUTIVE','STORE_STAFF']){
  const id=(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(${`VERIFY-monitor_${role}`},${`VERIFY-monitor_${role}@example.test`},${role},'not-a-login',0) RETURNING id`)[0].id;
  const token=crypto.randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${id},${tokenDigest(token)},'VERIFY-csrf',now()+interval '1 hour')`;users.push({id,role,token});
 }
 const app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false})}),path='/api/v1/tally/monitor';
 const call=async(url,{user=users[0],method='GET',csrf=true,body={}}={})=>{
  const req=Readable.from(method==='GET'?[]:[Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,url,headers:{host:'localhost','content-type':'application/json',...(user?{cookie:`crm_session=${user.token}`}:{}) ,...(csrf?{'x-csrf-token':'VERIFY-csrf'}:{})},socket:{remoteAddress:'test'}});
  const res={headersSent:false,setHeader(){},writeHead(n){this.status=n;this.headersSent=true;},end(value){this.body=JSON.parse(String(value));}};await app(req,res);return res;
 };
 try{
  assert.equal((await call(path,{user:null})).status,401);assert.equal((await call(`${path}?companyId=${a.company}`,{user:users[2]})).status,403);assert.equal((await call(`${path}?companyId=${a.company}`,{user:users[3]})).status,403);
  assert.equal((await call(path)).status,422);assert.equal((await call(`${path}?companyId=${a.company}&companyId=${b.company}`)).status,422);
  const before=await call(`${path}?companyId=${a.company}`);assert.equal(before.status,200);assert.equal(before.body.jobs.length,1);assert.equal(before.body.jobs[0].id,jobs[0]);assert.equal(before.body.uploads[0].deliveryState,'RETAINED_PAYLOADS');assert.equal(before.body.uploads[0].indexState,'DATASET_RECEIPTS_AVAILABLE');assert.equal(before.body.queue.connectorLocalQueueDepth,null);assert.equal(before.body.queue.pendingReadRequests,0);assert.ok(!JSON.stringify(before.body).includes('VERIFY-B'));assert.ok(!JSON.stringify(before.body).includes('token_hash'));
  const action=`${path}/request-read?companyId=${a.company}`;
  assert.equal((await call(action,{method:'POST',csrf:false,body:{reason:'VERIFY- manual read'}})).status,403);
  assert.equal((await call(action,{method:'POST',body:{reason:''}})).status,422);
  const queued=await call(action,{method:'POST',body:{reason:'VERIFY- manual read'}});assert.equal(queued.status,202);assert.equal(queued.body.status,'REQUESTED');
  const again=await call(action,{method:'POST',body:{reason:'VERIFY- second click'}});assert.equal(again.body.id,queued.body.id);assert.equal(again.body.alreadyRequested,true);
  assert.equal((await call(`${path}/jobs/${jobs[1]}/retry?companyId=${a.company}`,{method:'POST',body:{reason:'VERIFY- retry'}})).status,404);
  assert.equal((await call(`${path}/jobs/${jobs[0]}/retry?companyId=${a.company}`,{method:'POST',body:{reason:''}})).status,422);
  const retry=await call(`${path}/jobs/${jobs[0]}/retry?companyId=${a.company}`,{method:'POST',body:{reason:'VERIFY- retry'}});assert.equal(retry.status,202);assert.equal(retry.body.id,queued.body.id);
  const manager=await call(`${path}?companyId=${a.company}`,{user:users[1]});assert.equal(manager.status,200);assert.equal(manager.body.capabilities.payloads,false);
  assert.equal((await call(`/api/v1/tally/retained/payloads?companyId=${a.company}`,{user:users[1]})).status,403);
  assert.equal((await db.sql`SELECT count(*) AS n FROM audit_logs WHERE entity='TALLY_READ_REQUEST' AND record_id=${queued.body.id}`)[0].n,1);
 }finally{await app.close();installPermissionProvider(null);}
}));
