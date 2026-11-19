import {TextDecoder} from 'node:util';
import {AppError,validationFailed} from '../../core/errors.js';
import {AuditRepository,TransactionRunner} from '../../core/runtime.js';
import {hasPermission} from '../../rbac.js';
import {forbidden} from '../../core/errors.js';
import {PriceImportRepository} from './repository.js';
import {PriceImportService} from './service.js';
import {PriceLevelRepository,PriceLevelService} from './levels.js';
import {resolveQuotationLevel} from './quotation-source.js';
import {s,validate} from '../../core/schema.js';
import {requireQuotableCustomer,requireCustomerHandler,contractForLine} from '../operations/customer-gates.js';
import {pricingToday} from './quotation-source.js';
import {ManualPriceService} from './manual.js';
import {PriceDispositionRepository,PriceDispositionService} from './disposition.js';
// This upload limit is local to pricing; the app's default JSON limit is unchanged.
async function readUpload(req){
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)throw new AppError(413,'PAYLOAD_TOO_LARGE','Price import requests must be at most 12 MiB.');chunks.push(chunk);}
 let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw validationFailed('Provide a valid UTF-8 JSON object.');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw validationFailed('Provide a JSON object.');return body;
}
export function priceImportRoutes({db,route,json,readJson}){
 const service=new PriceImportService({db,repository:new PriceImportRepository(db),transactions:new TransactionRunner(db),audit:new AuditRepository(db),access:{require(actor,permission){if(!actor?.id||!hasPermission(actor,permission))throw forbidden();}}});
 const levels=new PriceLevelService({db,repository:new PriceLevelRepository(db),transactions:new TransactionRunner(db),audit:new AuditRepository(db),access:{require(actor,permission){if(!actor?.id||!hasPermission(actor,permission))throw forbidden();}}});
 const upload=method=>async({req,res,user})=>json(res,200,{data:await service[method](user,await readUpload(req))});
 const manual=new ManualPriceService(service);
 const disposition=new PriceDispositionService({db,repository:new PriceDispositionRepository(db),transactions:new TransactionRunner(db),audit:new AuditRepository(db),access:service.access});
 return [
  route('GET','/api/crm/price-dispositions','items.list_price.read',async({res,url,user})=>json(res,200,{data:await disposition.list(user,url.searchParams.get('page')??1)})),
  route('GET','/api/crm/price-dispositions/:id','items.list_price.read',async({res,user,params})=>json(res,200,{data:await disposition.detail(user,params.id)})),
  route('POST','/api/crm/price-dispositions/preview','items.update',async({req,res,user})=>json(res,200,{data:await disposition.preview(user,await readJson(req))})),
  route('POST','/api/crm/price-dispositions','items.update',async({req,res,user})=>json(res,200,{data:await disposition.request(user,await readJson(req))})),
  route('POST','/api/crm/price-dispositions/:id/decision','items.update',async({req,res,user,params})=>json(res,200,{data:await disposition.decide(user,params.id,await readJson(req))})),
  route('POST','/api/crm/price-imports/manual/preview','items.update',async({req,res,user})=>json(res,200,{data:await manual.preview(user,await readJson(req))})),
  route('POST','/api/crm/price-imports/manual','items.update',async({req,res,user})=>json(res,200,{data:await manual.save(user,await readJson(req))})),
  route('GET','/api/crm/quotation-price-levels','quotations.create',async({res})=>{const rows=await new PriceLevelRepository(db).all();json(res,200,{data:[1,2,3,4].map(level=>{const row=rows.find(r=>r.level_number===level);return {level,label:row?.status==='CONFIRMED'&&!row.is_deleted?row.label:null};})});}),
  route('POST','/api/crm/quotation-price-level-preview','quotations.create',async({req,res,user})=>{
   const b=validate(s.object({customerId:s.id(),itemId:s.id(),quantity:s.string({pattern:/^\d{1,14}(?:\.\d{1,6})?$/}),level:s.int({min:1,max:4}),referenceDate:s.date().optional()}),await readJson(req));
   if(b.referenceDate&&(process.env.NODE_ENV==='production'||b.referenceDate>pricingToday()))throw validationFailed('Historical pricing preview is for development only and cannot use a future date.');
   const result=await new TransactionRunner(db).run(user,'Preview configured net quotation price',async()=>{
    await db.prepare('SELECT pg_advisory_xact_lock(812731)').get();
    await requireQuotableCustomer(db,b.customerId);await requireCustomerHandler(db,b.customerId,user);
    if(!await db.prepare("SELECT id FROM customers WHERE id=? AND status='ACTIVE' AND NOT is_deleted").get(b.customerId))throw validationFailed('Select an active customer.');
    const at=b.referenceDate??pricingToday(),value=await resolveQuotationLevel(db,b.level,b.itemId,b.quantity,at);
    await contractForLine(db,b.customerId,{itemId:b.itemId,quantity:b.quantity,unitPrice:value.unitPrice,discountPercent:'0'},at);
    return {level:value.level,unitPrice:value.unitPrice,currency:value.currency,fingerprint:value.fingerprint};
   });json(res,200,{data:result});
  }),
  route('GET','/api/crm/price-levels','items.list_price.read',async({res,user})=>json(res,200,{data:await levels.list(user)})),
  route('PUT','/api/crm/price-levels/:level','items.update',async({req,res,user,params})=>{const b=await readJson(req);if(!b||typeof b!=='object'||Array.isArray(b))throw validationFailed('Provide a JSON object.');json(res,200,{data:await levels.save(user,params.level,b)});}),
  route('GET','/api/crm/price-imports','items.list_price.read',async({res,user})=>json(res,200,{data:await service.list(user)})),
  route('GET','/api/crm/price-imports/:id','items.list_price.read',async({res,user,params,url})=>json(res,200,{data:await service.detail(user,params.id,url.searchParams.get('page')??1)})),
  route('POST','/api/crm/price-imports/inspect','items.list_price.read',upload('inspect')),
  route('POST','/api/crm/price-imports/preview','items.list_price.read',upload('preview')),
  route('POST','/api/crm/price-imports','items.update',upload('save')),
  route('POST','/api/crm/price-imports/:id/decision','items.update',async({req,res,user,params})=>{const b=await readJson(req);if(!b||typeof b!=='object'||Array.isArray(b))throw validationFailed('Provide a JSON object.');json(res,200,{data:await service.decide(user,params.id,b)});})
 ];
}
