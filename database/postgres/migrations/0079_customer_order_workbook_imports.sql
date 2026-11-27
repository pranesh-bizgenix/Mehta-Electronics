-- Retain customer PO/open-order snapshots without creating sales orders,
-- changing Tally balances, or treating a summary as another purchase order.
CREATE TABLE crm_order_import_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_key uuid NOT NULL UNIQUE,
 source_document_id uuid NOT NULL UNIQUE REFERENCES source_documents(id),
 file_sha256 text NOT NULL UNIQUE CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
 filename text NOT NULL,original_bytes bytea NOT NULL CHECK(octet_length(original_bytes) BETWEEN 1 AND 8388608),
 parser_version text NOT NULL,source_summary jsonb NOT NULL CHECK(jsonb_typeof(source_summary)='object'),layouts jsonb NOT NULL CHECK(jsonb_typeof(layouts)='array'),
 customer_id integer REFERENCES customers(id),company_id uuid REFERENCES tally_companies(id),as_of_date date,
 currency text CHECK(currency IS NULL OR currency ~ '^[A-Z]{3}$'),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING_REVIEW','APPROVED','REJECTED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by integer NOT NULL REFERENCES users(id),
 editors integer[] NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by integer NOT NULL REFERENCES users(id),
 schedule_import_id uuid REFERENCES customer_schedule_imports(id),
 reviewed_by integer REFERENCES users(id),review_reason text,reviewed_at timestamptz,
 CHECK(status<>'APPROVED' OR (customer_id IS NOT NULL AND company_id IS NOT NULL AND as_of_date IS NOT NULL AND schedule_import_id IS NOT NULL AND reviewed_by IS NOT NULL AND NOT reviewed_by=ANY(editors)))
);
CREATE INDEX crm_order_import_batches_list ON crm_order_import_batches(created_at DESC,id);
CREATE TABLE crm_order_import_rows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES crm_order_import_batches(id),
 sheet text NOT NULL,source_row integer NOT NULL CHECK(source_row>0),source_column integer NOT NULL CHECK(source_column BETWEEN -1 AND 99),
 layout text NOT NULL,source_key text NOT NULL,source_fingerprint text NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'),
 source_facts jsonb NOT NULL,raw_row jsonb NOT NULL,source_issues jsonb NOT NULL,
 review_values jsonb NOT NULL DEFAULT '{}',item_id integer REFERENCES items(id),mapping_snapshot jsonb NOT NULL DEFAULT '{}',
 excluded boolean NOT NULL DEFAULT false,version integer NOT NULL DEFAULT 1,
 created_by integer NOT NULL REFERENCES users(id),updated_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(batch_id,source_key),CHECK(version>0),CHECK(jsonb_typeof(source_facts)='object' AND jsonb_typeof(review_values)='object'),
 CHECK(source_facts ? 'kind' AND source_facts->>'kind' IN ('PO_LINE','SUMMARY')),CHECK(jsonb_typeof(source_issues)='array'),
 CHECK(coalesce(jsonb_typeof(raw_row->'cells')='array' AND jsonb_typeof(raw_row->'headers')='array',false)),CHECK(jsonb_typeof(mapping_snapshot)='object')
);
CREATE INDEX crm_order_import_rows_batch ON crm_order_import_rows(batch_id,sheet,source_row,source_column);
CREATE INDEX crm_order_import_rows_po ON crm_order_import_rows((source_facts->>'poNumber'));
CREATE TABLE crm_order_schedule_registry (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id integer NOT NULL REFERENCES customers(id),
 company_id uuid NOT NULL REFERENCES tally_companies(id),business_key text NOT NULL,
 active_line_id uuid NOT NULL REFERENCES customer_open_order_lines(id),
 batch_id uuid NOT NULL REFERENCES crm_order_import_batches(id),row_id uuid NOT NULL REFERENCES crm_order_import_rows(id),
 snapshot_fingerprint text NOT NULL,version integer NOT NULL DEFAULT 1,status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(customer_id,company_id,business_key),CHECK(jsonb_typeof(business_key::jsonb)='array' AND jsonb_array_length(business_key::jsonb)=5)
);
CREATE INDEX crm_order_schedule_registry_po ON crm_order_schedule_registry(customer_id,company_id,(business_key::jsonb->>0),(business_key::jsonb->>1)) WHERE status='ACTIVE';
CREATE FUNCTION guard_order_workbook_import() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer; current_status text;
BEGIN
 actor:=nullif(current_setting('mehta.actor_id',true),'')::integer;
 IF TG_OP IN ('DELETE','TRUNCATE') OR actor IS NULL OR current_setting('mehta.order_import_write',true) IS DISTINCT FROM 'authorized' OR length(trim(coalesce(current_setting('mehta.audit_reason',true),'')))<3 THEN RAISE EXCEPTION 'Use the audited customer order import workflow'; END IF;
 IF TG_OP='INSERT' AND NEW.created_by<>actor THEN RAISE EXCEPTION 'Import creator must match the audit actor'; END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='crm_order_import_batches' THEN
  IF NEW.status<>'DRAFT' OR NOT actor=ANY(NEW.editors) THEN RAISE EXCEPTION 'Capture a draft source before review'; END IF;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='crm_order_import_rows' THEN
  SELECT status INTO current_status FROM crm_order_import_batches WHERE id=NEW.batch_id;
  IF current_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Only a draft source accepts retained worksheet rows'; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='crm_order_import_batches' THEN
   IF (NEW.id,NEW.request_key,NEW.source_document_id,NEW.file_sha256,NEW.filename,NEW.original_bytes,NEW.parser_version,NEW.source_summary,NEW.layouts,NEW.created_by,NEW.created_at)
   IS DISTINCT FROM (OLD.id,OLD.request_key,OLD.source_document_id,OLD.file_sha256,OLD.filename,OLD.original_bytes,OLD.parser_version,OLD.source_summary,OLD.layouts,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Original workbook and parse facts are immutable'; END IF;
   IF OLD.status IN ('APPROVED','REJECTED') OR NEW.version<>OLD.version+1 OR NOT (OLD.editors<@NEW.editors) THEN RAISE EXCEPTION 'Reload an editable import; source editors cannot be removed'; END IF;
   IF NOT ((OLD.status='DRAFT' AND NEW.status IN ('DRAFT','PENDING_REVIEW','REJECTED')) OR (OLD.status='PENDING_REVIEW' AND NEW.status IN ('APPROVED','DRAFT','REJECTED'))) THEN RAISE EXCEPTION 'Invalid import transition'; END IF;
   IF NEW.status='APPROVED' AND (NEW.reviewed_by<>actor OR actor=ANY(NEW.editors) OR NEW.reviewed_at IS NULL OR length(trim(coalesce(NEW.review_reason,'')))<3) THEN RAISE EXCEPTION 'An independent reviewer must approve the source import'; END IF;
  ELSIF TG_TABLE_NAME='crm_order_import_rows' THEN
   SELECT status INTO current_status FROM crm_order_import_batches WHERE id=OLD.batch_id;
   IF current_status<>'DRAFT' OR NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-ARRAY['review_values','item_id','mapping_snapshot','excluded','version','updated_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['review_values','item_id','mapping_snapshot','excluded','version','updated_by','updated_at']) THEN RAISE EXCEPTION 'Retain original row facts and edit only a draft review'; END IF;
  ELSE
   IF (NEW.customer_id,NEW.company_id,NEW.business_key,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.customer_id,OLD.company_id,OLD.business_key,OLD.created_by,OLD.created_at) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Schedule identity is immutable and versioned'; END IF;
  END IF;
 END IF;
 NEW.updated_by:=actor;NEW.updated_at:=now();RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['crm_order_import_batches','crm_order_import_rows','crm_order_schedule_registry'] LOOP
  EXECUTE format('CREATE TRIGGER order_workbook_write BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_order_workbook_import()',t);
  EXECUTE format('CREATE TRIGGER order_workbook_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION guard_order_workbook_import()',t);
 END LOOP;
END $$;
