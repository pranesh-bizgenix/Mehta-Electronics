import assert from 'node:assert/strict';
import {test} from 'node:test';
import crypto from 'node:crypto';
import {orderSyncState,orderSyncStates} from '../src/tally-order-sync-state.js';
import {withTestTransaction} from '../test-support/transaction.js';
import {salesOrderFixture} from '../test-support/sales-order-fixture.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {saveOrder,orderList} from '../src/sales-orders.js';

test('per-order status requires explicit stored evidence and never treats missing evidence as proof of Tally absence',()=>{
 assert.equal(orderSyncState().status,'NOT_YET_SYNCED');assert.match(orderSyncState().note,/unknown/);
 const job={status:'SUCCEEDED',company_id:'company',company_name:'ZZTEST_company',error_detail:{message:'ZZTEST private financial error'}};
 assert.equal(orderSyncState({job}).status,'NOT_YET_SYNCED');
 assert.equal(orderSyncState({job,source:{observed_at:'2026-11-04'}}).status,'IN_TALLY');
 assert.equal(orderSyncState({job:{...job,status:'FAILED'}}).lastError.message.includes('private'),false);
 assert.equal(orderSyncState({job:{...job,status:'FAILED'}},true).lastError.message,'ZZTEST private financial error');
 assert.equal(orderSyncState({reconciliation:{status:'MISMATCH'}}).status,'MISMATCH');
 assert.equal(orderSyncState({conflict:{id:'conflict',company_id:'company'}}).conflict.path,'/tally/conflicts?companyId=company&open=conflict');
});
test('order list/detail derive sync from explicit CRM foreign keys, source-company identity and persisted conflicts',()=>withTestTransaction(async db=>{
 const f=await salesOrderFixture(db);try{
  let order=await saveOrder(db,null,f.body,f.executive);assert.equal(order.tallySync.status,'NOT_YET_SYNCED');
  const a=await tallyFixture(db,'ZZTEST_sync_state_A'),b=await tallyFixture(db,'ZZTEST_sync_state_B'),job=crypto.randomUUID(),item=crypto.randomUUID();
  await db.sql`INSERT INTO tally_sync_jobs(id,connector_id,company_name,status) VALUES(${job},${a.connector},'ZZTEST_sync_state_A','stored')`;
  await db.sql`INSERT INTO tally_sync_job_items(id,job_id,company_id,entity_kind,external_id,idempotency_key,status,crm_sales_order_id,completed_at) VALUES(${item},${job},${a.company},'sales_order','ZZTEST_stable_guid','ZZTEST_idempotency','SUCCEEDED',${order.id},now())`;
  const fields={'/stored/guid':'ZZTEST_stable_guid','/stored/voucher_type':'Sales Order'};
  await db.sql`INSERT INTO tally_visibility_current_cache(company_id,entity,record_key,record_id,name,session_id,observed_at,summary_fields,public_summary,financial_search,public_search,has_raw) VALUES(${b.company},'vouchers','ZZTEST_source','ZZTEST_source','ZZTEST_source',${b.session},now(),${db.sql.json(fields)},'{}','ZZTEST_','ZZTEST_',false)`;
  assert.equal((await orderSyncStates(db,[order.id],f.owner)).get(order.id).status,'NOT_YET_SYNCED');
  await db.sql`INSERT INTO tally_visibility_current_cache(company_id,entity,record_key,record_id,name,session_id,observed_at,summary_fields,public_summary,financial_search,public_search,has_raw) VALUES(${a.company},'vouchers','ZZTEST_source','ZZTEST_source','ZZTEST_source',${a.session},now(),${db.sql.json(fields)},'{}','ZZTEST_','ZZTEST_',false)`;
  assert.equal((await orderSyncStates(db,[order.id],f.owner)).get(order.id).status,'IN_TALLY');
  const conflict=crypto.randomUUID();await db.sql`INSERT INTO tally_conflicts(id,company_id,entity_kind,external_id,conflict_type,source_snapshot,status,crm_sales_order_id,created_by) VALUES(${conflict},${a.company},'sales_order','ZZTEST_stable_guid','ZZTEST_DIFFERENCE','{}','OPEN',${order.id},${f.owner.id})`;
  const list=await orderList(db,new URL('http://localhost/api/crm/orders'),f.owner),listed=list.data.find(row=>row.id===order.id);assert.equal(listed.tallySync.status,'CONFLICT');assert.equal(listed.tallySync.conflict.id,conflict);
 }finally{await f.close();}
}));
