import { hasPermission } from './rbac.js';
import { TallyVisibilityService, visibilityPermission, visibilityKinds } from './tally-visibility-service.js';
import { TALLY_ENTITY_DESCRIPTORS } from '../public/tally-entity-descriptors.js';

const fail = (status,message) => Object.assign(new Error(message),{status});
/** Controller depends on the TallyService interface; tests may inject a service.
 * @type {import('./tally-visibility-contracts').TallyController}
 */
export function tallyVisibilityRoutes({db,route,json,readJson,service:injectedService}) {
  const service = injectedService || new TallyVisibilityService(db);
  const check = (user,kind) => {
    if (!visibilityKinds.includes(kind)) throw fail(404,'Unknown Tally entity.');
    if (!hasPermission(user,visibilityPermission(kind))) throw fail(403,'Permission denied.');
  };
  const routes = [
    route('GET','/api/tally/entities','authenticated',async({res,user})=>json(res,200,{data:Object.values(TALLY_ENTITY_DESCRIPTORS).filter(entity=>hasPermission(user,entity.permission))})),
    route('GET','/api/tally/inspection/:kind/sync','authenticated',async({res,url,user,params})=>{
      check(user,params.kind);json(res,200,await service.salesSummary(params.kind,url,user));
    }),
    route('GET','/api/tally/inspection/tree','tally.read',async({res,url,user})=>json(res,200,await service.tree(url,user))),
    route('GET','/api/tally/inspection/:kind/quality','authenticated',async({res,url,user,params})=>{
      check(user,params.kind);json(res,200,await service.quality(params.kind,url,user));
    }),
    route('GET','/api/tally/inspection/:kind/reconciliation','tally.read',async({res,url,user,params})=>{
      check(user,params.kind);json(res,200,await service.reconciliation(params.kind,url,user));
    }),
    route('POST','/api/tally/inspection/:kind/create-crm','authenticated',async({req,res,url,user,params,ip})=>{
      check(user,params.kind);
      if(!hasPermission(user,params.kind==='items'?'items.create':'customers.create'))throw fail(403,'CRM creation permission required.');
      const body=await readJson(req),keys=body.recordKeys;
      if(!Array.isArray(keys)||!keys.length||keys.length>100||keys.some(k=>typeof k!=='string'||k.length>300))throw fail(422,'Choose between 1 and 100 source IDs.');
      const data=[];
      for(const key of keys) {
        try{data.push({recordKey:key,...await service.createCrm(params.kind,key,url,user,ip)});}
        catch(error){if(!error.status)throw error;data.push({recordKey:key,error:error.message,status:error.status});}
      }
      json(res,200,{data});
    }),
    route('POST','/api/tally/retained/replay','tally.read',async({req,res,user,ip})=>{
      const body=await readJson(req);
      json(res,200,await service.replay(body.sessionId,user,ip));
    }),
    route('GET','/api/tally/visibility/overview','tally.read',async({res,url,user})=>{
      json(res,200,await service.overview(url,user));
    }),
    route('GET','/api/tally/visibility/:kind','authenticated',async({res,url,user,params})=>{
      check(user,params.kind); json(res,200,await service.list(params.kind,url,user));
    }),
    route('GET','/api/tally/visibility/:kind/:id','authenticated',async({res,url,user,params})=>{
      check(user,params.kind); json(res,200,await service.detail(params.kind,params.id,url,user));
    }),
    route('POST','/api/tally/visibility/:kind/export','authenticated',async({req,res,url,user,params,ip})=>{
      check(user,params.kind); const body=await readJson(req);
      if(url.searchParams.get('view')==='reconciliation'&&!hasPermission(user,'tally.read'))throw fail(403,'Reconciliation permission required.');
      json(res,200,await service.export(params.kind,url,user,body.columns,body.format,ip));
    }),
    route('GET','/api/tally/retained/payloads','tally.read',async({res,url,user})=>{
      json(res,200,await service.retainedPayloads(url,user));
    }),
    route('GET','/api/tally/retained/payloads/:id','tally.read',async({res,url,user,params})=>{
      json(res,200,await service.retainedPayloads(url,user,params.id));
    }),
    route('GET','/api/tally/retained/quarantine','tally.read',async({res,url,user})=>{
      json(res,200,await service.quarantine(url,user));
    })
  ];
  return routes.flatMap(definition=>[definition,route(definition.method,definition.pattern.replace('/api/tally/','/api/v1/tally/'),definition.permission,definition.handler)]);
}
