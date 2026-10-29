ALTER TABLE email_threads
  ADD CONSTRAINT email_threads_id_account_unique UNIQUE(id,email_account_id),
  ADD COLUMN invoice_id uuid REFERENCES sales_invoices(id);
ALTER TABLE email_messages
  ADD CONSTRAINT email_messages_thread_account_fk
  FOREIGN KEY(thread_id,email_account_id) REFERENCES email_threads(id,email_account_id);
ALTER TABLE reminders
  ADD COLUMN invoice_id uuid REFERENCES sales_invoices(id);

CREATE INDEX email_threads_invoice_idx
  ON email_threads(invoice_id,last_message_at DESC) WHERE invoice_id IS NOT NULL;
CREATE INDEX email_drafts_approval_idx
  ON email_drafts(approval_request_id) WHERE approval_request_id IS NOT NULL;
CREATE INDEX email_drafts_workflow_execution_idx
  ON email_drafts(workflow_execution_id) WHERE workflow_execution_id IS NOT NULL;
CREATE INDEX email_drafts_enquiry_idx
  ON email_drafts(enquiry_id,created_at DESC) WHERE enquiry_id IS NOT NULL;
CREATE INDEX email_drafts_quotation_idx
  ON email_drafts(quotation_id,created_at DESC) WHERE quotation_id IS NOT NULL;
CREATE INDEX reminders_enquiry_idx
  ON reminders(enquiry_id,due_at) WHERE enquiry_id IS NOT NULL;
CREATE INDEX reminders_quotation_idx
  ON reminders(quotation_id,due_at) WHERE quotation_id IS NOT NULL;
CREATE INDEX reminders_invoice_idx
  ON reminders(invoice_id,due_at) WHERE invoice_id IS NOT NULL;
CREATE INDEX notifications_reminder_idx
  ON notifications(reminder_id) WHERE reminder_id IS NOT NULL;
CREATE INDEX tally_conflicts_party_mapping_idx
  ON tally_conflicts(party_mapping_id) WHERE party_mapping_id IS NOT NULL;
CREATE INDEX tally_conflicts_part_mapping_idx
  ON tally_conflicts(part_mapping_id) WHERE part_mapping_id IS NOT NULL;
CREATE INDEX tally_reconciliations_job_idx
  ON tally_reconciliations(job_id) WHERE job_id IS NOT NULL;

CREATE FUNCTION target_source_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'Source documents cannot be deleted or truncated';
  END IF;
  IF (NEW.content_sha256,NEW.document_type,NEW.original_name,NEW.mime_type,
      NEW.byte_count,NEW.storage_reference,NEW.issuer_party_id,NEW.ingestion_source,
      NEW.ingestion_reference,NEW.ingested_at,NEW.created_at,NEW.created_by)
     IS DISTINCT FROM
     (OLD.content_sha256,OLD.document_type,OLD.original_name,OLD.mime_type,
      OLD.byte_count,OLD.storage_reference,OLD.issuer_party_id,OLD.ingestion_source,
      OLD.ingestion_reference,OLD.ingested_at,OLD.created_at,OLD.created_by) THEN
    RAISE EXCEPTION 'Source document originals and provenance are immutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER source_documents_immutable
  BEFORE UPDATE OR DELETE ON source_documents
  FOR EACH ROW EXECUTE FUNCTION target_source_document_guard();
CREATE TRIGGER source_documents_no_truncate
  BEFORE TRUNCATE ON source_documents
  FOR EACH STATEMENT EXECUTE FUNCTION target_source_document_guard();

CREATE FUNCTION target_workflow_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active_version IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM workflow_versions
    WHERE id=NEW.active_version AND workflow_definition_id=NEW.id
  ) THEN
    RAISE EXCEPTION 'Active workflow version must belong to its workflow definition';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER workflow_definition_active_version_guard
  BEFORE INSERT OR UPDATE OF active_version ON workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION target_workflow_version_guard();
