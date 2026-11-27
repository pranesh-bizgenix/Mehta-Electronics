-- Approved split allocations extend existing procurement; ordinary RFQs still
-- permit one supplier PO. No business values or role grants are inserted.
CREATE TABLE sourcing_awards (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rfq_id integer NOT NULL REFERENCES crm_rfqs(id),
 request_key uuid NOT NULL UNIQUE,request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 source_fingerprint text NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 evidence text NOT NULL CHECK(length(trim(evidence)) BETWEEN 3 AND 2000),
 status text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK(status IN ('PENDING_APPROVAL','APPROVED','ORDERED','REJECTED','CANCELLED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by integer NOT NULL REFERENCES users(id),
 approved_by integer REFERENCES users(id),decision_reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status NOT IN ('APPROVED','ORDERED') OR (approved_by IS NOT NULL AND approved_by<>created_by))
);
CREATE UNIQUE INDEX sourcing_award_active_rfq ON sourcing_awards(rfq_id) WHERE status IN ('PENDING_APPROVAL','APPROVED','ORDERED');
CREATE TABLE sourcing_award_allocations (
 id uuid PRIMARY KEY,award_id uuid NOT NULL REFERENCES sourcing_awards(id),
 reply_id integer NOT NULL REFERENCES crm_rfq_vendor_replies(id),vendor_id integer NOT NULL REFERENCES crm_procurement_vendors(id),
 item_id integer NOT NULL REFERENCES items(id),quantity numeric(20,6) NOT NULL CHECK(quantity>0),promised_on date NOT NULL,
 UNIQUE(award_id,reply_id,item_id)
);
CREATE INDEX sourcing_award_allocations_vendor ON sourcing_award_allocations(vendor_id,award_id);
ALTER TABLE crm_supplier_pos ADD COLUMN split_award_id uuid REFERENCES sourcing_awards(id);
DROP INDEX crm_supplier_po_rfq_once;
CREATE UNIQUE INDEX crm_supplier_po_rfq_once ON crm_supplier_pos(rfq_id) WHERE rfq_id IS NOT NULL AND split_award_id IS NULL AND status<>'CANCELLED';
CREATE UNIQUE INDEX crm_supplier_po_split_vendor ON crm_supplier_pos(split_award_id,vendor_id) WHERE split_award_id IS NOT NULL;

CREATE FUNCTION guard_sourcing_award() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') OR current_setting('mehta.procurement_write',true) IS DISTINCT FROM 'authorized'
 OR nullif(current_setting('mehta.actor_id',true),'') IS NULL OR length(trim(coalesce(current_setting('mehta.audit_reason',true),'')))<3
 THEN RAISE EXCEPTION 'Split awards require the authorised procurement workflow'; END IF;
 IF TG_TABLE_NAME='sourcing_award_allocations' AND TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Split allocations are immutable'; END IF;
 IF TG_TABLE_NAME='sourcing_awards' AND TG_OP='UPDATE' THEN
  IF (NEW.rfq_id,NEW.request_key,NEW.request_hash,NEW.source_fingerprint,NEW.snapshot,NEW.evidence,NEW.created_by,NEW.created_at)
   IS DISTINCT FROM (OLD.rfq_id,OLD.request_key,OLD.request_hash,OLD.source_fingerprint,OLD.snapshot,OLD.evidence,OLD.created_by,OLD.created_at)
  THEN RAISE EXCEPTION 'Split award source and allocation snapshot are immutable'; END IF;
  IF NOT ((OLD.status='PENDING_APPROVAL' AND NEW.status IN ('APPROVED','REJECTED','CANCELLED'))
       OR (OLD.status='APPROVED' AND NEW.status IN ('ORDERED','CANCELLED'))
       OR (OLD.status='ORDERED' AND NEW.status='CANCELLED'))
  THEN RAISE EXCEPTION 'Unsupported split award transition'; END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Split award version must advance once'; END IF;
  IF NEW.status='APPROVED' AND NEW.approved_by::text IS DISTINCT FROM current_setting('mehta.actor_id',true) THEN RAISE EXCEPTION 'Split reviewer must match the audit actor'; END IF;
  IF NEW.status='CANCELLED' AND OLD.status='ORDERED' AND EXISTS(SELECT 1 FROM crm_supplier_pos WHERE split_award_id=OLD.id AND status<>'CANCELLED') THEN RAISE EXCEPTION 'Cancel generated supplier POs before cancelling the split award'; END IF;
  NEW.updated_at=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sourcing_awards_guard BEFORE INSERT OR UPDATE OR DELETE ON sourcing_awards FOR EACH ROW EXECUTE FUNCTION guard_sourcing_award();
CREATE TRIGGER sourcing_award_allocations_guard BEFORE INSERT OR UPDATE OR DELETE ON sourcing_award_allocations FOR EACH ROW EXECUTE FUNCTION guard_sourcing_award();
CREATE TRIGGER sourcing_awards_no_truncate BEFORE TRUNCATE ON sourcing_awards FOR EACH STATEMENT EXECUTE FUNCTION guard_sourcing_award();
CREATE TRIGGER sourcing_award_allocations_no_truncate BEFORE TRUNCATE ON sourcing_award_allocations FOR EACH STATEMENT EXECUTE FUNCTION guard_sourcing_award();

CREATE FUNCTION protect_split_rfq() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='crm_rfqs' THEN
  IF EXISTS(SELECT 1 FROM sourcing_awards WHERE rfq_id=OLD.id AND status IN ('PENDING_APPROVAL','APPROVED','ORDERED'))
   AND (NEW.winner_reply_id,NEW.status) IS DISTINCT FROM (OLD.winner_reply_id,OLD.status)
  THEN RAISE EXCEPTION 'Resolve the split award before changing the RFQ winner or status'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM sourcing_awards WHERE rfq_id=OLD.rfq_id AND status IN ('APPROVED','ORDERED')) THEN RAISE EXCEPTION 'Approved split offer sources are frozen'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER split_rfq_source_guard BEFORE UPDATE ON crm_rfqs FOR EACH ROW EXECUTE FUNCTION protect_split_rfq();
CREATE TRIGGER split_reply_source_guard BEFORE UPDATE ON crm_rfq_vendor_replies FOR EACH ROW EXECUTE FUNCTION protect_split_rfq();
