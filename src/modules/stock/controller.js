import {AuditRepository,TransactionRunner,SystemClock} from '../../core/runtime.js';
import {forbidden} from '../../core/errors.js';
import {hasPermission} from '../../rbac.js';
import {readCompany} from '../../tally-read-service.js';
import {StockCheckRepository} from './repository.js';
import {StockCheckService} from './service.js';
import {stockFulfillmentRoutes} from './fulfillment.js';
export function stockCheckRoutes({db,route,json,readJson}){
 const service=new StockCheckService({db,repository:new StockCheckRepository(db),transactions:new TransactionRunner(db),audit:new AuditRepository(db),clock:new SystemClock(),access:{require(actor,key){if(!actor?.id||!hasPermission(actor,key))throw forbidden();}}});
 return [
  ...stockFulfillmentRoutes({db,route,json,readJson}),
  route('POST','/api/crm/stock-checks/preview','items.read',async({req,res,url,user})=>json(res,200,{data:await service.preview(user,await readCompany(db,url),await readJson(req))})),
  route('POST','/api/crm/stock-checks','orders.update',async({req,res,url,user})=>json(res,200,{data:await service.record(user,await readCompany(db,url),await readJson(req))})),
  route('GET','/api/crm/stock-checks','items.read',async({res,url,user})=>json(res,200,{data:await service.history(user,await readCompany(db,url),url.searchParams.get('page')??1)})),
  route('GET','/api/crm/stock-checks/daily','users.read',async({res,url,user})=>json(res,200,{data:await service.daily(user,await readCompany(db,url),url.searchParams.get('day'))}))
 ];
}
