import { hasPermission } from './rbac.js';
import {readTallyFreshness} from './tally-freshness.js';
import {tallySyncMonitor,retryTallyRead} from './tally-sync-monitor.js';
import {requestTallyRead} from './tally-read-requests.js';
import {TallyConflictService} from './tally-conflicts.js';
import {downloadRetainedPayload} from './tally-payload-download.js';
import { TallyVisibilityService, visibilityPermission, visibilityKinds } from './tally-visibility-service.js';
import { TALLY_ENTITY_DESCRIPTORS } from '../public/tally-entity-descriptors.js';

const fail = (status,message) => Object.assign(new Error(message),{status});
/** Controller depends on the TallyService interface; tests may inject a service.
 * @type {import('./tally-visibility-contracts').TallyController}
 */
export function tallyVisibilityRoutes({db,route,json,readJson,service:injectedService}) {
  const service = injectedService || new TallyVisibilityService(db);
  const conflicts=new TallyConflictService(db);
  const check = (user,kind) => {
    if (!visibilityKinds.includes(kind)) throw fail(404,'Unknown Tally entity.');
    if (!hasPermission(user,visibilityPermission(kind))) throw fail(403,'Permission denied.');
  };
  const routes = [
    route('GET','/api/tally/monitor','tally.read',async({res,url,user})=>json(res,200,await tallySyncMonitor(db,url,user))),
    route('POST','/api/tally/monitor/request-read','tally.sync',async({req,res,url,user})=>json(res,202,await requestTallyRead(db,url,await readJson(req),user))),
    route('POST','/api/tally/monitor/jobs/:id/retry','tally.sync',async({req,res,url,user,params})=>json(res,202,await retryTallyRead(db,url,params.id,await readJson(req),user))),
    route('GET','/api/tally/conflicts','tally.read',async({res,url,user})=>json(res,200,await conflicts.list(url,user))),
    route('POST','/api/tally/conflicts/detect','tally.sync',async({req,res,url,user})=>json(res,200,await conflicts.detect(url,await readJson(req),user))),
    route('GET','/api/tally/conflicts/:id','tally.read',async({res,url,user,params})=>json(res,200,await conflicts.detail(url,params.id,user))),
    route('POST','/api/tally/conflicts/:id/resolve','tally.sync',async({req,res,url,user,params})=>json(res,200,await conflicts.resolve(url,params.id,await readJson(req),user))),
    route('POST','/api/tally/conflicts/:id/recover','tally.sync',async({req,res,url,user,params})=>json(res,202,await conflicts.recover(url,params.id,await readJson(req),user))),
    route('GET','/api/tally/visibility/freshness','authenticated',async({res,url,user})=>json(res,200,await readTallyFreshness(db,url,user))),
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
      if(params.kind==='customers')throw fail(422,'Use the customer review wizard: preview selected actions with a reason, then commit with an Idempotency-Key.');
      if(params.kind==='items')throw fail(422,'Use the item review wizard: preview selected products with a reason, then commit with an Idempotency-Key.');
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
    route('POST','/api/tally/retained/replay','tally.read',async({req,res,url,user,ip})=>{
      const body=await readJson(req);
      json(res,200,await service.replay(body.sessionId,url,user,ip));
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
    route('GET','/api/tally/retained/payloads/:id/download','tally.read',async({res,url,user,params})=>{
      await downloadRetainedPayload(db,url,params.id,user,res);
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
