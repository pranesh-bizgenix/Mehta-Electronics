// Read original identity/brand fields without returning raw or financial payloads.
export const itemIdentitySql={
  guid:"COALESCE(NULLIF(r.fields->>'/stored/tally_guid',''),NULLIF(r.fields->>'/xml/GUID/#text',''),NULLIF(r.fields->>'/xml/GUID',''))",
  master:"COALESCE(NULLIF(r.fields->>'/stored/master_id',''),NULLIF(r.fields->>'/xml/MASTERID/#text',''),NULLIF(r.fields->>'/xml/MASTERID',''))"
};
export async function readItemSources(db,companyId,{financial=false}={}){
  const rows=await db.prepare(`SELECT c.company_id,c.record_key,c.record_id,c.name,c.parent_name,c.session_id,c.observed_at,
    ${itemIdentitySql.guid} AS guid,${itemIdentitySql.master} AS master_id,
    COALESCE(NULLIF(r.fields->>'/xml/PARTNO/#text',''),NULLIF(r.fields->>'/xml/PARTNO',''),NULLIF(r.fields->>'/xml/PARTNUMBER/#text',''),NULLIF(r.fields->>'/xml/PARTNUMBER',''),c.name) AS part_code,
    COALESCE(NULLIF(c.summary_fields->>'/stored/brand',''),NULLIF(r.fields->>'/xml/BRANDNAME/#text',''),NULLIF(r.fields->>'/xml/BRANDNAME',''),NULLIF(r.fields->>'/xml/BRAND/#text',''),NULLIF(r.fields->>'/xml/BRAND','')) AS brand,
    COALESCE(NULLIF(c.summary_fields->>'/stored/hsn',''),NULLIF(c.summary_fields->>'/derived/hsn','')) AS hsn,
    c.summary_fields->>'/stored/base_unit' AS uom,c.summary_fields->>'/stored/description' AS description,
    c.summary_fields->>'/stored/closing_quantity_text' AS closing_quantity_text
    ${financial?",c.summary_fields->>'/stored/closing_rate_text' AS closing_rate_text,c.summary_fields->>'/stored/closing_value' AS closing_value":''}
    FROM tally_visibility_current_cache c JOIN tally_visibility_records r ON r.id=c.record_id
    WHERE c.company_id=? AND c.entity='items' ORDER BY c.observed_at DESC,c.record_id DESC`).all(companyId);
  return canonicalItemSources(rows);
}
export function canonicalItemSources(rows){
  const time=value=>value instanceof Date?value.getTime():Date.parse(value);
  const groups=new Map();
  for(const row of rows){const guid=String(row.guid??'').trim(),master=String(row.master_id??'').trim();const identity=guid?`guid:${guid.toLowerCase()}`:master?`master:${master}`:null;
    const key=identity||`record:${row.record_key}`;const list=groups.get(key)||[];list.push({...row,guid:guid||null,master_id:master||null,identity});groups.set(key,list);}
  const sources=[...groups.values()].map(list=>{
    list.sort((a,b)=>time(b.observed_at)-time(a.observed_at)||b.record_id.localeCompare(a.record_id));
    const row=list[0],ambiguous=list.filter(r=>time(r.observed_at)===time(row.observed_at)).length>1;
    return {...row,stable:Boolean(row.identity&&!ambiguous),identityIssue:!row.identity?'No GUID or Master ID was delivered.':ambiguous?'Multiple items share this identity in the latest observation.':null};
  });
  const guidMasters=new Set(sources.filter(row=>row.guid&&row.master_id).map(row=>row.master_id));
  for(const row of sources)if(!row.guid&&row.master_id&&guidMasters.has(row.master_id)){row.stable=false;row.identityIssue='Master ID also identifies a GUID-bearing source; review the ambiguity.';}
  return sources;
}
export function itemLinkMatches(link,source){return Boolean(link.tally_guid?source.guid&&link.tally_guid.toLowerCase()===source.guid.toLowerCase():link.tally_master_id&&link.tally_master_id===source.master_id);}
export async function stableItemLinks(db,itemId,options={}){
  const links=await db.prepare("SELECT l.*,c.name AS company_name FROM crm_tally_item_links l JOIN tally_companies c ON c.id=l.company_id WHERE l.item_id=? AND l.status='ACTIVE' AND NOT l.is_deleted AND l.tally_record_key IS NOT NULL ORDER BY l.id").all(itemId);
  const sources=new Map(),out=[];
  for(const link of links){if(!sources.has(link.company_id))sources.set(link.company_id,await readItemSources(db,link.company_id,options));
    const found=sources.get(link.company_id).filter(s=>s.stable&&itemLinkMatches(link,s));
    if(found.length===1)out.push({...found[0],company_name:link.company_name});}
  return out;
}
const visibleGuid=itemIdentitySql.guid.replaceAll('r.fields','vr.fields'),visibleMaster=itemIdentitySql.master.replaceAll('r.fields','vr.fields');
export const stableItemLinkExists=`EXISTS(SELECT 1 FROM crm_tally_item_links sl JOIN tally_visibility_current_cache vc ON vc.company_id=sl.company_id AND vc.entity='items'
  JOIN tally_visibility_records vr ON vr.id=vc.record_id WHERE sl.item_id=r.id AND sl.status='ACTIVE' AND NOT sl.is_deleted AND sl.tally_record_key IS NOT NULL
  AND (sl.tally_guid IS NOT NULL AND lower(sl.tally_guid)=lower(${visibleGuid}) OR sl.tally_guid IS NULL AND sl.tally_master_id=${visibleMaster}))`;
export async function resolvedItemVisibilityLinks(db,companyId){
  const links=await db.prepare("SELECT item_id,tally_guid,tally_master_id FROM crm_tally_item_links WHERE company_id=? AND tally_record_key IS NOT NULL AND status='ACTIVE' AND NOT is_deleted").all(companyId);
  if(!links.length)return [];
  const sources=await readItemSources(db,companyId);
  return links.flatMap(link=>{const matches=sources.filter(s=>s.stable&&itemLinkMatches(link,s));return matches.length===1?[{record_key:matches[0].record_key,crm_kind:'item',crm_id:link.item_id,identity_confirmed:true}]:[];});
}
