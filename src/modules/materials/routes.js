import {MaterialService} from './service.js';
export function materialRoutes({db,route,json,readJson,operations}){
 const service=new MaterialService({db,operations});return [
  route('GET','/api/crm/support/materials','operations.read',async({res,user,url})=>json(res,200,await service.list(user,url.searchParams))),
  route('GET','/api/crm/support/materials/eligible','operations.read',async({res,user,url})=>json(res,200,{data:await service.eligible(user,url.searchParams.get('search')||'')})),
  route('GET','/api/crm/support/materials/sources/:operation','operations.read',async({res,user,params})=>json(res,200,{data:await service.sources(user,params.operation)})),
  route('POST','/api/crm/support/materials','operations.write',async({req,res,user})=>json(res,201,{data:await service.open(user,await readJson(req))})),
  route('GET','/api/crm/support/materials/:id/resources','operations.read',async({res,user,params,url})=>json(res,200,{data:await service.resources(user,params.id,url.searchParams)})),
  route('GET','/api/crm/support/materials/:id','operations.read',async({res,user,params})=>json(res,200,{data:await service.detail(user,params.id)})),
  route('POST','/api/crm/support/materials/:id/actions','operations.write',async({req,res,user,params})=>json(res,200,{data:await service.act(user,params.id,await readJson(req))})),
  route('POST','/api/crm/support/materials/:id/pdf','operations.read',async({req,res,user,params})=>{const b=await readJson(req),f=await service.pdf(user,params.id,b);res.writeHead(200,{'content-type':'application/pdf','content-length':f.bytes.length,'content-disposition':`${b.preview?'inline':'attachment'}; filename="${f.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(f.bytes);})
 ];
}
