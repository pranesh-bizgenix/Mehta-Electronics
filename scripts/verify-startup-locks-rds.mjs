import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';
import {assertCurrentDatabase} from '../src/database-guard.js';
import {assertActiveOwner} from '../src/db.js';

const url=getConfig().databaseUrl,target=new URL(url);
if(process.env.VERIFY_AUTHORIZED_RDS_ROLLBACK!=='true'||target.hostname!=='mehta-controldesk-db01.chs2eymsy2ec.ap-southeast-2.rds.amazonaws.com'||target.pathname!=='/postgres'||target.searchParams.get('sslmode')!=='require')throw new Error('Explicit rollback verification against the authorised RDS target is required.');
const sql=connectPostgres(url),connections=[],checks=[];
try{
 const writer=await sql.reserve();connections.push(writer);await assertCurrentDatabase(writer);
 const startup=await sql.reserve();connections.push(startup);
 await writer.unsafe('BEGIN');
 // Simulate the table-lock mode taken by an ordinary user insert/update, with
 // no row insert, account change, credential read or persisted mutation.
 await writer.unsafe('LOCK TABLE users IN ROW EXCLUSIVE MODE');
 await startup.unsafe('BEGIN');await startup.unsafe("SET LOCAL lock_timeout = '500ms'");
 await assert.rejects(startup.unsafe('LOCK TABLE users IN EXCLUSIVE MODE'),{code:'55P03'});
 await startup.unsafe('ROLLBACK');checks.push('Old whole-table startup lock conflicts with an unrelated user write');
 await startup.unsafe('BEGIN');await startup.unsafe("SET LOCAL lock_timeout = '2s'");
 const owner=await assertActiveOwner({prepare(statement){return {get:async()=>(await startup.unsafe(statement))[0]};}});
 assert.ok(owner);checks.push('Active Owner and role share locks succeed while unrelated user writes remain open');
 await startup.unsafe('ROLLBACK');await writer.unsafe('ROLLBACK');
 await fs.mkdir('verification-output/crm-completion',{recursive:true});
 const report={passed:checks.length,checks,scope:'Lock-only RDS concurrency check; no business rows, credentials or accounts were changed.'};
 await fs.writeFile('verification-output/crm-completion/startup-locks-rds.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 for(const connection of connections){try{await connection.unsafe('ROLLBACK');}finally{connection.release();}}
 await sql.end({timeout:5});
}
