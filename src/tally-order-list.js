import {readCompany,pagination} from './tally-read-service.js';
import {validationFailed} from './core/errors.js';
import {tallyFreshness} from './tally-freshness.js';
export async function selectedOrderCompany(db,url){
 if(url.searchParams.getAll('companyId').length!==1||!url.searchParams.get('companyId'))throw validationFailed('Select exactly one imported company before reading Tally orders.',{fields:[{path:'companyId',message:'is required exactly once'}]});
 return readCompany(db,url);
}
export async function listTallyOrders(db,url){
 const company=await selectedOrderCompany(db,url),{page,pageSize}=pagination(url),kind=url.searchParams.get('kind');
 if(kind&&!['sales_orders','purchase_orders'].includes(kind))throw validationFailed('Choose sales_orders or purchase_orders.');
 const search=String(url.searchParams.get('search')||'').trim().slice(0,200);
 const types=kind==='sales_orders'?['Sales Order']:kind==='purchase_orders'?['Purchase Order']:['Sales Order','Purchase Order'];
 const where=`company_id=? AND entity='vouchers' AND summary_fields->>'/stored/voucher_type' IN (${types.map(()=>'?').join(',')})${search?" AND (strpos(lower(COALESCE(summary_fields->>'/stored/voucher_number','')),lower(?))>0 OR strpos(lower(COALESCE(summary_fields->>'/stored/party_name','')),lower(?))>0)":''}`;
 const args=[company.id,...types,...(search?[search,search]:[])];
 const total=(await db.prepare(`SELECT count(*) AS n FROM tally_visibility_current_cache WHERE ${where}`).get(...args)).n;
 const data=await db.prepare(`SELECT record_key AS id,company_id,summary_fields->>'/stored/voucher_type' AS voucher_type,
 summary_fields->>'/stored/voucher_number' AS voucher_number,summary_fields->>'/stored/party_name' AS party_name,
 summary_fields->>'/stored/date' AS date,summary_fields->>'/stored/voucher_status' AS status,observed_at,has_raw
 FROM tally_visibility_current_cache WHERE ${where} ORDER BY summary_fields->>'/stored/date' DESC NULLS LAST,voucher_number DESC,record_key LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize);
 return {company,data,freshness:await tallyFreshness(db,company.id,kind==='sales_orders'?['salesOrdersXml']:kind==='purchase_orders'?['purchaseOrdersXml']:['salesOrdersXml','purchaseOrdersXml']),pagination:{page,pageSize,total,pages:Math.ceil(total/pageSize)},readOnly:true,source:'Tally connector imports'};
}
