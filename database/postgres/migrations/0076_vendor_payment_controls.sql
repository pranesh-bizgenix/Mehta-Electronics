-- Reuse the existing supplier payable and payment-advice ledgers. A reviewed
-- invoice may create a due without inventing a supplier statement document.
ALTER TABLE vendor_due_lines ALTER COLUMN statement_id DROP NOT NULL;
ALTER TABLE vendor_due_lines ADD COLUMN supplier_document_id integer UNIQUE REFERENCES crm_supplier_documents(id),
 ADD COLUMN company_id uuid REFERENCES tally_companies(id),ADD COLUMN source_fingerprint text,
 ADD COLUMN evidence text,ADD COLUMN reviewed_by integer REFERENCES users(id),ADD COLUMN review_reason text,
 ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE vendor_due_lines ADD CONSTRAINT vendor_due_source CHECK(statement_id IS NOT NULL OR supplier_document_id IS NOT NULL);
ALTER TABLE vendor_payment_advices ADD COLUMN request_key uuid UNIQUE,ADD COLUMN request_hash text,
 ADD COLUMN evidence text,ADD COLUMN review_reason text,ADD COLUMN source_fingerprint text,
 ADD COLUMN confirmed_by integer REFERENCES users(id),ADD COLUMN confirmed_at timestamptz,
 ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE vendor_debit_notes ADD COLUMN evidence text,ADD COLUMN review_reason text,
 ADD COLUMN request_key uuid UNIQUE,ADD COLUMN request_hash text;
CREATE UNIQUE INDEX vendor_confirmed_transaction ON vendor_payment_advices(vendor_id,upper(trim(transaction_reference)))
 WHERE NOT is_deleted AND status IN ('PENDING_APPROVAL','APPROVED','CONFIRMED') AND transaction_reference IS NOT NULL;
CREATE FUNCTION guard_vendor_payment_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') OR current_setting('mehta.payables_write',true) IS DISTINCT FROM 'authorized'
 OR nullif(current_setting('mehta.actor_id',true),'') IS NULL
 OR length(trim(coalesce(current_setting('mehta.audit_reason',true),'')))<3 THEN RAISE EXCEPTION 'Use the audited supplier payable workflow'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.created_by::text IS DISTINCT FROM current_setting('mehta.actor_id',true) THEN RAISE EXCEPTION 'An actual creator is required'; END IF;
  IF TG_TABLE_NAME='vendor_due_lines' THEN
   IF (NEW.status<>'PENDING_REVIEW' OR NEW.supplier_document_id IS NULL OR NEW.company_id IS NULL OR NEW.source_fingerprint IS NULL OR length(trim(coalesce(NEW.evidence,'')))<3) THEN RAISE EXCEPTION 'New supplier dues require invoice evidence and independent review'; END IF;
  END IF;
  IF TG_TABLE_NAME IN ('vendor_payment_advices','vendor_debit_notes') THEN
   IF (NEW.status<>'PENDING_APPROVAL' OR NEW.due_line_id IS NULL OR NEW.request_key IS NULL OR NEW.request_hash IS NULL OR length(trim(coalesce(NEW.evidence,'')))<3) THEN RAISE EXCEPTION 'Supplier payment and adjustment records require evidence and independent review'; END IF;
  END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='vendor_due_lines' THEN
   IF (NEW.supplier_document_id,NEW.supplier_po_id,NEW.statement_id,NEW.vendor_id,NEW.company_id,NEW.invoice_number,NEW.invoice_date,NEW.due_date,NEW.amount,NEW.currency_code,NEW.source_fingerprint,NEW.evidence)
    IS DISTINCT FROM (OLD.supplier_document_id,OLD.supplier_po_id,OLD.statement_id,OLD.vendor_id,OLD.company_id,OLD.invoice_number,OLD.invoice_date,OLD.due_date,OLD.amount,OLD.currency_code,OLD.source_fingerprint,OLD.evidence) THEN RAISE EXCEPTION 'Supplier due source facts are immutable'; END IF;
   IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Supplier due version must advance'; END IF;
   IF NOT ((OLD.status='PENDING_REVIEW' AND NEW.status IN ('OPEN','DISPUTED')) OR (OLD.status IN ('OPEN','PARTIALLY_PAID') AND NEW.status IN ('OPEN','PARTIALLY_PAID','PAID'))) THEN RAISE EXCEPTION 'Invalid supplier due transition'; END IF;
   IF OLD.status='PENDING_REVIEW' AND NEW.status='OPEN' AND (NEW.reviewed_by IS NULL OR NEW.reviewed_by=NEW.created_by OR NEW.reviewed_by::text IS DISTINCT FROM current_setting('mehta.actor_id',true)) THEN RAISE EXCEPTION 'An independent reviewer must verify the supplier due'; END IF;
  ELSIF TG_TABLE_NAME='vendor_payment_advices' THEN
   IF (NEW.vendor_id,NEW.due_line_id,NEW.amount,NEW.currency_code,NEW.payment_date,NEW.transaction_reference,NEW.advice_number,NEW.request_key,NEW.request_hash,NEW.source_fingerprint,NEW.evidence)
    IS DISTINCT FROM (OLD.vendor_id,OLD.due_line_id,OLD.amount,OLD.currency_code,OLD.payment_date,OLD.transaction_reference,OLD.advice_number,OLD.request_key,OLD.request_hash,OLD.source_fingerprint,OLD.evidence) THEN RAISE EXCEPTION 'Supplier payment source facts are immutable'; END IF;
   IF NOT ((OLD.status='PENDING_APPROVAL' AND NEW.status IN ('APPROVED','REJECTED')) OR (OLD.status='APPROVED' AND NEW.status IN ('CONFIRMED','REJECTED'))) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Invalid supplier payment transition'; END IF;
  ELSIF TG_TABLE_NAME='vendor_debit_notes' THEN
   IF (to_jsonb(NEW)-ARRAY['status','approved_by','approved_at','approval_reason','review_reason','updated_at','updated_by','row_metadata_version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','approved_by','approved_at','approval_reason','review_reason','updated_at','updated_by','row_metadata_version']) THEN RAISE EXCEPTION 'Supplier note source facts are immutable'; END IF;
   IF OLD.status<>'PENDING_APPROVAL' OR NEW.status NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'Supplier note review is final'; END IF;
  END IF;
  IF TG_TABLE_NAME='vendor_payment_advices' THEN
   IF NEW.status='CONFIRMED' AND (NEW.confirmed_by IS NULL OR NEW.confirmed_by=NEW.created_by OR NEW.confirmed_at IS NULL OR NEW.confirmed_by::text IS DISTINCT FROM current_setting('mehta.actor_id',true)) THEN RAISE EXCEPTION 'Independent payment confirmation is required'; END IF;
  END IF;
  IF TG_TABLE_NAME IN ('vendor_payment_advices','vendor_debit_notes') THEN
   IF NEW.status='APPROVED' AND (NEW.approved_by IS NULL OR NEW.approved_by=NEW.created_by OR NEW.approved_by::text IS DISTINCT FROM current_setting('mehta.actor_id',true)) THEN RAISE EXCEPTION 'Independent payment or adjustment approval is required'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['vendor_due_lines','vendor_payment_advices','vendor_debit_notes'] LOOP
  EXECUTE format('CREATE TRIGGER supplier_payment_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_vendor_payment_workflow()',t);
  EXECUTE format('CREATE TRIGGER supplier_payment_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION guard_vendor_payment_workflow()',t);
 END LOOP;
END $$;
