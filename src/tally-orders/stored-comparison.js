import {selectedOrderCompany} from '../tally-order-list.js';
import {normalizeTallyOrder} from './normalize.js';
import {compareOrders} from './compare.js';
import {hasPermission} from '../rbac.js';
import {readItemSources,itemLinkMatches} from '../tally-item-links.js';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const key=value=>{if(typeof value!=='string'||!value.trim()||value.length>300)fail(422,'Select a stored order.');return value;};

async function retainedOrder(db,companyId,recordKey,kind){
 const row=await db.prepare(`SELECT c.record_key,c.record_id,c.observed_at,c.summary_fields,r.raw_record
 FROM tally_visibility_current_cache c JOIN tally_visibility_records r
 ON r.id=c.record_id AND r.company_id=c.company_id AND r.entity=c.entity
 WHERE c.company_id=? AND c.entity='vouchers' AND c.record_key=?`).get(companyId,key(recordKey));
 if(!row)fail(404,'The selected order has no retained source in this company.');
 const expected=kind==='sales_orders'?'Sales Order':'Purchase Order';
 if(row.summary_fields?.['/stored/voucher_type']!==expected)fail(422,`Select a ${expected}.`);
 let document;
 try{document=normalizeTallyOrder(row.raw_record,{companyId,kind});}catch(error){fail(422,error.message);}
 if(document.voucherType!==expected)fail(409,'Stored order type differs from its original. Re-import before comparing.');
 if(document.lines.length>200)fail(422,'Comparison supports up to 200 lines per document.');
 const storedStatus=row.summary_fields?.['/stored/voucher_status'];
 if(['CANCELLED','DELETED','OPTIONAL'].includes(storedStatus))document.status=storedStatus;
 return {document,source:{recordKey:row.record_key,snapshotId:row.record_id,observedAt:row.observed_at,number:document.number}};
}

/** Selected retained records only. No live fetch, posting, approval or association. */
export async function compareStoredOrders(db,url,body,user){
 if(!['OWNER','ACCOUNTS'].includes(user?.role)||!hasPermission(user,'tally.read'))fail(403,'Order comparison requires Owner or Accounts with Tally read access.');
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['mode','salesOrderKey','purchaseOrderKey','customerOrderId','netExTaxConfirmed'].includes(k)))fail(422,'Choose stored orders and a comparison type. Supplied document contents are not accepted.');
 if(!['CUSTOMER_PO','SUPPLIER_PO'].includes(body.mode))fail(422,'Choose customer PO or supplier PO comparison.');
 if(typeof body.netExTaxConfirmed!=='boolean')fail(422,'Confirm whether the compared prices exclude tax.');
 const company=await selectedOrderCompany(db,url);
 return db.withConnection(async()=>{
  await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   const sales=await retainedOrder(db,company.id,body.salesOrderKey,'sales_orders');
   let other;
   if(body.mode==='SUPPLIER_PO'){
    if(body.customerOrderId!==undefined)fail(422,'Choose only a supplier Purchase Order.');
    other=await retainedOrder(db,company.id,body.purchaseOrderKey,'purchase_orders');
   }else{
    if(!hasPermission(user,'orders.read'))fail(403,'Customer PO comparison requires sales order read access.');
    if(body.purchaseOrderKey!==undefined||!Number.isSafeInteger(body.customerOrderId)||body.customerOrderId<1)fail(422,'Select a saved CRM customer PO.');
    const row=await db.prepare('SELECT sales_order_id,version,status,public_snapshot FROM crm_order_workflows WHERE sales_order_id=?').get(body.customerOrderId);
    if(!row)fail(404,'Customer PO not found.');
    const snapshot=row.public_snapshot;
    if(snapshot.companyId!==company.id)fail(422,'The customer PO must be explicitly bound to the selected company.');
    if(snapshot.supplyType!=='DOMESTIC_STANDARD')fail(422,'The customer PO currency basis is not supported.');
    const sources=await readItemSources(db,company.id);
    const links=await db.prepare("SELECT item_id,tally_guid,tally_master_id FROM crm_tally_item_links WHERE company_id=? AND status='ACTIVE' AND NOT is_deleted AND tally_record_key IS NOT NULL").all(company.id);
    const identity=source=>source.guid?`guid:${source.guid.toLowerCase()}`:`master:${source.master_id}`;
    // Names resolve only against a unique stable master; CRM items additionally
    // require an explicit active link. CRM numeric IDs are never Tally IDs.
    for(const line of sales.document.lines){
     const matches=sources.filter(s=>s.stable&&(line.itemId?(s.guid?.toLowerCase()===line.itemId.toLowerCase()||s.master_id===line.itemId):s.name===line.itemCode));
     line.itemId=matches.length===1?identity(matches[0]):null;
     if(!line.itemId)line.itemCode=null;
    }
    const lines=snapshot.lines.map(line=>{
     const candidates=links.filter(l=>l.item_id===line.itemId).flatMap(l=>sources.filter(s=>s.stable&&itemLinkMatches(l,s)));
     const identities=[...new Set(candidates.map(identity))];
     return {itemId:identities.length===1?identities[0]:null,itemCode:null,description:line.partCode,quantity:line.quantity,unit:line.uom,unitPrice:line.unitPrice,discountPercent:line.discountPercent,netAmount:line.net,taxPercent:line.taxPercent,hsn:line.hsn??null};
    });
    other={document:{id:String(row.sales_order_id),companyId:company.id,kind:'customer_po',currency:'INR',status:row.status,lines},source:{orderId:row.sales_order_id,version:row.version,number:snapshot.poNumber,source:'CRM_ENTERED_CUSTOMER_PO'}};
   }
   const data=compareOrders(sales.document,other.document,{mode:body.mode,netExTaxConfirmed:body.netExTaxConfirmed});
   const result={data,company,sources:{salesOrder:sales.source,purchaseOrder:other.source},readOnly:true,note:'Selected stored records only. This comparison does not verify original customer PO entry, approve orders, prove stock availability or update Tally.'};
   await db.exec('COMMIT');return result;
  }catch(error){await db.exec('ROLLBACK');throw error;}
 });
}
