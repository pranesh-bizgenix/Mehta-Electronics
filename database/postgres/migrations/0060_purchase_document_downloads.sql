-- Purchasing document workflow only. No imported Tally tables or stock writes.
CREATE TABLE company_document_settings (
 id integer PRIMARY KEY CHECK(id=1), value jsonb NOT NULL DEFAULT '{}',
 version integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by integer REFERENCES users(id)
);
INSERT INTO company_document_settings(id) VALUES(1);
CREATE TABLE purchase_document_counters (
 kind text NOT NULL CHECK(kind IN ('RFQ','PO')), financial_year text NOT NULL,
 next_value bigint NOT NULL CHECK(next_value>0), PRIMARY KEY(kind,financial_year)
);
CREATE TABLE purchase_documents (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('RFQ','PO')), number text NOT NULL UNIQUE,
 vendor_id integer NOT NULL REFERENCES crm_procurement_vendors(id),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','CANCELLED')),
 version integer NOT NULL DEFAULT 1, request_key uuid NOT NULL UNIQUE,
 created_by integer NOT NULL REFERENCES users(id), approved_by integer REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_documents_list ON purchase_documents(kind,id DESC);
CREATE FUNCTION purchase_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Purchasing documents cannot be deleted'; END IF;
 IF current_setting('mehta.purchase_document_write',true) IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'Use purchasing document service'; END IF;
 IF TG_TABLE_NAME='purchase_documents' AND TG_OP='UPDATE' THEN
  IF NEW.number<>OLD.number OR NEW.kind<>OLD.kind OR NEW.created_by<>OLD.created_by OR NEW.request_key<>OLD.request_key THEN RAISE EXCEPTION 'Document identity is immutable'; END IF;
  NEW.updated_at=now();
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['company_document_settings','purchase_document_counters','purchase_documents'] LOOP
 EXECUTE format('CREATE TRIGGER purchase_document_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION purchase_document_guard()',t);
 EXECUTE format('CREATE TRIGGER purchase_document_truncate_guard BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION purchase_document_guard()',t);
 END LOOP;
END $$;
