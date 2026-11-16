import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {salesOrderFixture} from '../test-support/sales-order-fixture.js';
import {replaceContacts} from '../src/db.js';
import {transaction} from '../src/crm-modules.js';
import {saveOrder} from '../src/sales-orders.js';

test('legacy contact replacement requires its real reason and records creator/archive provenance without a session-setting guess',()=>withTestTransaction(async db=>{
  const f=await quotationFixture(db);
  const [old]=await db.sql`SELECT id,created_at,created_by FROM customer_contacts WHERE customer_id=${f.customer.id} AND NOT is_deleted`;
  await assert.rejects(replaceContacts(db,f.customer.id,[]),{status:422});
  assert.equal((await db.sql`SELECT is_deleted FROM customer_contacts WHERE id=${old.id}`)[0].is_deleted,false);
  const reason='VERIFY- authorised contact replacement';
  await replaceContacts(db,f.customer.id,[{name:'VERIFY- new contact',email:'new-contact@example.test'}],reason);
  const [archived]=await db.sql`SELECT * FROM customer_contacts WHERE id=${old.id}`;
  assert.equal(archived.created_by,old.created_by);assert.deepEqual(archived.created_at,old.created_at);
  assert.equal(archived.is_deleted,true);assert.equal(archived.deleted_by,f.owner.id);
  assert.equal(archived.delete_reason,reason);assert.ok(archived.deleted_at);
  const [fresh]=await db.sql`SELECT created_by,updated_by,row_metadata_version FROM customer_contacts WHERE customer_id=${f.customer.id} AND NOT is_deleted`;
  assert.equal(fresh.created_by,f.owner.id);assert.equal(fresh.updated_by,f.owner.id);assert.equal(fresh.row_metadata_version,1);
}));

test('new quote/order lines record the actual maker; new business rows cannot omit provenance or downgrade its version',()=>withTestTransaction(async db=>{
  const f=await salesOrderFixture(db);
  const [quoteLine]=await db.sql`SELECT created_by,created_at,row_metadata_version FROM quotation_lines WHERE quotation_id=${f.quote.id} AND NOT is_deleted`;
  assert.equal(quoteLine.created_by,f.executive.id);assert.ok(quoteLine.created_at);assert.equal(quoteLine.row_metadata_version,1);
  const order=await saveOrder(db,null,f.body,f.executive);
  const [orderLine]=await db.sql`SELECT created_by,created_at,row_metadata_version FROM sales_order_lines WHERE sales_order_id=${order.id} AND NOT is_deleted`;
  assert.equal(orderLine.created_by,f.executive.id);assert.ok(orderLine.created_at);assert.equal(orderLine.row_metadata_version,1);
  await assert.rejects(db.sql`INSERT INTO units_of_measure(code,name) VALUES('VERIFY-MISSING_ACTOR','VERIFY- missing actor')`,/actual creator/);
  await assert.rejects(db.sql`INSERT INTO units_of_measure(code,name,created_by,row_metadata_version) VALUES('VERIFY-DOWNGRADE','VERIFY- downgraded',${f.owner.id},0)`,/current provenance/);
  await transaction(db,f.owner,'VERIFY- unit provenance',async()=>{
    await db.sql`INSERT INTO units_of_measure(code,name) VALUES('VERIFY-META_UNIT','VERIFY- provenance unit')`;
    await assert.rejects(db.sql`UPDATE units_of_measure SET created_by=${f.manager.id} WHERE code='VERIFY-META_UNIT'`,/Creation provenance is immutable/);
    await assert.rejects(db.sql`UPDATE units_of_measure SET row_metadata_version=0 WHERE code='VERIFY-META_UNIT'`,/managed by the database/);
    await db.sql`UPDATE units_of_measure SET is_deleted=true WHERE code='VERIFY-META_UNIT'`;
    const [unit]=await db.sql`SELECT deleted_by,delete_reason,deleted_at FROM units_of_measure WHERE code='VERIFY-META_UNIT'`;
    assert.equal(unit.deleted_by,f.owner.id);assert.equal(unit.delete_reason,'VERIFY- unit provenance');assert.ok(unit.deleted_at);
    const [audit]=await db.sql`SELECT new_value FROM audit_logs WHERE entity='ROW_METADATA' AND record_id LIKE 'units_of_measure:%VERIFY-META_UNIT%' ORDER BY id DESC LIMIT 1`;
    assert.ok(audit);assert.equal(Object.hasOwn(JSON.parse(audit.new_value),'name'),false,'Metadata audit must not duplicate business payloads.');
  });
}));

test('provenance migration adds nullable historical creation fields before setting future defaults and contains no business UPDATE backfill',()=>{
  const sql=fs.readFileSync(new URL('../database/postgres/migrations/0043_business_row_provenance.sql',import.meta.url),'utf8');
  for(const table of ['quotation_lines','sales_order_lines']){
    assert.ok(sql.includes(`ALTER TABLE "${table}" ADD COLUMN "created_at" timestamptz;`));
    assert.ok(sql.includes(`ALTER TABLE "${table}" ALTER COLUMN "created_at" SET DEFAULT clock_timestamp();`));
    assert.ok(sql.includes(`ALTER TABLE "${table}" ADD COLUMN "created_by" integer REFERENCES users(id);`));
  }
  assert.equal(/^UPDATE\s+[a-z_"]/im.test(sql),false,'Do not invent historical actors/timestamps with a data backfill.');
});
