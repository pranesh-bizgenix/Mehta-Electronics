import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {test} from 'node:test';
import {readSchema} from '../scripts/lib/schema-audit.mjs';
import {withTestTransaction} from '../test-support/transaction.js';
import {transaction} from '../src/crm-modules.js';

const policy=JSON.parse(fs.readFileSync(new URL('../docs/workflow-integrity-policy.json',import.meta.url),'utf8'));
const identifier=value=>{assert.match(value,/^[a-z_][a-z0-9_]*$/);return `"${value}"`;};

test('workflow quantities have validated nonnegative checks and required parent identities; unknown parsed facts remain nullable',()=>withTestTransaction(async db=>{
  const schema=await readSchema(db.sql);
  for(const check of policy.newChecks){
    const constraint=schema.constraints.find(c=>c.table===check.table&&c.name===check.constraint);
    assert.ok(constraint?.validated,`${check.table}.${check.column} needs its validated check.`);
    assert.ok(constraint.columns.includes(check.column));
    assert.match(constraint.definition,/>=\s*\(?0/);
    assert.equal(schema.columns.find(c=>c.table===check.table&&c.name===check.column).nullable,check.allowNull);
  }
  for(const [table,columns] of Object.entries(policy.nullability))for(const column of columns)
    assert.equal(schema.columns.find(c=>c.table===table&&c.name===column)?.nullable,false,`${table}.${column} must be required.`);
  for(const key of Object.keys(policy.signedExceptions)){
    const [table,column]=key.split('.');
    assert.ok(schema.columns.some(c=>c.table===table&&c.name===column),`Stale signed-value exception: ${key}.`);
    assert.ok(policy.signedExceptions[key].length>30);
  }
}));

test('database rejects negative typed prices/quantities and impossible receipt splits without creating retained business rows',()=>withTestTransaction(async db=>{
  const [maker]=await db.sql`INSERT INTO users(name,email,role,password_hash) VALUES('VERIFY-quantity_maker',${`VERIFY-${crypto.randomUUID()}@example.test`},'OWNER','not-a-login') RETURNING id`;
  const absent=crypto.randomUUID();
  const parents={
    price_list_items:{price_list_id:absent},supplier_po_lines:{supplier_po_id:-1,line_number:1},
    supplier_po_schedules:{supplier_po_line_id:absent,schedule_number:1},purchase_request_lines:{purchase_request_id:-1},
    rfq_vendor_reply_lines:{reply_id:-1},acceptance_lines:{acceptance_id:absent},goods_receipt_lines:{goods_receipt_id:absent},
    supply_allocations:{sales_order_line_id:-1,supplier_po_line_id:absent},dispatch_lines:{dispatch_id:absent}
  };
  await transaction(db,maker,'VERIFY- quantity constraint verification',async()=>{
    for(const check of policy.newChecks){
      const values={...parents[check.table],[check.column]:'-0.000001'};
      const columns=Object.keys(values),params=columns.map((_,i)=>`$${i+1}`).join(',');
      const statement=`INSERT INTO ${identifier(check.table)} (${columns.map(identifier).join(',')}) VALUES (${params})`;
      await assert.rejects(db.sql.unsafe(statement,Object.values(values)),error=>error.code==='23514'&&error.constraint_name===check.constraint,`${check.table}.${check.column}`);
      // A zero passes this CHECK and reaches the deliberately absent parent's FK.
      await assert.rejects(db.sql.unsafe(statement,Object.values({...values,[check.column]:'0'})),{code:'23503'});
    }
    await assert.rejects(db.sql`INSERT INTO goods_receipt_lines(goods_receipt_id,received_quantity,accepted_quantity,rejected_quantity) VALUES(${absent},10,5,6)`,error=>error.code==='23514'&&error.constraint_name==='s0_received_disposition');
  });
}));
