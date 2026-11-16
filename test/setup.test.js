import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {test} from 'node:test';
import {SetupRepository,SetupService} from '../src/modules/admin/setup-service.js';
import {recordBackupReceipt} from '../src/migration-backup.js';
import {withTestTransaction} from '../test-support/transaction.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';

const now=new Date('2026-11-03T09:00:00Z');
const ready=id=>({id,name:`ZZTEST_${id}`,role:'OWNER',status:'ACTIVE',must_change_password:0,mfa_enabled:true});
function fixture() {
  const state={people:[ready(1),ready(2)],mapping:{total:1,linked:1},cost:{total:1,configured:1},policy:{revision:1},connectors:[{status:'active',last_seen_at:now.toISOString(),last_sync_at:now.toISOString(),heartbeat_at:now.toISOString(),tally_available:true,selected_company:'ZZTEST_company',expected_company_name:'ZZTEST_company'}],roles:[{key:'OWNER',requires_mfa:true}],rules:[{key:'margin.floor_percent',label:'ZZTEST Rule',configured:true}],backup:{new_value:JSON.stringify({database:'mehta_electronics_local',createdAt:now.toISOString(),size:1,sha256:'a'.repeat(64)})}};
  const access={mfaEnabled:true,can:()=>true,require:()=>{},requiresMfa:()=>true};
  const repository={mappings:async()=>state.mapping,costs:async()=>state.cost,policy:async()=>state.policy,connectors:async()=>state.connectors,roles:async()=>state.roles,backup:async()=>state.backup};
  const service=new SetupService({repository,users:{list:async()=>state.people},access,rules:{list:async()=>state.rules},clock:{now:()=>now}});
  return {state,access,service};
}

test('setup blocks every non-Owner even with broad permission grants, before reading state',async()=>{
  const {service}=fixture();
  for(const role of ['MANAGER','EXECUTIVE','ACCOUNTS','LOGISTICS_LEAD','STORE_STAFF','ADMIN'])await assert.rejects(service.read({role}),{status:403});
});

test('setup reports current readiness, exact repair links and live gaps without inventing defaults',async()=>{
  const {state,access,service}=fixture();
  const read=()=>service.read({id:1,role:'OWNER'});
  let result=await read();assert.equal(result.readyCount,10);assert.equal(result.total,10);
  assert.equal(result.rows.find(r=>r.key==='policy').href,'/quotations?tool=policy');
  assert.equal(result.rows.find(r=>r.key==='costs').href,'/quotations?tool=costs');
  assert.ok(result.rows.every(r=>r.href.startsWith('/')&&!r.href.startsWith('//')));
  state.people=[ready(1)];state.mapping={total:2,linked:1};state.cost={total:2,configured:0};state.policy=null;
  state.connectors[0].heartbeat_at=new Date(now.getTime()-181000).toISOString();
  state.rules[0].configured=false;state.backup=null;access.mfaEnabled=false;
  result=await read();assert.equal(result.readyCount,0);
  assert.match(result.rows.find(r=>r.key==='customers').detail,/1 of 2/);
  assert.match(result.rows.find(r=>r.key==='backup').detail,/No valid verified/);
  state.mapping={total:0,linked:0};state.cost={total:0,configured:0};
  result=await read();assert.equal(result.rows.find(r=>r.key==='items').status,'NEEDS_ATTENTION');
  state.backup={new_value:'invalid JSON'};assert.equal((await read()).rows.find(r=>r.key==='backup').status,'NEEDS_ATTENTION');
});

test('setup distinguishes stale/future backups, wrong selected company and unenrolled MFA accounts',async()=>{
  const {state,service}=fixture(),read=()=>service.read({id:1,role:'OWNER'});
  const receipt=JSON.parse(state.backup.new_value);
  for(const date of [new Date(now.getTime()-600001),new Date(now.getTime()+1000)]) {
    state.backup.new_value=JSON.stringify({...receipt,createdAt:date.toISOString()});
    assert.equal((await read()).rows.find(r=>r.key==='backup').status,'NEEDS_ATTENTION');
  }
  state.people[1].mfa_enabled=false;
  state.connectors[0].selected_company='ZZTEST_wrong_company';
  const result=await read();
  for(const key of ['connector','mfa','reviewers','staff'])assert.equal(result.rows.find(r=>r.key===key).status,'NEEDS_ATTENTION');
});

test('retained quotation policy cannot report ready without its current confirmed margin decision',async()=>{
  const {state,service}=fixture(),read=async()=>(await service.read({id:1,role:'OWNER'})).rows.find(row=>row.key==='policy');
  assert.equal((await read()).status,'READY');
  state.rules[0].configured=false;
  let row=await read();assert.equal(row.status,'NEEDS_ATTENTION');assert.equal(row.href,'/decisions?key=margin.floor_percent');assert.match(row.detail,/awaits Owner confirmation/);
  state.rules=[];assert.equal((await read()).status,'NEEDS_ATTENTION');
  state.policy=null;row=await read();assert.equal(row.href,'/quotations?tool=policy');
});

test('setup HTTP and repository use live database state; backup receipts are recorded and fixtures roll back',()=>withTestTransaction(async db=>{
  const create=async(role,suffix)=>({role,id:(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(${`ZZTEST_setup_${suffix}`},${`ZZTEST_setup_${suffix}@example.test`},${role},'not-a-login',0) RETURNING id`)[0].id});
  const owner=await create('OWNER','owner'),manager=await create('MANAGER','manager');
  const tokens=new Map();
  for(const person of [owner,manager]) {const token=crypto.randomUUID();tokens.set(person.id,token);await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${person.id},${tokenDigest(token)},'ZZTEST_csrf',now()+interval '1 hour')`;}
  const app=createApp({db,config:getConfig({mfaEnabled:false})});
  async function request(actor) {
    const req=Readable.from([]);Object.assign(req,{method:'GET',url:'/api/v1/setup',headers:{host:'localhost',...(actor?{cookie:`crm_session=${tokens.get(actor.id)}`}: {})},socket:{remoteAddress:'test'}});
    const res={status:0,headersSent:false,setHeader(){},writeHead(s){this.status=s;this.headersSent=true;},end(v){this.body=JSON.parse(String(v));}};
    await app(req,res);return res;
  }
  try {
    assert.equal((await request(null)).status,401);assert.equal((await request(manager)).status,403);
    const response=await request(owner);assert.equal(response.status,200);assert.equal(response.body.data.rows.length,10);
    const repo=new SetupRepository(db),before=await repo.mappings('items');
    const item=(await db.sql`INSERT INTO items(part_code,description,uom,created_by,updated_by) VALUES('ZZTEST_SETUP_ITEM','ZZTEST setup item','NOS',${owner.id},${owner.id}) RETURNING id`)[0].id;
    const after=await repo.mappings('items');assert.equal(after.total,before.total+1);assert.equal(after.linked,before.linked);
    const cost=await repo.costs();assert.ok(cost.total>=1);assert.ok(cost.configured<cost.total);
    const receipt={database:'mehta_electronics_local',file:'ZZTEST_setup_receipt.dump',createdAt:new Date().toISOString(),size:12,sha256:'b'.repeat(64)};
    await assert.rejects(recordBackupReceipt(db.sql,{...receipt,database:'another_database'}),/Invalid/);
    await recordBackupReceipt(db.sql,receipt);
    assert.equal(JSON.parse((await repo.backup()).new_value).file,receipt.file);
    const next=await request(owner);assert.equal(next.body.data.rows.find(r=>r.key==='backup').status,'READY');
    assert.equal((await db.sql`SELECT count(*) AS n FROM audit_logs WHERE entity='DATABASE_BACKUP' AND record_id=${receipt.file}`)[0].n,1);
    assert.equal((await db.sql`SELECT part_code FROM items WHERE id=${item}`)[0].part_code,'ZZTEST_SETUP_ITEM');
    const text=JSON.stringify(next.body);assert.ok(!text.includes('password_hash')&&!text.includes('token_hash')&&!text.includes('api_key'));
  }finally {await app.close();installPermissionProvider(null);}
}));
