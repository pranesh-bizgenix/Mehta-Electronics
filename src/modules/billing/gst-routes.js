import {GstPreparationService} from './gst-preparation.js';
export function gstRoutes({db,route,json,readJson}){const service=new GstPreparationService({db});return [
 route('GET','/api/crm/accounts/gst','collections.read',async({res,user})=>json(res,200,{data:await service.list(user)})),
 route('POST','/api/crm/accounts/gst/preview','collections.write',async({req,res,user})=>json(res,200,{data:await service.preview(user,await readJson(req))})),
 route('POST','/api/crm/accounts/gst','collections.write',async({req,res,user})=>json(res,201,{data:await service.create(user,await readJson(req))})),
 route('GET','/api/crm/accounts/gst/:id','collections.read',async({res,user,params})=>json(res,200,{data:await service.detail(user,params.id)})),
 route('POST','/api/crm/accounts/gst/:id/decision','collections.write',async({req,res,user,params})=>json(res,200,{data:await service.decide(user,params.id,await readJson(req))})),
 route('POST','/api/crm/accounts/gst/:id/export','collections.read',async({req,res,user,params})=>json(res,200,{data:await service.export(user,params.id,await readJson(req))})),
 route('POST','/api/crm/accounts/gst/:id/pdf','collections.read',async({req,res,user,params})=>{const b=await readJson(req),f=await service.pdf(user,params.id,b);res.writeHead(200,{'content-type':'application/pdf','content-length':f.bytes.length,'content-disposition':`${b?.preview?'inline':'attachment'}; filename="${f.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(f.bytes);})
];}
