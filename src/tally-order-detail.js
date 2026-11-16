import {selectedOrderCompany} from './tally-order-list.js';
import {mapTallySalesDocument} from './tally-sales-documents.js';
import {isTallyFinancial} from './tally-visibility-service.js';
import {tallyFreshness} from './tally-freshness.js';
const scalar=value=>value==null?null:typeof value==='object'?scalar(value['#text']):String(value).trim()||null;
const array=value=>value==null?[]:Array.isArray(value)?value:[value];
export async function tallyOrderDetail(db,url,key,user){
 const company=await selectedOrderCompany(db,url);
 const row=await db.prepare(`SELECT c.record_key,c.summary_fields,c.observed_at,c.session_id,r.raw_record,r.payload_id
 FROM tally_visibility_current_cache c LEFT JOIN tally_visibility_records r ON r.id=c.record_id AND r.company_id=c.company_id AND r.entity=c.entity
 WHERE c.company_id=? AND c.entity='vouchers' AND c.record_key=? AND c.summary_fields->>'/stored/voucher_type' IN ('Sales Order','Purchase Order')`).get(company.id,key);
 if(!row)throw Object.assign(new Error('Tally order not found in the selected company.'),{status:404});
 const raw=row.raw_record??{},document=mapTallySalesDocument(raw),financial=isTallyFinancial(user),field=name=>row.summary_fields?.[`/stored/${name}`]??null;
 const inventories=array(raw['ALLINVENTORYENTRIES.LIST']||raw['INVENTORYENTRIES.LIST']);
 const lines=document.lines.map((line,index)=>({position:line.position,item:line.stockItemName,description:line.description,itemId:line.stockItemId,
  actualQuantity:line.actualQuantity,billedQuantity:line.billedQuantity,unit:line.unit,
  pendingQuantity:scalar(inventories[index]?.PENDINGQTY),dueDate:scalar(inventories[index]?.ORDERDUEDATE),
  ...(financial?{rate:line.rate,amount:line.amount,discountPercent:line.discountPercent}:{} )}));
 const dataset=(field('voucher_type')||document.voucher_type)==='Purchase Order'?'purchaseOrdersXml':'salesOrdersXml';
 const payload=financial&&row.payload_id?await db.prepare('SELECT id,dataset FROM tally_raw_payloads WHERE id=? AND company_id=?').get(row.payload_id,company.id):null;
 return {company,readOnly:true,financial,freshness:await tallyFreshness(db,company.id,[dataset]),data:{id:row.record_key,
  type:field('voucher_type')||document.voucher_type,number:field('voucher_number')||document.voucher_number,
  party:field('party_name')||document.party_name,date:field('date')||document.date,status:field('voucher_status')||document.voucher_status,
  effectiveDate:scalar(raw.EFFECTIVEDATE),reference:document.reference,referenceDate:scalar(raw.REFERENCEDATE),observedAt:row.observed_at,
  lines,linesAvailable:Boolean(row.raw_record),...(financial?{totals:document.totals,currency:document.currency}:{}),
  originalPayload:payload?{id:payload.id,dataset:payload.dataset,path:`/api/v1/tally/retained/payloads/${payload.id}`}:null,
  note:'Quantities and financial strings are preserved as delivered. Pending quantity is shown only when Tally supplies PENDINGQTY; actual minus billed is not treated as pending. Source status is not fulfilment status.'}};
}
