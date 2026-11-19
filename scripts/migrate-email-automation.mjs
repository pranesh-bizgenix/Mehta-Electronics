// Apply only 0061, after verifying every existing migration and a new full backup.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';
import {runPostgresTool} from '../src/database-backup.js';
import {recordBackupReceipt,backupsDirectory} from '../src/migration-backup.js';
import {applyMigrations,migrationsDirectory} from '../src/migrations.js';
const target='0061_email_automation_read_models.sql';
const sql=connectPostgres(getConfig().databaseUrl);
try {
 const entries=fs.readdirSync(migrationsDirectory).filter(n=>n.endsWith('.sql')).sort().map(name=>({name,sql:fs.readFileSync(path.join(migrationsDirectory,name),'utf8')}));
 const rows=await sql`SELECT name,checksum FROM mehta_schema_migrations ORDER BY name`;
 const pending=entries.filter(e=>!rows.some(r=>r.name===e.name));
 if(pending.length!==1||pending[0].name!==target)throw Error('Refused: 0061 must be the only pending migration.');
 for(const row of rows){const entry=entries.find(e=>e.name===row.name);if(!entry||row.checksum!==crypto.createHash('sha256').update(entry.sql).digest('hex'))throw Error('Refused: existing migration checksum mismatch.');}
 const url=getConfig().databaseUrl,createdAt=new Date().toISOString(),database=decodeURIComponent(new URL(url).pathname.slice(1));
 const name=`${database}-${createdAt.replace(/[:.]/g,'-')}-${crypto.randomBytes(4).toString('hex')}.dump`,file=path.join(backupsDirectory,name),partial=file+'.partial';
 fs.mkdirSync(backupsDirectory,{recursive:true});
 console.log('Verified: only 0061 is pending. Creating full database backup.');
 try {
  await runPostgresTool('pg_dump',url,['--format=custom','--compress=1','--no-owner','--no-acl','--file',partial]);
  const size=fs.statSync(partial).size;if(!size)throw Error('Empty backup.');
  await runPostgresTool('pg_restore',url,['--list',partial]);
  const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(partial))hash.update(chunk);
  const receipt={database,file:name,createdAt,size,sha256:hash.digest('hex')};
  fs.linkSync(partial,file);fs.writeFileSync(file+'.json',JSON.stringify(receipt),{flag:'wx',mode:0o600});await recordBackupReceipt(sql,receipt);
  const result=await applyMigrations(sql,{migrations:entries});
  if(result.applied!==1)throw Error('Unexpected applied migration count.');
  console.log(JSON.stringify({migration:target,...result}));
 } finally {if(fs.existsSync(partial))fs.unlinkSync(partial);}
}catch(error){console.error('Email automation migration stopped:',error.code||error.message);process.exitCode=1;}
finally{await sql.end({timeout:5});}
