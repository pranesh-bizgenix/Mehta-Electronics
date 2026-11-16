import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {test} from 'node:test';
import {fixtureRuleService} from '../test-support/business-rule-fixture.js';
import {withTestTransaction} from '../test-support/transaction.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';
import {saveCustomer} from '../src/crm-modules.js';
import {createConnectorStore} from '../src/connector-store.js';
import {importTallySession} from '../src/tally-import.js';

async function fixture(db){
 const a=await tallyFixture(db,'VERIFY-Conflict Company A'),b=await tallyFixture(db,'VERIFY-Conflict Company B'),actors={};
 for(const role of ['OWNER','MANAGER','STORE_STAFF']){const id=(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(${`VERIFY-conflict_${role}`},${`VERIFY-conflict_${role}@example.test`},${role},'not-a-login',0) RETURNING id`)[0].id,token=crypto.randomUUID();actors[role]={id,role,token};await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${id},${tokenDigest(token)},'VERIFY-csrf',now()+interval '1 hour')`;}
 await a.insert('tally_groups',{id:'VERIFY-conflict_group',name:'VERIFY- Conflict Debtors',parent_name:'Sundry Debtors'});
 await a.insert('tally_ledgers',{id:'VERIFY-conflict_ledger',name:'VERIFY- Tally customer',parent_name:'VERIFY- Conflict Debtors',gstin:'27ZZZZZ0004Z1Z5',tally_guid:'VERIFY-conflict_guid',raw_record:{GUID:'VERIFY-conflict_guid'}});
 const source=await db.prepare("SELECT record_key FROM tally_visibility_current_cache WHERE company_id=? AND entity='ledgers'").get(a.company);
 const customer=await saveCustomer(db,null,{name:'VERIFY- CRM customer',gstin:'27ABCDE2234F1Z5',stateCode:'27',creditLimit:'0',creditDays:0,ownerId:actors.OWNER.id,reason:'VERIFY- create comparison fixture'},actors.OWNER);
 await db.sql`INSERT INTO tally_visibility_crm_links(company_id,entity,record_key,crm_kind,crm_id,created_by) VALUES(${a.company},'ledgers',${source.record_key},'customer',${customer.id},${actors.OWNER.id})`;
 const app=createApp({db,config:getConfig({mfaEnabled:false})});
 async function request(path,{actor=actors.OWNER,method='GET',body,csrf=true}={}){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{method,url:path,headers:{host:'localhost','content-type':'application/json',...(actor?{cookie:`crm_session=${actor.token}`} :{}),...(csrf?{'x-csrf-token':'VERIFY-csrf'}:{})},socket:{remoteAddress:'test'}});const res={status:0,headersSent:false,setHeader(){},writeHead(n){this.status=n;this.headersSent=true;},end(value){this.body=value?JSON.parse(String(value)):null;}};await app(req,res);return res;}
 return {a,b,actors,customer,source,request,close:async()=>{await app.close();installPermissionProvider(null);}};
}

test('conflicts use stable company links, explicit review policy, independent approval, stale evidence checks and audited CRM-only resolution',()=>withTestTransaction(async db=>{
 const f=await fixture(db),base='/api/v1/tally/conflicts',query=`?companyId=${f.a.company}`;
 try{
  assert.equal((await f.request(base)).status,422);assert.equal((await f.request(base+query,{actor:null})).status,401);assert.equal((await f.request(base+query,{actor:f.actors.STORE_STAFF})).status,403);
  const body={kind:'customers',recordKeys:[f.source.record_key],reason:'VERIFY- compare explicitly linked customer'};
  assert.equal((await f.request(`${base}/detect${query}`,{method:'POST',body,csrf:false})).status,403);
  assert.equal((await f.request(`${base}/detect?companyId=${f.b.company}`,{method:'POST',body})).status,404);
  const detected=await f.request(`${base}/detect${query}`,{method:'POST',body});assert.equal(detected.status,200,JSON.stringify(detected.body));const id=detected.body.data[0].conflictId;assert.ok(id);
  const again=await f.request(`${base}/detect${query}`,{method:'POST',body});assert.equal(again.body.data[0].conflictId,id);
  let detail=await f.request(`${base}/${id}${query}`);assert.equal(detail.status,200);assert.equal(detail.body.data.winningSource,null);assert.equal(detail.body.data.pairs.length,2);
  assert.equal((await f.request(`${base}/${id}?companyId=${f.b.company}`)).status,404);
  const resolution={winner:'TALLY',policyVersion:1,fingerprint:detail.body.data.current.fingerprint,reason:'VERIFY- reviewed current source fields'};
  assert.equal((await f.request(`${base}/${id}/resolve${query}`,{method:'POST',body:resolution})).status,403);
  const unset=await f.request(`${base}/${id}/resolve${query}`,{actor:f.actors.MANAGER,method:'POST',body:resolution});assert.equal(unset.status,409);assert.equal(unset.body.code,'RULE_NOT_CONFIGURED');
  await fixtureRuleService(db).set(f.actors.OWNER,'tally.conflict_winners',[{category:'customers',winner:'TALLY'}],'VERIFY- confirmed fixture resolution policy');
  detail=await f.request(`${base}/${id}${query}`);resolution.policyVersion=detail.body.data.policyVersion;
  const resolved=await f.request(`${base}/${id}/resolve${query}`,{actor:f.actors.MANAGER,method:'POST',body:resolution});assert.equal(resolved.status,200,JSON.stringify(resolved.body));assert.equal(resolved.body.status,'RESOLVED');
  const customer=await db.prepare('SELECT name,gstin FROM customers WHERE id=?').get(f.customer.id);assert.equal(customer.name,'VERIFY- Tally customer');assert.equal(customer.gstin,'27ZZZZZ0004Z1Z5');assert.equal((await db.prepare('SELECT gstin FROM tally_ledgers WHERE company_id=?').get(f.a.company)).gstin,'27ZZZZZ0004Z1Z5');
  assert.ok(await db.prepare("SELECT id FROM audit_logs WHERE entity='TALLY_CONFLICT' AND record_id=? AND action='RESOLVED'").get(id));
  await saveCustomer(db,f.customer.id,{name:'VERIFY- revised CRM name',reason:'VERIFY- demonstrate stale comparison'},f.actors.OWNER);
  const second=await f.request(`${base}/detect${query}`,{method:'POST',body});const secondId=second.body.data[0].conflictId;assert.notEqual(secondId,id);
  const snapshot=(await f.request(`${base}/${secondId}${query}`)).body.data;
  await saveCustomer(db,f.customer.id,{name:'VERIFY- concurrently revised CRM name',reason:'VERIFY- source changed after comparison'},f.actors.OWNER);
  assert.equal((await f.request(`${base}/${secondId}/resolve${query}`,{actor:f.actors.MANAGER,method:'POST',body:{...resolution,fingerprint:snapshot.current.fingerprint}})).status,409);
  await f.request(`${base}/detect${query}`,{method:'POST',body});assert.equal((await db.prepare('SELECT status FROM tally_conflicts WHERE id=?').get(secondId)).status,'SUPERSEDED');
 }finally{await f.close();}
}));

test('recovery is company/token scoped, deduplicated, audited, delivered on heartbeat and completes only after indexed upload',()=>withTestTransaction(async db=>{
 const f=await fixture(db),store=createConnectorStore(getConfig(),{database:db.sql});await store.ready();
 try{
  const base='/api/v1/tally/conflicts',query=`?companyId=${f.a.company}`,body={kind:'customers',recordKeys:[f.source.record_key],reason:'VERIFY- compare before recovery'};
  const id=(await f.request(`${base}/detect${query}`,{method:'POST',body})).body.data[0].conflictId;
  const path=`${base}/${id}/recover${query}`,recover={reason:'VERIFY- request source re-read'};
  assert.equal((await f.request(path,{method:'POST',body:recover,csrf:false})).status,403);
  const requested=await f.request(path,{method:'POST',body:recover});assert.equal(requested.status,202,JSON.stringify(requested.body));assert.equal(requested.body.status,'REQUESTED');
  assert.equal((await f.request(path,{method:'POST',body:recover})).body.id,requested.body.id);
  const actor={id:f.a.connector,expected_company_name:'VERIFY-Conflict Company A'},other={id:f.b.connector,expected_company_name:'VERIFY-Conflict Company B'};
  const heartbeat=await store.heartbeat(actor,{connectorVersion:'1.2.0',selectedCompany:actor.expected_company_name,tallyAvailable:true});assert.deepEqual(heartbeat.readRequestIds,[requested.body.id]);
  assert.deepEqual((await store.heartbeat(other,{selectedCompany:other.expected_company_name,tallyAvailable:true})).readRequestIds,[]);
  await assert.rejects(store.start(other,{company:other.expected_company_name,from:'2026-01-01',to:'2026-12-31',readRequestIds:[requested.body.id]}),{status:422});
  const upload=await store.start(actor,{company:actor.expected_company_name,from:'2026-01-01',to:'2026-12-31',readRequestIds:[requested.body.id]});
  assert.equal((await db.prepare('SELECT status FROM tally_read_requests WHERE id=?').get(requested.body.id)).status,'REQUESTED');
  const xml='<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER><GUID>VERIFY-recovery_voucher</GUID><MASTERID>1</MASTERID><DATE>20260601</DATE><VOUCHERTYPENAME>Sales Order</VOUCHERTYPENAME><VOUCHERNUMBER>VERIFY-recovery</VOUCHERNUMBER></VOUCHER></COLLECTION></DATA></BODY></ENVELOPE>';
  await store.append(actor,{sessionId:upload.sessionId,field:'vouchersXml',sequence:0,content:xml});
  await store.append(actor,{sessionId:upload.sessionId,field:'ledgersXml',sequence:0,content:'<ENVELOPE><BODY><DATA><COLLECTION/></DATA></BODY></ENVELOPE>'});
  const summary=await importTallySession(db,upload.sessionId,{requiredDatasets:['vouchersXml','ledgersXml']});assert.equal(summary.status,'stored');
  const done=await db.prepare('SELECT status,last_session_id FROM tally_read_requests WHERE id=?').get(requested.body.id);assert.equal(done.status,'INDEXED');assert.equal(done.last_session_id,upload.sessionId);
  assert.equal((await db.prepare('SELECT status FROM tally_conflicts WHERE id=?').get(id)).status,'OPEN');
  assert.ok(await db.prepare("SELECT id FROM audit_logs WHERE entity='TALLY_READ_REQUEST' AND record_id=? AND action='INDEXED'").get(requested.body.id));
  const after=(await f.request(`${base}/${id}${query}`)).body.data;assert.equal(after.current,null);assert.match(after.sourceError,/latest complete collection/);
  const retry=await f.request(path,{method:'POST',body:recover});assert.equal(retry.status,202);assert.notEqual(retry.body.id,requested.body.id);
  const incomplete=await store.start(actor,{company:actor.expected_company_name,from:'2026-01-01',to:'2026-12-31',readRequestIds:[retry.body.id]});
  await store.append(actor,{sessionId:incomplete.sessionId,field:'vouchersXml',sequence:0,content:xml});
  await importTallySession(db,incomplete.sessionId,{requiredDatasets:['vouchersXml']});
  const missing=await db.prepare('SELECT status,error_code FROM tally_read_requests WHERE id=?').get(retry.body.id);assert.equal(missing.status,'FAILED');assert.equal(missing.error_code,'REQUESTED_DATASET_NOT_DELIVERED');
  await db.sql`UPDATE tally_companies SET tally_guid='VERIFY-known_company_guid' WHERE id=${f.a.company}`;
  await assert.rejects(store.start(actor,{company:actor.expected_company_name,from:'2026-01-01',to:'2026-12-31',companyGuid:'VERIFY-different_company_guid'}),{status:422});
  await assert.rejects(store.start(actor,{company:actor.expected_company_name,from:'2026-01-01',to:'2026-12-31'}),{status:422});
 }finally{await store.close();await f.close();}
}));
