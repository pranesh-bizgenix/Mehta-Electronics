import {readSchema} from '../scripts/lib/schema-audit.mjs';
import {createModules} from '../src/modules/container.js';
import {automationCredentialRoutes} from '../src/modules/automation-api/credential-controller.js';
const protectedName=name=>/^(email_|automation_|outbound_|review_|task|work_|exception_|approval_)/.test(name)||['attachments','classifications','jobs','job_logs','alerts','notifications','customer_message_checklist','manual_response_exceptions','business_rule_values'].includes(name);
const protectedPath=path=>/^\/api\/v1\/(?:automation|messages|tasks|work-items|me\/work|exceptions|approvals)(?:\/|$)/.test(path)||/\/message-checklist(?:\/|$)/.test(path);
/** Metadata only: never reads messages, documents, customer data or credentials. */
export async function automationCompatibilitySurface(db,config){
 const schema=await readSchema(db.sql),tables=schema.tables.filter(row=>protectedName(row.name)).map(({name,type})=>({name,type})),names=new Set(tables.map(t=>t.name));
 const database=Object.fromEntries(['columns','constraints','indexes','triggers'].map(key=>[key,schema[key].filter(row=>names.has(row.table))]));
 const ownerRoutes=automationCredentialRoutes({service:{},route:(method,path,permission)=>({method,path,permission})});
 const endpoints=[...createModules({db,config}).routeDefinitions().filter(row=>protectedPath(row.path)),...ownerRoutes].map(row=>({method:row.method,path:row.path,permission:row.permission??'authenticated',idempotency:row.idempotency??null,mfaExempt:Boolean(row.mfaExempt)}));
 endpoints.push({method:'GET',path:'/api/v1/automation/switches',permission:'SERVICE:automation.read',idempotency:null,mfaExempt:false});
 endpoints.sort((a,b)=>`${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
 const permissions=await db.prepare('SELECT key,resource,action,description,owner_only FROM permissions ORDER BY key').all();
 return {database:schema.database,tables,...database,permissions,endpoints};
}
/** Existing members must remain byte-equivalent; additional members are allowed.
 * Enum/check changes are flagged for explicit compatibility review, never auto-blessed. */
export function compatibilityDifferences(baseline,current){
 const differences=[];
 if(current.database!==baseline.database)differences.push('database identity changed');
 for(const group of ['tables','columns','constraints','indexes','triggers','permissions','endpoints']){
  const key=row=>group==='endpoints'?`${row.method} ${row.path}`:group==='permissions'?row.key:group==='tables'?row.name:`${row.table}.${row.name}`;
  const found=new Map(current[group].map(row=>[key(row),row]));
  for(const old of baseline[group]){const actual=found.get(key(old));if(!actual)differences.push(`${group}: removed ${key(old)}`);else if(JSON.stringify(actual)!==JSON.stringify(old))differences.push(`${group}: changed ${key(old)}`);}
 }
 return differences;
}
