import {BankService} from './bank-service.js';
import {validationFailed} from '../../core/errors.js';
export function bankRoutes({db,route,json,readJson}){
 const service=new BankService({db});
 const upload=async req=>{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>3*1024*1024)throw Object.assign(new Error('Statement upload exceeds the 2 MiB CSV limit.'),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw validationFailed('Provide a valid statement upload.');}};
 return [
  route('GET','/api/crm/accounts/bank/accounts','collections.read',async({res,user})=>json(res,200,{data:await service.accounts(user)})),
  route('POST','/api/crm/accounts/bank/accounts','collections.write',async({req,res,user})=>json(res,201,{data:await service.createAccount(user,await readJson(req))})),
  route('POST','/api/crm/accounts/bank/accounts/:id/verify','collections.approve',async({req,res,user,params})=>json(res,200,{data:await service.verifyAccount(user,params.id,await readJson(req))})),
  route('GET','/api/crm/accounts/bank/accounts/:id/statements','collections.read',async({res,user,params})=>json(res,200,{data:await service.list(user,params.id)})),
  route('POST','/api/crm/accounts/bank/preview','collections.write',async({req,res,user})=>json(res,200,{data:await service.preview(user,await upload(req))})),
  route('POST','/api/crm/accounts/bank/statements','collections.write',async({req,res,user})=>json(res,201,{data:await service.import(user,await upload(req))})),
  route('GET','/api/crm/accounts/bank/statements/:id','collections.read',async({res,user,params,url})=>json(res,200,{data:await service.detail(user,params.id,url.searchParams.get('page')||1)})),
  route('POST','/api/crm/accounts/bank/statements/:id/review','collections.approve',async({req,res,user,params})=>json(res,200,{data:await service.review(user,params.id,await readJson(req))})),
  route('GET','/api/crm/accounts/bank/statements/:id/matches','collections.read',async({res,user,params})=>json(res,200,{data:await service.matches(user,params.id)})),
  route('GET','/api/crm/accounts/bank/lines/:id/suggestions','collections.read',async({res,user,params})=>json(res,200,{data:await service.suggestions(user,params.id)})),
  route('POST','/api/crm/accounts/bank/lines/:id/proposals','collections.write',async({req,res,user,params})=>json(res,201,{data:await service.propose(user,params.id,await readJson(req))})),
  route('POST','/api/crm/accounts/bank/matches/:id/review','collections.approve',async({req,res,user,params})=>json(res,200,{data:await service.confirm(user,params.id,await readJson(req))})),
  route('POST','/api/crm/accounts/bank/statements/:id/pdf','collections.read',async({req,res,user,params})=>{const b=await readJson(req),f=await service.pdf(user,params.id,b);res.writeHead(200,{'content-type':'application/pdf','content-length':f.bytes.length,'content-disposition':`${b.preview?'inline':'attachment'}; filename="${f.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(f.bytes);})
 ];
}
