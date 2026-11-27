CREATE TABLE supplier_schemes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vendor_id integer NOT NULL REFERENCES crm_procurement_vendors(id),
 request_key uuid NOT NULL UNIQUE,request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),valid_from date NOT NULL,valid_to date NOT NULL CHECK(valid_to>=valid_from),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 status text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK(status IN ('PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by integer NOT NULL REFERENCES users(id),approved_by integer REFERENCES users(id),
 decision_reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'APPROVED' OR (approved_by IS NOT NULL AND approved_by<>created_by))
);
CREATE UNIQUE INDEX supplier_schemes_active_name ON supplier_schemes(vendor_id,lower(name),valid_from,valid_to) WHERE status IN ('PENDING_APPROVAL','APPROVED');
CREATE INDEX supplier_schemes_vendor_dates ON supplier_schemes(vendor_id,valid_from,valid_to,status);
CREATE FUNCTION guard_supplier_scheme() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') OR current_setting('mehta.procurement_write',true) IS DISTINCT FROM 'authorized'
 OR nullif(current_setting('mehta.actor_id',true),'') IS NULL OR length(trim(coalesce(current_setting('mehta.audit_reason',true),'')))<3
 THEN RAISE EXCEPTION 'Supplier schemes require an authorised audited workflow'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.vendor_id,NEW.request_key,NEW.request_hash,NEW.name,NEW.valid_from,NEW.valid_to,NEW.payload,NEW.created_by,NEW.created_at)
   IS DISTINCT FROM (OLD.vendor_id,OLD.request_key,OLD.request_hash,OLD.name,OLD.valid_from,OLD.valid_to,OLD.payload,OLD.created_by,OLD.created_at)
  THEN RAISE EXCEPTION 'Scheme terms are immutable; cancel and request a reviewed replacement'; END IF;
  IF NOT ((OLD.status='PENDING_APPROVAL' AND NEW.status IN ('APPROVED','REJECTED','CANCELLED')) OR (OLD.status='APPROVED' AND NEW.status='CANCELLED')) THEN RAISE EXCEPTION 'Invalid supplier scheme transition'; END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Scheme version must advance once'; END IF;
  IF NEW.status='APPROVED' AND NEW.approved_by::text IS DISTINCT FROM current_setting('mehta.actor_id',true) THEN RAISE EXCEPTION 'Scheme reviewer must match audit actor'; END IF;
  NEW.updated_at=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER supplier_schemes_guard BEFORE INSERT OR UPDATE OR DELETE ON supplier_schemes FOR EACH ROW EXECUTE FUNCTION guard_supplier_scheme();
CREATE TRIGGER supplier_schemes_no_truncate BEFORE TRUNCATE ON supplier_schemes FOR EACH STATEMENT EXECUTE FUNCTION guard_supplier_scheme();
