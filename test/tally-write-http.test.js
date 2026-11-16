import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {writeFixture} from '../test-support/tally-write-fixture.js';
import {testFetch} from '../test-support/http-client.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';

test('new write HTTP routes enforce sessions, CSRF, Owner control, connector auth and selected-company scope; disabled old read paths add no write queries',()=>withTestTransaction(async db=>{
  const f=await writeFixture(db),tokens=new Map();
  const [manager]=await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('ZZTEST_write_manager','ZZTEST_write_manager@example.test','MANAGER','not-a-login',0) RETURNING id,role`;
  for(const actor of [f.maker,manager]){
    const token=crypto.randomUUID();tokens.set(actor.id,token);
    await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${actor.id},${tokenDigest(token)},'ZZTEST_write_csrf',now()+interval '1 hour')`;
  }
  const connectorToken=crypto.randomBytes(32).toString('hex');await db.sql`UPDATE tally_connectors SET access_token_hash=${tokenDigest(connectorToken)},access_token_expires_at=now()+interval '1 hour' WHERE id=${f.connector}`;
  let writeQueries=0;const instrumented=new Proxy(db,{get(target,key){
    if(key==='prepare')return query=>{if(/\btw_/i.test(query))writeQueries++;return target.prepare(query);};
    return Reflect.get(target,key);
  }});
  const app=createApp({db:instrumented,config:getConfig({mfaEnabled:false})}),fetch=testFetch(app);
  const headers=actor=>actor?{cookie:`crm_session=${tokens.get(actor.id)}`,'x-csrf-token':'ZZTEST_write_csrf'}:{};
  async function call(path,{actor=f.maker,method='GET',body,extra={}}={}){
    const r=await fetch(`http://localhost${path}`,{method,headers:{'content-type':'application/json',...headers(actor),...extra},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};
  }
  try{
    assert.equal((await call(`/api/crm/tally-orders?companyId=${f.company}`)).status,200);
    assert.equal((await call(`/api/v1/tally/visibility/items?companyId=${f.company}`)).status,200);
    const heartbeat={machineName:'ZZTEST_write_pc',connectorVersion:'1.3.0',tallyAvailable:true,selectedCompany:'ZZTEST_Write Company',selectedCompanyGuid:'ZZTEST_write_company_guid',writeCapability:{protocol:1,version:'1.0.0',createOnly:true}};
    assert.equal((await call('/api/connectors/heartbeat',{actor:null,method:'POST',body:heartbeat,extra:{authorization:`Bearer ${connectorToken}`}})).status,200);
    assert.deepEqual((await call('/api/health',{actor:null})).body,{status:'ok'});
    assert.deepEqual((await call('/api/tally-write/banner')).body.data,{live:false});
    assert.equal(writeQueries,0,'Existing read/heartbeat/health paths must not query any write table when default-disabled.');
    assert.equal((await call('/api/tally-write/settings',{actor:null})).status,401);
    assert.equal((await call('/api/tally-write/settings',{actor:manager})).status,403);
    const settings=await call('/api/tally-write/settings');assert.equal(settings.status,200);assert.equal(settings.body.data.control.master_enabled,false);
    for(const c of settings.body.data.categories){assert.equal(c.enabled,false);assert.equal(c.dry_run_only,true);assert.equal(c.approval_mode,null);assert.equal(c.mapping_id,null);}
    assert.equal((await call('/api/tally-write/control',{method:'PUT',body:{masterEnabled:false,reason:'ZZTEST CSRF failure'},extra:{'x-csrf-token':'invalid'}})).status,403);
    assert.equal((await call('/api/tally-write/control',{actor:manager,method:'PUT',body:{masterEnabled:false,reason:'ZZTEST forbidden'}})).status,403);
    const rowId=crypto.randomUUID(),scope=`?companyId=${f.company}`;
    const mutations=[['PUT','/api/tally-write/control'],['PUT','/api/tally-write/categories/SALES_ORDER'],['POST','/api/tally-write/categories/SALES_ORDER/resume'],['POST','/api/tally-write/mappings'],['POST','/api/tally-write/preview'],['POST',`/api/tally-write/outbox/${rowId}/approve${scope}`],['POST',`/api/tally-write/outbox/${rowId}/actions${scope}`],['POST','/api/tally-write/party-reviews'],['POST',`/api/tally-write/party-reviews/${rowId}/approve`],['POST',`/api/tally-write/reconcile${scope}`]];
    for(const [method,path]of mutations){
      assert.equal((await call(path,{actor:null,method,body:{reason:'ZZTEST unauthorized'}})).status,401,path);
      assert.equal((await call(path,{actor:manager,method,body:{reason:'ZZTEST forbidden'}})).status,403,path);
      assert.equal((await call(path,{method,body:{reason:'ZZTEST csrf failure'},extra:{'x-csrf-token':'invalid'}})).status,403,path);
    }
    for(const path of ['/api/tally-write/mappings','/api/tally-write/sources',`/api/tally-write/outbox/${rowId}`])assert.equal((await call(path,{actor:manager})).status,403,path);
    for(const operation of ['claim','authorize','result'])assert.equal((await call(`/api/connectors/tally-write/${operation}`,{actor:null,method:'POST',body:{jobId:rowId},extra:{authorization:'Bearer ZZTEST_invalid'}})).status,401,operation);
    assert.equal((await call('/api/tally-write/outbox')).status,422);
    assert.equal((await call(`/api/tally-write/outbox?companyId=${f.company}&companyId=${f.company}`)).status,422);
    assert.equal((await call(`/api/tally-write/outbox?companyId=${f.company}`,{actor:manager})).status,403);
    assert.equal((await call('/api/connectors/tally-write/config',{actor:null})).status,401);
    assert.deepEqual((await call('/api/connectors/tally-write/config',{actor:null,extra:{authorization:`Bearer ${connectorToken}`}})).body.data,{active:false});
    assert.equal((await call('/api/connectors/tally-write/claim',{actor:null,method:'POST',body:{companyId:f.company},extra:{authorization:'Bearer ZZTEST_invalid'}})).status,401);
    assert.deepEqual((await call('/api/connectors/tally-write/claim',{actor:null,method:'POST',body:{companyId:f.company},extra:{authorization:`Bearer ${connectorToken}`}})).body.data,{inactive:true});
    assert.equal((await call('/api/connectors/tally-write/claim',{actor:null,method:'POST',body:{companyId:crypto.randomUUID()},extra:{authorization:`Bearer ${connectorToken}`}})).status,404);
  }finally{await app.close();installPermissionProvider(null);}
}));
