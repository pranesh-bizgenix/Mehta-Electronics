import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';
import {compareOrderCounts,manualOrderReference} from '../src/tally-order-reconciliation.js';

async function fixture(db){
 const a=await tallyFixture(db,'VERIFY-Order Company A'),b=await tallyFixture(db,'VERIFY-Order Company B'),empty=await tallyFixture(db,'VERIFY-Empty Order Company');
 const users=[];for(const role of ['OWNER','STORE_STAFF','MANAGER']){const id=(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(${`VERIFY-order_scope_${role}`},${`VERIFY-order_scope_${role}@example.test`},${role},'not-a-login',0) RETURNING id`)[0].id;const token=crypto.randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${id},${tokenDigest(token)},'VERIFY-csrf',now()+interval '1 hour')`;users.push({id,role,token});}
 async function cache(source,key,number,type='Sales Order',status='RECORDED',guid=key){
  const fields={'/stored/voucher_type':type,'/stored/voucher_number':number,'/stored/party_name':source===b?'VERIFY-Only B party':'VERIFY-Only A party','/stored/date':'20260601','/stored/voucher_status':status,'/stored/guid':guid};
  await db.sql`INSERT INTO tally_visibility_current_cache(company_id,entity,record_key,record_id,name,session_id,observed_at,summary_fields,public_summary,financial_search,public_search,has_raw)
   VALUES(${source.company},'vouchers',${key},${key},${number},${source.session},now(),${db.sql.json(fields)},'{}'::jsonb,'VERIFY- hidden financial amount','VERIFY- public metadata',true)`;
 }
 await cache(a,'VERIFY-same_key','VERIFY-SHARED_NUMBER');await cache(a,'VERIFY-a_po','VERIFY-A_PO','Purchase Order','CANCELLED');await cache(b,'VERIFY-same_key','VERIFY-SHARED_NUMBER');await cache(b,'VERIFY-b_only','VERIFY-B_ONLY');
 const app=createApp({db,config:getConfig({mfaEnabled:false})});
 async function request(path,{actor=users[0],method='GET',body,csrf=true}={}){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{method,url:path,headers:{host:'localhost','content-type':'application/json',...(actor?{cookie:`crm_session=${actor.token}`} :{}),...(csrf?{'x-csrf-token':'VERIFY-csrf'}:{})},socket:{remoteAddress:'test'}});const res={status:0,headersSent:false,setHeader(){},writeHead(n){this.status=n;this.headersSent=true;},end(value){this.body=value?JSON.parse(String(value)):null;}};await app(req,res);return res;}
 return {a,b,empty,users,cache,request,close:async()=>{await app.close();installPermissionProvider(null);}};
}
test('order drill-down scopes source lines and payloads, preserves decimals and removes all financial fields for Manager',()=>withTestTransaction(async db=>{
 const f=await fixture(db),payload=crypto.randomUUID();
 const raw={GUID:'VERIFY-guid',VOUCHERTYPENAME:'Sales Order',VOUCHERNUMBER:'VERIFY-SHARED_NUMBER',DATE:'20260601',PARTYLEDGERNAME:'VERIFY-A_party',AMOUNT:'9007199254740993.123456',
  'ALLINVENTORYENTRIES.LIST':[{STOCKITEMNAME:'VERIFY-part',ACTUALQTY:'5 Nos',BILLEDQTY:'2 Nos',PENDINGQTY:'1 Nos',RATE:'123.456789/Nos',AMOUNT:'246.913578'}]};
 await db.sql`INSERT INTO tally_raw_payloads(id,company_id,session_id,dataset,content_hash,content) VALUES(${payload},${f.a.company},${f.a.session},'salesOrdersXml','VERIFY-hash','<ENVELOPE>VERIFY-original</ENVELOPE>')`;
 const fields=(await db.sql`SELECT summary_fields FROM tally_visibility_current_cache WHERE company_id=${f.a.company} AND record_key='VERIFY-same_key'`)[0].summary_fields;
 await db.sql`INSERT INTO tally_visibility_records(id,company_id,entity,record_key,session_id,payload_id,name,raw_record,fields,content_hash,observed_at) VALUES('VERIFY-detail_record',${f.a.company},'vouchers','VERIFY-same_key',${f.a.session},${payload},'VERIFY-SHARED_NUMBER',${db.sql.json(raw)},${db.sql.json(fields)},'VERIFY-hash',now())`;
 await db.sql`UPDATE tally_visibility_current_cache SET record_id='VERIFY-detail_record' WHERE company_id=${f.a.company} AND record_key='VERIFY-same_key'`;
 try{
  const path=`/api/crm/tally-orders/VERIFY-same_key?companyId=${f.a.company}`;
  const full=await f.request(path);assert.equal(full.status,200);assert.equal(full.body.data.lines[0].rate,'123.456789/Nos');assert.equal(full.body.data.lines[0].pendingQuantity,'1 Nos');assert.equal(full.body.data.totals.grandTotal,'9007199254740993.123456');assert.equal(full.body.data.originalPayload.id,payload);
  const limited=await f.request(path,{actor:f.users[2]});assert.equal(limited.status,200);assert.equal(limited.body.financial,false);assert.equal(limited.body.data.lines[0].actualQuantity,'5 Nos');assert.ok(!Object.hasOwn(limited.body.data.lines[0],'rate'));assert.ok(!Object.hasOwn(limited.body.data,'totals'));assert.equal(limited.body.data.originalPayload,null);assert.ok(!JSON.stringify(limited.body).includes('246.913578'));
  assert.equal((await f.request(path,{actor:f.users[1]})).status,403);
  const other=await f.request(`/api/crm/tally-orders/VERIFY-same_key?companyId=${f.b.company}`);assert.equal(other.status,200);assert.equal(other.body.data.lines.length,0);assert.equal(other.body.data.originalPayload,null);
  assert.equal((await f.request(`/api/crm/tally-orders/VERIFY-a_po?companyId=${f.b.company}`)).status,404);
  assert.equal((await f.request('/api/crm/tally-orders/VERIFY-same_key')).status,422);
  const freshness=await f.request(`/api/v1/tally/visibility/freshness?companyId=${f.a.company}`);assert.equal(freshness.status,200);assert.ok(freshness.body.data.every(row=>row.sourceTimestamp===null));
  assert.equal((await f.request('/api/v1/tally/visibility/freshness')).status,422);
 }finally{await f.close();}
}));

test('Tally order API requires exactly one valid company and isolates rows, search, type filters and totals',()=>withTestTransaction(async db=>{
 const f=await fixture(db),path='/api/crm/tally-orders';try{
  assert.equal((await f.request(path,{actor:null})).status,401);assert.equal((await f.request(`${path}?companyId=${f.a.company}`,{actor:f.users[1]})).status,403);
  for(const query of ['', '?companyId=', '?companyId=all','?companyId=invalid',`?companyId=${f.a.company}&companyId=${f.b.company}`])assert.equal((await f.request(path+query)).status,422,query);
  assert.equal((await f.request(`${path}?companyId=${crypto.randomUUID()}`)).status,404);
  for(const source of [f.a,f.b]){const response=await f.request(`${path}?companyId=${source.company}&pageSize=1`);assert.equal(response.status,200);assert.equal(response.body.pagination.total,2);assert.equal(response.body.data.length,1);assert.equal(response.body.company.id,source.company);assert.ok(response.body.data.every(row=>row.company_id===source.company));}
  const results=await f.request(`${path}?companyId=${f.a.company}&search=VERIFY-B_ONLY`);assert.equal(results.body.pagination.total,0);assert.equal(results.body.data.length,0);
  assert.equal((await f.request(`${path}?companyId=${f.a.company}&search=Only%20B`)).body.pagination.total,0);
  assert.equal((await f.request(`${path}?companyId=${f.a.company}&search=Only%20A`)).body.pagination.total,2);
  assert.equal((await f.request(`${path}?companyId=${f.a.company}&kind=purchase_orders`)).body.pagination.total,1);
  assert.equal((await f.request(`${path}?companyId=${f.b.company}&kind=purchase_orders`)).body.pagination.total,0);
  assert.equal((await f.request(`${path}?companyId=${f.empty.company}`)).body.pagination.total,0);
  assert.equal((await f.request(`${path}?companyId=${f.a.company}&page=abc`)).status,422);
  const listing=await f.request(`${path}?companyId=${f.a.company}`);assert.ok(!JSON.stringify(listing.body).includes('hidden financial'));
  const index=await db.prepare("SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='tally_current_voucher_type_date'").get();assert.match(index.indexdef,/company_id/);
 }finally{await f.close();}
}));
test('reconciliation distinguishes count-only matches, missing identities and status differences',()=>{
 const rows=[{number:'SO-A',status:'RECORDED',identity:'guid:a'}];
 assert.equal(compareOrderCounts(rows,{RECORDED:1}).outcome,'COUNTS_MATCH_NOT_IDENTITY_VERIFIED');
 assert.equal(compareOrderCounts(rows,{RECORDED:1},rows,'stable').outcome,'PASS');
 const mismatch=compareOrderCounts(rows,{RECORDED:1},[{number:'SO-B',status:'RECORDED',identity:'guid:b'}],'stable');assert.equal(mismatch.outcome,'MISMATCH');assert.equal(mismatch.missing[0].number,'SO-B');assert.equal(mismatch.unexpected[0].number,'SO-A');
 assert.equal(compareOrderCounts(rows,{CANCELLED:1},[{number:'SO-A',status:'CANCELLED',identity:'guid:a'}],'stable').statusDifferences.length,1);
 assert.throws(()=>manualOrderReference({companyId:'b',complete:true,datasets:[]},'a'),{status:422});
});
test('Tally read, inspection, export, payload and dashboard aliases require company scope; foreign snapshots and replay sessions are rejected',()=>withTestTransaction(async db=>{
 const f=await fixture(db);
 const payloadId=crypto.randomUUID(),otherId=crypto.randomUUID();
 for(const [source,id,name]of [[f.a,payloadId,'VERIFY-A_source'],[f.b,otherId,'VERIFY-B_source']]){
  const content=`<ENVELOPE><BODY><DATA><COLLECTION><GROUP NAME="${name}"><NAME>${name}</NAME><PARENT>Primary</PARENT></GROUP></COLLECTION></DATA></BODY></ENVELOPE>`;
  await db.sql`INSERT INTO tally_raw_payloads(id,company_id,session_id,dataset,content_hash,content) VALUES(${id},${source.company},${source.session},'groupsXml',${crypto.createHash('sha256').update(content).digest('hex')},${content})`;
  await source.insert('tally_groups',{id:name,name,parent_name:'Primary'});
 }
 const paths=['/api/tally/masters/groups','/api/tally/masters/groups/VERIFY-A_source','/api/tally/customers','/api/tally/items','/api/tally/reconciliation','/api/tally/visibility/overview','/api/tally/visibility/groups','/api/tally/inspection/groups/quality','/api/tally/inspection/tree','/api/tally/inspection/items/reconciliation','/api/tally/inspection/quotations/sync','/api/tally/retained/payloads','/api/tally/retained/quarantine','/api/dashboard/tally','/api/dashboard/quality'];
 try{
  for(const path of paths){assert.equal((await f.request(path)).status,422,path);assert.equal((await f.request(`${path}?companyId=${f.a.company}&companyId=${f.b.company}`)).status,422,path);if(path.startsWith('/api/tally/visibility')||path.startsWith('/api/tally/inspection')||path.startsWith('/api/tally/retained'))assert.equal((await f.request(path.replace('/api/tally/','/api/v1/tally/'))).status,422,path);}
  const groups=await f.request(`/api/v1/tally/visibility/groups?companyId=${f.a.company}`);assert.equal(groups.status,200);assert.ok(groups.body.data.every(row=>row.name!=='VERIFY-B_source'));
  const foreign=await f.request(`/api/v1/tally/visibility/groups/VERIFY-B_source?companyId=${f.a.company}`);assert.equal(foreign.status,404);
  assert.equal((await f.request(`/api/tally/masters/groups/VERIFY-B_source?companyId=${f.a.company}`)).status,404);
  assert.equal((await f.request(`/api/tally/masters/groups/VERIFY-A_source?companyId=${f.a.company}`)).status,200);
  const ownPayload=await f.request(`/api/v1/tally/retained/payloads/${payloadId}?companyId=${f.a.company}`);assert.equal(ownPayload.status,200);
  assert.equal((await f.request(`/api/v1/tally/retained/payloads/${otherId}?companyId=${f.a.company}`)).status,404);
  for(const prefix of ['/api/tally','/api/v1/tally']){
   assert.equal((await f.request(`${prefix}/visibility/groups/export`,{method:'POST',body:{format:'csv',columns:['/stored/name']}})).status,422);
   assert.equal((await f.request(`${prefix}/retained/replay`,{method:'POST',body:{sessionId:f.a.session}})).status,422);
   assert.equal((await f.request(`${prefix}/retained/replay?companyId=${f.a.company}`,{method:'POST',body:{sessionId:f.b.session}})).status,404);
  }
  const replay=await f.request(`/api/v1/tally/retained/replay?companyId=${f.a.company}`,{method:'POST',body:{sessionId:f.a.session}});assert.equal(replay.status,200);assert.equal(replay.body.errors,0);
  const onlyA=await f.request(`/api/v1/tally/visibility/groups?companyId=${f.a.company}`);assert.ok(onlyA.body.data.every(row=>row.name!=='VERIFY-B_source'));
  const exportResult=await f.request(`/api/v1/tally/visibility/groups/export?companyId=${f.a.company}`,{method:'POST',body:{format:'csv',columns:['/stored/name']}});assert.equal(exportResult.status,200);assert.ok(!exportResult.body.content.includes('VERIFY-B_source'));
 }finally{await f.close();}
}));
test('live reconciliation compares company-scoped connector payloads and manual counts without writing data',()=>withTestTransaction(async db=>{
 const f=await fixture(db),base='/api/crm/tally-order-reconciliation';
 async function payload(source,dataset,vouchers){const content=`<ENVELOPE><BODY><DATA><COLLECTION>${vouchers.map(v=>`<VOUCHER><GUID>${v.guid}</GUID><VOUCHERNUMBER>${v.number}</VOUCHERNUMBER><VOUCHERTYPENAME>${dataset==='salesOrdersXml'?'Sales Order':'Purchase Order'}</VOUCHERTYPENAME><DATE>20260601</DATE><ISCANCELLED>${v.cancelled?'Yes':'No'}</ISCANCELLED></VOUCHER>`).join('')}</COLLECTION></DATA></BODY></ENVELOPE>`;
  await db.sql`INSERT INTO tally_raw_payloads(id,company_id,session_id,dataset,content_hash,content) VALUES(${crypto.randomUUID()},${source.company},${source.session},${dataset},${crypto.createHash('sha256').update(content).digest('hex')},${content})`;
  await db.sql`INSERT INTO tally_run_datasets(company_id,session_id,dataset,status,payload_count,imported_count,quarantined_count,processed_at) VALUES(${source.company},${source.session},${dataset},${vouchers.length?'imported':'received_empty'},${vouchers.length},${vouchers.length},0,now())`;
 }
 await payload(f.a,'salesOrdersXml',[{guid:'VERIFY-same_key',number:'VERIFY-SHARED_NUMBER'}]);await payload(f.a,'purchaseOrdersXml',[{guid:'VERIFY-a_po',number:'VERIFY-A_PO',cancelled:true}]);
 await payload(f.b,'salesOrdersXml',[{guid:'VERIFY-same_key',number:'VERIFY-SHARED_NUMBER'},{guid:'VERIFY-b_only',number:'VERIFY-B_ONLY'}]);await payload(f.b,'purchaseOrdersXml',[]);
 const manual={companyId:f.a.company,complete:true,scope:{mode:'ALL_RETAINED'},datasets:[{kind:'sales_orders',counts:[{status:'RECORDED',count:1}],vouchers:[{number:'VERIFY-SHARED_NUMBER',status:'RECORDED'}]},{kind:'purchase_orders',counts:[{status:'CANCELLED',count:1}],vouchers:[{number:'VERIFY-A_PO',status:'CANCELLED'}]}]};
 const before=(await db.sql`SELECT jsonb_agg(t ORDER BY company_id,record_key) AS rows FROM tally_visibility_current_cache t WHERE company_id IN (${f.a.company},${f.b.company})`)[0].rows;
 try{
  assert.equal((await f.request(base)).status,422);assert.equal((await f.request(`${base}?companyId=${f.a.company}`,{actor:null})).status,401);
  const report=await f.request(`${base}?companyId=${f.a.company}`);assert.equal(report.status,200);assert.equal(report.body.outcome,'PASS');assert.equal(report.body.run.id,f.a.session);assert.equal(report.body.scope.mode,'DATE_WINDOW');assert.ok(!JSON.stringify(report.body).includes('VERIFY-B_ONLY'));
  const other=await f.request(`${base}?companyId=${f.b.company}`);assert.equal(other.body.outcome,'PASS');assert.equal(other.body.datasets[0].controlDeskTotal,2);
  const empty=await f.request(`${base}?companyId=${f.empty.company}`);assert.equal(empty.body.outcome,'NOT_VERIFIED');assert.equal(empty.body.run,null);
  const path=`${base}/compare?companyId=${f.a.company}`;
  assert.equal((await f.request(path,{method:'POST',body:manual,csrf:false})).status,403);
  assert.equal((await f.request(path,{method:'POST',body:{...manual,companyId:f.b.company}})).status,422);
  const good=await f.request(path,{method:'POST',body:manual});assert.equal(good.body.outcome,'PASS');
  const missing=structuredClone(manual);missing.datasets[0].vouchers[0].number='VERIFY-MISSING';const comparison=await f.request(path,{method:'POST',body:missing});assert.equal(comparison.body.outcome,'MISMATCH');assert.equal(comparison.body.datasets[0].missing[0].number,'VERIFY-MISSING');
  const countsOnly=structuredClone(manual);delete countsOnly.datasets[0].vouchers;delete countsOnly.datasets[1].vouchers;assert.equal((await f.request(path,{method:'POST',body:countsOnly})).body.outcome,'NOT_VERIFIED');
  const wrong=structuredClone(manual);wrong.datasets[0].counts[0].count=2;assert.equal((await f.request(path,{method:'POST',body:wrong})).status,422);
  const after=(await db.sql`SELECT jsonb_agg(t ORDER BY company_id,record_key) AS rows FROM tally_visibility_current_cache t WHERE company_id IN (${f.a.company},${f.b.company})`)[0].rows;assert.deepEqual(after,before);
 }finally{await f.close();}
}));
