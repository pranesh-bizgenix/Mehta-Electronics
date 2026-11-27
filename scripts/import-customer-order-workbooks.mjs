import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {getConfig} from '../src/config.js';
import {createDatabase} from '../src/postgres.js';
import {createModules} from '../src/modules/container.js';
import {OrderWorkbookService} from '../src/modules/order-imports/service.js';

// Retain the two user-supplied originals only. Customer, company, units and
// snapshot dates must be confirmed in the existing CRM review workflow.
const files=process.argv.slice(2),dry=files.includes('--dry-run'),paths=files.filter(p=>p!=='--dry-run');
if(paths.length!==2)throw new Error('Provide the two original XLSX paths, optionally with --dry-run.');
const expected=new Set(['Mehta Open Orders-26.10.2026 (3).xlsx','Mehta open order Oct.xlsx']);
if(paths.some(p=>!expected.delete(path.basename(p)))||expected.size)throw new Error('Only the two explicitly supplied customer order workbooks are accepted.');
const config=getConfig(),target=new URL(config.databaseUrl);
if(target.hostname!=='mehta-controldesk-db01.chs2eymsy2ec.ap-southeast-2.rds.amazonaws.com'||target.pathname!=='/postgres'||target.searchParams.get('sslmode')!=='require')throw new Error('Refusing an unexpected database target.');
const inputs=await Promise.all(paths.map(async file=>({filename:path.basename(file),base64:(await fs.readFile(file)).toString('base64'),requestKey:randomUUID(),reason:'Retain user-supplied customer PO/open-order workbook for unassigned source review; do not create operational orders.'})));
const decoder=new OrderWorkbookService({db:null});
const previews=inputs.map(input=>{const parsed=decoder.decode(input);return {filename:input.filename,sha256:parsed.sha256,summary:parsed.plan.summary};});
if(dry){console.log(JSON.stringify({mode:'DRY_RUN_NO_DATABASE_CONNECTION',files:previews},null,2));process.exit(0);}
const db=createDatabase(config);await db.ready();
try{
  const actor=await db.prepare("SELECT id,role FROM users WHERE email='owner@test.local' AND role='OWNER' AND status='ACTIVE'").get();
  if(!actor)throw new Error('The existing authorized test Owner is not active; no replacement account will be created.');
  const modules=createModules({db,config});await modules.ready();const service=new OrderWorkbookService({db}),results=[];
  for(const input of inputs){const result=await service.capture(actor,input),batch=result.batch;results.push({id:batch.id,filename:batch.filename,status:batch.status,customerId:batch.customer_id,sourceSummary:batch.source_summary,replayed:result.replayed});}
  await fs.mkdir('verification-output/crm-completion',{recursive:true});await fs.writeFile('verification-output/crm-completion/customer-order-workbooks.json',JSON.stringify({mode:'ORIGINAL_SOURCE_CAPTURE_ONLY',results},null,2));console.log(JSON.stringify(results,null,2));
}finally{await db.close();}
