-- Additive billing snapshots and verified originals; no Tally or CRM table changes.
CREATE TABLE billing_document_settings (
 id integer PRIMARY KEY CHECK(id=1), value jsonb NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 0, updated_by integer REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO billing_document_settings(id) VALUES(1);
CREATE TABLE billing_document_counters (
 financial_year text PRIMARY KEY, next_value bigint NOT NULL CHECK(next_value>0)
);
CREATE TABLE billing_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_key uuid NOT NULL UNIQUE,
 source text NOT NULL CHECK(source IN ('CRM','TALLY')), customer_id integer NOT NULL REFERENCES customers(id),
 invoice_reference_id uuid REFERENCES crm_operations(id), sales_order_id integer REFERENCES sales_orders(id),
 shipment_id integer REFERENCES crm_shipments(id), number text, invoice_date date NOT NULL,
 payload jsonb NOT NULL, status text NOT NULL CHECK(status IN ('DRAFT','PENDING_APPROVAL','APPROVED','ISSUED','CANCELLED')) DEFAULT 'DRAFT',
 version integer NOT NULL DEFAULT 1, created_by integer NOT NULL REFERENCES users(id), approved_by integer REFERENCES users(id),
 settings_version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(approved_by IS NULL OR approved_by<>created_by), CHECK(status<>'ISSUED' OR number IS NOT NULL)
);
CREATE UNIQUE INDEX billing_crm_number ON billing_documents(number) WHERE source='CRM' AND number IS NOT NULL;
CREATE UNIQUE INDEX billing_external_number ON billing_documents(customer_id,lower(number)) WHERE source='TALLY' AND status<>'CANCELLED';
CREATE UNIQUE INDEX billing_shipment_once ON billing_documents(shipment_id) WHERE shipment_id IS NOT NULL AND status<>'CANCELLED';
CREATE UNIQUE INDEX billing_reference_once ON billing_documents(invoice_reference_id) WHERE invoice_reference_id IS NOT NULL AND status<>'CANCELLED';
CREATE INDEX billing_documents_list ON billing_documents(created_at DESC,id);
CREATE INDEX billing_documents_customer ON billing_documents(customer_id,invoice_date DESC);
CREATE TABLE billing_document_originals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL UNIQUE REFERENCES billing_documents(id),
 filename text NOT NULL, sha256 text NOT NULL UNIQUE, bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 5 AND 5242880),
 uploaded_by integer NOT NULL REFERENCES users(id), verified_by integer REFERENCES users(id), verified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(verified_by IS NULL OR verified_by<>uploaded_by)
);
CREATE FUNCTION billing_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Billing records cannot be deleted'; END IF;
 IF current_setting('mehta.billing_write',true) IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'Use billing document service'; END IF;
 IF TG_TABLE_NAME='billing_documents' AND TG_OP='UPDATE' THEN
  IF NEW.created_by<>OLD.created_by OR NEW.customer_id<>OLD.customer_id OR NEW.source<>OLD.source OR NEW.request_key<>OLD.request_key THEN RAISE EXCEPTION 'Billing identity is immutable'; END IF;
  IF OLD.status='ISSUED' THEN RAISE EXCEPTION 'Issued invoices are immutable; use the approved accounting correction process'; END IF;
 END IF;
 IF TG_TABLE_NAME='billing_document_originals' AND TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['verified_by','verified_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['verified_by','verified_at']) THEN RAISE EXCEPTION 'Original invoice bytes are immutable'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['billing_document_settings','billing_document_counters','billing_documents','billing_document_originals'] LOOP
  EXECUTE format('CREATE TRIGGER billing_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION billing_document_guard()',t);
  EXECUTE format('CREATE TRIGGER billing_truncate_guard BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION billing_document_guard()',t);
 END LOOP;
END $$;
