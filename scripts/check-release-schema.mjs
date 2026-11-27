import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';
import {assertCurrentDatabase} from '../src/database-guard.js';
import {migrationsDirectory} from '../src/migrations.js';

// Read-only release preflight. This never applies SQL files or authorises a
// migration; the existing backup and startup guards remain authoritative.
const args=process.argv.slice(2);
if(args.length>1||args.some(arg=>arg!=='--allow-pending'))throw new Error('Usage: node scripts/check-release-schema.mjs [--allow-pending]');
const sql=connectPostgres(getConfig().databaseUrl);
try{
 await sql.ready();await assertCurrentDatabase(sql);
 const entries=fs.readdirSync(migrationsDirectory).filter(name=>name.endsWith('.sql')).sort();
 if(entries.some((name,index)=>!/^\d{4}_[a-z0-9_-]+\.sql$/.test(name)||Number(name.slice(0,4))!==index+1))throw new Error('Release migration files must have contiguous valid names.');
 const applied=await sql`SELECT name,checksum FROM mehta_schema_migrations ORDER BY name`;
 const names=new Set(applied.map(row=>row.name));
 const unknown=applied.filter(row=>!entries.includes(row.name)).map(row=>row.name);
 const checksumMismatches=applied.filter(row=>entries.includes(row.name)&&row.checksum!==crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationsDirectory,row.name))).digest('hex')).map(row=>row.name);
 const pending=entries.filter(name=>!names.has(name));
 const passed=!unknown.length&&!checksumMismatches.length&&(!pending.length||args.includes('--allow-pending'));
 console.log(JSON.stringify({mode:'READ_ONLY_RELEASE_SCHEMA_CHECK',passed,applied:applied.length,bundled:entries.length,unknown,checksumMismatches,pending},null,2));
 if(!passed)process.exitCode=1;
}finally{await sql.end({timeout:5});}
