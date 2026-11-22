-- Keep applied 0063 immutable. A trigger shared by differently shaped tables
-- must not resolve intake-only NEW/OLD fields for policy/evidence records.
ALTER TABLE crm_quotation_availability_lines ADD COLUMN checked_source_fingerprint char(64);
CREATE OR REPLACE FUNCTION crm_sales_intake_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Sales intake records are retained; use an audited lifecycle action'; END IF;
 IF current_setting('mehta.sales_intake_write',true) IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'Use authorised sales intake services'; END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME IN ('crm_sales_intake_policy_versions','crm_sales_intake_deliveries','crm_sales_intake_documents','crm_sales_intake_events','crm_quotation_availability_events') THEN
   RAISE EXCEPTION 'Intake evidence and events are immutable';
  END IF;
  IF TG_TABLE_NAME='crm_sales_intakes' THEN
   IF (NEW.original_payload,NEW.normalized,NEW.business_hash,NEW.source_system,NEW.mailbox,NEW.message_id,NEW.company_id,NEW.received_at,NEW.source_received_at)
    IS DISTINCT FROM (OLD.original_payload,OLD.normalized,OLD.business_hash,OLD.source_system,OLD.mailbox,OLD.message_id,OLD.company_id,OLD.received_at,OLD.source_received_at)
   THEN RAISE EXCEPTION 'Original extraction is immutable; retain a reviewed revision separately'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
