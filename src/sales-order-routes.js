import {orderList,orderDetail,saveOrder,orderAction,orderHistory,uploadOriginal,downloadOriginal,dispatchOrder,markDelivered,logisticsSearch,orderQuoteSource} from './sales-orders.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function salesOrderRoutes({db,route,json,readJson}){
 const body=async req=>{const b=await readJson(req);if(!b||typeof b!=='object'||Array.isArray(b))fail(422,'Provide a JSON object.');return b;};
 const save=(fn,code=200)=>async({req,res,params,user})=>json(res,code,{data:await fn(params,await body(req),user)});
 const original=shipment=>async({req,res,params,user})=>{
 if(!String(req.headers['content-type']||'').startsWith('application/json')||req.headers['content-encoding'])fail(415,'Upload an uncompressed JSON original.');
 let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>14*1024*1024)fail(413,'Original exceeds the 10 MB file limit.');chunks.push(c);}
 let b;try{b=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'Invalid upload JSON.');}if(!b||typeof b!=='object'||Array.isArray(b))fail(422,'Provide an upload object.');
 json(res,201,{data:await uploadOriginal(db,params.id,b,user,shipment?params.shipment:null)});
 };
 return [
 route('GET','/api/crm/order-quotes/:id','orders.create',async({res,params,user})=>json(res,200,{data:await orderQuoteSource(db,params.id,user)})),
 route('GET','/api/crm/orders','orders.read',async({res,url,user})=>json(res,200,await orderList(db,url,user))),
 route('POST','/api/crm/orders','orders.create',save((p,b,u)=>saveOrder(db,null,b,u),201)),
 route('GET','/api/crm/orders/:id','orders.read',async({res,params,user})=>json(res,200,{data:await orderDetail(db,params.id,user)})),
 route('PUT','/api/crm/orders/:id','orders.update',save((p,b,u)=>saveOrder(db,p.id,b,u))),
 route('POST','/api/crm/orders/:id/actions','orders.read',save((p,b,u)=>orderAction(db,p.id,b,u))),
 route('GET','/api/crm/orders/:id/history','orders.read',async({res,params,user})=>json(res,200,{data:await orderHistory(db,params.id,user)})),
 route('POST','/api/crm/orders/:id/po-original','orders.update',original(false)),
 route('GET','/api/crm/order-documents/:id','orders.read',async({res,params,user})=>{
 const d=await downloadOriginal(db,params.id,user);res.writeHead(200,{'content-type':d.mime_type,'content-disposition':`attachment; filename="original-${params.id}"; filename*=UTF-8''${encodeURIComponent(d.original_name)}`,'content-length':d.original_bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'"});res.end(d.original_bytes);
 }),
 route('GET','/api/crm/orders/:id/pick-list','orders.read',async({res,params,user})=>{const d=await orderDetail(db,params.id,user);json(res,200,{data:{orderNumber:d.order_number,status:d.effectiveStatus,lines:d.lines,stock:d.verification.stock}});}),
 route('POST','/api/crm/orders/:id/dispatch','orders.dispatch',save((p,b,u)=>dispatchOrder(db,p.id,b,u),201)),
 route('POST','/api/crm/orders/:id/shipments/:shipment/proof','orders.dispatch',original(true)),
 route('POST','/api/crm/shipments/:id/deliver','orders.dispatch',save((p,b,u)=>markDelivered(db,p.id,b,u))),
 route('GET','/api/crm/logistics','orders.read',async({res,url,user})=>json(res,200,await logisticsSearch(db,url,user)))
 ];
}
