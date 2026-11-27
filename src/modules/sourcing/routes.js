import {SourcingService} from './service.js';
import {SplitAwardService} from './awards.js';
import {SupplierPerformanceService} from './supplier-performance.js';
import {SupplierSchemeService} from './schemes.js';
export function sourcingRoutes({db,route,json,readJson}){const s=new SourcingService({db}),awards=new SplitAwardService({db}),performance=new SupplierPerformanceService({db}),schemes=new SupplierSchemeService({db});return [
 route('GET','/api/crm/sourcing/supplier-performance','purchasing.read',async({res,user,url})=>json(res,200,{data:await performance.read(user,Object.fromEntries(url.searchParams))})),
 route('POST','/api/crm/sourcing/supplier-performance/pdf','purchasing.read',async({res,user,req})=>{const b=await readJson(req),f=await performance.pdf(user,b||{});res.writeHead(200,{'content-type':'application/pdf','content-disposition':`${b.preview?'inline':'attachment'}; filename="${f.filename}"`,'content-length':f.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(f.bytes);}),
 route('GET','/api/crm/sourcing/suppliers/:id/schemes','purchasing.read',async({res,user,params})=>json(res,200,{data:await schemes.list(user,params.id)})),
 route('POST','/api/crm/sourcing/schemes','purchasing.write',async({res,user,req})=>json(res,201,{data:await schemes.create(user,await readJson(req))})),
 route('POST','/api/crm/sourcing/schemes/:id/decision','purchasing.approve',async({res,user,req,params})=>json(res,200,{data:await schemes.decide(user,params.id,await readJson(req))})),
 route('GET','/api/crm/sourcing/schemes/:id/progress','purchasing.read',async({res,user,url,params})=>json(res,200,{data:await schemes.progress(user,params.id,url.searchParams.get('asOf'))})),
 route('GET','/api/crm/sourcing/rfqs/:id/awards','purchasing.read',async({res,user,params})=>json(res,200,{data:await awards.list(user,params.id)})),
 route('POST','/api/crm/sourcing/rfqs/:id/awards','purchasing.write',async({res,user,params,req})=>json(res,201,{data:await awards.create(user,params.id,await readJson(req))})),
 route('GET','/api/crm/sourcing/awards/:id','purchasing.read',async({res,user,params})=>json(res,200,{data:await awards.detail(user,params.id)})),
 route('POST','/api/crm/sourcing/awards/:id/decision','purchasing.write',async({res,user,params,req})=>json(res,200,{data:await awards.act(user,params.id,await readJson(req))})),
 route('POST','/api/crm/sourcing/awards/:id/pdf','purchasing.read',async({res,user,params,req})=>{const b=await readJson(req),file=await awards.pdf(user,params.id,b?.reason,b?.preview===true);res.writeHead(200,{'content-type':'application/pdf','content-length':file.bytes.length,'content-disposition':`${b.preview===true?'inline':'attachment'}; filename="${file.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(file.bytes);}),
 route('GET','/api/crm/sourcing/conversions','purchasing.read',async({res,user})=>json(res,200,{data:await s.conversions(user)})),
 route('POST','/api/crm/sourcing/conversions','purchasing.write',async({req,res,user})=>json(res,201,{data:await s.createConversion(user,await readJson(req))})),
 route('POST','/api/crm/sourcing/conversions/:id/decision','purchasing.approve',async({req,res,user,params})=>json(res,200,{data:await s.decideConversion(user,params.id,await readJson(req))})),
 route('GET','/api/crm/sourcing/rfqs/:id','purchasing.read',async({res,user,params})=>json(res,200,{data:await s.comparison(user,params.id)})),
 route('POST','/api/crm/sourcing/rfqs/:id/offers','purchasing.write',async({req,res,user,params})=>json(res,200,{data:await s.recordOffer(user,params.id,await readJson(req))})),
 route('POST','/api/crm/sourcing/rfqs/:id/pdf','purchasing.read',async({req,res,user,params})=>{const b=await readJson(req),file=await s.pdf(user,params.id,b.reason,b.preview===true);res.writeHead(200,{'content-type':'application/pdf','content-length':file.bytes.length,'content-disposition':`${b.preview===true?'inline':'attachment'}; filename="${file.filename}"`,'cache-control':'no-store'});res.end(file.bytes);})
];}
