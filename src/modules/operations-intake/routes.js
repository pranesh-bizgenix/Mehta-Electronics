import {OperationsIntakeService} from './service.js';
export function createOperationsIntake(options){return new OperationsIntakeService(options);}
export function operationsIntakeRoutes({service,route,json,readJson}){
 const company=url=>url.searchParams.get('companyId');
 return [
  route('GET','/api/crm/operations-intake','authenticated',async({res,url,user})=>json(res,200,await service.list(user,url.searchParams))),
  route('GET','/api/crm/operations-intake/:id','authenticated',async({res,url,user,params})=>json(res,200,{data:await service.detail(user,params.id,company(url))})),
  route('GET','/api/crm/operations-intake/:id/stock-preview','authenticated',async({res,url,user,params})=>json(res,200,{data:await service.stockPreview(user,params.id,company(url))})),
  ...[['review','review'],['actions','action'],['purchase-request','procurement']].map(([suffix,method])=>route('POST',`/api/crm/operations-intake/:id/${suffix}`,'authenticated',async({req,res,url,user,params})=>json(res,200,{data:await service[method](user,params.id,company(url),await readJson(req))})))
 ];
}
