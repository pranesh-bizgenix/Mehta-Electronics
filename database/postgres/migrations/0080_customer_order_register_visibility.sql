-- Display visibility only. Original rows, approvals and business quantities stay intact.
CREATE TABLE crm_order_register_visibility (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL UNIQUE REFERENCES crm_order_import_batches(id),
 hidden boolean NOT NULL,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_order_register_visibility() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer;
BEGIN
 actor:=nullif(current_setting('mehta.actor_id',true),'')::integer;
 IF TG_OP IN ('DELETE','TRUNCATE') OR actor IS NULL OR current_setting('mehta.order_import_write',true) IS DISTINCT FROM 'authorized' OR length(trim(coalesce(current_setting('mehta.audit_reason',true),'')))<3 THEN RAISE EXCEPTION 'Use the audited order register visibility action'; END IF;
 IF TG_OP='INSERT' AND NEW.created_by<>actor THEN RAISE EXCEPTION 'Visibility creator must match the actor'; END IF;
 IF TG_OP='UPDATE' AND ((NEW.id,NEW.batch_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.batch_id,OLD.created_by,OLD.created_at) OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'Visibility identity is immutable and versioned'; END IF;
 IF NEW.hidden AND NOT EXISTS(SELECT 1 FROM crm_order_import_batches b WHERE b.id=NEW.batch_id AND b.status='DRAFT') THEN RAISE EXCEPTION 'Only a draft source may be hidden'; END IF;
 NEW.updated_by:=actor;NEW.updated_at:=now();RETURN NEW;
END $$;
CREATE TRIGGER order_register_visibility_write BEFORE INSERT OR UPDATE OR DELETE ON crm_order_register_visibility FOR EACH ROW EXECUTE FUNCTION guard_order_register_visibility();
CREATE TRIGGER order_register_visibility_no_truncate BEFORE TRUNCATE ON crm_order_register_visibility FOR EACH STATEMENT EXECUTE FUNCTION guard_order_register_visibility();
