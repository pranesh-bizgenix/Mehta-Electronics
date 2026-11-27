-- Reuse bank masters/statements/matches and confirmed CRM receipts.
ALTER TABLE bank_accounts ADD COLUMN verified_by integer REFERENCES users(id),ADD COLUMN verified_at timestamptz,ADD COLUMN verification_reason text;
ALTER TABLE bank_statement_imports ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}',ADD COLUMN request_key uuid UNIQUE;
ALTER TABLE bank_reconciliation_matches DROP CONSTRAINT bank_reconciliation_matches_statement_line_id_operation_id_key;
CREATE UNIQUE INDEX bank_reconciliation_active_pair ON bank_reconciliation_matches(statement_line_id,operation_id) WHERE NOT is_deleted AND status IN ('PROPOSED','CONFIRMED');
CREATE TABLE crm_bank_source_files (
 import_id uuid PRIMARY KEY REFERENCES bank_statement_imports(id),source_document_id uuid NOT NULL REFERENCES source_documents(id),
 original_name text NOT NULL,original_bytes bytea NOT NULL CHECK(octet_length(original_bytes) BETWEEN 1 AND 2097152),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_bank_source_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('mehta.bank_write',true) IS DISTINCT FROM 'authorized'
 OR NEW.created_by::text IS DISTINCT FROM current_setting('mehta.actor_id',true)
 OR length(trim(coalesce(current_setting('mehta.audit_reason',true),'')))<3 THEN RAISE EXCEPTION 'Bank originals are immutable and require the audited banking workflow'; END IF;
 INSERT INTO audit_logs(user_id,entity,record_id,action,new_value,reason) VALUES(NEW.created_by,'BANK_STATEMENT_SOURCE',NEW.import_id::text,'RETAINED',jsonb_build_object('sha256',NEW.sha256,'bytes',octet_length(NEW.original_bytes))::text,current_setting('mehta.audit_reason',true));
 RETURN NEW;
END $$;
CREATE TRIGGER bank_source_file_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_bank_source_files FOR EACH ROW EXECUTE FUNCTION guard_bank_source_file();
CREATE TRIGGER bank_source_file_no_truncate BEFORE TRUNCATE ON crm_bank_source_files FOR EACH STATEMENT EXECUTE FUNCTION guard_bank_source_file();
CREATE FUNCTION guard_bank_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('mehta.bank_write',true) IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'Use the audited bank reconciliation workflow'; END IF;
 IF TG_TABLE_NAME='bank_accounts' THEN
  IF NEW.status='ACTIVE' AND (NEW.verified_by IS NULL OR NEW.verified_by=NEW.created_by OR NEW.verified_at IS NULL OR length(trim(coalesce(NEW.verification_reason,'')))<3) THEN RAISE EXCEPTION 'An independent reviewer must verify the bank account'; END IF;
  IF TG_OP='UPDATE' AND (NEW.company_id,NEW.account_reference,NEW.currency_code) IS DISTINCT FROM (OLD.company_id,OLD.account_reference,OLD.currency_code) THEN RAISE EXCEPTION 'Bank account identity is immutable'; END IF;
 ELSIF TG_TABLE_NAME='bank_statement_imports' AND TG_OP='UPDATE' THEN
  IF (NEW.bank_account_id,NEW.source_document_id,NEW.file_sha256,NEW.layout_key,NEW.metadata,NEW.request_key) IS DISTINCT FROM (OLD.bank_account_id,OLD.source_document_id,OLD.file_sha256,OLD.layout_key,OLD.metadata,OLD.request_key) THEN RAISE EXCEPTION 'Statement source and balances are immutable'; END IF;
 ELSIF TG_TABLE_NAME='bank_statement_lines' AND TG_OP='UPDATE' THEN
  IF (NEW.import_id,NEW.bank_account_id,NEW.source_line_key,NEW.transaction_date,NEW.value_date,NEW.direction,NEW.amount,NEW.balance,NEW.utr,NEW.narration,NEW.raw_row) IS DISTINCT FROM (OLD.import_id,OLD.bank_account_id,OLD.source_line_key,OLD.transaction_date,OLD.value_date,OLD.direction,OLD.amount,OLD.balance,OLD.utr,OLD.narration,OLD.raw_row) THEN RAISE EXCEPTION 'Imported bank transactions are immutable'; END IF;
 ELSIF TG_TABLE_NAME='bank_reconciliation_matches' AND TG_OP='UPDATE' THEN
  IF (NEW.statement_line_id,NEW.operation_id,NEW.amount,NEW.reason) IS DISTINCT FROM (OLD.statement_line_id,OLD.operation_id,OLD.amount,OLD.reason) THEN RAISE EXCEPTION 'Match proposals are immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bank_account_workflow BEFORE INSERT OR UPDATE ON bank_accounts FOR EACH ROW EXECUTE FUNCTION guard_bank_workflow();
CREATE TRIGGER bank_import_workflow BEFORE INSERT OR UPDATE ON bank_statement_imports FOR EACH ROW EXECUTE FUNCTION guard_bank_workflow();
CREATE TRIGGER bank_line_workflow BEFORE INSERT OR UPDATE ON bank_statement_lines FOR EACH ROW EXECUTE FUNCTION guard_bank_workflow();
CREATE TRIGGER bank_match_workflow BEFORE INSERT OR UPDATE ON bank_reconciliation_matches FOR EACH ROW EXECUTE FUNCTION guard_bank_workflow();
