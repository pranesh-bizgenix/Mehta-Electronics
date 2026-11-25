import {SupportIntakeService} from './service.js';
export const createSupportIntake=options=>new SupportIntakeService(options);
export function supportIntakeRoutes({service,route,json,readJson}){const company=url=>url.searchParams.get('companyId');return [
 route('GET','/api/crm/support-intake','operations.read',async({res,url,user})=>json(res,200,await service.list(user,url.searchParams))),
 route('GET','/api/crm/support-intake/options','operations.read',async({res,url,user})=>json(res,200,{data:await service.options(user,url.searchParams)})),
 route('GET','/api/crm/support-intake/:id','operations.read',async({res,url,user,params})=>json(res,200,{data:await service.detail(user,params.id,company(url))})),
 ...[['review','review'],['cases','handoff'],['actions','action']].map(([suffix,method])=>route('POST',`/api/crm/support-intake/:id/${suffix}`,'operations.write',async({req,res,url,user,params})=>json(res,200,{data:await service[method](user,params.id,company(url),await readJson(req))})))
];}
