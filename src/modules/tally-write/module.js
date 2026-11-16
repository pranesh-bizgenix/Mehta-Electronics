import {TallyWriteReview} from './review.js';
import {category,uuid,fail,mayProduce} from './contracts.js';

const modules=new WeakMap();
export function tallyWriteActive(db,kind){return modules.get(db)?.master===true;}
export async function guardTallyWriteMutation(db,kind,entityId){
  if(!entityId||!tallyWriteActive(db,kind))return;
  const service=modules.get(db),config=await service.config(kind);if(!mayProduce(config.master_enabled,config))return;
  if(await service.one("SELECT id FROM tw_outbox WHERE category=? AND entity_id=? AND status IN ('CLAIMED','SENT','UNKNOWN') LIMIT 1",kind,String(entityId)))fail(409,'A Tally create is in flight or uncertain. Resolve its read-back before changing this CRM document.');
}
export async function requireTallyWriteConfirmation(db,kind,entityId){
  if(!tallyWriteActive(db,kind))return;
  const service=modules.get(db),config=await service.config(kind);if(!mayProduce(config.master_enabled,config))return;
  const source=await service.one('SELECT version FROM crm_order_workflows WHERE sales_order_id=?',entityId);
  const link=await service.one("SELECT l.id FROM tw_document_links l JOIN tw_outbox o ON o.id=l.outbox_id WHERE l.company_id=? AND l.category=? AND l.entity_id=? AND o.status='CONFIRMED' AND o.snapshot->>'version'=? LIMIT 1",config.company_id,kind,String(entityId),String(source?.version));
  if(!link)fail(409,'This order is awaiting confirmed Tally entry. Complete the write review and read-back before dispatch.');
}
export async function notifyTallyWrite(db,kind,entityId,user){
  if(!entityId||!tallyWriteActive(db,kind))return;
  const service=modules.get(db);let config;
  try{config=await service.config(kind);if(!mayProduce(config.master_enabled,config))return;await service.queue(user,{category:kind,entityId,reason:'Eligible CRM document changed; evaluate the configured Tally create policy.'},{internal:true});service.lastProducerError=null;}
  catch(error){
    service.lastProducerError='ENQUEUE_BLOCKED';if(!config?.company_id)return;
    try{await service.work(user,'Tally producer held an unready CRM document',async()=>{
      await service.change("UPDATE tw_outbox SET status='HELD',last_error='CRM_SOURCE_CHANGED_OR_UNREADY',updated_at=clock_timestamp() WHERE category=? AND entity_id=? AND status IN ('PENDING','APPROVED')",kind,String(entityId));
      await service.one('INSERT INTO tw_alerts(category,company_id,code,message,reason) VALUES(?,?,?,?,?) RETURNING id',kind,config.company_id,'ENQUEUE_BLOCKED',error.status?String(error.message).slice(0,500):'The write producer failed. Read sync and the CRM business action remain separate.','Configured write producer could not queue an eligible, validated snapshot.');
    });}catch{/* A write-side failure must not undo or throw from a committed business action. */}
  }
}
const object=value=>{if(!value||typeof value!=='object'||Array.isArray(value))fail(422,'A JSON object is required.');return value;};
function company(url){const values=url.searchParams.getAll('companyId');if(values.length!==1)fail(422,'Select exactly one company.');return uuid(values[0]);}
export function createTallyWriteModule({db,connectorStore,route,json,readJson,readConnectorJson}){
  const service=new TallyWriteReview(db);modules.set(db,service);
  const ownerGet=(path,fn)=>route('GET',path,'tally.write.manage',async ctx=>json(ctx.res,200,{data:await fn(ctx)}));
  const staffPost=(path,permission,fn,method='POST')=>route(method,path,permission,async ctx=>json(ctx.res,200,{data:await fn(ctx,object(await readJson(ctx.req)))}));
  const connectorPost=(path,fn)=>route('POST',path,null,async ctx=>{const connector=await connectorStore.authenticate(ctx.req.headers);json(ctx.res,200,{data:await fn(connector,object(await readConnectorJson(ctx.req)))});});
  const routes=[
    ownerGet('/api/tally-write/settings',ctx=>service.settings(ctx.user)),
    staffPost('/api/tally-write/control','tally.write.manage',(ctx,b)=>service.setControl(ctx.user,b),'PUT'),
    staffPost('/api/tally-write/categories/:category','tally.write.manage',(ctx,b)=>service.setCategory(ctx.user,category(ctx.params.category),b),'PUT'),
    staffPost('/api/tally-write/categories/:category/resume','tally.write.manage',(ctx,b)=>service.resume(ctx.user,category(ctx.params.category),b)),
    ownerGet('/api/tally-write/mappings',ctx=>service.mappings(ctx.user,company(ctx.url),category(ctx.url.searchParams.get('category')))),
    staffPost('/api/tally-write/mappings','tally.write.manage',(ctx,b)=>service.saveMapping(ctx.user,b)),
    ownerGet('/api/tally-write/mapping-candidates',ctx=>service.mappingDrafts.candidates(ctx.user,company(ctx.url),category(ctx.url.searchParams.get('category')))),
    staffPost('/api/tally-write/mapping-drafts','tally.write.manage',(ctx,b)=>service.mappingDrafts.draft(ctx.user,b)),
    ownerGet('/api/tally-write/mappings/:id/evidence',ctx=>service.mappingDrafts.evidence(ctx.user,company(ctx.url),ctx.params.id)),
    staffPost('/api/tally-write/mappings/:id/review-preview','tally.write.manage',(ctx,b)=>service.mappingDrafts.preview(ctx.user,{...b,mappingId:uuid(ctx.params.id)})),
    staffPost('/api/tally-write/mappings/:id/review-approve','tally.write.manage',(ctx,b)=>service.mappingDrafts.approved(ctx.user,{...b,parentVersionId:uuid(ctx.params.id)})),
    ownerGet('/api/tally-write/sources',ctx=>service.sourceOptions(ctx.user,company(ctx.url),ctx.url.searchParams.get('entity'),ctx.url.searchParams.get('search')??'')),
    staffPost('/api/tally-write/preview','tally.write.approve',(ctx,b)=>{uuid(b.companyId);if(b.category==='PARTY_LEDGER')uuid(b.entityId);else if(!/^[1-9]\d{0,9}$/.test(String(b.entityId)))fail(422,'Choose a CRM document ID.');return service.queue(ctx.user,{...b,dryRun:true});}),
    route('GET','/api/tally-write/outbox','tally.write.read',async ctx=>json(ctx.res,200,{data:await service.monitor(ctx.user,company(ctx.url))})),
    route('GET','/api/tally-write/outbox/:id','tally.write.read',async ctx=>json(ctx.res,200,{data:await service.job(ctx.user,company(ctx.url),ctx.params.id)})),
    staffPost('/api/tally-write/outbox/:id/approve','tally.write.approve',(ctx,b)=>service.approve(ctx.user,company(ctx.url),ctx.params.id,b)),
    staffPost('/api/tally-write/outbox/:id/actions','tally.write.approve',(ctx,b)=>{
      const companyId=company(ctx.url);
      if(b.action==='REQUEST_READBACK')return service.requestReadback(ctx.user,companyId,ctx.params.id,b);
      if(b.action==='RESOLVE_ABSENT')return service.resolveAbsent(ctx.user,companyId,ctx.params.id,b);
      return service.holdOrCancel(ctx.user,companyId,ctx.params.id,b);
    }),
    staffPost('/api/tally-write/party-reviews','tally.write.manage',(ctx,b)=>service.requestParty(ctx.user,b)),
    staffPost('/api/tally-write/party-reviews/:id/approve','tally.write.approve',async(ctx,b)=>{const result=await service.approveParty(ctx.user,ctx.params.id,b);if(tallyWriteActive(db,'PARTY_LEDGER'))await notifyTallyWrite(db,'PARTY_LEDGER',result.id,ctx.user);return result;}),
    staffPost('/api/tally-write/reconcile','tally.write.read',(ctx,b)=>service.reconcile(ctx.user,company(ctx.url),b.reason)),
    route('GET','/api/tally-write/banner','authenticated',async ctx=>json(ctx.res,200,{data:await service.banner()})),
    route('GET','/api/connectors/tally-write/config',null,async ctx=>json(ctx.res,200,{data:await service.connectorConfig(await connectorStore.authenticate(ctx.req.headers))})),
    connectorPost('/api/connectors/tally-write/claim',(c,b)=>service.claim(c,b)),
    connectorPost('/api/connectors/tally-write/authorize',(c,b)=>service.authorize(c,b)),
    connectorPost('/api/connectors/tally-write/result',(c,b)=>service.result(c,b))
  ];
  return {service,routes,observeHeartbeat:(c,b)=>service.observeHeartbeat(c,b),health:base=>service.health(base),
    async initialize(){try{await service.control();if(service.master)for(const c of await service.many('SELECT category FROM tw_categories'))await service.config(c.category);}catch{service.master=false;service.enabledCategories.clear();}}};
}
