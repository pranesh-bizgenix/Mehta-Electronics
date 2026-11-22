import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';

// Independent-session lock evidence, not a claim that serialized rollback
// scenarios simulate concurrent HTTP delivery. No business data is written.
if(process.env.VERIFY_AUTHORIZED_RDS_ROLLBACK!=='true')throw new Error('Explicit RDS verification opt-in is required.');
const url=getConfig().databaseUrl,target=new URL(url);
if(target.hostname!=='mehta-controldesk-db01.chs2eymsy2ec.ap-southeast-2.rds.amazonaws.com'||decodeURIComponent(target.pathname.slice(1))!=='postgres'||target.searchParams.get('sslmode')!=='require')throw new Error('Unexpected verification target.');
const first=connectPostgres(url,{postgresOptions:{max:1,connect_timeout:10}}),second=connectPostgres(url,{postgresOptions:{max:1,connect_timeout:10}});
const report={startedAt:new Date().toISOString(),checks:[],cleanup:'NO_BUSINESS_WRITES',limitation:'Proves exclusion/release of the actual shared allocation lock across independent connections; does not certify simultaneous duplicate HTTP deliveries.'};
try{
 for(let i=0;i<10;i++){
  let unlock,ready;
  const gate=new Promise(resolve=>{unlock=resolve;}),held=new Promise(resolve=>{ready=resolve;});
  const owner=first.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(812731)`;ready();await gate;});
  try{
   await Promise.race([held,owner]);
   await second.begin(async tx=>{const [r]=await tx`SELECT pg_try_advisory_xact_lock(812731) AS acquired`;assert.equal(r.acquired,false);});
  }finally{unlock();await owner;}
  await second.begin(async tx=>{const [r]=await tx`SELECT pg_try_advisory_xact_lock(812731) AS acquired`;assert.equal(r.acquired,true);});
  report.checks.push({id:'INDEPENDENT-LOCK-'+(i+1),status:'PASS'});console.log('PASS independent lock exclusion/release',i+1);
 }
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=e.message;process.exitCode=1;console.error(e.message);}
finally{await Promise.allSettled([first.end({timeout:5}),second.end({timeout:5})]);report.finishedAt=new Date().toISOString();fs.mkdirSync('verification-output/sales-intake',{recursive:true});fs.writeFileSync('verification-output/sales-intake/independent-locks.json',JSON.stringify(report,null,2));}
