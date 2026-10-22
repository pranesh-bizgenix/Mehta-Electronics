-- Forward-only safeguards for the CRM metadata introduced in 0006.
-- No imported tables or connector objects are changed.
ALTER TABLE crm_parties ADD CONSTRAINT crm_parties_archive_reason_present
  CHECK (NOT is_deleted OR (status='ARCHIVED' AND COALESCE(length(trim(archive_reason)),0)>0));
ALTER TABLE crm_tally_item_links ADD CONSTRAINT crm_tally_item_links_archive_reason_present
  CHECK (NOT is_deleted OR (status='ARCHIVED' AND COALESCE(length(trim(archive_reason)),0)>0));

CREATE OR REPLACE FUNCTION crm_read_metadata_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer; reason text;
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'Archive CRM read-layer metadata with an audit reason instead';
  END IF;
  actor := NULLIF(current_setting('mehta.actor_id',true),'')::integer;
  IF actor IS NULL THEN RAISE EXCEPTION 'CRM metadata requires an audit actor'; END IF;
  IF TG_OP='INSERT' AND NEW.created_by IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'CRM creator must match the audit actor';
  END IF;
  reason := NULLIF(current_setting('mehta.audit_reason',true),'');
  IF TG_OP='UPDATE' THEN
    IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.is_deleted IS DISTINCT FROM OLD.is_deleted) AND reason IS NULL THEN
      RAISE EXCEPTION 'Status changes require an audit reason';
    END IF;
    NEW.updated_at := now();
  END IF;
  INSERT INTO audit_logs(user_id,entity,record_id,action,old_value,new_value,reason)
  VALUES(actor,TG_TABLE_NAME,NEW.id::text,TG_OP,
    CASE WHEN TG_OP='UPDATE' THEN row_to_json(OLD)::text ELSE NULL END,row_to_json(NEW)::text,reason);
  RETURN NEW;
END;
$$;
