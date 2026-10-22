import * as p from './procurement.js';
import {genericSupplierPoWorkbook} from './procurement-xlsx.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function procurementRoutes({db,route,json,readJson}){
 const save=(fn,status=200)=>async({req,res,params,user})=>{const b=await readJson(req);if(!b||typeof b!=='object'||Array.isArray(b))fail(422,'Provide a JSON object.');json(res,status,{data:await fn(params,b,user)});};
 return [
 route('GET','/api/crm/purchasing/vendor-sources','purchasing.read',async({res})=>json(res,200,{data:await db.prepare("SELECT id,name,gstin,phone,email,address,company_id FROM crm_parties WHERE party_role='VENDOR' AND status='ACTIVE' AND NOT is_deleted ORDER BY name LIMIT 500").all()})),
 route('GET','/api/crm/purchasing/order-source/:id','purchasing.read',async({res,params,user})=>json(res,200,{data:await p.purchaseSource(db,params.id,user)})),
 route('POST','/api/crm/purchasing/vendors','purchasing.write',save((x,b,u)=>p.saveVendor(db,null,b,u),201)),
 route('PUT','/api/crm/purchasing/vendors/:id','purchasing.write',save((x,b,u)=>p.saveVendor(db,x.id,b,u))),
 route('POST','/api/crm/purchasing/requests','purchasing.write',save((x,b,u)=>p.saveRequest(db,null,b,u),201)),
 route('PUT','/api/crm/purchasing/requests/:id','purchasing.write',save((x,b,u)=>p.saveRequest(db,x.id,b,u))),
 route('POST','/api/crm/purchasing/rfqs','purchasing.write',save((x,b,u)=>p.createRfq(db,b,u),201)),
 route('GET','/api/crm/purchasing/rfqs/:id/comparison','purchasing.read',async({res,params,user})=>json(res,200,{data:await p.rfqComparison(db,params.id,user)})),
 route('POST','/api/crm/purchasing/rfqs/:id/replies','purchasing.write',save((x,b,u)=>p.saveReply(db,x.id,b,u))),
 route('POST','/api/crm/purchasing/rfqs/:id/winner','purchasing.write',save((x,b,u)=>p.selectWinner(db,x.id,b,u))),
 route('POST','/api/crm/purchasing/pos','purchasing.write',save((x,b,u)=>p.saveSupplierPo(db,null,b,u),201)),
 route('PUT','/api/crm/purchasing/pos/:id','purchasing.write',save((x,b,u)=>p.saveSupplierPo(db,x.id,b,u))),
 route('GET','/api/crm/purchasing/pos/:id/detail','purchasing.read',async({res,params,user})=>json(res,200,{data:await p.supplierPoDetail(db,params.id,user)})),
 route('POST','/api/crm/purchasing/pos/:id/actions','purchasing.write',save((x,b,u)=>p.supplierPoAction(db,x.id,b,u))),
 route('GET','/api/crm/purchasing/pos/:id/export','purchasing.read',async({res,params,user,url})=>{
 if(url.searchParams.get('format')!=='generic')fail(409,'Connectwell export is pending the original Excel template. Generic export is available explicitly with format=generic.');
 const po=await p.purchaseRecord(db,'pos',params.id,user),bytes=genericSupplierPoWorkbook(po);res.writeHead(200,{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','content-disposition':`attachment; filename="${po.number}-GENERIC.xlsx"`,'cache-control':'no-store','content-length':bytes.length});res.end(bytes);
 }),
 route('POST','/api/crm/purchasing/pos/:id/grns','purchasing.write',save((x,b,u)=>p.createGrn(db,x.id,b,u),201)),
 route('GET','/api/crm/purchasing/grns/:id/check','purchasing.read',async({res,params,user})=>json(res,200,{data:await p.grnCheck(db,params.id,user)})),
 route('POST','/api/crm/purchasing/grns/:id/post','purchasing.approve',save((x,b,u)=>p.postGrn(db,x.id,b,u))),
 route('POST','/api/crm/purchasing/pos/:id/documents','purchasing.write',async({req,res,params,user})=>{
 if(!String(req.headers['content-type']||'').startsWith('application/json')||req.headers['content-encoding'])fail(415,'Upload uncompressed JSON.');let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>14*1024*1024)fail(413,'Original exceeds 10 MB.');chunks.push(c);}let b;try{b=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'Invalid upload JSON.');}if(!b||typeof b!=='object'||Array.isArray(b))fail(422,'Provide an upload object.');json(res,201,{data:await p.uploadSupplierDocument(db,params.id,b,user)});
 }),
 route('GET','/api/crm/purchasing/documents/:id/original','purchasing.read',async({res,params,user,url})=>{const d=await p.supplierOriginal(db,params.id,user),inline=url.searchParams.get('inline')==='1';res.writeHead(200,{'content-type':d.mime_type,'content-disposition':`${inline?'inline':'attachment'}; filename="original-${params.id}"; filename*=UTF-8''${encodeURIComponent(d.original_name)}`,'content-length':d.original_bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'SAMEORIGIN','content-security-policy':"sandbox; default-src 'none'; frame-ancestors 'self'"});res.end(d.original_bytes);}),
 route('PUT','/api/crm/purchasing/documents/:id/review-data','purchasing.write',save((x,b,u)=>p.saveDocumentReview(db,x.id,b,u))),
 route('GET','/api/crm/purchasing/documents/:id/comparison','purchasing.read',async({res,params,user})=>json(res,200,{data:await p.documentComparison(db,params.id,user)})),
 route('POST','/api/crm/purchasing/documents/:id/approve','purchasing.approve',save((x,b,u)=>p.approveDocument(db,x.id,b,u))),
 route('POST','/api/crm/purchasing/:kind/:id/cancel','purchasing.write',save((x,b,u)=>p.cancelPurchaseRecord(db,x.kind,x.id,b,u))),
 route('GET','/api/crm/purchasing/:kind/:id/history','purchasing.read',async({res,params,user})=>json(res,200,{data:await p.purchaseHistory(db,params.kind,params.id,user)})),
 route('GET','/api/crm/purchasing/:kind/:id','purchasing.read',async({res,params,user})=>json(res,200,{data:await p.purchaseRecord(db,params.kind,params.id,user)})),
 route('GET','/api/crm/purchasing/:kind','purchasing.read',async({res,url,params,user})=>json(res,200,await p.purchaseList(db,params.kind,url,user)))
 ];
}
