-- Additive Accounts inbox. Financial records and the shared notification/audit tables are reused.
CREATE TABLE crm_accounts_intakes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES tally_companies(id),
 credential_id uuid NOT NULL REFERENCES automation_service_credentials(id), email_message_id uuid NOT NULL,
 provider_message_id text NOT NULL CHECK(length(provider_message_id) BETWEEN 1 AND 250),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'), source jsonb NOT NULL CHECK(jsonb_typeof(source)='object'),
 category text NOT NULL CHECK(category IN ('CREDIT_NOTE','DEBIT_NOTE','INVOICE','REMINDER','DUE_PAYMENT','PAYMENT_CLAIM','PAYMENT_STATUS','PAYMENT_CONFIRMATION','PAYMENT_DISPUTE','OTHER_PAYMENT','OTHER')),
 status text NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK(status IN ('NEEDS_REVIEW','REVIEWED','APPROVED','REJECTED','COMPLETED')),
 customer_id integer REFERENCES customers(id), invoice_document_id uuid REFERENCES billing_documents(id),
 finance_operation_id uuid REFERENCES crm_operations(id), assigned_to integer NOT NULL REFERENCES users(id),
 backup_owner_id integer NOT NULL REFERENCES users(id), reviewed_by integer REFERENCES users(id), approved_by integer REFERENCES users(id),
 resolutions jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,email_message_id), UNIQUE(company_id,provider_message_id), CHECK(assigned_to<>backup_owner_id)
);
CREATE INDEX crm_accounts_intakes_queue ON crm_accounts_intakes(company_id,status,category,created_at DESC,id);
CREATE INDEX crm_accounts_intakes_customer ON crm_accounts_intakes(customer_id,created_at DESC);
CREATE TABLE crm_accounts_intake_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, intake_id uuid NOT NULL REFERENCES crm_accounts_intakes(id),
 action text NOT NULL, actor_id integer REFERENCES users(id), credential_id uuid REFERENCES automation_service_credentials(id),
 reason text NOT NULL CHECK(length(trim(reason))>=3), detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX crm_accounts_intake_events_timeline ON crm_accounts_intake_events(intake_id,id);
CREATE FUNCTION guard_accounts_intake() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') OR current_setting('mehta.accounts_intake_write',true) IS DISTINCT FROM 'authorized'
 OR nullif(current_setting('mehta.actor_id',true),'') IS NULL OR length(trim(coalesce(current_setting('mehta.audit_reason',true),'')))<3 THEN
  RAISE EXCEPTION 'Accounts intake requires an authorised audited workflow';
 END IF;
 IF TG_TABLE_NAME='crm_accounts_intake_events' AND TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Accounts events are append only'; END IF;
 IF TG_TABLE_NAME='crm_accounts_intakes' AND TG_OP='UPDATE' THEN
  IF (NEW.company_id,NEW.credential_id,NEW.email_message_id,NEW.provider_message_id,NEW.request_hash,NEW.source,NEW.created_at)
  IS DISTINCT FROM (OLD.company_id,OLD.credential_id,OLD.email_message_id,OLD.provider_message_id,OLD.request_hash,OLD.source,OLD.created_at)
  THEN RAISE EXCEPTION 'Original Accounts delivery is immutable'; END IF;
  NEW.updated_at=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_accounts_intakes_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_accounts_intakes FOR EACH ROW EXECUTE FUNCTION guard_accounts_intake();
CREATE TRIGGER crm_accounts_intake_events_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_accounts_intake_events FOR EACH ROW EXECUTE FUNCTION guard_accounts_intake();
CREATE TRIGGER crm_accounts_intakes_no_truncate BEFORE TRUNCATE ON crm_accounts_intakes FOR EACH STATEMENT EXECUTE FUNCTION guard_accounts_intake();
CREATE TRIGGER crm_accounts_intake_events_no_truncate BEFORE TRUNCATE ON crm_accounts_intake_events FOR EACH STATEMENT EXECUTE FUNCTION guard_accounts_intake();
