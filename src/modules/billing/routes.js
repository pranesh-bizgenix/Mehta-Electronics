import * as billing from './service.js';
import {reportCatalogue,reportData,reportPdf,reportXlsx} from './reports.js';
import {validationFailed} from '../../core/errors.js';
export function billingRoutes({db,route,json,readJson,operations}){
 const body=async req=>{const b=await readJson(req);if(!b||typeof b!=='object'||Array.isArray(b))throw validationFailed('Provide an object.');return b;};
 const originalBody=async req=>{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>7*1024*1024)throw Object.assign(new Error('Invoice upload exceeds 5 MB PDF limit.'),{status:413});chunks.push(chunk);}try{const b=JSON.parse(Buffer.concat(chunks).toString());if(!b||typeof b!=='object'||Array.isArray(b))throw new Error();return b;}catch{throw validationFailed('Provide a valid invoice upload.');}};
 const file=(res,f,preview)=>{res.writeHead(200,{'content-type':f.mimeType||'application/pdf','content-length':f.bytes.length,'content-disposition':`${preview?'inline':'attachment'}; filename="${f.filename}"`,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'; frame-ancestors 'self'"});res.end(f.bytes);};
 return [
  route('GET','/api/crm/billing/settings','collections.read',async({res,user})=>{billing.financeAccess(user);json(res,200,{data:await billing.settings(db)});}),
  route('PUT','/api/crm/billing/settings','rules.manage',async({req,res,user})=>json(res,200,{data:await billing.saveSettings(db,user,await body(req))})),
  route('GET','/api/crm/billing','collections.read',async({res,user,url})=>json(res,200,await billing.list(db,user,Object.fromEntries(url.searchParams)))),
  route('POST','/api/crm/billing','collections.write',async({req,res,user})=>json(res,201,{data:await billing.create(db,user,await body(req))})),
  route('GET','/api/crm/billing/:id','collections.read',async({res,user,params})=>json(res,200,{data:await billing.detail(db,user,params.id)})),
  route('POST','/api/crm/billing/:id/original','collections.write',async({req,res,user,params})=>json(res,200,{data:await billing.upload(db,user,params.id,await originalBody(req))})),
  route('POST','/api/crm/billing/:id/actions','collections.write',async({req,res,user,params})=>json(res,200,{data:await billing.act(db,user,params.id,await body(req),{operations})})),
  route('POST','/api/crm/billing/:id/pdf','collections.read',async({req,res,user,params})=>{const b=await body(req);file(res,await billing.download(db,user,params.id,b),b.preview===true);}),
  route('GET','/api/crm/reports/catalogue','authenticated',async({res,user})=>json(res,200,{data:reportCatalogue(user)})),
  route('GET','/api/crm/reports/:kind','authenticated',async({res,user,params,url})=>json(res,200,{data:await reportData(db,user,params.kind,Object.fromEntries(url.searchParams))})),
  route('POST','/api/crm/reports/:kind/pdf','authenticated',async({req,res,user,params})=>{const b=await body(req);file(res,await reportPdf(db,user,params.kind,b),b.preview===true);}),
  route('POST','/api/crm/reports/:kind/xlsx','authenticated',async({req,res,user,params})=>file(res,await reportXlsx(db,user,params.kind,await body(req)),false))
 ];
}
