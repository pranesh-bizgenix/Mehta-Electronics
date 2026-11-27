import {PayablesService} from './payables-service.js';
export function payablesRoutes({db,route,json,readJson,rules}){
 const s=new PayablesService({db,rules}),root='/api/crm/accounts/payables';
 return [
  route('GET',root+'/sources','collections.read',async({res,user,url})=>json(res,200,{data:await s.sources(user,Object.fromEntries(url.searchParams))})),
  route('GET',root+'/sources/:id','collections.read',async({res,user,params})=>json(res,200,{data:await s.previewSource(user,Number(params.id))})),
  route('GET',root+'/approval-policy','collections.read',async({res,user})=>json(res,200,{data:await s.policy(user)})),
  route('GET',root,'collections.read',async({res,user,url})=>json(res,200,{data:await s.list(user,Object.fromEntries(url.searchParams))})),
  route('GET',root+'/:id','collections.read',async({res,user,params})=>json(res,200,{data:await s.detail(user,params.id)})),
  route('POST',root,'collections.write',async({req,res,user})=>json(res,201,{data:await s.createDue(user,await readJson(req))})),
  route('POST',root+'/:id/review','collections.approve',async({req,res,user,params})=>json(res,200,{data:await s.reviewDue(user,params.id,await readJson(req))})),
  route('POST',root+'/:id/payments','collections.write',async({req,res,user,params})=>json(res,201,{data:await s.requestPayment(user,params.id,await readJson(req))})),
  route('POST',root+'/payments/:id/review','collections.approve',async({req,res,user,params})=>json(res,200,{data:await s.reviewPayment(user,params.id,await readJson(req))})),
  route('POST',root+'/:id/notes','collections.write',async({req,res,user,params})=>json(res,201,{data:await s.requestNote(user,params.id,await readJson(req))})),
  route('POST',root+'/notes/:id/review','collections.approve',async({req,res,user,params})=>json(res,200,{data:await s.reviewNote(user,params.id,await readJson(req))})),
  route('POST',root+'/:id/pdf','collections.read',async({req,res,user,params})=>{const b=await readJson(req),f=await s.pdf(user,params.id,b);res.writeHead(200,{'content-type':'application/pdf','content-length':f.bytes.length,'content-disposition':`${b?.preview?'inline':'attachment'}; filename="${f.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(f.bytes);})
 ];
}
