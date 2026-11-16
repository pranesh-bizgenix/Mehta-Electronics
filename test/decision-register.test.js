import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {DecisionService,usableSetting} from '../src/modules/decisions/service.js';
import {TransactionRunner,AuditRepository,fingerprint} from '../src/core/runtime.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {testFetch} from '../test-support/http-client.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';

const reason='VERIFY- reviewed CRM decision';
const input=(version,extra={})=>({expectedVersion:version,requestKey:randomUUID(),reason,...extra});
const current=async(service,owner,key)=>(await service.list(owner)).data.find(r=>r.key===key);
test('Owner decision lifecycle is exact, versioned, replay-safe and append-only',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),s=new DecisionService({db}),key='invoice.authority',before=await current(s,f.owner,key);
 for(const actor of [f.manager,f.accounts,f.executive]){await assert.rejects(()=>s.list(actor),{status:403});await assert.rejects(()=>s.enter(actor,key,input(before.version,{value:'TALLY_CREATES',confirm:true})),{status:403});}
 const body=input(before.version,{value:'TALLY_CREATES',confirm:false,evidenceSource:'VERIFY- source section 1'}),entered=await s.enter(f.owner,key,body);
 assert.equal(entered.status,'ENTERED');assert.equal(await s.getSetting(key),null);
 assert.equal((await s.enter(f.owner,key,body)).version,entered.version);
 await assert.rejects(()=>s.enter(f.owner,key,{...body,value:'CRM_CREATES'}),{code:'IDEMPOTENCY_KEY_REUSED'});
 await assert.rejects(()=>s.decide(f.owner,key,input(before.version,{decision:'CONFIRM'})),{code:'DECISION_VERSION_CHANGED'});
 const confirmed=await s.decide(f.owner,key,input(entered.version,{decision:'CONFIRM'}));assert.equal(confirmed.status,'CONFIRMED');assert.equal(confirmed.confirmedBy,f.owner.id);assert.equal((await s.requireSetting(key)).value,'TALLY_CREATES');
 const rejected=await s.decide(f.owner,key,input(confirmed.version,{decision:'REJECT'}));assert.equal(rejected.status,'REJECTED');assert.equal(await s.getSetting(key),null);
 await assert.rejects(()=>s.decide(f.owner,key,input(rejected.version,{decision:'CONFIRM'})),{code:'DECISION_REJECTED'});
 const cleared=await s.decide(f.owner,key,input(rejected.version,{decision:'CLEAR'}));assert.equal(cleared.status,'EMPTY');assert.equal(cleared.value,null);
 await assert.rejects(()=>db.prepare('UPDATE decision_register SET reason=? WHERE decision_key=?').run(reason,key),/append.only|immutable/i);
 await assert.rejects(()=>db.prepare('DELETE FROM decision_register WHERE decision_key=?').run(key),/append.only|immutable/i);
 const history=await s.history(f.owner,key);assert.ok(history.some(r=>r.status==='CONFIRMED'));assert.ok(history.some(r=>r.status==='REJECTED'));
 const audit=await db.prepare("SELECT count(*)::integer AS n FROM audit_logs WHERE entity='DECISION' AND record_id=? AND reason=?").get(key,reason);assert.ok(audit.n>=4);
}));
test('CSV preview/import never confirms and preserves canonical policy until explicit confirmation or clear',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),s=new DecisionService({db}),key='credit.default_limit_new_customer',start=await current(s,f.owner,key);
 const live=await s.enter(f.owner,key,input(start.version,{value:'1000.000001',confirm:true})),old=await s.repository.legacy(key);
 const csv=`key,answer,version,status,evidence_source\r\n${key},"""2000.000001""",${live.version},CONFIRMED,VERIFY- reference\r\n`,plan=await s.previewImport(f.owner,{csv});assert.equal(plan.canImport,true);
 const body={csv,fingerprint:plan.fingerprint,requestKey:randomUUID(),reason},saved=await s.import(f.owner,body);assert.equal(saved.rows[0].status,'ENTERED');assert.equal(saved.rows[0].value,'2000.000001');assert.equal(await s.getSetting(key),null);
 assert.deepEqual(await s.repository.legacy(key),old,'Staging a decision never overwrites the retained canonical business value.');
 assert.equal((await s.import(f.owner,body)).replayed,true);
 const rejected=await s.decide(f.owner,key,input(saved.rows[0].version,{decision:'REJECT'}));assert.deepEqual(await s.repository.legacy(key),old,'Rejecting a candidate leaves the canonical source retained but unusable.');
 await s.decide(f.owner,key,input(rejected.version,{decision:'CLEAR'}));assert.equal((await s.repository.legacy(key)).is_cleared,true);
 const duplicate=await s.previewImport(f.owner,{csv:csv+csv.split('\r\n')[1]+'\r\n'});assert.equal(duplicate.canImport,false);
 const sourceChanged=await s.previewImport(f.owner,{csv});assert.equal(sourceChanged.canImport,false);
 const now=await current(s,f.owner,key),freshCsv=`key,answer,version\n${key},"""3000.000001""",${now.version}\n`,fresh=await s.previewImport(f.owner,{csv:freshCsv});
 await s.enter(f.owner,key,input(now.version,{value:'4000',confirm:false}));
 await assert.rejects(()=>s.import(f.owner,{csv:freshCsv,fingerprint:fresh.fingerprint,requestKey:randomUUID(),reason}),{status:422});
}));
test('unbound or changed canonical rules cannot pass confirmed-only gate and failed audit rolls back everything',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),s=new DecisionService({db}),key='credit.default_limit_new_customer',tx=new TransactionRunner(db);
 await tx.run(f.owner,reason,async()=>{const old=await s.repository.legacy(key);await db.prepare('INSERT INTO business_rule_values(rule_key,version,value,is_cleared,reason,created_by) VALUES(?,?,?::text::jsonb,false,?,?)').run(key,(old?.version??0)+1,JSON.stringify('111.000001'),reason,f.owner.id);});
 assert.equal(await usableSetting(db,key),null,'Existing source values are not automatically confirmed.');
 await s.confirmLegacy(f.owner,key,'111.000001',reason);assert.equal((await s.requireSetting(key)).value,'111.000001');
 await tx.run(f.owner,reason,async()=>{const old=await s.repository.legacy(key);await db.prepare('INSERT INTO business_rule_values(rule_key,version,value,is_cleared,reason,created_by) VALUES(?,?,?::text::jsonb,false,?,?)').run(key,old.version+1,JSON.stringify('222'),reason,f.owner.id);});
 assert.equal(await s.getSetting(key),null,'A changed canonical value needs a fresh Owner confirmation.');
 const drifted=await current(s,f.owner,key);assert.equal(drifted.sourceChanged,true);await assert.rejects(()=>s.decide(f.owner,key,input(drifted.version,{decision:'CONFIRM'})),{code:'DECISION_SOURCE_CHANGED'});
 const before=await current(s,f.owner,key),audit=new AuditRepository(db),broken=new DecisionService({db,audit:{record:async event=>{if(event.entity==='DECISION')throw new Error('VERIFY- audit refused');return audit.record(event);}}});
 await assert.rejects(()=>broken.enter(f.owner,key,input(before.version,{value:'333',confirm:true})),/audit refused/);
 assert.equal((await current(s,f.owner,key)).version,before.version);assert.equal((await s.repository.legacy(key)).value,'222');
 const invoice=await current(s,f.owner,'invoice.authority');
 await assert.rejects(()=>s.bulkDecide(f.owner,{entries:[{key,expectedVersion:before.version},{key:'invoice.authority',expectedVersion:invoice.version+1}],decision:'CLEAR',requestKey:randomUUID(),reason}),{code:'DECISION_VERSION_CHANGED'});
 assert.equal((await current(s,f.owner,key)).version,before.version,'A later row conflict rolls back earlier bulk changes.');
}));
test('decision endpoints enforce real sessions, CSRF, Owner role and safe CSV export',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false})}),fetch=testFetch(app);
 async function headers(actor){const token=randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${actor.id},${tokenDigest(token)},'VERIFY-decision_csrf',now()+interval '1 hour')`;return {cookie:`crm_session=${token}`,'x-csrf-token':'VERIFY-decision_csrf','content-type':'application/json'};}
 try{
  const owner=await headers(f.owner),manager=await headers(f.manager);
  assert.equal((await fetch('http://localhost/api/v1/decisions')).status,401);
  assert.equal((await fetch('http://localhost/api/v1/decisions',{headers:manager})).status,403);
  const list=await fetch('http://localhost/api/v1/decisions',{headers:owner});assert.equal(list.status,200);const body=await list.json();assert.equal(body.summary.total,body.data.length);
  const row=body.data.find(r=>r.key==='invoice.authority'),url='http://localhost/api/v1/decisions/invoice.authority/enter',payload=JSON.stringify(input(row.version,{value:'TALLY_CREATES',confirm:true}));
  assert.equal((await fetch(url,{method:'POST',headers:{cookie:owner.cookie,'content-type':'application/json'},body:payload})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:manager,body:payload})).status,403);
  const saved=await fetch(url,{method:'POST',headers:owner,body:payload});assert.equal(saved.status,200);assert.equal((await saved.json()).data.status,'CONFIRMED');
  const csv=await fetch('http://localhost/api/v1/decisions/sheet',{headers:owner});assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/text\/csv/);assert.ok((await csv.text()).includes('invoice.authority'));
  assert.equal((await fetch('http://localhost/api/v1/decisions/invoice.authority/history',{headers:owner})).status,200);
  assert.equal((await fetch(url,{method:'POST',headers:owner,body:JSON.stringify({...input(row.version,{value:'TALLY_CREATES',confirm:true}),unknown:true})})).status,422);
 }finally{await app.close();installPermissionProvider(null);}
}));
