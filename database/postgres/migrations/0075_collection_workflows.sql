CREATE TABLE crm_financial_scopes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),operation_id uuid NOT NULL REFERENCES crm_operations(id),company_id uuid NOT NULL REFERENCES tally_companies(id),
 evidence text NOT NULL,created_by integer NOT NULL REFERENCES users(id),reviewed_by integer REFERENCES users(id),reason text NOT NULL,review_reason text,
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','CONFIRMED','REJECTED')),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'CONFIRMED' OR (reviewed_by IS NOT NULL AND reviewed_by<>created_by))
);
CREATE UNIQUE INDEX financial_scope_active ON crm_financial_scopes(operation_id) WHERE status IN ('PENDING_REVIEW','CONFIRMED');
CREATE TABLE crm_receipt_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_key uuid NOT NULL UNIQUE,request_hash text NOT NULL,
 customer_id integer NOT NULL REFERENCES customers(id),company_id uuid NOT NULL REFERENCES tally_companies(id),
 bank_reference text NOT NULL,payment_date date NOT NULL,amount numeric(30,6) NOT NULL CHECK(amount>0),
 created_by integer NOT NULL REFERENCES users(id),backup_id integer NOT NULL REFERENCES users(id),reviewed_by integer REFERENCES users(id),
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','CONFIRMED','REJECTED')),reason text NOT NULL,review_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),CHECK(backup_id<>created_by),CHECK(status<>'CONFIRMED' OR (reviewed_by IS NOT NULL AND reviewed_by<>created_by))
);
CREATE UNIQUE INDEX receipt_batch_reference ON crm_receipt_batches(company_id,upper(trim(bank_reference))) WHERE status IN ('PENDING_REVIEW','CONFIRMED');
CREATE TABLE crm_receipt_batch_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES crm_receipt_batches(id),invoice_id uuid NOT NULL REFERENCES crm_operations(id),
 receipt_id uuid NOT NULL UNIQUE REFERENCES crm_operations(id),amount numeric(30,6) NOT NULL CHECK(amount>0),UNIQUE(batch_id,invoice_id)
);
CREATE TABLE crm_collection_arrangements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_key uuid NOT NULL UNIQUE,request_hash text NOT NULL,invoice_id uuid NOT NULL REFERENCES crm_operations(id),
 kind text NOT NULL CHECK(kind IN ('DUE_DATE','PROMISE','PDC')),payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 replaces_id uuid REFERENCES crm_collection_arrangements(id),evidence text NOT NULL,created_by integer NOT NULL REFERENCES users(id),reviewed_by integer REFERENCES users(id),
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','ACTIVE','KEPT','BROKEN','CLEARED','BOUNCED','SUPERSEDED','SETTLED','CANCELLED','REJECTED')),
 version integer NOT NULL DEFAULT 1,reason text NOT NULL,review_reason text,cleared_receipt_id uuid UNIQUE REFERENCES crm_operations(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),CHECK(status<>'ACTIVE' OR (reviewed_by IS NOT NULL AND reviewed_by<>created_by))
);
CREATE UNIQUE INDEX collection_due_active ON crm_collection_arrangements(invoice_id) WHERE kind='DUE_DATE' AND status='ACTIVE';
CREATE UNIQUE INDEX collection_due_pending ON crm_collection_arrangements(invoice_id) WHERE kind='DUE_DATE' AND status='PENDING_REVIEW';
CREATE UNIQUE INDEX collection_cheque_identity ON crm_collection_arrangements(invoice_id,upper(payload->>'chequeNumber')) WHERE kind='PDC' AND status IN ('PENDING_REVIEW','ACTIVE','CLEARED');
CREATE TABLE crm_invoice_adjustments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_key uuid NOT NULL UNIQUE,request_hash text NOT NULL,invoice_id uuid NOT NULL REFERENCES crm_operations(id),
 kind text NOT NULL CHECK(kind IN ('CREDIT','DEBIT')),number text NOT NULL,document_date date NOT NULL,amount numeric(30,6) NOT NULL CHECK(amount>0),
 source_reference text NOT NULL,evidence text NOT NULL,status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','CONFIRMED','REJECTED')),
 created_by integer NOT NULL REFERENCES users(id),reviewed_by integer REFERENCES users(id),reason text NOT NULL,review_reason text,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'CONFIRMED' OR (reviewed_by IS NOT NULL AND reviewed_by<>created_by))
);
CREATE UNIQUE INDEX invoice_adjustment_active_number ON crm_invoice_adjustments(invoice_id,kind,upper(trim(number))) WHERE status IN ('PENDING_REVIEW','CONFIRMED');
CREATE FUNCTION guard_collection_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') OR current_setting('mehta.collections_write',true) IS DISTINCT FROM 'authorized' OR nullif(current_setting('mehta.actor_id',true),'') IS NULL OR length(trim(coalesce(current_setting('mehta.audit_reason',true),'')))<3 THEN RAISE EXCEPTION 'Use the audited collections workflow'; END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='crm_receipt_batch_lines' THEN RAISE EXCEPTION 'Receipt allocations are immutable'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','version','reviewed_by','review_reason','updated_at','cleared_receipt_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','reviewed_by','review_reason','updated_at','cleared_receipt_id']) THEN RAISE EXCEPTION 'Collection source facts are immutable'; END IF;
  IF TG_TABLE_NAME='crm_collection_arrangements' THEN
   IF NOT ((OLD.status='PENDING_REVIEW' AND NEW.status IN ('ACTIVE','REJECTED','CANCELLED')) OR (OLD.status='ACTIVE' AND NEW.status IN ('KEPT','BROKEN','CLEARED','BOUNCED','SUPERSEDED','SETTLED','CANCELLED'))) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Invalid collection arrangement transition'; END IF;
  ELSIF OLD.status<>'PENDING_REVIEW' OR NEW.status NOT IN ('CONFIRMED','REJECTED') THEN RAISE EXCEPTION 'Collection approval is already final'; END IF;
  IF NEW.status IN ('ACTIVE','CONFIRMED') AND (NEW.created_by=NEW.reviewed_by OR NEW.reviewed_by::text IS DISTINCT FROM current_setting('mehta.actor_id',true)) THEN RAISE EXCEPTION 'An independent reviewer must confirm collection facts'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['crm_financial_scopes','crm_receipt_batches','crm_receipt_batch_lines','crm_collection_arrangements','crm_invoice_adjustments'] LOOP
  EXECUTE format('CREATE TRIGGER collections_workflow BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_collection_workflow()',t);
  EXECUTE format('CREATE TRIGGER collections_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION guard_collection_workflow()',t);
 END LOOP;
END $$;
