import {DeliveryCommitmentService} from './commitments.js';
export function commitmentRoutes({db,route,json,readJson}){const s=new DeliveryCommitmentService({db});return [
 route('GET','/api/crm/delivery/sources','authenticated',async({res,user,url})=>json(res,200,{data:await s.sources(user,url.searchParams.get('kind'),Object.fromEntries(url.searchParams))})),
 route('GET','/api/crm/delivery/customer/:id/coverage','authenticated',async({res,user,params})=>json(res,200,{data:await s.coverage(user,params.id)})),
 route('GET','/api/crm/delivery/:kind/:id','authenticated',async({res,user,params})=>json(res,200,{data:await s.parent(user,params.kind,params.id)})),
 route('POST','/api/crm/delivery/commitments','authenticated',async({req,res,user})=>json(res,201,{data:await s.create(user,await readJson(req))})),
 route('POST','/api/crm/delivery/commitments/:id/review','authenticated',async({req,res,user,params})=>json(res,200,{data:await s.review(user,params.id,await readJson(req))})),
 route('POST','/api/crm/delivery/:kind/:id/pdf','authenticated',async({req,res,user,params})=>{const b=await readJson(req),f=await s.pdf(user,params.kind,params.id,b);res.writeHead(200,{'content-type':'application/pdf','content-length':f.bytes.length,'content-disposition':`${b?.preview?'inline':'attachment'}; filename="${f.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(f.bytes);})
];}
