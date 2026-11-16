import {hasPermission} from './rbac.js';
import {readCompany} from './tally-read-service.js';
import {readItemSources,itemLinkMatches} from './tally-item-links.js';
import {tallyRecordHref} from '../public/crm-navigation.js';
import {forbidden,validationFailed} from './core/errors.js';

/** Only explicitly linked masters, public identifiers and the selected company. */
export async function searchLinkedTally(db,url,user){
 const customers=hasPermission(user,'customers.read'),items=hasPermission(user,'items.read');
 if(!customers&&!items)throw forbidden('Customer or item read access is required.');
 const company=await readCompany(db,url),term=(url.searchParams.get('search')||'').trim();
 if(term.length>200)throw validationFailed('Search at most 200 characters.');
 if(term.length<2)return {company,data:[]};
 const data=[],query=term.toLocaleLowerCase('en-IN');
 if(customers){
  const rows=await db.prepare(`SELECT DISTINCT c.record_key,c.name,c.observed_at,d.id AS crm_id,d.name AS crm_name,d.gstin
   FROM tally_visibility_crm_links l JOIN tally_visibility_current_cache c ON c.company_id=l.company_id AND c.entity=l.entity AND c.record_key=l.record_key
   JOIN customers d ON d.id=l.crm_id
   WHERE l.company_id=? AND l.entity='ledgers' AND l.crm_kind='customer' AND d.status='ACTIVE'
   AND (NULLIF(c.summary_fields->>'/stored/tally_guid','') IS NOT NULL OR NULLIF(c.summary_fields->>'/stored/master_id','') IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM tally_visibility_crm_links other WHERE other.company_id=l.company_id AND other.entity=l.entity AND other.record_key=l.record_key AND other.crm_kind='customer' AND other.crm_id<>l.crm_id)
   AND (strpos(lower(c.name),lower(?))>0 OR strpos(lower(d.name),lower(?))>0 OR strpos(lower(COALESCE(d.gstin,'')),lower(?))>0)
   ORDER BY c.name,c.record_key,d.id LIMIT 5`).all(company.id,term,term,term);
  for(const row of rows)data.push({id:`customer:${row.record_key}`,kind:'customer',source:'Tally',label:row.name,hint:row.gstin||row.crm_name,crmId:row.crm_id,crmHref:`/customers/${row.crm_id}`,companyId:company.id,recordKey:row.record_key,href:tallyRecordHref('customers',company.id,row.record_key),observedAt:row.observed_at});
 }
 if(items){
  const links=await db.prepare(`SELECT l.item_id,l.tally_guid,l.tally_master_id,i.part_code,i.description FROM crm_tally_item_links l JOIN items i ON i.id=l.item_id
   WHERE l.company_id=? AND l.tally_record_key IS NOT NULL AND l.status='ACTIVE' AND NOT l.is_deleted AND i.status='ACTIVE'`).all(company.id);
  if(links.length){
   const guid=new Map(),master=new Map();
   for(const link of links){const map=link.tally_guid?guid:master,key=link.tally_guid?link.tally_guid.toLowerCase():link.tally_master_id;if(!key)continue;const group=map.get(key)||[];group.push(link);map.set(key,group);}
   const sources=(await readItemSources(db,company.id)).filter(row=>row.stable).sort((a,b)=>(a.part_code||a.name).localeCompare(b.part_code||b.name)||a.record_key.localeCompare(b.record_key));
   let found=0;
   for(const row of sources){
    const candidates=[...(row.guid?guid.get(row.guid.toLowerCase())||[]:[]),...(row.master_id?master.get(row.master_id)||[]:[])].filter(link=>itemLinkMatches(link,row));
    if(new Set(candidates.map(link=>link.item_id)).size!==1)continue;
    const linked=candidates[0];if(![row.name,row.part_code,row.description,row.hsn,linked.part_code,linked.description].some(value=>typeof value==='string'&&value.toLocaleLowerCase('en-IN').includes(query)))continue;
    data.push({id:`item:${row.record_key}`,kind:'item',source:'Tally',label:row.part_code||row.name,hint:row.description||linked.description||row.name,crmId:linked.item_id,crmHref:`/items?open=${linked.item_id}`,companyId:company.id,recordKey:row.record_key,href:tallyRecordHref('items',company.id,row.record_key),observedAt:row.observed_at});
    if(++found===5)break;
   }
  }
 }
 return {company,data};
}
