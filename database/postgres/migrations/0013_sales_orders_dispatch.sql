-- CRM only: preserve existing order identities and allow manual orders.
ALTER TABLE sales_orders ALTER COLUMN quotation_id DROP NOT NULL;
ALTER TABLE sales_order_lines ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED'));
ALTER TABLE sales_order_lines ADD COLUMN is_deleted boolean NOT NULL DEFAULT false;
CREATE TABLE crm_order_workflows (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, sales_order_id integer NOT NULL UNIQUE REFERENCES sales_orders(id),
 customer_id integer NOT NULL REFERENCES customers(id), po_key text NOT NULL, version integer NOT NULL DEFAULT 1,
 source_quote_version integer, source_quote_snapshot jsonb,
 public_snapshot jsonb NOT NULL, private_snapshot jsonb NOT NULL,
 approval_fingerprint text, approved_by integer REFERENCES users(id), approved_version integer,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by integer NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','HELD','APPROVED','PARTIALLY_DISPATCHED','DISPATCHED','DELIVERED','CANCELLED')),
 is_deleted boolean NOT NULL DEFAULT false CHECK(NOT is_deleted),UNIQUE(customer_id,po_key)
);
CREATE TABLE crm_order_versions (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,sales_order_id integer NOT NULL REFERENCES sales_orders(id),version integer NOT NULL,
 public_snapshot jsonb NOT NULL,private_snapshot jsonb NOT NULL,reason text NOT NULL CHECK(length(trim(reason))>=3),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by integer NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'RECORDED' CHECK(status='RECORDED'),is_deleted boolean NOT NULL DEFAULT false CHECK(NOT is_deleted),UNIQUE(sales_order_id,version)
);
CREATE TABLE crm_order_events (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,sales_order_id integer NOT NULL REFERENCES sales_orders(id),version integer NOT NULL,
 action text NOT NULL,reason text NOT NULL CHECK(length(trim(reason))>=3),public_detail jsonb NOT NULL DEFAULT '{}',private_detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by integer NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'RECORDED' CHECK(status='RECORDED'),is_deleted boolean NOT NULL DEFAULT false CHECK(NOT is_deleted)
);
CREATE TABLE crm_shipments (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,sales_order_id integer NOT NULL REFERENCES sales_orders(id),
 vehicle_number text NOT NULL,lr_number text NOT NULL,transporter text NOT NULL,eway_bill_number text,notes text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by integer NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'DISPATCHED' CHECK(status IN ('DISPATCHED','DELIVERED')),is_deleted boolean NOT NULL DEFAULT false CHECK(NOT is_deleted)
);
CREATE INDEX crm_shipment_lr_search ON crm_shipments(upper(lr_number));
CREATE TABLE crm_shipment_items (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,shipment_id integer NOT NULL REFERENCES crm_shipments(id),order_line_id integer NOT NULL REFERENCES sales_order_lines(id),
 quantity numeric(20,6) NOT NULL CHECK(quantity>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by integer NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status='ACTIVE'),is_deleted boolean NOT NULL DEFAULT false CHECK(NOT is_deleted),UNIQUE(shipment_id,order_line_id)
);
CREATE TABLE crm_order_documents (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,sales_order_id integer NOT NULL REFERENCES sales_orders(id),shipment_id integer REFERENCES crm_shipments(id),
 customer_id integer NOT NULL REFERENCES customers(id),po_key text NOT NULL,kind text NOT NULL CHECK(kind IN ('CUSTOMER_PO','DELIVERY_PROOF')),
 original_name text NOT NULL,mime_type text NOT NULL,sha256 text NOT NULL CHECK(length(sha256)=64),byte_count integer NOT NULL CHECK(byte_count BETWEEN 1 AND 10485760),original_bytes bytea NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),created_by integer NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),is_deleted boolean NOT NULL DEFAULT false,
 CHECK((kind='CUSTOMER_PO' AND shipment_id IS NULL) OR (kind='DELIVERY_PROOF' AND shipment_id IS NOT NULL))
);
CREATE UNIQUE INDEX crm_po_duplicate_hash ON crm_order_documents(customer_id,po_key,sha256) WHERE kind='CUSTOMER_PO';
CREATE UNIQUE INDEX crm_po_current_original ON crm_order_documents(sales_order_id) WHERE kind='CUSTOMER_PO' AND status='ACTIVE';
CREATE UNIQUE INDEX crm_proof_current_original ON crm_order_documents(shipment_id) WHERE kind='DELIVERY_PROOF' AND status='ACTIVE';
CREATE INDEX crm_order_status ON crm_order_workflows(status,updated_at DESC);
CREATE FUNCTION crm_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Order records cannot be deleted or truncated'; END IF;
 IF current_setting('mehta.order_write',true) IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'Use the order workflow service'; END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME IN ('crm_order_versions','crm_order_events','crm_shipment_items') THEN RAISE EXCEPTION 'Order history is immutable'; END IF;
  IF TG_TABLE_NAME='crm_order_documents' AND (to_jsonb(NEW)-ARRAY['status','is_deleted','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','is_deleted','updated_at']) THEN RAISE EXCEPTION 'Original documents are immutable'; END IF;
  NEW.updated_at=now();
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['crm_order_workflows','crm_order_versions','crm_order_events','crm_shipments','crm_shipment_items','crm_order_documents'] LOOP
 EXECUTE format('CREATE TRIGGER order_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION crm_order_guard()',t);
 EXECUTE format('CREATE TRIGGER order_truncate_guard BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION crm_order_guard()',t);
 END LOOP;
END $$;
CREATE FUNCTION crm_managed_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE qid integer;
BEGIN
 IF TG_TABLE_NAME='sales_orders' THEN qid=OLD.id; ELSE qid=COALESCE(NEW.sales_order_id,OLD.sales_order_id); END IF;
 IF EXISTS(SELECT 1 FROM crm_order_workflows WHERE sales_order_id=qid) AND current_setting('mehta.order_write',true) IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'Managed orders must use the verification and dispatch workflow'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER managed_order_guard BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION crm_managed_order_guard();
CREATE TRIGGER managed_order_line_guard BEFORE INSERT OR UPDATE ON sales_order_lines FOR EACH ROW EXECUTE FUNCTION crm_managed_order_guard();
