import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';
import {runPostgresTool} from '../src/database-backup.js';
import {recordBackupReceipt} from '../src/migration-backup.js';
import {applyMigrations} from '../src/migrations.js';
import {directoryArchiveManifest} from './lib/backup-archive.mjs';

// Client-only use of this machine's existing native or Ubuntu PostgreSQL tools.
// No database, package installation, cloud service or new listener is created.
// The existing archive verification and freshness gate remain authoritative.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
if(args.some(arg=>!['--dry-run','--probe','--parallel','--backup-only','--native'].includes(arg))||new Set(args).size!==args.length||args.includes('--probe')&&args.length>1)throw new Error('Use --dry-run, --probe, --parallel, --native or --backup-only; --probe must be used alone.');
const native=args.includes('--native');
const target=new URL(getConfig().databaseUrl);
if(process.platform!=='win32'||target.hostname!=='mehta-controldesk-db01.chs2eymsy2ec.ap-southeast-2.rds.amazonaws.com'||decodeURIComponent(target.pathname.slice(1))!=='postgres'||target.searchParams.get('sslmode')!=='require')throw new Error('This client-only runner requires Windows and the explicitly authorised RDS postgres target with SSL required.');
if(args.includes('--dry-run')){
 console.log(`DRY RUN: verify workspace PostgreSQL 18 clients; take a complete ${args.includes('--parallel')?'four-worker synchronized directory backup, retain every member in a standard uncompressed TAR and fully parse it offline':'custom-format backup'} with the existing ${native?'native Windows':'Ubuntu WSL'} client; catalog-verify with the existing pg_restore method; hash and record the original snapshot timestamp; ${args.includes('--backup-only')?'stop without applying migrations':'immediately run applyMigrations through the unchanged ten-minute guard'}. No command, connection, backup or migration was executed.`);
 process.exit(0);
}
const run=promisify(execFile),clientRoot=path.join(root,'.vercel/tools/pgsql18-linux/root');
const dump=path.join(clientRoot,'usr/lib/postgresql/18/bin/pg_dump');
if(!native&&!fs.existsSync(dump))throw new Error('The verified PostgreSQL 18 Linux client must first be extracted inside .vercel/tools/pgsql18-linux/root. Do not install a database.');
const env={...process.env,PGHOST:target.hostname,PGPORT:target.port||'5432',PGDATABASE:'postgres',PGUSER:decodeURIComponent(target.username),PGPASSWORD:decodeURIComponent(target.password),PGSSLMODE:'require'};
for(const name of ['PGSERVICE','PGSERVICEFILE','PGHOSTADDR','PGOPTIONS','PGPASSFILE'])delete env[name];
// Transfer connection values through inherited environment only, never shell
// interpolation, command arguments, logs or generated credential files.
env.WSLENV='PGHOST:PGPORT:PGDATABASE:PGUSER:PGPASSWORD:PGSSLMODE';
const options={cwd:root,env,windowsHide:true,maxBuffer:4*1024*1024};
const linuxPath=async file=>(await run('wsl.exe',['--distribution','Ubuntu','--exec','wslpath','-a','-u',file],options)).stdout.trim();
const linuxRoot=native?null:await linuxPath(clientRoot),bin=linuxRoot+'/usr/lib/postgresql/18/bin/',library=linuxRoot+'/usr/lib/x86_64-linux-gnu';
const wsl=(name,toolArgs)=>run('wsl.exe',['--distribution','Ubuntu','--exec','env','LD_LIBRARY_PATH='+library,bin+name,...toolArgs],options);
const verifier=path.join(root,'.vercel/tools/pgsql18/bin');if(!process.env.PG_BIN&&fs.existsSync(path.join(verifier,'pg_restore.exe')))process.env.PG_BIN=verifier;
const nativeRestore=path.join(process.env.PG_BIN||verifier,'pg_restore.exe');if(!fs.existsSync(nativeRestore))throw new Error('The verified native PostgreSQL 18 archive verifier is required.');
const nativeVersion=(await run(nativeRestore,['--version'],options)).stdout;if(!/^pg_restore \(PostgreSQL\) 18\./.test(nativeVersion))throw new Error('A PostgreSQL 18 native archive verifier is required.');
const client=(name,args)=>native?run(path.join(path.dirname(nativeRestore),name+'.exe'),args,options):wsl(name,args);
const version=(await client('pg_dump',['--version'])).stdout.trim();if(!/^pg_dump \(PostgreSQL\) 18\./.test(version))throw new Error('A compatible PostgreSQL 18 dump client is required.');
if(args.includes('--probe')){
 const started=performance.now(),result=await wsl('psql',['--no-psqlrc','--tuples-only','--no-align','--command',"SELECT repeat('x',1048576)"]);
 console.log(JSON.stringify({mode:'READ_ONLY_SYNTHETIC_NETWORK_PROBE',client:version,bytes:result.stdout.trim().length,elapsedMs:Math.round(performance.now()-started)}));process.exit(0);
}
const sql=connectPostgres(getConfig().databaseUrl),wallStart=performance.now();
try{
 await sql.ready();fs.mkdirSync(path.join(root,'backups'),{recursive:true});
 const createdAt=new Date().toISOString(),name=`postgres-${createdAt.replace(/[:.]/g,'-')}-${crypto.randomBytes(4).toString('hex')}.dump`,file=path.join(root,'backups',name),partial=file+'.partial';
 console.log('Taking a complete same-RDS backup using the existing '+(native?'native Windows':'WSL Ubuntu')+' client.');
 let directoryListing=null;
 if(args.includes('--parallel')){
  // PostgreSQL 18 deliberately writes the same TOC format for directory and
  // TAR archives. No header rewriting or data filtering occurs here.
  // https://github.com/postgres/postgres/blob/REL_18_STABLE/src/bin/pg_dump/pg_backup_directory.c
  // The four workers use pg_dump's synchronized snapshot, not four independent dumps.
  const directory=file+'.directory.partial',clientDirectory=native?directory:await linuxPath(directory);
  await client('pg_dump',['--format=directory','--jobs=4','--compress=0','--no-owner','--no-acl','--file',clientDirectory]);
  directoryListing=(await client('pg_restore',['--list',clientDirectory])).stdout;
  const ordered=directoryArchiveManifest(directory,directoryListing);
  const manifest=file+'.members';fs.writeFileSync(manifest,Buffer.from(ordered.join('\0')+'\0'),{flag:'wx',mode:0o600});
  console.log('Parallel dump completed; packaging all members with the native Windows Python TAR writer.');
  const tarWriter="import sys,tarfile,pathlib; root=pathlib.Path(sys.argv[1]); names=pathlib.Path(sys.argv[2]).read_bytes().decode('utf-8').split('\\0'); archive=tarfile.open(sys.argv[3],mode='w',format=tarfile.USTAR_FORMAT); [archive.add(str(root/name),arcname=name,recursive=False) for name in names if name]; archive.close()";
  await run('python.exe',['-c',tarWriter,directory,manifest,partial],options);
  console.log('Packaging completed; fully reading the archive offline with the native Windows PostgreSQL verifier.');
  const verifierEnv={...process.env};for(const key of Object.keys(verifierEnv))if(key.startsWith('PG'))delete verifierEnv[key];
  // --file NUL emits SQL into the Windows null device. There is no --dbname,
  // no connection environment and no SQL execution or database restoration.
  await run(nativeRestore,['--no-owner','--no-acl','--file','NUL',partial],{cwd:root,env:verifierEnv,windowsHide:true,maxBuffer:4*1024*1024});

 }
 else await client('pg_dump',['--format=custom','--compress=1','--no-owner','--no-acl','--file',native?partial:await linuxPath(partial)]);
 if(!fs.statSync(partial).size)throw new Error('Empty backup archive.');
 const catalog=await runPostgresTool('pg_restore',getConfig().databaseUrl,['--list',partial]);
 if(directoryListing){const entries=text=>text.split(/\r?\n/).filter(line=>/^\d+;/.test(line)).join('\n');if(entries(directoryListing)!==entries(catalog.stdout))throw new Error('TAR and original directory catalogs differ.');}
 const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(partial))hash.update(chunk);
 const receipt={database:'postgres',file:name,createdAt,size:fs.statSync(partial).size,sha256:hash.digest('hex')};
 fs.renameSync(partial,file);fs.writeFileSync(file+'.json',JSON.stringify(receipt,null,2),{flag:'wx',mode:0o600});await recordBackupReceipt(sql,receipt);
 console.log(JSON.stringify({backupPath:file,originalSnapshotAt:createdAt,verifiedAt:new Date().toISOString(),bytes:receipt.size}));
 if(args.includes('--backup-only')){
  console.log(JSON.stringify({status:'BACKUP_VERIFIED_ONLY',backupPath:file,originalSnapshotAt:createdAt,migrationsApplied:[],elapsedMs:Math.round(performance.now()-wallStart)}));
  // A verified backup does not imply it is fresh enough for a later migration.
  // applyMigrations must still enforce the original snapshot age when invoked.
  process.exitCode=0;
 }else{
 const before=new Set((await sql`SELECT name FROM mehta_schema_migrations`).map(row=>row.name));
 const result=await applyMigrations(sql);
 const applied=(await sql`SELECT name FROM mehta_schema_migrations ORDER BY name`).map(row=>row.name).filter(name=>!before.has(name));
 const report={...result,backupPath:file,originalSnapshotAt:createdAt,migrationsApplied:applied,elapsedMs:Math.round(performance.now()-wallStart)};
 const out=path.join(root,'verification-output/crm-completion');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'wsl-migration-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }
}catch(error){console.error(JSON.stringify({status:'BACKUP_OR_MIGRATION_FAILED',code:error.code||'BACKUP_FAILED',elapsedMs:Math.round(performance.now()-wallStart),migrations:'Not confirmed; inspect the ledger before retrying.'}));process.exitCode=1;}
finally{await sql.end({timeout:5});}
