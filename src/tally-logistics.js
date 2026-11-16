import {hasPermission} from './rbac.js';
import {readCompany,pagination} from './tally-read-service.js';
import {tallyFreshness} from './tally-freshness.js';

export const logisticsVoucherTypes=['Delivery Note','Receipt Note','Stock Journal','Physical Stock','Rejections In','Rejections Out'];
const scalar=value=>value==null?null:typeof value==='object'?scalar(value['#text']):String(value).trim()||null;
const array=value=>value==null?[]:Array.isArray(value)?value:[value];
const fail=(status,message)=>Object.assign(new Error(message),{status});
function authorize(user){
 if(!hasPermission(user,'logistics.read')||!hasPermission(user,'logistics.orders.read'))throw fail(403,'All-order logistics access is required. Store staff use assigned CRM orders.');
}
// Explicit operational whitelist: never return raw XML, rates, amounts, costs or ledger entries.
export function logisticsDocument(row){
 const raw=row.raw_record||{},field=name=>scalar(raw[name]),stored=name=>scalar(row.summary_fields?.[`/stored/${name}`]);
 const lines=[];
 for(const collection of ['ALLINVENTORYENTRIES.LIST','INVENTORYENTRIES.LIST','INVENTORYENTRIESIN.LIST','INVENTORYENTRIESOUT.LIST']){
  // Some exports repeat the all-inventory collection under its legacy alias.
  if(collection==='INVENTORYENTRIES.LIST'&&raw['ALLINVENTORYENTRIES.LIST'])continue;
  for(const item of array(raw[collection]))lines.push({position:lines.length+1,collection,item:scalar(item.STOCKITEMNAME),actualQuantity:scalar(item.ACTUALQTY),billedQuantity:scalar(item.BILLEDQTY),
   allocations:array(item['BATCHALLOCATIONS.LIST']).map(batch=>({godown:scalar(batch.GODOWNNAME),destinationGodown:scalar(batch.DESTINATIONGODOWNNAME),batch:scalar(batch.BATCHNAME),actualQuantity:scalar(batch.ACTUALQTY),billedQuantity:scalar(batch.BILLEDQTY),trackingNumber:scalar(batch.TRACKINGNUMBER),orderNumber:scalar(batch.ORDERNO)}))});
 }
 return {id:row.record_key,number:stored('voucher_number')||field('VOUCHERNUMBER'),type:stored('voucher_type')||field('VOUCHERTYPENAME'),date:stored('date')||field('DATE'),party:stored('party_name')||field('PARTYLEDGERNAME')||field('PARTYNAME'),status:stored('voucher_status'),reference:field('REFERENCE'),
  dispatch:{shippedBy:field('BASICSHIPPEDBY'),documentNumber:field('BASICSHIPDOCUMENTNO'),vesselOrVehicle:field('BASICSHIPVESSELNO')},observedAt:row.observed_at,lines,linesAvailable:Boolean(row.raw_record)};
}
export async function readTallyLogistics(db,url,user,key=null){
 authorize(user);
 const company=await readCompany(db,url),{page,pageSize}=pagination(url);
 const kind=url.searchParams.get('kind')||'documents',type=url.searchParams.get('type')||'',search=(url.searchParams.get('search')||'').trim();
 if(!['documents','godowns'].includes(kind)||type&&!logisticsVoucherTypes.includes(type)||search.length>200)throw fail(422,'Choose a supported logistics view/type and search at most 200 characters.');
 const args=[company.id],where=["c.company_id=?",kind==='godowns'?"c.entity='godowns'":"c.entity='vouchers'"];
 if(kind==='documents'){
  where.push(`c.summary_fields->>'/stored/voucher_type' IN (${logisticsVoucherTypes.map(()=>'?').join(',')})`);args.push(...logisticsVoucherTypes);
  if(type){where.push("c.summary_fields->>'/stored/voucher_type'=?");args.push(type);}
 }
 if(key){where.push('c.record_key=?');args.push(key);}
 if(search){where.push("(strpos(lower(c.name),lower(?))>0 OR strpos(lower(COALESCE(c.summary_fields->>'/stored/party_name','')),lower(?))>0 OR strpos(lower(COALESCE(c.summary_fields->>'/stored/voucher_number','')),lower(?))>0)");args.push(search,search,search);}
 const predicate=where.join(' AND '),freshness=await tallyFreshness(db,company.id,kind==='godowns'?['godownsXml']:['logisticsDocumentsXml','vouchersXml']);
 const total=(await db.prepare(`SELECT count(*) AS n FROM tally_visibility_current_cache c WHERE ${predicate}`).get(...args)).n;
 const rows=await db.prepare(`SELECT c.record_key,c.name,c.summary_fields,c.observed_at,${key?'r.raw_record':'NULL AS raw_record'} FROM tally_visibility_current_cache c ${key?'LEFT JOIN tally_visibility_records r ON r.id=c.record_id AND r.company_id=c.company_id AND r.entity=c.entity':''} WHERE ${predicate} ORDER BY c.observed_at DESC,c.record_key LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize);
 if(key&&!rows.length)throw fail(404,'Logistics document not found in the selected company.');
 const data=rows.map(row=>kind==='godowns'?{id:row.record_key,name:row.name,parent:scalar(row.summary_fields?.['/stored/parent_name']),observedAt:row.observed_at}:logisticsDocument(row));
 return {company,readOnly:true,freshness,data:key?data[0]:data,pagination:{page,pageSize,total,pages:Math.ceil(total/pageSize)},note:'Tally source records only. Godown masters and voucher movements do not establish current stock by location, CRM GRN approval, delivery proof or staff assignments. Custom voucher types need an explicit confirmed mapping.'};
}
