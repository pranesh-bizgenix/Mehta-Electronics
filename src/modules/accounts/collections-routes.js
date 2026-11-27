import {CollectionsService} from './collections-service.js';
export function collectionsRoutes({db,route,json,readJson,operations,work}){const s=new CollectionsService({db,operations,work});return [
 route('GET','/api/crm/accounts/collections/ageing','collections.read',async({res,user,url})=>json(res,200,{data:await s.ageing(user,Object.fromEntries(url.searchParams))})),
 route('GET','/api/crm/accounts/collections/invoices/:id','collections.read',async({res,user,params})=>json(res,200,{data:await s.invoice(user,params.id)})),
 route('POST','/api/crm/accounts/collections/scopes','collections.write',async({req,res,user})=>json(res,201,{data:await s.requestScope(user,await readJson(req))})),
 route('POST','/api/crm/accounts/collections/scopes/:id/review','collections.approve',async({req,res,user,params})=>json(res,200,{data:await s.reviewScope(user,params.id,await readJson(req))})),
 route('GET','/api/crm/accounts/collections/batches','collections.read',async({res,user})=>json(res,200,{data:await s.batches(user)})),
 route('GET','/api/crm/accounts/collections/batches/:id','collections.read',async({res,user,params})=>json(res,200,{data:await s.batch(user,params.id)})),
 route('POST','/api/crm/accounts/collections/batches','collections.write',async({req,res,user})=>json(res,201,{data:await s.createBatch(user,await readJson(req))})),
 route('POST','/api/crm/accounts/collections/batches/:id/review','collections.approve',async({req,res,user,params})=>json(res,200,{data:await s.reviewBatch(user,params.id,await readJson(req))})),
 route('POST','/api/crm/accounts/collections/arrangements','collections.write',async({req,res,user})=>json(res,201,{data:await s.arrangement(user,await readJson(req))})),
 route('POST','/api/crm/accounts/collections/arrangements/:id/review','collections.approve',async({req,res,user,params})=>json(res,200,{data:await s.reviewArrangement(user,params.id,await readJson(req))})),
 route('POST','/api/crm/accounts/collections/adjustments','collections.write',async({req,res,user})=>json(res,201,{data:await s.adjustment(user,await readJson(req))})),
 route('POST','/api/crm/accounts/collections/adjustments/:id/review','collections.approve',async({req,res,user,params})=>json(res,200,{data:await s.reviewAdjustment(user,params.id,await readJson(req))})),
 route('POST','/api/crm/accounts/collections/batches/:id/pdf','collections.read',async({req,res,user,params})=>{const b=await readJson(req),f=await s.batchPdf(user,params.id,b);res.writeHead(200,{'content-type':'application/pdf','content-length':f.bytes.length,'content-disposition':`${b?.preview?'inline':'attachment'}; filename="${f.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(f.bytes);}),
 route('POST','/api/crm/accounts/collections/pdf','collections.read',async({req,res,user})=>{const b=await readJson(req),f=await s.pdf(user,b);res.writeHead(200,{'content-type':'application/pdf','content-length':f.bytes.length,'content-disposition':`${b?.preview?'inline':'attachment'}; filename="${f.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(f.bytes);})
];}
