-- New CRM procurement records only; imported Tally tables are read-only sources.
CREATE TABLE crm_procurement_vendors (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,source_party_id bigint UNIQUE REFERENCES crm_parties(id),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),version integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','ARCHIVED'))
);
CREATE TABLE crm_purchase_requests (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,number text NOT NULL UNIQUE,sales_order_id integer REFERENCES sales_orders(id),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),version integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','REQUESTED','CANCELLED'))
);
CREATE TABLE crm_rfqs (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,number text NOT NULL UNIQUE,request_id integer NOT NULL REFERENCES crm_purchase_requests(id),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),version integer NOT NULL DEFAULT 1,winner_reply_id integer,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','WINNER_SELECTED','CANCELLED'))
);
CREATE TABLE crm_rfq_vendors (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,rfq_id integer NOT NULL REFERENCES crm_rfqs(id),vendor_id integer NOT NULL REFERENCES crm_procurement_vendors(id),
 status text NOT NULL DEFAULT 'INVITED' CHECK(status IN ('INVITED','REPLIED','DECLINED')),UNIQUE(rfq_id,vendor_id)
);
CREATE TABLE crm_rfq_vendor_replies (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,rfq_id integer NOT NULL REFERENCES crm_rfqs(id),vendor_id integer NOT NULL REFERENCES crm_procurement_vendors(id),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),version integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'RECORDED' CHECK(status IN ('RECORDED','WITHDRAWN')),UNIQUE(rfq_id,vendor_id)
);
ALTER TABLE crm_rfqs ADD CONSTRAINT crm_rfq_winner_fk FOREIGN KEY(winner_reply_id) REFERENCES crm_rfq_vendor_replies(id);
CREATE TABLE crm_supplier_pos (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,number text NOT NULL UNIQUE,vendor_id integer NOT NULL REFERENCES crm_procurement_vendors(id),
 rfq_id integer REFERENCES crm_rfqs(id),sales_order_id integer REFERENCES sales_orders(id),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),version integer NOT NULL DEFAULT 1,approval_fingerprint text,approved_by integer REFERENCES users(id),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING_APPROVAL','APPROVED','ISSUED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
 CHECK(rfq_id IS NOT NULL OR sales_order_id IS NOT NULL)
);
CREATE UNIQUE INDEX crm_supplier_po_rfq_once ON crm_supplier_pos(rfq_id) WHERE rfq_id IS NOT NULL AND status<>'CANCELLED';
CREATE TABLE crm_grns (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,number text NOT NULL UNIQUE,supplier_po_id integer NOT NULL REFERENCES crm_supplier_pos(id),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),version integer NOT NULL DEFAULT 1,request_key uuid NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'HELD' CHECK(status IN ('HELD','POSTED','CANCELLED'))
);
CREATE TABLE crm_supplier_documents (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,supplier_po_id integer NOT NULL REFERENCES crm_supplier_pos(id),
 kind text NOT NULL CHECK(kind IN ('ACCEPTANCE','DISPATCH_INVOICE','PACKING_SLIP','TEST_REPORT')),
 original_name text NOT NULL,mime_type text NOT NULL,sha256 text NOT NULL,byte_count integer NOT NULL CHECK(byte_count BETWEEN 1 AND 10485760),original_bytes bytea NOT NULL,
 payload jsonb NOT NULL DEFAULT '{}',version integer NOT NULL DEFAULT 1,review_fingerprint text,
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','REVIEWED','ARCHIVED')),UNIQUE(supplier_po_id,kind,sha256)
);
CREATE TABLE crm_procurement_events (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,entity text NOT NULL,record_id integer NOT NULL,action text NOT NULL,version integer NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason))>=3),before_snapshot jsonb,after_snapshot jsonb,detail jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'RECORDED' CHECK(status='RECORDED')
);
CREATE INDEX crm_procurement_history ON crm_procurement_events(entity,record_id,id DESC);
CREATE INDEX crm_grns_po ON crm_grns(supplier_po_id,status);
CREATE INDEX crm_supplier_docs_po ON crm_supplier_documents(supplier_po_id,status);
CREATE FUNCTION crm_procurement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Procurement records cannot be deleted or truncated'; END IF;
 IF current_setting('mehta.procurement_write',true) IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'Use the procurement service'; END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='crm_procurement_events' THEN RAISE EXCEPTION 'Procurement audit is immutable'; END IF;
  IF TG_TABLE_NAME='crm_supplier_documents' AND (NEW.original_bytes IS DISTINCT FROM OLD.original_bytes OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.original_name IS DISTINCT FROM OLD.original_name OR NEW.mime_type IS DISTINCT FROM OLD.mime_type OR NEW.supplier_po_id IS DISTINCT FROM OLD.supplier_po_id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.byte_count IS DISTINCT FROM OLD.byte_count) THEN RAISE EXCEPTION 'Supplier originals are immutable'; END IF;
  NEW.updated_at=now();NEW.created_at=OLD.created_at;NEW.created_by=OLD.created_by;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['crm_procurement_vendors','crm_purchase_requests','crm_rfqs','crm_rfq_vendors','crm_rfq_vendor_replies','crm_supplier_pos','crm_grns','crm_supplier_documents','crm_procurement_events'] LOOP
 EXECUTE format('ALTER TABLE %I ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN created_by integer NOT NULL REFERENCES users(id), ADD COLUMN is_deleted boolean NOT NULL DEFAULT false',t);
 EXECUTE format('CREATE TRIGGER procurement_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION crm_procurement_guard()',t);
 EXECUTE format('CREATE TRIGGER procurement_truncate_guard BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION crm_procurement_guard()',t);
 END LOOP;
END $$;
