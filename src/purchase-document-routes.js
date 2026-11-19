import * as service from './purchase-documents.js';
export function purchaseDocumentRoutes({db,route,json,readJson}){
 const body=async req=>{const b=await readJson(req);if(!b||typeof b!=='object'||Array.isArray(b))throw Object.assign(new Error('Provide a JSON object.'),{status:422});return b;};
 return [
 route('GET','/api/crm/purchase-documents/vendors','purchasing.read',async({res,url})=>json(res,200,{data:await db.prepare("SELECT id,payload FROM crm_procurement_vendors WHERE status='ACTIVE' AND NOT is_deleted AND payload->>'name' ILIKE ? ORDER BY payload->>'name',id LIMIT 50").all('%'+String(url.searchParams.get('search')||'').slice(0,200)+'%')})),
 route('GET','/api/crm/purchase-documents/permissions','rules.manage',async({res})=>json(res,200,{data:await db.prepare('SELECT key,description FROM permissions ORDER BY key').all()})),
 route('GET','/api/crm/purchase-documents/settings','purchasing.read',async({res})=>json(res,200,{data:await service.documentSettings(db)})),
 route('PUT','/api/crm/purchase-documents/settings','rules.manage',async({req,res,user})=>json(res,200,{data:await service.saveDocumentSettings(db,await body(req),user)})),
 route('GET','/api/crm/purchase-documents','purchasing.read',async({res,url,user})=>json(res,200,await service.listDocuments(db,url.searchParams.get('kind'),user,url))),
 route('POST','/api/crm/purchase-documents','purchasing.read',async({req,res,user})=>json(res,201,{data:await service.savePurchaseDocument(db,null,await body(req),user)})),
 route('GET','/api/crm/purchase-documents/:id','purchasing.read',async({res,params,user})=>json(res,200,{data:await service.getDocument(db,params.id,user)})),
 route('PUT','/api/crm/purchase-documents/:id','purchasing.read',async({req,res,params,user})=>json(res,200,{data:await service.savePurchaseDocument(db,params.id,await body(req),user)})),
 route('POST','/api/crm/purchase-documents/:id/actions','purchasing.read',async({req,res,params,user})=>json(res,200,{data:await service.actPurchaseDocument(db,params.id,await body(req),user)})),
 route('POST','/api/crm/purchase-documents/:id/pdf','purchasing.read',async({req,res,params,user})=>{
  const b=await body(req),file=await service.downloadPurchaseDocument(db,params.id,b,user);
  res.writeHead(200,{'content-type':'application/pdf','content-length':file.bytes.length,'cache-control':'no-store','content-disposition':`${b.preview?'inline':'attachment'}; filename="${file.number.replace(/[^A-Za-z0-9_-]/g,'-')}.pdf"`,'x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'; frame-ancestors 'self'"});res.end(file.bytes);
 })];
}
