import {CATEGORIES,settingsIssues,uuid,fail} from './contracts.js';

const recent=(value,now)=>{
  const timestamp=Date.parse(value);
  return Number.isFinite(timestamp)&&timestamp<=now&&now-timestamp<=180000;
};

/** A connection or imported record never establishes permission to post. */
export function readinessSummary({company,control,categories,mappings,coverage,connectors,capabilities,now=Date.now()}){
  const bound=connectors.filter(row=>row.status==='active'&&row.expected_company_name===company.name&&row.selected_company===company.name);
  const connected=bound.filter(row=>row.tally_available===true&&recent(row.heartbeat_at,now));
  const writeObserved=connected.some(row=>capabilities.some(capability=>capability.connector_id===row.id&&capability.company_id===company.id&&capability.protocol===1&&capability.create_only===true&&recent(capability.reported_at,now)));
  const rows=CATEGORIES.map(category=>{
    const config=categories.find(row=>row.category===category)??{};
    const blockers=[];
    if(control?.master_enabled!==true)blockers.push('Master posting switch is OFF.');
    if(config.enabled!==true)blockers.push('Category posting switch is OFF.');
    if(config.paused===true)blockers.push('Category is paused.');
    if(config.company_id!==company.id)blockers.push('Category is not assigned to this company.');
    blockers.push(...settingsIssues({...config,approval_mode:config.approval_mode??control?.approval_mode},{live:true}));
    const mapping=mappings.find(row=>row.id===config.mapping_id&&row.category===category&&row.status==='APPROVED');
    if(!mapping||mapping.reviewed!==true)blockers.push('An independently approved mapping with Tally expert review is required.');
    const required=category==='PARTY_LEDGER'?['groups']:['voucher_types','ledgers','items','units','godowns'];
    for(const entity of required)if(!coverage.some(row=>row.entity===entity&&Number(row.count)>0))blockers.push(`No imported ${entity} records are available for mapping review.`);
    if(!connected.length)blockers.push('No recent Tally-available connector heartbeat for this company.');
    if(!writeObserved)blockers.push('Recent write-protocol evidence has not been verified for this company.');
    return {category,status:blockers.length?'BLOCKED':'REQUIRES_DOCUMENT_VALIDATION',blockers};
  });
  return {company:{id:company.id,name:company.name},observedAt:new Date(now).toISOString(),connection:connected.length?'AVAILABLE':'UNKNOWN_OR_OFFLINE',writeCapability:writeObserved?'RECENTLY_OBSERVED':'UNKNOWN',categories:rows,
    unsupported:[
      {record:'Quotation',reason:'No quotation posting category or reviewed Tally representation is implemented.'},
      {record:'Tax invoice',reason:'No invoice posting category is implemented; statutory issuance and ledger mappings require separate validation.'},
      {record:'Supplier PO document PDF',reason:'Document-only POs are separate from the operational supplier PO source supported by the write module.'},
      {record:'Other CRM records',reason:'Receipts, goods receipts, dispatches and support records do not yet have posting adapters. A PDF download does not create a Tally voucher.'}
    ],note:'Read-only readiness check. This does not queue records, enable posting, verify live XML import or certify end-to-end sync. Every document still requires source, identity, approval, mapping, duplicate and read-back validation.'};
}

export async function readReadiness(service,user,companyId){
  service.owner(user);uuid(companyId);
  // One statement keeps the observed company, mappings and connection facts in
  // one database snapshot. No status endpoint with housekeeping writes is used.
  const row=await service.one(`SELECT c.id,c.name,
    (SELECT to_jsonb(t) FROM tw_control t WHERE singleton) AS control,
    (SELECT jsonb_agg(to_jsonb(t)) FROM tw_categories t) AS categories,
    (SELECT jsonb_agg(jsonb_build_object('id',m.id,'category',m.category,'status',m.status,'reviewed',EXISTS(SELECT 1 FROM tw_mapping_evidence e WHERE e.mapping_id=m.id AND e.expert_name IS NOT NULL AND e.expert_reference IS NOT NULL AND e.expert_reviewed_at IS NOT NULL))) FROM tw_mapping_versions m WHERE m.company_id=c.id) AS mappings,
    (SELECT jsonb_agg(to_jsonb(n)) FROM (SELECT entity,count(*)::integer AS count FROM tally_visibility_current_cache WHERE company_id=c.id GROUP BY entity) n) AS coverage,
    (SELECT jsonb_agg(jsonb_build_object('id',t.id,'status',t.status,'expected_company_name',t.expected_company_name,'selected_company',h.selected_company,'tally_available',h.tally_available,'heartbeat_at',h.updated_at)) FROM tally_connectors t LEFT JOIN tally_connector_heartbeats h ON h.connector_id=t.id WHERE t.revoked_at IS NULL AND t.expected_company_name=c.name) AS connectors,
    (SELECT jsonb_agg(to_jsonb(t)) FROM tw_connector_capabilities t WHERE t.company_id=c.id) AS capabilities
    FROM tally_companies c WHERE c.id=?`,companyId);
  if(!row)fail(404,'Selected company is not imported.');
  return readinessSummary({company:row,control:row.control,categories:row.categories??[],mappings:row.mappings??[],coverage:row.coverage??[],connectors:row.connectors??[],capabilities:row.capabilities??[]});
}
