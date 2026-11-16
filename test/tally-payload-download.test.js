import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EventEmitter} from 'node:events';
import {randomUUID,createHash} from 'node:crypto';
import {downloadRetainedPayload,writePayloadChunks,PAYLOAD_CHUNK_BYTES} from '../src/tally-payload-download.js';
import {withTestTransaction} from '../test-support/transaction.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';
import {testFetch} from '../test-support/http-client.js';

test('payload stream obeys backpressure, bounds its chunks and stops after a disconnected download',async()=>{
 const response=new EventEmitter();let writes=0,pulls=0;
 response.write=()=>{writes++;return writes!==1;};
 async function* chunks(){pulls++;yield Buffer.from('ZZTEST first');pulls++;yield Buffer.from('ZZTEST second');}
 const pending=writePayloadChunks(response,chunks());await new Promise(resolve=>setImmediate(resolve));
 assert.equal(pulls,1);assert.equal(writes,1);response.emit('drain');await pending;assert.equal(writes,2);
 response.destroyed=true;await assert.rejects(()=>writePayloadChunks(response,[Buffer.from('ZZTEST')]),/disconnected/);response.destroyed=false;
 await assert.rejects(()=>writePayloadChunks(response,[Buffer.alloc(PAYLOAD_CHUNK_BYTES+1)]),/Invalid/);
 response.write=()=>false;
 const disconnected=writePayloadChunks(response,[Buffer.from('ZZTEST')]);await new Promise(resolve=>setImmediate(resolve));response.emit('close');await assert.rejects(disconnected,/disconnected/);
 assert.equal(response.listenerCount('drain'),0);assert.equal(response.listenerCount('error'),0);assert.equal(response.listenerCount('close'),0);
 await assert.rejects(()=>writePayloadChunks(response,[Buffer.from('ZZTEST')],{drainTimeoutMs:5}),/time limit/);
 const abort=new AbortController(),aborted=writePayloadChunks(response,[Buffer.from('ZZTEST')],{signal:abort.signal});await new Promise(resolve=>setImmediate(resolve));abort.abort(new Error('ZZTEST deadline'));await assert.rejects(aborted,/ZZTEST deadline/);
 assert.equal(response.listenerCount('drain'),0);assert.equal(response.listenerCount('close'),0);
});

test('an interrupted payload handler rolls back and releases its connection even when rollback itself fails (protocol spy)',async()=>{
 const company=randomUUID(),payload=randomUUID(),statements=[];let released=false,fetches=0,destroyed=false;
 const response=new EventEmitter();Object.assign(response,{headersSent:false,writeHead(){this.headersSent=true;},write(){setImmediate(()=>this.emit('close'));return false;},destroy(){destroyed=true;this.destroyed=true;},end(){assert.fail('An interrupted XML must not be ended as a successful attachment.');}});
 const protocol={
  async withConnection(run){try{return await run();}finally{released=true;}},
  async exec(sql){statements.push(sql);if(sql==='ROLLBACK')throw new Error('ZZTEST already closed connection');},
  prepare(sql){statements.push(sql);return {
   async get(){if(sql.startsWith('SELECT id,name'))return {id:company,name:'ZZTEST download'};if(sql.startsWith('SELECT id,octet_length'))return {id:payload,bytes:6};if(sql.startsWith('FETCH')){fetches++;return {chunk:Buffer.from('ZZTEST')};}throw new Error('Unexpected protocol statement.');},
   async all(){assert.ok(sql.startsWith('DECLARE'));return [];}
  };}
 };
 await assert.rejects(()=>downloadRetainedPayload(protocol,new URL(`http://localhost/api/tally/retained/payloads/${payload}/download?companyId=${company}`),payload,{id:1,role:'OWNER'},response),/disconnected/);
 assert.equal(fetches,1);assert.equal(released,true);assert.equal(destroyed,true);assert.ok(statements.includes('ROLLBACK'));assert.ok(statements.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
});

test('large retained XML downloads exactly through both aliases with session, financial and company checks',()=>withTestTransaction(async db=>{
 const a=await tallyFixture(db,'ZZTEST payload A'),b=await tallyFixture(db,'ZZTEST payload B'),payloadId=randomUUID();
 // Above the former 16MiB ceiling, with multibyte characters crossing byte slices.
 const content='<ENVELOPE>ZZTEST '+('₹अ🙂'.repeat(1800000))+'</ENVELOPE>',original=Buffer.from(content);
 assert.ok(original.length>16777216);
 const digest=createHash('sha256').update(original).digest('hex');
 await db.sql`INSERT INTO tally_raw_payloads(id,company_id,session_id,dataset,content_hash,content) VALUES(${payloadId},${a.company},${a.session},'vouchersXml',${digest},${content})`;
 const headers={};
 for(const role of ['OWNER','ACCOUNTS','MANAGER','EXECUTIVE','STORE_STAFF']){
  const token=randomUUID(),[person]=await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(${`ZZTEST payload ${role}`},${`ZZTEST_payload_${role}@example.test`},${role},'not-a-login',0) RETURNING id`;
  await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${person.id},${tokenDigest(token)},'ZZTEST csrf',now()+interval '1 hour')`;
  headers[role]={cookie:`crm_session=${token}`};
 }
 const app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false})}),fetch=testFetch(app);
 const base=`/api/tally/retained/payloads/${payloadId}/download`;
 try{
  assert.equal((await fetch(`${base}?companyId=${a.company}`)).status,401);
  for(const role of ['MANAGER','EXECUTIVE','STORE_STAFF'])assert.equal((await fetch(`${base}?companyId=${a.company}`,{headers:headers[role]})).status,403);
  assert.equal((await fetch(base,{headers:headers.OWNER})).status,422);
  assert.equal((await fetch(`${base}?companyId=${a.company}&companyId=${b.company}`,{headers:headers.OWNER})).status,422);
  assert.equal((await fetch(`${base}?companyId=${b.company}`,{headers:headers.OWNER})).status,404);
  assert.equal((await fetch(`/api/tally/retained/payloads/invalid/download?companyId=${a.company}`,{headers:headers.OWNER})).status,422);
  for(const [prefix,role]of [['/api/tally','OWNER'],['/api/v1/tally','ACCOUNTS']]){
   const response=await fetch(`${prefix}/retained/payloads/${payloadId}/download?companyId=${a.company}`,{headers:headers[role]});
   assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-disposition'),/^attachment; filename="tally-payload-[a-f0-9-]+\.xml"$/);assert.equal(response.headers.get('content-length'),String(original.length));
   const actual=Buffer.from(await response.arrayBuffer());assert.equal(actual.length,original.length);assert.equal(createHash('sha256').update(actual).digest('hex'),digest);
  }
  assert.equal((await db.sql`SELECT content_hash FROM tally_raw_payloads WHERE id=${payloadId}`)[0].content_hash,digest);
 }finally{await app.close();installPermissionProvider(null);}
}));
