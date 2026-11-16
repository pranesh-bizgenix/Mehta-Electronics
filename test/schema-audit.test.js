import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {test} from 'node:test';
import {readSchema,structuralFindings,businessMetadataFindings,fkIndexPredicate} from '../scripts/lib/schema-audit.mjs';
import {withTestTransaction} from '../test-support/transaction.js';
import {transaction} from '../src/crm-modules.js';

const policy=JSON.parse(fs.readFileSync(new URL('../docs/schema-policy.json',import.meta.url),'utf8'));
const matrix=JSON.parse(fs.readFileSync(new URL('../docs/workflow-schema-matrix.json',import.meta.url),'utf8'));

test('schema audit accepts only FK-covering partial predicates and catches a PK masquerading as a foreign key',()=>{
  assert.equal(fkIndexPredicate(null,['parent_id']),true);
  assert.equal(fkIndexPredicate('(parent_id IS NOT NULL)',['parent_id']),true);
  assert.equal(fkIndexPredicate("status='OPEN'",['parent_id']),false);
  assert.equal(fkIndexPredicate('(other_id IS NOT NULL)',['parent_id']),false);
  const schema={tables:[{name:'fixture',type:'BASE TABLE'}],columns:[{table:'fixture',name:'parent_id',type:'integer'}],
    constraints:[{table:'fixture',type:'p',columns:['parent_id'],validated:true}],indexes:[],triggers:[]};
  assert.equal(structuralFindings(schema).some(f=>f.key==='foreign-key:fixture:parent_id'),true);
  schema.constraints.push({table:'fixture',type:'f',columns:['parent_id'],validated:false});
  assert.equal(structuralFindings(schema).some(f=>f.kind==='foreign-key'),true,'Unvalidated constraints cannot prove integrity.');
});

test('live schema: every base table has a PK, financial storage is exact, FKs/statuses have documented exceptions, indexes and immutable guards exist',()=>withTestTransaction(async db=>{
  const schema=await readSchema(db.sql),findings=structuralFindings(schema,policy.exceptions);
  assert.deepEqual(findings.filter(f=>!f.exception),[]);
  assert.deepEqual(businessMetadataFindings(schema,policy.businessTables),[]);
  assert.equal(findings.some(f=>['primary-key','float-money','money-scale','foreign-key-index','append-only'].includes(f.kind)),false);
  for(const [key,reason]of Object.entries(policy.exceptions)){
    assert.ok(reason.length>30,`${key} requires a real semantic reason.`);
    assert.ok(findings.some(f=>f.key===key),`Remove stale schema exception ${key}.`);
  }
  for(const table of schema.tables){
    const classification=policy.classifications[table.name];
    assert.ok(classification,`Classify ${table.name}.`);
    assert.ok(['ACTIVE','FOUNDATION','LEGACY'].includes(classification.status));
    assert.ok(classification.reason.length>20);
  }
  for(const [key,states]of Object.entries(policy.statusDomains)){
    const [table,column]=key.split('.');
    const checks=schema.constraints.filter(c=>c.table===table&&c.type==='c'&&c.validated&&c.columns.includes(column));
    for(const state of states)assert.ok(checks.some(c=>c.definition.includes(`'${state}'`)),`${key}: missing runtime state ${state}.`);
  }
  for(const workflow of matrix.workflows)for(const [table,columns]of Object.entries(workflow.tables)){
    assert.ok(schema.tables.some(t=>t.name===table),`${workflow.key}: missing ${table}.`);
    for(const column of columns)assert.ok(schema.columns.some(c=>c.table===table&&c.name===column),`${workflow.key}: missing ${table}.${column}.`);
  }
  for(const table of ['stock_check_log','packing_boxes','pick_scans','bank_accounts','bank_statement_imports','bank_statement_lines','vendor_statements','vendor_due_lines','crm_claims','crm_price_levels']){
    for(const name of ['created_at','updated_at','created_by','is_deleted','deleted_at','deleted_by','delete_reason'])
      assert.ok(schema.columns.some(c=>c.table===table&&c.name===name),`${table} lacks ${name}.`);
  }
}));

test('reserved schema enforces audit context, empty price settings, reasoned soft deletion and append-only audit rows in rollback',()=>withTestTransaction(async db=>{
  const [maker]=await db.sql`INSERT INTO users(name,email,role,password_hash) VALUES('ZZTEST_schema_maker',${`ZZTEST_${crypto.randomUUID()}@example.test`},'OWNER','not-a-login') RETURNING id`;
  await assert.rejects(db.sql`INSERT INTO crm_price_levels(level_number,created_by) VALUES(1,${maker.id})`,/Audit actor and reason/);
  await transaction(db,maker,'ZZTEST schema guard test',async()=>{
    const [row]=await db.sql`INSERT INTO crm_price_levels(level_number,created_by) VALUES(1,${maker.id}) RETURNING id,meaning,configuration,status`;
    assert.equal(row.meaning,null);assert.equal(row.configuration,null);assert.equal(row.status,'NOT_SET');
    await assert.rejects(db.sql`UPDATE crm_price_levels SET status='CONFIRMED' WHERE id=${row.id}`,{code:'23514'});
    await db.sql`SELECT set_config('mehta.audit_reason','',true)`;
    await assert.rejects(db.sql`UPDATE crm_price_levels SET is_deleted=true,deleted_at=now(),deleted_by=${maker.id} WHERE id=${row.id}`,/Audit actor and reason/);
    await db.sql`SELECT set_config('mehta.audit_reason','ZZTEST schema guard test',true)`;
    await assert.rejects(db.sql`DELETE FROM crm_price_levels WHERE id=${row.id}`,/hard deletion/);
    const [audit]=await db.sql`SELECT id FROM audit_logs WHERE entity='crm_price_levels' AND record_id=${row.id}::text`;
    assert.ok(audit);
    await assert.rejects(db.sql`UPDATE audit_logs SET reason='ZZTEST edit' WHERE id=${audit.id}`,/append.only|immutable/i);
    await assert.rejects(db.sql`DELETE FROM audit_logs WHERE id=${audit.id}`,/append.only|immutable/i);
  });
}));

test('Tally outbox stays dry-run only, company scoped, idempotent and bound to the actual independent reviewer',()=>withTestTransaction(async db=>{
  const actors=await db.sql`INSERT INTO users(name,email,role,password_hash) VALUES
    ('ZZTEST_outbox_maker',${`ZZTEST_${crypto.randomUUID()}@example.test`},'OWNER','not-a-login'),
    ('ZZTEST_outbox_checker',${`ZZTEST_${crypto.randomUUID()}@example.test`},'OWNER','not-a-login') RETURNING id`;
  const company=crypto.randomUUID(),other=crypto.randomUUID();
  await db.sql`INSERT INTO tally_companies(id,name) VALUES(${company},'ZZTEST_outbox_A'),(${other},'ZZTEST_outbox_B')`;
  let record;
  await transaction(db,actors[0],'ZZTEST dry-run guard',async()=>{
    const [config]=await db.sql`INSERT INTO tally_write_category_config(category,company_id,created_by) VALUES('ZZTEST_SALES_ORDER',${company},${actors[0].id}) RETURNING enabled,direction,conflict_winner`;
    assert.deepEqual({...config},{enabled:false,direction:null,conflict_winner:null});
    await assert.rejects(db.sql`UPDATE tally_write_category_config SET enabled=true WHERE company_id=${company}`,{code:'23514'});
    const [row]=await db.sql`INSERT INTO tally_outbox(category,company_id,idempotency_key,payload,payload_sha256,created_by) VALUES('ZZTEST_SALES_ORDER',${company},'ZZTEST_once','{}',${'a'.repeat(64)},${actors[0].id}) RETURNING id,dry_run`;
    record=row.id;assert.equal(row.dry_run,true);
    await assert.rejects(db.sql`UPDATE tally_outbox SET dry_run=false WHERE id=${record}`,{code:'23514'});
    await assert.rejects(db.sql`INSERT INTO tally_outbox(category,company_id,idempotency_key,payload,payload_sha256,created_by) VALUES('ZZTEST_SALES_ORDER',${company},'ZZTEST_once','{}',${'b'.repeat(64)},${actors[0].id})`,{code:'23505'});
    await assert.rejects(db.sql`INSERT INTO tally_outbox(category,company_id,idempotency_key,payload,payload_sha256,created_by) VALUES('ZZTEST_SALES_ORDER',${other},'ZZTEST_foreign','{}',${'a'.repeat(64)},${actors[0].id})`,{code:'23503'});
    await assert.rejects(db.sql`UPDATE tally_outbox SET status='APPROVED',approved_by=${actors[1].id},approved_at=now(),approval_reason='ZZTEST forged checker' WHERE id=${record}`,/actual audit actor/);
    await assert.rejects(db.sql`UPDATE tally_outbox SET status='APPROVED',approved_by=${actors[0].id},approved_at=now(),approval_reason='ZZTEST self approval' WHERE id=${record}`,{code:'23514'});
  });
  await transaction(db,actors[1],'ZZTEST independent review',async()=>{
    await db.sql`UPDATE tally_outbox SET status='APPROVED',approved_by=${actors[1].id},approved_at=now(),approval_reason='ZZTEST independent review' WHERE id=${record}`;
    assert.equal((await db.sql`SELECT dry_run FROM tally_outbox WHERE id=${record}`)[0].dry_run,true);
  });
}));
