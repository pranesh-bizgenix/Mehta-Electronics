import * as l from './logistics.js';
import {readTallyLogistics} from './tally-logistics.js';
import { createGrn,grnCheck,postGrn } from './procurement.js';
import { dispatchOrder,markDelivered,uploadOriginal } from './sales-orders.js';
export function logisticsRoutes({db,route,json,readJson}) {
  const upload=async req=>{
    if(!String(req.headers['content-type']||'').startsWith('application/json')||req.headers['content-encoding'])throw Object.assign(new Error('Upload uncompressed JSON.'),{status:415});
    let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>14*1024*1024)throw Object.assign(new Error('Photo upload exceeds 10 MB.'),{status:413});chunks.push(c);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('Invalid upload JSON.'),{status:400});}
  };
  const save=(fn,status=200)=>async({req,res,params,user})=>{
    const body=await (/\/(?:evidence|proof)$/.test(req.url?.split('?')[0]||'')?upload(req):readJson(req));
    if(!body||typeof body!=='object'||Array.isArray(body))throw Object.assign(new Error('Provide a JSON object.'),{status:422});
    json(res,status,{data:await fn(params,body,user)});
  };
  const get=fn=>async({res,params,user,url})=>json(res,200,{data:await fn(params,user,url)});
  return [
    route('GET','/api/crm/logistics/tally','logistics.orders.read',async({res,url,user})=>json(res,200,await readTallyLogistics(db,url,user))),
    route('GET','/api/crm/logistics/tally/:key','logistics.orders.read',async({res,url,user,params})=>json(res,200,await readTallyLogistics(db,url,user,params.key))),
    route('GET','/api/crm/logistics/orders','logistics.read',async({res,url,user})=>json(res,200,await l.logisticsOrders(db,url,user))),
    route('GET','/api/crm/logistics/orders/:id','logistics.read',get((p,u)=>l.logisticsOrderDetail(db,p.id,u))),
    route('POST','/api/crm/logistics/orders/:id/assignments','logistics.assignment.manage',save((p,b,u)=>l.assignStore(db,p.id,b,u))),
    route('GET','/api/crm/logistics/store-staff','logistics.assignment.manage',get(()=>db.prepare("SELECT id,name FROM users WHERE role='STORE_STAFF' AND status='ACTIVE' ORDER BY name").all())),
    route('GET','/api/crm/logistics/pos','logistics.grn.read',get((p,u)=>l.receivingPos(db,u))),
    route('GET','/api/crm/logistics/pos/:id','logistics.grn.read',get((p,u)=>l.receivingPo(db,p.id,u))),
    route('POST','/api/crm/logistics/pos/:id/grns','logistics.grn.manage',save((p,b,u)=>createGrn(db,p.id,b,u),201)),
    route('GET','/api/crm/logistics/grns/:id','logistics.read',get((p,u)=>l.logisticsGrn(db,p.id,u))),
    route('GET','/api/crm/logistics/grns/:id/check','logistics.grn.read',get((p,u)=>grnCheck(db,p.id,u))),
    route('POST','/api/crm/logistics/grns/:id/post','logistics.grn.post',save((p,b,u)=>postGrn(db,p.id,b,u))),
    route('POST','/api/crm/logistics/orders/:id/dispatch','logistics.dispatch.manage',save((p,b,u)=>dispatchOrder(db,p.id,b,u),201)),
    route('POST','/api/crm/logistics/shipments/:id/deliver','logistics.dispatch.manage',save((p,b,u)=>markDelivered(db,p.id,b,u))),
    route('POST','/api/crm/logistics/orders/:id/shipments/:shipment/proof','logistics.dispatch.manage',save((p,b,u)=>uploadOriginal(db,p.id,b,u,p.shipment),201)),
    route('POST','/api/crm/logistics/orders/:id/evidence','logistics.evidence.write',save((p,b,u)=>l.appendEvidence(db,'DISPATCH',p.id,b,u),201)),
    route('POST','/api/crm/logistics/grns/:id/evidence','logistics.evidence.write',save((p,b,u)=>l.appendEvidence(db,'GRN',p.id,b,u),201)),
    route('GET','/api/crm/logistics/evidence/:id/photo','logistics.read',async({res,params,user})=>{
      const photo=await l.evidencePhoto(db,params.id,user);res.writeHead(200,{'content-type':photo.photo_mime,'content-length':photo.photo_bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'"});res.end(photo.photo_bytes);
    })
  ];
}
