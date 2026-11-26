import {hasPermission} from '../../rbac.js';
import {forbidden,validationFailed} from '../../core/errors.js';
export function shipmentFilters(query){
 const page=Number(query.get('page')??'1'),search=(query.get('search')??'').trim(),status=query.get('status')??'';
 if(!Number.isSafeInteger(page)||page<1||page>1000000||search.length>200||!['','DISPATCHED','DELIVERED'].includes(status))throw validationFailed('Choose a valid shipment page, search and status.');
 return {page,search,status};
}
export async function shipmentRegister(db,actor,query){
 if(!hasPermission(actor,'orders.read'))throw forbidden();
 const f=shipmentFilters(query),args=[f.search,f.search,f.status,f.status];
 const from=`FROM crm_shipments s JOIN sales_orders o ON o.id=s.sales_order_id JOIN customers c ON c.id=o.customer_id
 WHERE NOT s.is_deleted AND (?='' OR strpos(lower(concat_ws(' ',o.order_number,c.name,s.lr_number,s.transporter)),lower(?))>0) AND (?='' OR s.status=?)`;
 const rows=await db.prepare(`SELECT s.id,s.sales_order_id AS "orderId",o.order_number AS "orderNumber",c.name AS customer,
 s.status,s.lr_number AS "lrNumber",s.transporter,s.vehicle_number AS vehicle,s.created_at AS "dispatchedAt",
 (SELECT count(*)::integer FROM crm_order_documents d WHERE d.shipment_id=s.id AND d.kind='DELIVERY_PROOF' AND d.status='ACTIVE' AND NOT d.is_deleted) AS "proofCount"
 ${from} ORDER BY s.created_at DESC,s.id DESC LIMIT 25 OFFSET ?`).all(...args,(f.page-1)*25);
 const {total}=await db.prepare(`SELECT count(*)::integer AS total ${from}`).get(...args);
 return {data:rows,pagination:{page:f.page,pageSize:25,total},note:'Manual dispatch records only. No live carrier tracking is connected. Open the order to retain delivery proof and confirm delivery.'};
}
export function dispatchRoutes({db,route,json}){return [route('GET','/api/crm/dispatch/shipments','orders.read',async({res,user,url})=>json(res,200,await shipmentRegister(db,user,url.searchParams)))];}
