import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {withAuthorizedRdsRollbackVerification} from '../test-support/transaction.js';
import {TransactionRunner} from '../src/core/runtime.js';

const tag='ZZTEST_'+randomUUID().replaceAll('-',''),report={startedAt:new Date().toISOString(),mode:'Same authorized RDS and outer rollback; production workflow error semantics',checks:[]};
try{
 await withAuthorizedRdsRollbackVerification(async db=>{
  const tx=new TransactionRunner(db),[initial]=await db.sql`SELECT pg_backend_pid() AS id`;
  for(let i=0;i<10;i++){
   const email=tag+'_'+i+'@example.test';
   await assert.rejects(()=>tx.run(null,tag+' expected SQL-error rollback',async()=>{
    await db.prepare("INSERT INTO users(name,email,role,password_hash) VALUES(?,?,'OWNER','not-a-login')").run(tag+'_failed_'+i,email);
    await db.prepare("SELECT set_config('mehta.sales_intake_write','authorized',true)").get();
    await db.prepare('SELECT 1/0 AS impossible').get();
   }),{code:'22012'});
   assert.equal((await db.prepare('SELECT count(*)::integer AS n FROM users WHERE email=?').get(email)).n,0);
   assert.notEqual((await db.prepare("SELECT current_setting('mehta.sales_intake_write',true) AS value").get()).value,'authorized');
   await tx.run(null,tag+' workflow savepoint cannot commit outer transaction',async()=>{
    await db.prepare("INSERT INTO users(name,email,role,password_hash) VALUES(?,?,'OWNER','not-a-login')").run(tag+'_retained_'+i,email);
   });
   assert.equal((await db.prepare('SELECT count(*)::integer AS n FROM users WHERE email=?').get(email)).n,1);
   await assert.rejects(()=>db.sql`SELECT 1/0`,{code:'22012'});
   assert.equal((await db.prepare('SELECT pg_backend_pid() AS id').get()).id,initial.id);
   for(const sql of ['COMMIT','SELECT 1; COMMIT','CREATE TABLE forbidden(id integer)'])assert.throws(()=>db.prepare(sql),/managed transaction/);
   await assert.rejects(()=>db.exec('COMMIT'),/outer transaction cannot be committed/);
   report.checks.push({id:'TRANSACTION-'+(i+1),status:'PASS'});console.log('PASS workflow SQL rollback, root SQL recovery and no outer commit',i+1);
  }
 },{productionTransactions:true});
 await withAuthorizedRdsRollbackVerification(async db=>assert.equal((await db.prepare('SELECT count(*)::integer AS n FROM users WHERE name LIKE ?').get(tag+'%')).n,0));
 report.status='PASS';report.cleanup='OUTER_ROLLBACK_VERIFIED_ZERO_USERS';
}catch(e){report.status='FAIL';report.error=e.message;process.exitCode=1;console.error(e.message);}
finally{report.finishedAt=new Date().toISOString();fs.mkdirSync('verification-output/sales-intake',{recursive:true});fs.writeFileSync('verification-output/sales-intake/transaction-semantics.json',JSON.stringify(report,null,2));}
