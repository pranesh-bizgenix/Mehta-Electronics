// Stable source-key + company links are authoritative; names are display values only.
export const stableCustomerLinkExists = `EXISTS(SELECT 1 FROM tally_visibility_crm_links vl
  JOIN tally_visibility_current_cache vc ON vc.company_id=vl.company_id AND vc.entity=vl.entity AND vc.record_key=vl.record_key
  WHERE vl.crm_kind='customer' AND vl.crm_id=r.id AND vl.entity='ledgers'
  AND (NULLIF(vc.summary_fields->>'/stored/tally_guid','') IS NOT NULL OR NULLIF(vc.summary_fields->>'/stored/master_id','') IS NOT NULL))`;

export async function stableCustomerLinks(db,customerId){
  return db.prepare(`SELECT l.company_id,l.record_key,c.name AS company_name,v.name,
    v.summary_fields->>'/stored/tally_guid' AS tally_guid,v.summary_fields->>'/stored/master_id' AS master_id,
    v.summary_fields->>'/stored/closing_balance' AS closing_balance,v.summary_fields->>'/stored/dr_cr' AS dr_cr,v.observed_at AS fetched_at
    FROM tally_visibility_crm_links l JOIN tally_visibility_current_cache v ON v.company_id=l.company_id AND v.entity=l.entity AND v.record_key=l.record_key
    JOIN tally_companies c ON c.id=l.company_id WHERE l.crm_kind='customer' AND l.crm_id=? AND l.entity='ledgers'
    AND (NULLIF(v.summary_fields->>'/stored/tally_guid','') IS NOT NULL OR NULLIF(v.summary_fields->>'/stored/master_id','') IS NOT NULL) ORDER BY l.company_id,l.record_key`).all(customerId);
}
