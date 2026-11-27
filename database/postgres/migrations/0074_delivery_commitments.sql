CREATE TABLE crm_delivery_commitments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_key uuid NOT NULL UNIQUE,request_hash text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('CUSTOMER','SUPPLIER')),
 order_line_id integer REFERENCES sales_order_lines(id),supplier_po_id integer REFERENCES crm_supplier_pos(id),po_line_key uuid,
 replaces_id uuid REFERENCES crm_delivery_commitments(id),source_fingerprint text NOT NULL,snapshot jsonb NOT NULL,
 commitments jsonb NOT NULL CHECK(jsonb_typeof(commitments)='array'),evidence text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','CONFIRMED','REJECTED','SUPERSEDED','CANCELLED')),
 version integer NOT NULL DEFAULT 1,created_by integer NOT NULL REFERENCES users(id),reviewed_by integer REFERENCES users(id),
 reason text NOT NULL,review_reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='CUSTOMER' AND order_line_id IS NOT NULL AND supplier_po_id IS NULL AND po_line_key IS NULL) OR (kind='SUPPLIER' AND order_line_id IS NULL AND supplier_po_id IS NOT NULL AND po_line_key IS NOT NULL)),
 CHECK(status<>'CONFIRMED' OR (reviewed_by IS NOT NULL AND reviewed_by<>created_by))
);
CREATE UNIQUE INDEX delivery_customer_confirmed ON crm_delivery_commitments(order_line_id) WHERE kind='CUSTOMER' AND status='CONFIRMED';
CREATE UNIQUE INDEX delivery_customer_pending ON crm_delivery_commitments(order_line_id) WHERE kind='CUSTOMER' AND status='PENDING_REVIEW';
CREATE UNIQUE INDEX delivery_supplier_confirmed ON crm_delivery_commitments(supplier_po_id,po_line_key) WHERE kind='SUPPLIER' AND status='CONFIRMED';
CREATE UNIQUE INDEX delivery_supplier_pending ON crm_delivery_commitments(supplier_po_id,po_line_key) WHERE kind='SUPPLIER' AND status='PENDING_REVIEW';
CREATE FUNCTION guard_delivery_commitment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') OR current_setting('mehta.delivery_write',true) IS DISTINCT FROM 'authorized' OR nullif(current_setting('mehta.actor_id',true),'') IS NULL OR length(trim(coalesce(current_setting('mehta.audit_reason',true),'')))<3 THEN RAISE EXCEPTION 'Use the audited delivery schedule workflow'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['status','version','reviewed_by','review_reason','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','reviewed_by','review_reason','updated_at']) THEN RAISE EXCEPTION 'Delivery commitment sources and dates are immutable'; END IF;
  IF NOT ((OLD.status='PENDING_REVIEW' AND NEW.status IN ('CONFIRMED','REJECTED','CANCELLED')) OR (OLD.status='CONFIRMED' AND NEW.status IN ('SUPERSEDED','CANCELLED'))) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Invalid delivery commitment transition'; END IF;
  IF NEW.status='CONFIRMED' AND (NEW.reviewed_by=NEW.created_by OR NEW.reviewed_by::text IS DISTINCT FROM current_setting('mehta.actor_id',true)) THEN RAISE EXCEPTION 'An independent reviewer must confirm changed delivery commitments'; END IF;
  NEW.updated_at=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER delivery_commitment_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_delivery_commitments FOR EACH ROW EXECUTE FUNCTION guard_delivery_commitment();
CREATE TRIGGER delivery_commitment_no_truncate BEFORE TRUNCATE ON crm_delivery_commitments FOR EACH STATEMENT EXECUTE FUNCTION guard_delivery_commitment();
