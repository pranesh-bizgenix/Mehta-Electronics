import {FieldVisitService} from './field-visit-service.js';
import {s,validate} from '../../core/schema.js';
export function fieldVisitRoutes({db,route,json,readJson,customers}){const service=new FieldVisitService({db,customers}),id=x=>validate(s.id(),x);return [
 route('GET','/api/crm/field-visits/current','customers.read',async({res,user})=>json(res,200,await service.current(user))),
 route('GET','/api/crm/customers/:id/visits','customers.read',async({res,user,params,url})=>json(res,200,await service.list(user,id(params.id),Number(url.searchParams.get('page')||1)))),
 route('POST','/api/crm/customers/:id/visits','customers.update',async({req,res,user,params})=>json(res,201,{data:await service.start(user,id(params.id),await readJson(req))})),
 route('POST','/api/crm/customers/:id/visits/:record/actions','customers.update',async({req,res,user,params})=>json(res,200,{data:await service.finish(user,id(params.id),params.record,await readJson(req))}))
 ];}
