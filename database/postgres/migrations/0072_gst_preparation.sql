-- Internal GST preparation only. No provider calls, IRN or e-Way numbers.
CREATE TABLE crm_gst_preparations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_key uuid NOT NULL UNIQUE,request_hash text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('IRN','EWAY','PURCHASE_TAX')),
 billing_document_id uuid REFERENCES billing_documents(id),supplier_document_id integer REFERENCES crm_supplier_documents(id),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),source_fingerprint text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','READY_FOR_PROVIDER','REJECTED','CANCELLED')),
 version integer NOT NULL DEFAULT 1,created_by integer NOT NULL REFERENCES users(id),reviewed_by integer REFERENCES users(id),
 reason text NOT NULL,review_reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind IN ('IRN','EWAY') AND billing_document_id IS NOT NULL AND supplier_document_id IS NULL) OR (kind='PURCHASE_TAX' AND supplier_document_id IS NOT NULL AND billing_document_id IS NULL)),
 CHECK(status<>'READY_FOR_PROVIDER' OR (reviewed_by IS NOT NULL AND reviewed_by<>created_by))
);
CREATE UNIQUE INDEX crm_gst_active_invoice_kind ON crm_gst_preparations(billing_document_id,kind) WHERE status IN ('PENDING_REVIEW','READY_FOR_PROVIDER');
CREATE UNIQUE INDEX crm_gst_active_purchase ON crm_gst_preparations(supplier_document_id) WHERE status IN ('PENDING_REVIEW','READY_FOR_PROVIDER');
CREATE FUNCTION guard_gst_preparation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') OR current_setting('mehta.gst_write',true) IS DISTINCT FROM 'authorized'
 OR nullif(current_setting('mehta.actor_id',true),'') IS NULL OR length(trim(coalesce(current_setting('mehta.audit_reason',true),'')))<3 THEN RAISE EXCEPTION 'Use the audited GST preparation workflow'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (NEW.request_key,NEW.request_hash,NEW.kind,NEW.billing_document_id,NEW.supplier_document_id,NEW.snapshot,NEW.source_fingerprint,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.request_key,OLD.request_hash,OLD.kind,OLD.billing_document_id,OLD.supplier_document_id,OLD.snapshot,OLD.source_fingerprint,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'GST source snapshots are immutable'; END IF;
  IF NOT ((OLD.status='PENDING_REVIEW' AND NEW.status IN ('READY_FOR_PROVIDER','REJECTED','CANCELLED')) OR (OLD.status='READY_FOR_PROVIDER' AND NEW.status='CANCELLED')) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Invalid GST preparation transition'; END IF;
  IF NEW.status='READY_FOR_PROVIDER' AND (NEW.reviewed_by=NEW.created_by OR NEW.reviewed_by::text IS DISTINCT FROM current_setting('mehta.actor_id',true)) THEN RAISE EXCEPTION 'An independent audit actor must review GST preparation'; END IF;
  NEW.updated_at=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gst_preparation_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_gst_preparations FOR EACH ROW EXECUTE FUNCTION guard_gst_preparation();
CREATE TRIGGER gst_preparation_no_truncate BEFORE TRUNCATE ON crm_gst_preparations FOR EACH STATEMENT EXECUTE FUNCTION guard_gst_preparation();
