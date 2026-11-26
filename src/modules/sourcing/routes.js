import {SourcingService} from './service.js';
export function sourcingRoutes({db,route,json,readJson}){const s=new SourcingService({db});return [
 route('GET','/api/crm/sourcing/conversions','purchasing.read',async({res,user})=>json(res,200,{data:await s.conversions(user)})),
 route('POST','/api/crm/sourcing/conversions','purchasing.write',async({req,res,user})=>json(res,201,{data:await s.createConversion(user,await readJson(req))})),
 route('POST','/api/crm/sourcing/conversions/:id/decision','purchasing.approve',async({req,res,user,params})=>json(res,200,{data:await s.decideConversion(user,params.id,await readJson(req))})),
 route('GET','/api/crm/sourcing/rfqs/:id','purchasing.read',async({res,user,params})=>json(res,200,{data:await s.comparison(user,params.id)})),
 route('POST','/api/crm/sourcing/rfqs/:id/offers','purchasing.write',async({req,res,user,params})=>json(res,200,{data:await s.recordOffer(user,params.id,await readJson(req))})),
 route('POST','/api/crm/sourcing/rfqs/:id/pdf','purchasing.read',async({req,res,user,params})=>{const b=await readJson(req),file=await s.pdf(user,params.id,b.reason,b.preview===true);res.writeHead(200,{'content-type':'application/pdf','content-length':file.bytes.length,'content-disposition':`${b.preview===true?'inline':'attachment'}; filename="${file.filename}"`,'cache-control':'no-store'});res.end(file.bytes);})
];}
