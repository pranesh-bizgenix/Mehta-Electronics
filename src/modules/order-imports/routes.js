import {OrderWorkbookService} from './service.js';
import {validationFailed} from '../../core/errors.js';
import {CustomerOrderRegister} from './register.js';
export function orderWorkbookRoutes({db,route,json,readJson}){
 const service=new OrderWorkbookService({db}),register=new CustomerOrderRegister(service),root='/api/crm/order-imports';
 const upload=async req=>{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)throw Object.assign(new Error('Choose a workbook up to 8 MiB.'),{status:413});chunks.push(chunk);}try{const b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!b||typeof b!=='object'||Array.isArray(b))throw new Error();return b;}catch{throw validationFailed('Provide a valid XLSX upload.');}};
 return [
  route('GET','/api/crm/customer-order-register','orders.read',async({res,user,url})=>json(res,200,{data:await register.list(user,Object.fromEntries(url.searchParams))})),
  route('POST',root+'/columns','orders.update',async({req,res,user})=>json(res,200,{data:await service.columns(user,await upload(req))})),
  route('POST',root+'/manual','orders.update',async({req,res,user})=>json(res,201,{data:await service.createManual(user,await readJson(req))})),
  route('POST',root+'/:id/rows','orders.update',async({req,res,user,params})=>json(res,201,{data:await service.append(user,params.id,await readJson(req))})),
  route('POST',root+'/:id/visibility','orders.update',async({req,res,user,params})=>json(res,200,{data:await service.visibility(user,params.id,await readJson(req))})),
  route('GET',root,'orders.read',async({res,user,url})=>json(res,200,{data:await service.list(user,Object.fromEntries(url.searchParams))})),
  route('POST',root+'/preview','orders.update',async({req,res,user})=>json(res,200,{data:await service.preview(user,await upload(req))})),
  route('POST',root,'orders.update',async({req,res,user})=>json(res,201,{data:await service.capture(user,await upload(req))})),
  route('GET',root+'/:id','orders.read',async({res,user,params})=>json(res,200,{data:await service.batch(user,params.id)})),
  route('GET',root+'/:id/rows','orders.read',async({res,user,params,url})=>json(res,200,{data:await service.rows(user,params.id,Object.fromEntries(url.searchParams))})),
  route('GET',root+'/:id/review','orders.read',async({res,user,params})=>json(res,200,{data:await service.reviewPlan(user,params.id)})),
  route('PUT',root+'/:id/context','orders.update',async({req,res,user,params})=>json(res,200,{data:await service.context(user,params.id,await readJson(req))})),
  route('PUT',root+'/:id/rows/:row','orders.update',async({req,res,user,params})=>json(res,200,{data:await service.editRow(user,params.id,params.row,await readJson(req))})),
  route('POST',root+'/:id/submit','orders.update',async({req,res,user,params})=>json(res,200,{data:await service.submit(user,params.id,await readJson(req))})),
  route('POST',root+'/:id/decision','orders.review',async({req,res,user,params})=>json(res,200,{data:await service.decide(user,params.id,await readJson(req))})),
  route('POST',root+'/:id/original','orders.read',async({req,res,user,params})=>{const b=await readJson(req),f=await service.original(user,params.id,b?.reason);res.writeHead(200,{'content-type':f.mimeType,'content-length':f.bytes.length,'content-disposition':`attachment; filename="${f.filename.replace(/[^A-Za-z0-9_.() -]/g,'_')}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(f.bytes);}),
  route('POST',root+'/:id/pdf','orders.read',async({req,res,user,params})=>{const b=await readJson(req),f=await service.pdf(user,params.id,b);res.writeHead(200,{'content-type':'application/pdf','content-length':f.bytes.length,'content-disposition':`${b?.preview?'inline':'attachment'}; filename="${f.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(f.bytes);})
 ];
}
