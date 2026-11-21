#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {getConfig} from '../src/config.js';
import {REQUIRED_DATABASE,assertDatabaseTarget,assertCurrentDatabase} from '../src/database-guard.js';
import {createMigrationBackup,requireRecentBackup} from '../src/migration-backup.js';
import {applyMigrations} from '../src/migrations.js';
import {connectPostgres} from '../src/postgres.js';

const started=performance.now();
let sql;
try {
  const args=process.argv.slice(2);
  if(args.length>1||args.some(arg=>arg!=='--dry-run')) {
    throw new Error('Usage: node scripts/backup-verify-migrate.mjs [--dry-run]. No guard-bypass or database-override flags are accepted.');
  }
  const databaseUrl=getConfig().databaseUrl;
  // Refuse remote targets before connecting, including the normally authorized RDS URL.
  assertDatabaseTarget(databaseUrl);
  const target=new URL(databaseUrl);
  if(decodeURIComponent(target.pathname.slice(1))!==REQUIRED_DATABASE||
      !['localhost','127.0.0.1','[::1]'].includes(target.hostname)||
      [...target.searchParams.keys()].some(key=>key!=='sslmode')) {
    throw new Error(`Local-only script: DATABASE_URL must target ${REQUIRED_DATABASE} on localhost, 127.0.0.1 or [::1], without connection-override query parameters. RDS is refused.`);
  }
  const steps=[
    `Confirm the connected database is ${REQUIRED_DATABASE} on the configured loopback host.`,
    'Create a fresh full backup in ./backups using createMigrationBackup.',
    'Verify the archive with the existing pg_restore --list, SHA-256 receipt and unchanged ten-minute freshness check.',
    'Immediately apply pending migrations with the existing guarded migration runner.',
    'Print backup path, verification time, original snapshot time, applied migration names/count and total elapsed time.'
  ];
  if(args.includes('--dry-run')) {
    console.log('DRY RUN: no database connection, files, backup, audit writes or migrations will be executed.');
    steps.forEach((step,index)=>console.log(`${index+1}. ${step}`));
  } else {
    sql=connectPostgres(databaseUrl);
    await assertCurrentDatabase(sql,REQUIRED_DATABASE);
    const ledger=async()=>{
      const [exists]=await sql`SELECT to_regclass('mehta_schema_migrations') AS relation`;
      return exists?.relation?await sql`SELECT name FROM mehta_schema_migrations ORDER BY name`:[];
    };
    const before=new Set((await ledger()).map(row=>row.name));
    console.log('Creating and verifying a fresh full local database backup...');
    // This existing helper verifies the archive, hashes it and publishes its receipt.
    // Its createdAt remains the original snapshot-start time, never the finish time.
    const file=await createMigrationBackup(databaseUrl);
    const receipt=JSON.parse(await fs.readFile(`${file}.json`,'utf8'));
    console.log(`Backup path: ${file}`);
    console.log(`Archive verified at: ${new Date().toISOString()}`);
    console.log(`Snapshot started at: ${receipt.createdAt}`);
    const verified=await requireRecentBackup({directory:path.dirname(file),database:REQUIRED_DATABASE});
    if(path.resolve(verified)!==path.resolve(file))throw new Error('Freshness verification selected another archive; refusing to migrate.');
    console.log('Verification passed. Immediately applying pending migrations...');
    const result=await applyMigrations(sql,{allowWithoutBackup:false});
    console.log(`Migrations applied by this run: ${result.applied}; total migrations: ${result.total}`);
    const added=(await ledger()).map(row=>row.name).filter(name=>!before.has(name));
    if(added.length===result.applied)console.log(`Migrations applied: ${added.join(', ')||'none (already current)'}`);
    else console.log(`Concurrent ledger changes detected; newly recorded migrations: ${added.join(', ')||'none'}. Only the applied count above is attributed to this run.`);
    console.log('Backup, verification and migrations completed successfully.');
  }
} catch(error) {
  // Do not echo connection strings or raw PostgreSQL/client-tool errors.
  const safe=error?.code==='MIGRATION_BACKUP_REQUIRED'||
    /^(Usage:|Local-only script:|Freshness verification)/.test(error?.message||'');
  console.error(`Stopped: ${safe?error.message:'Preflight, backup, verification or migration failed. No later step was executed. Check the local configuration and PostgreSQL client tools.'}`);
  process.exitCode=1;
} finally {
  if(sql)try{await sql.end({timeout:5});}catch{console.error('Database connection cleanup failed.');process.exitCode=1;}
  console.log(`Elapsed time: ${((performance.now()-started)/1000).toFixed(2)} seconds`);
}
