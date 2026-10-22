import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { getConfig } from '../src/config.js';
import { connectPostgres,createDatabase } from '../src/postgres.js';
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

test('isolated PostgreSQL read layer: coverage, classification, audited CRM-only creation, races and archives', {skip:!process.env.RUN_TALLY_READ_DB_TEST}, async () => {
  // Create a dedicated test database and retain it for inspection. No DROP, DELETE or
  // production schema migration runs; report its name explicitly at completion.
  const config=getConfig(),url=new URL(process.env.TEST_DATABASE_URL||config.databaseUrl);
  const admin=connectPostgres(url.toString()),name=`mehta_read_review_${crypto.randomBytes(6).toString('hex')}`;
  let db;
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    url.pathname=`/${name}`; db=createDatabase({databaseUrl:url.toString()});
    // Synthetic source tables contain only the contract consumed by this service.
    await db.sql.unsafe(`
      CREATE TABLE users(id integer PRIMARY KEY);
      CREATE TABLE customers(id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,name text NOT NULL,normalized_name text,gstin text UNIQUE,pan text,billing_address text,created_by integer,updated_by integer,status text DEFAULT 'ACTIVE');
      CREATE TABLE customer_contacts(id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,customer_id integer,name text,phone text,email text,is_primary integer);
      CREATE TABLE items(id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,part_code text UNIQUE,description text,hsn text,uom text,created_by integer,updated_by integer,status text DEFAULT 'ACTIVE');
      CREATE TABLE audit_logs(id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,user_id integer,entity text,record_id text,action text,old_value text,new_value text,reason text,ip_address text);
      CREATE TABLE tally_companies(id uuid PRIMARY KEY,name text);
      CREATE TABLE tally_groups(id text,company_id uuid,name text,parent_name text,fetched_at timestamptz);
      CREATE TABLE tally_ledgers(id text,company_id uuid,name text,parent_name text,phone text,email text,gstin text,pan text,address text,contact_person text,closing_balance numeric,opening_balance numeric,dr_cr text,fetched_at timestamptz);
      CREATE TABLE tally_stock_items(id text,company_id uuid,name text,parent_name text,description text,hsn text,base_unit text,normalized_part_number text,closing_quantity_text text,closing_rate_text text,closing_value numeric(18,2),fetched_at timestamptz);
      CREATE TABLE tally_sync_jobs(id uuid PRIMARY KEY,company_name text,status text,started_at timestamptz,completed_at timestamptz,last_progress_at timestamptz,message text);
      INSERT INTO users VALUES(1);
    `);
    await db.sql.unsafe(await fs.readFile(new URL('../database/postgres/migrations/0006_stored_tally_read_layer.sql',import.meta.url),'utf8'));
    await db.sql.unsafe(await fs.readFile(new URL('../database/postgres/migrations/0007_stored_tally_audit_guards.sql',import.meta.url),'utf8'));
    await db.sql.unsafe(await fs.readFile(new URL('../database/postgres/migrations/0008_crm_master_extensions.sql',import.meta.url),'utf8'));
    const company=crypto.randomUUID(),other=crypto.randomUUID();
    await db.sql`INSERT INTO tally_companies VALUES(${company},'Mehta (from 1-Apr-23) (from 1-Apr-23)'),(${other},'Other')`;
    await db.sql`INSERT INTO tally_groups(id,company_id,name,parent_name) VALUES('g1',${company},'Sundry Debtors','Primary'),('g2',${company},'Retail','Sundry Debtors'),('g3',${company},'Sundry Creditors','Primary')`;
    await db.sql`INSERT INTO tally_ledgers(id,company_id,name,parent_name,phone) VALUES('c1',${company},'CafÃ©','Retail','+91Â 98765'),('v1',${company},'Vendor A','Sundry Creditors',NULL),('bank',${company},'Bank','Bank Accounts',NULL),('other',${other},'Other Customer','Sundry Debtors',NULL)`;
    await db.sql`INSERT INTO tally_stock_items(id,company_id,name,parent_name,base_unit,closing_value) VALUES('i1',${company},'Part-1','Switchgear','NOS',-125.25),('i2',${company},'Part2','Switchgear','NOS',NULL),('i3',${other},'Other Item','Other','NOS',50000)`;
    await db.sql`INSERT INTO tally_sync_jobs VALUES(${crypto.randomUUID()},'Mehta (from 1-Apr-23) (from 1-Apr-23)','stored',now()-interval '1 hour',now()-interval '30 minutes',now()-interval '30 minutes',NULL),(${crypto.randomUUID()},'Mehta (from 1-Apr-23) (from 1-Apr-23)','partial',now(),NULL,now(),'Some datasets absent')`;
    const rawBefore=await db.sql`SELECT (SELECT jsonb_agg(t) FROM tally_ledgers t) AS ledgers,(SELECT jsonb_agg(t) FROM tally_stock_items t) AS items,(SELECT jsonb_agg(t) FROM tally_groups t) AS groups`;
    const urlFor=query=>new URL(`http://test/?companyId=${company}&${query||''}`);
    const customers=await readStoredTally(db,'customers',urlFor());
    assert.equal(customers.data.length,1);assert.equal(customers.data[0].name,'CafÃ©');assert.equal(customers.data[0].display_name,'Café');assert.equal(customers.data[0].display_phone,'+91 98765');
    assert.equal(customers.company.display_name,'Mehta (from 1-Apr-23)');
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
    const actor={id:1},request={companyId:company,kind:'customer',sourceId:'c1'};
    const attempts=await Promise.all([createCrmFromStored(db,request,actor,'test'),createCrmFromStored(db,request,actor,'test')]);
    assert.equal(attempts.filter(row=>row.created).length,1);
    await createCrmFromStored(db,{companyId:company,kind:'vendor',sourceId:'v1'},actor,'test');
    await createCrmFromStored(db,{companyId:company,kind:'item',sourceId:'i1'},actor,'test');
    assert.equal((await readReconciliation(db,urlFor())).summary.matched,3);
    assert.equal((await db.sql`SELECT count(*) AS n FROM customers`)[0].n,1);
    assert.equal((await db.sql`SELECT count(*) AS n FROM customer_contacts`)[0].n,1);
    assert.ok((await db.sql`SELECT count(*) AS n FROM audit_logs`)[0].n>=5);
    // Invalid actor/status transitions roll back rather than leaving unaudited changes.
    await assert.rejects(db.sql`UPDATE crm_parties SET status='ARCHIVED',is_deleted=true,archive_reason='test'`);
    await db.withConnection(async()=>{
      await db.exec('BEGIN');
      await db.prepare("SELECT set_config('mehta.actor_id','1',true),set_config('mehta.audit_reason','Archived in isolated review',true)").get();
      await db.prepare("UPDATE crm_parties SET status='ARCHIVED',is_deleted=true,archive_reason='Archived in isolated review' WHERE party_role='VENDOR'").run();
      await db.exec('COMMIT');
    });
    assert.equal((await readReconciliation(db,urlFor('status=conflict'))).data[0].kind,'vendor');
    const rawAfter=await db.sql`SELECT (SELECT jsonb_agg(t) FROM tally_ledgers t) AS ledgers,(SELECT jsonb_agg(t) FROM tally_stock_items t) AS items,(SELECT jsonb_agg(t) FROM tally_groups t) AS groups`;
    assert.deepEqual(rawAfter,rawBefore);
    console.log(`Retained isolated review database: ${name}`);
  } finally {await db?.close();await admin.end();}
});
