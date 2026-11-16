import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {test} from 'node:test';
import {createDatabase} from '../src/postgres.js';
import {getConfig} from '../src/config.js';
import {applyMigrations} from '../src/migrations.js';

test('requires PostgreSQL configuration without a storage fallback',()=>assert.throws(()=>createDatabase({databaseUrl:''}),/DATABASE_URL is required/));

// Migration SQL is observed by a protocol spy, never executed as DDL on the live database.
test('migration protocol is idempotent, detects checksum edits/unknown entries and rolls back a failed statement',async()=>{
 const entries=[{name:'0001_probe.sql',sql:'ZZTEST migration statement'}],ledger=new Map(),events=[];
 const tx=async(parts,...values)=>{const statement=parts.join('?');events.push(statement);
  if(statement.includes('to_regclass'))return [{relation:'mehta_schema_migrations'}];
  if(statement.includes('SELECT name,'))return [...ledger].map(([name,checksum])=>({name,checksum}));
  if(statement.includes('INSERT INTO mehta_schema_migrations'))ledger.set(values[0],values[1]);return [];
 };
 tx.unsafe=async text=>{events.push(text);if(text==='ZZTEST deliberate failure')throw new Error('ZZTEST failed statement');return [];};
 const sql={unsafe:async()=>[{name:'mehta_electronics_local'}],begin:async fn=>{const before=new Map(ledger);try{return await fn(tx);}catch(error){ledger.clear();for(const [key,value]of before)ledger.set(key,value);events.push('ROLLBACK');throw error;}}};
 const run=migrations=>applyMigrations(sql,{migrations,environment:'development',allowWithoutBackup:true});
 assert.deepEqual(await run(entries),{applied:1,total:1});assert.deepEqual(await run(entries),{applied:0,total:1});
 await assert.rejects(run([{...entries[0],sql:'ZZTEST edited'}]),/checksum/);
 await assert.rejects(run([...entries,{name:'0002_failure.sql',sql:'ZZTEST deliberate failure'}]),/failed statement/);
 assert.equal(ledger.size,1);assert.equal(ledger.get(entries[0].name),crypto.createHash('sha256').update(entries[0].sql).digest('hex'));assert.ok(events.includes('ROLLBACK'));
 await assert.rejects(run([]),/unknown migrations/);
});

test('real concurrent connections isolate uncommitted fixtures and release rolls back',async()=>{
 const db=createDatabase(getConfig());
 try{
  await Promise.all([1,2].map(n=>db.withConnection(async()=>{
   await db.exec('BEGIN');
   await db.prepare("INSERT INTO audit_logs(entity,record_id,action,reason) VALUES('ZZTEST_CONNECTION',?,'TEST','ZZTEST rollback')").run(String(n));
   assert.equal((await db.prepare("SELECT count(*) AS n FROM audit_logs WHERE entity='ZZTEST_CONNECTION'").get()).n,1);
   await db.exec('ROLLBACK');
  })));
  await assert.rejects(db.withConnection(async()=>{await db.exec('BEGIN');await db.prepare("INSERT INTO audit_logs(entity,record_id,action,reason) VALUES('ZZTEST_CONNECTION','3','TEST','ZZTEST interrupted')").run();throw new Error('ZZTEST interrupted');}),/interrupted/);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM audit_logs WHERE entity='ZZTEST_CONNECTION'").get()).n,0);
 }finally{await db.close();}
});
