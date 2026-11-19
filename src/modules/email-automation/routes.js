import {writeAudit} from '../../db.js';
import {hasPermission} from '../../rbac.js';
import {createMockAdapter} from './mock-adapter.js';
import {createStoredAdapter} from './repository.js';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function pageRows(rows,params) {
  const integer=(key,fallback,max)=>{const raw=params.get(key)??String(fallback);if(!/^[1-9]\d*$/.test(raw)||Number(raw)>max)fail(422,`Invalid ${key}.`);return Number(raw);};
  const page=integer('page',1,100000),pageSize=integer('pageSize',20,100);
  const search=(params.get('search')||'').trim().toLowerCase();if(search.length>200)fail(422,'Search is too long.');
  const status=params.get('status');
  const filtered=rows.filter(row=>(!status||row.status===status)&&(!search||[row.id,row.subject,row.sender,row.name,row.stage,row.errorCode].some(v=>String(v??'').toLowerCase().includes(search))));
  return {data:filtered.slice((page-1)*pageSize,page*pageSize),pagination:{page,pageSize,total:filtered.length,pages:Math.max(1,Math.ceil(filtered.length/pageSize))}};
}
export async function integrationHealth(db) {
  let postgres={provider:'PostgreSQL',status:'Unknown',checkedAt:null};
  try {await db.prepare('SELECT 1 AS healthy').get();postgres={provider:'PostgreSQL',status:'Connected',checkedAt:new Date().toISOString()};}
  catch {postgres={provider:'PostgreSQL',status:'Unavailable',checkedAt:new Date().toISOString()};}
  return [postgres,...['Gmail','S3','AI provider'].map(provider=>({provider,status:'Not configured',checkedAt:null}))];
}
export function emailAutomationRoutes({db,config,route,json,adapter}) {
  if(!config.emailAutomationEnabled)return [];
  const source=adapter??(config.emailAutomationDataMode==='stored'?createStoredAdapter(db):createMockAdapter());
  const base='/api/v1/email-automation';
  const get=(suffix,permission,load)=>route('GET',base+suffix,permission,async context=>{
    // Defense in depth: use the same authoritative role provider as the app wrapper.
    if(!context.user)fail(401,'Authentication required.');
    if(!hasPermission(context.user,permission))fail(403,'Access restricted.');
    const result=await load(context);
    // The access event is real; no fictional IDs, subjects, bodies or file metadata enter audit_logs.
    await writeAudit(db,{userId:context.user.id,entity:'email-automation',recordId:!source.sample&&context.params?.id?context.params.id:'module',action:'VIEW_'+(suffix.includes(':id')?'EMAIL_DETAILS':suffix.slice(1).toUpperCase())});
    json(context.res,200,{...result,sample:source.sample,mode:source.sample?'Sample data':'Stored records'});
  });
  const snapshot=async()=>{const data=await source.read();return {...data,emails:data.emails.map(email=>({...email,attachmentCount:data.attachments.filter(a=>a.emailId===email.id).length}))};};
  return [
    get('/emails','email_automation.read',async({url})=>{const d=await snapshot();return {...pageRows(d.emails.map(({body,links,...row})=>row),url.searchParams),truncated:Boolean(d.truncated)};}),
    get('/emails/:id','email_automation.read',async({params,user})=>{const d=await snapshot(),email=d.emails.find(e=>e.id===params.id);if(!email)fail(404,'Email not found.');
      return {data:{...email,links:email.links.filter(link=>hasPermission(user,`${link.kind}.read`)),attachments:d.attachments.filter(a=>a.emailId===email.id),runs:d.runs.filter(r=>r.emailId===email.id)}};}),
    ...[['attachments','attachments'],['processing','runs'],['errors','runs']].map(([suffix,key])=>get('/'+suffix,'email_automation.read',async({url,user})=>{
      const d=await snapshot();let rows=d[key];
      if(suffix==='errors'){
        rows=d.runs.filter(r=>r.status==='Failed').map(r=>({...r,source:source.sample?'Sample processing run':'Processing run'}));
        if(hasPermission(user,'email_automation.integrations.read')){
          const health=await integrationHealth(db);
          rows.push(...health.filter(h=>h.status==='Unavailable').map(h=>({id:'integration-'+h.provider,emailId:null,stage:h.provider+' health check',status:'Failed',startedAt:h.checkedAt,finishedAt:h.checkedAt,errorCode:'INTEGRATION_UNAVAILABLE',source:'Real integration check'})));
        }
      }
      return {...pageRows(rows,url.searchParams),truncated:Boolean(d.truncated)};
    })),
    get('/dashboard','email_automation.read',async()=>{const d=await snapshot();return {data:{emails:d.emails.length,attachments:d.attachments.length,processed:d.emails.filter(e=>e.status==='Processed').length,pending:d.emails.filter(e=>e.status==='Pending').length,failed:d.runs.filter(r=>r.status==='Failed').length},truncated:Boolean(d.truncated)};}),
    get('/integrations','email_automation.integrations.read',async()=>({data:await integrationHealth(db)}))
  ];
}
