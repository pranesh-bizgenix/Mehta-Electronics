import {SalesIntakeService} from './service.js';
import {AvailabilityService} from './availability.js';
import {validationFailed} from '../../core/errors.js';

export function createSalesIntake({db,work,clock}){return {intake:new SalesIntakeService({db,work,clock}),availability:new AvailabilityService({db,clock})};}
export function salesIntakeRoutes({services,route,json,readJson}){
 const {intake,availability}=services,company=url=>url.searchParams.get('companyId');
 const get=fn=>async ctx=>json(ctx.res,200,{data:await fn(ctx)});
 const post=fn=>async ctx=>{const b=await readJson(ctx.req);if(!b||typeof b!=='object'||Array.isArray(b))throw validationFailed('Provide a JSON object.');json(ctx.res,200,{data:await fn(ctx,b)});};
 return [
  route('GET','/api/crm/sales-intake','sales_intake.read',async({res,url,user})=>json(res,200,await intake.list(user,url.searchParams))),
  route('GET','/api/crm/sales-intake/metrics','sales_intake.read',get(c=>intake.metrics(c.user,company(c.url)))),
  route('GET','/api/crm/sales-intake/policy','rules.manage',get(c=>intake.settings(c.user,company(c.url)))),
  route('POST','/api/crm/sales-intake/policy','rules.manage',post((c,b)=>intake.savePolicy(c.user,company(c.url),b))),
  route('GET','/api/crm/sales-intake/:id','sales_intake.read',get(c=>intake.detail(c.user,c.params.id,company(c.url)))),
  route('POST','/api/crm/sales-intake/:id/review','sales_intake.review',post((c,b)=>intake.resolve(c.user,c.params.id,company(c.url),b))),
  route('POST','/api/crm/sales-intake/:id/response','sales_intake.review',post((c,b)=>intake.respond(c.user,c.params.id,company(c.url),b))),
  route('POST','/api/crm/sales-intake/:id/cancel','sales_intake.review',post((c,b)=>intake.cancel(c.user,c.params.id,company(c.url),b))),
  route('GET','/api/crm/logistics/availability','logistics.read',get(c=>availability.list(c.user,company(c.url),c.url.searchParams))),
  route('GET','/api/crm/logistics/availability/companies','logistics.read',get(c=>availability.companies(c.user))),
  route('GET','/api/crm/logistics/availability/:id','logistics.read',get(c=>availability.detail(c.user,c.params.id,company(c.url)))),
  route('POST','/api/crm/logistics/availability/:id','logistics.read',post((c,b)=>availability.command(c.user,c.params.id,company(c.url),b))),
  route('GET','/api/crm/quotations/:id/availability','quotations.read',get(c=>availability.forQuote(c.user,Number(c.params.id))))
 ];
}
