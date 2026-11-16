import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import {withTestTransaction} from '../test-support/transaction.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import { displayText,companyDisplayName,classifyLedgers,groupHierarchy,reconcileExact,pagination,readStoredTally,readReconciliation,createCrmFromStored,readSync } from '../src/tally-read-service.js';
import { storedTallyRoutes } from '../src/tally-read-routes.js';

test('display repair is conservative and never changes identity text', () => {
  assert.equal(displayText('CafÃ©'), 'Café');
  assert.equal(displayText('â€“ +91Â 98765'), '– +91 98765');
  assert.equal(displayText('Müller · 日本語 · भारत'), 'Müller · 日本語 · भारत');
  assert.equal(displayText(Buffer.from('भारत','utf8').toString('latin1')), 'भारत');
  assert.equal(displayText('Already � lost'), 'Already � lost');
  assert.equal(companyDisplayName('Mehta (from 1-Apr-23) (from 1-Apr-23) (from 1-Apr-23)'), 'Mehta (from 1-Apr-23)');
  assert.equal(companyDisplayName('Mehta (from 1-Apr-23) (from 1-Apr-24)'), 'Mehta (from 1-Apr-23) (from 1-Apr-24)');
});
test('groups follow ancestors and terminate for cycles, orphans and ambiguous parents', () => {
  const groups = [{name:'Retail',parent_name:'Sundry Debtors'},{name:'Cycle A',parent_name:'Cycle B'},{name:'Cycle B',parent_name:'Cycle A'},{name:'Duplicate',parent_name:'Sundry Debtors'},{name:'Duplicate',parent_name:'Sundry Creditors'}];
  const ledgers = classifyLedgers(groups,[{name:'Customer',parent_name:'Retail'},{name:'Vendor',parent_name:'Sundry Creditors'},{name:'Bank',parent_name:'Bank Accounts'},{name:'Expense',parent_name:'Indirect Expenses'},{name:'Cycle',parent_name:'Cycle A'},{name:'Ambiguous',parent_name:'Duplicate'}]);
  assert.deepEqual(ledgers.map(row=>row.category),['customers','vendors','banks','expenses','other','other']);
  assert.equal(groupHierarchy(groups)[1].hierarchy_status,'cycle');
  assert.equal(groupHierarchy([{name:'Leaf',parent_name:'Absent'}])[0].hierarchy_status,'missing_parent');
});
test('exact reconciliation preserves punctuation, case and original encoding, and exposes conflicts', () => {
  const tally=[{kind:'item',name:'A-1',uom:'NOS'},{kind:'item',name:'A1'},{kind:'customer',name:'CafÃ©',gstin:'GST-A'},{kind:'item',name:'Duplicate'},{kind:'item',name:'Duplicate'}];
  const crm=[{kind:'item',name:'A-1',uom:'BOX'},{kind:'customer',name:'Café'},{kind:'item',name:'crm-only'},{kind:'item',name:'inactive',status:'INACTIVE'}];
  const rows=reconcileExact(tally,crm);
  assert.equal(rows.find(row=>row.name==='A-1').status,'conflict');
  assert.equal(rows.find(row=>row.name==='A1').status,'missing_in_crm');
  assert.equal(rows.find(row=>row.name==='CafÃ©').status,'missing_in_crm');
  assert.equal(rows.find(row=>row.name==='Café').status,'missing_in_tally');
  assert.equal(rows.find(row=>row.name==='Duplicate').status,'conflict');
  assert.equal(rows.find(row=>row.name==='inactive').status,'conflict');
  assert.equal(reconcileExact([{kind:'item',name:'abc'}],[{kind:'item',name:'ABC'}]).filter(row=>row.status==='matched').length,0);
  assert.equal(reconcileExact([{kind:'item',name:'original'}],[{kind:'item',name:'original',mapping_conflict:true}])[0].status,'conflict');
});
test('pagination rejects invalid and excessive values', () => {
  for(const query of ['page=0','page=-1','page=1.5','pageSize=101','pageSize=oops'])assert.throws(()=>pagination(new URL(`http://test/?${query}`)),{status:422});
});
test('route aliases retain read permissions and creation requires CRM create permission', async () => {
  const routes=storedTallyRoutes({db:{},config:{tallyFinancialRoles:['OWNER']},route:(method,pattern,permission,handler)=>({method,pattern,permission,handler}),json:()=>{},readJson:async()=>({kind:'item'})});
  for(const prefix of ['/tally','/api/tally']) {
    for(const kind of ['customers','vendors','items','groups','banks','expenses','reconciliation'])assert.ok(routes.find(route=>route.method==='GET'&&route.pattern===`${prefix}/${kind}`)?.permission);
  }
  await assert.rejects(routes.find(route=>route.pattern==='/tally/crm-records').handler({user:{role:'ACCOUNTS'}}),{status:403});
});

test('isolated PostgreSQL read layer: coverage, classification, audited CRM-only creation, idempotency and archives', async () => withTestTransaction(async db => {
    const source=await tallyFixture(db,'ZZTEST_Mehta (from 1-Apr-23) (from 1-Apr-23)'),company=source.company;
    const second=await tallyFixture(db,'ZZTEST_Other'),other=second.company;
    const actor={id:(await db.sql`INSERT INTO users(name,email,role,password_hash) VALUES('ZZTEST_Reader','ZZTEST_reader@example.test','OWNER','not-a-login') RETURNING id`)[0].id};
    for(const row of [{id:'ZZTEST_g1',name:'Sundry Debtors',parent_name:'Primary'},{id:'ZZTEST_g2',name:'Retail',parent_name:'Sundry Debtors'},{id:'ZZTEST_g3',name:'Sundry Creditors',parent_name:'Primary'}])await source.insert('tally_groups',row);
    await source.insert('tally_ledgers',{id:'ZZTEST_c1',name:'ZZTEST_CafÃ©',parent_name:'Retail',phone:'+91Â 98765'});
    await source.insert('tally_ledgers',{id:'ZZTEST_v1',name:'ZZTEST_Vendor A',parent_name:'Sundry Creditors'});
    await source.insert('tally_ledgers',{id:'ZZTEST_bank',name:'ZZTEST_Bank',parent_name:'Bank Accounts'});
    await second.insert('tally_ledgers',{id:'ZZTEST_other',name:'ZZTEST_Other Customer',parent_name:'Sundry Debtors'});
    await source.insert('tally_stock_items',{id:'ZZTEST_i1',name:'ZZTEST_Part-1',parent_name:'Switchgear',base_unit:'NOS',closing_value:'-125.25'});
    await source.insert('tally_stock_items',{id:'ZZTEST_i2',name:'ZZTEST_Part2',parent_name:'Switchgear',base_unit:'NOS',closing_value:null});
    await second.insert('tally_stock_items',{id:'ZZTEST_i3',name:'ZZTEST_Other Item',parent_name:'Other',base_unit:'NOS',closing_value:'50000'});
    await db.sql`INSERT INTO tally_sync_jobs(id,connector_id,company_name,status,started_at,completed_at,last_progress_at) VALUES(${crypto.randomUUID()},${source.connector},'ZZTEST_Mehta (from 1-Apr-23) (from 1-Apr-23)','stored',now()-interval '1 hour',now()-interval '30 minutes',now()-interval '30 minutes'),(${crypto.randomUUID()},${source.connector},'ZZTEST_Mehta (from 1-Apr-23) (from 1-Apr-23)','partial',now(),NULL,now())`;
    const rawBefore=await db.sql`SELECT (SELECT jsonb_agg(t ORDER BY t.id) FROM tally_ledgers t WHERE company_id=${company}) AS ledgers,(SELECT jsonb_agg(t ORDER BY t.id) FROM tally_stock_items t WHERE company_id=${company}) AS items,(SELECT jsonb_agg(t ORDER BY t.id) FROM tally_groups t WHERE company_id=${company}) AS groups`;
    const urlFor=query=>new URL(`http://test/?companyId=${company}&${query||''}`);
    const customers=await readStoredTally(db,'customers',urlFor());
    assert.equal(customers.data.length,1);assert.equal(customers.data[0].name,'ZZTEST_CafÃ©');assert.equal(customers.data[0].display_name,'ZZTEST_Café');assert.equal(customers.data[0].display_phone,'+91 98765');
    assert.equal(customers.company.display_name,'ZZTEST_Mehta (from 1-Apr-23)');
    assert.equal(customers.sync.status,'partial');assert.ok(customers.sync.lastSuccessfulSyncAt);
    assert.equal((await readStoredTally(db,'vendors',urlFor())).data.length,1);
    assert.equal((await readStoredTally(db,'banks',urlFor())).data.length,1);
    const stock=await readStoredTally(db,'items',urlFor(),{financial:true});
    assert.equal(stock.coverage.totalValue,null);assert.equal(stock.coverage.knownSignedValue,'-125.25');assert.equal(stock.coverage.missingValue,1);assert.equal(stock.coverage.valuedItems,1);assert.equal(stock.coverage.negativeValueItems,1);
    assert.equal((await readStoredTally(db,'items',new URL(`http://test/?companyId=${other}`),{financial:true})).coverage.totalValue,'50000.00');
    const restricted=await readStoredTally(db,'items',urlFor());assert.equal(restricted.coverage,null);assert.equal(Object.hasOwn(restricted.data[0],'closing_value'),false);
    assert.equal((await readStoredTally(db,'groups',urlFor('pageSize=1&page=2'))).pagination.total,3);
    await assert.rejects(readStoredTally(db,'items',new URL('http://test/?companyId=invalid')),{status:422});
    assert.equal((await readReconciliation(db,urlFor())).summary.missing_in_crm,4);
    const request={companyId:company,kind:'customer',sourceId:'ZZTEST_c1'};
    const attempts=await Promise.all([createCrmFromStored(db,request,actor,'test'),createCrmFromStored(db,request,actor,'test')]);
    assert.equal(attempts.filter(row=>row.created).length,1);
    await createCrmFromStored(db,{companyId:company,kind:'vendor',sourceId:'ZZTEST_v1'},actor,'test');
    await createCrmFromStored(db,{companyId:company,kind:'item',sourceId:'ZZTEST_i1'},actor,'test');
    assert.equal((await readReconciliation(db,urlFor())).summary.matched,3);
    assert.equal((await db.sql`SELECT count(*) AS n FROM customers WHERE created_by=${actor.id}`)[0].n,1);
    assert.equal((await db.sql`SELECT count(*) AS n FROM customer_contacts WHERE customer_id IN (SELECT id FROM customers WHERE created_by=${actor.id})`)[0].n,1);
    assert.ok((await db.sql`SELECT count(*) AS n FROM audit_logs WHERE user_id=${actor.id}`)[0].n>=5);
    // Invalid actor/status transitions roll back rather than leaving unaudited changes.
    await assert.rejects(db.sql`UPDATE crm_parties SET status='ARCHIVED',is_deleted=true,archive_reason='test' WHERE company_id=${company}`);
    await db.withConnection(async()=>{
      await db.exec('BEGIN');
      await db.prepare("SELECT set_config('mehta.actor_id',?,true),set_config('mehta.audit_reason','Archived in isolated review',true)").get(String(actor.id));
      await db.prepare("UPDATE crm_parties SET status='ARCHIVED',is_deleted=true,archive_reason='Archived in isolated review' WHERE party_role='VENDOR' AND company_id=?").run(company);
      await db.exec('COMMIT');
    });
    assert.equal((await readReconciliation(db,urlFor('status=conflict'))).data[0].kind,'vendor');
    const rawAfter=await db.sql`SELECT (SELECT jsonb_agg(t ORDER BY t.id) FROM tally_ledgers t WHERE company_id=${company}) AS ledgers,(SELECT jsonb_agg(t ORDER BY t.id) FROM tally_stock_items t WHERE company_id=${company}) AS items,(SELECT jsonb_agg(t ORDER BY t.id) FROM tally_groups t WHERE company_id=${company}) AS groups`;
    assert.deepEqual(rawAfter,rawBefore);
}));
