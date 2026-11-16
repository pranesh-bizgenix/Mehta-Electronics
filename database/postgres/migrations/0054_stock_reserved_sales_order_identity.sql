CREATE OR REPLACE FUNCTION crm_stock_reserved_owner(source_company uuid,crm_order integer,reservation text) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH source AS (
  SELECT record_key,nullif(summary_fields->>'/stored/guid','') AS guid,nullif(summary_fields->>'/stored/master_id','') AS master_id
  FROM tally_visibility_current_cache WHERE company_id=source_company AND entity='vouchers' AND summary_fields->>'/stored/voucher_type'='Sales Order'
   AND (lower(nullif(summary_fields->>'/stored/guid',''))=lower(reservation)
    OR nullif(summary_fields->>'/stored/guid','') IS NULL AND summary_fields->>'/stored/master_id'=reservation)
 ), bindings AS (
  SELECT DISTINCT j.crm_sales_order_id FROM tally_sync_job_items j JOIN source s
   ON j.external_id=ANY(ARRAY[s.record_key,s.guid,s.master_id,'guid:'||s.guid,'master:'||s.master_id])
  WHERE j.company_id=source_company AND j.entity_kind='sales_order'
   AND upper(j.status) IN ('STORED','SUCCEEDED','SUCCESS','IN_TALLY') AND j.crm_sales_order_id IS NOT NULL
 ) SELECT (SELECT count(*) FROM source)=1 AND (SELECT count(*) FROM bindings)=1 AND EXISTS(SELECT 1 FROM bindings WHERE crm_sales_order_id=crm_order)
$$;
