-- Additive Customer Support inbox; reuse existing operations, notifications and audit.
CREATE TABLE crm_support_intakes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES tally_companies(id),
 credential_id uuid NOT NULL REFERENCES automation_service_credentials(id), email_message_id uuid NOT NULL,
 provider_message_id text NOT NULL CHECK(length(provider_message_id) BETWEEN 1 AND 250),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'), source jsonb NOT NULL,
 category text NOT NULL CHECK(category IN ('PRODUCT_ENQUIRY','PRODUCT_SUPPORT','OTHER')),
 status text NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK(status IN ('NEEDS_REVIEW','REVIEWED','LINKED','CLOSED','REJECTED')),
 revision integer NOT NULL CHECK(revision>0), payload jsonb NOT NULL,
 customer_id integer REFERENCES customers(id), invoice_document_id uuid REFERENCES billing_documents(id),
 assigned_to integer NOT NULL REFERENCES users(id), backup_owner_id integer NOT NULL REFERENCES users(id),
 reviewed_by integer REFERENCES users(id), resolutions jsonb NOT NULL DEFAULT '{}',
 linked_records jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1 CHECK(version>0),
 received_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,email_message_id), UNIQUE(company_id,provider_message_id), CHECK(assigned_to<>backup_owner_id),
 CHECK(jsonb_typeof(source)='object' AND jsonb_typeof(payload)='object' AND jsonb_typeof(linked_records)='object')
);
CREATE INDEX crm_support_intakes_queue ON crm_support_intakes(company_id,status,category,created_at DESC,id);
CREATE INDEX crm_support_intakes_customer ON crm_support_intakes(customer_id,created_at DESC);
CREATE TABLE crm_support_intake_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, intake_id uuid NOT NULL REFERENCES crm_support_intakes(id),
 action text NOT NULL, actor_id integer REFERENCES users(id), credential_id uuid REFERENCES automation_service_credentials(id),
 reason text NOT NULL CHECK(length(trim(reason))>=3), detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX crm_support_intake_events_timeline ON crm_support_intake_events(intake_id,id);
CREATE TABLE crm_support_deliveries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, intake_id uuid NOT NULL REFERENCES crm_support_intakes(id),
 revision integer NOT NULL CHECK(revision>0), event_id text NOT NULL,
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'), payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(intake_id,revision)
);
CREATE FUNCTION guard_support_intake() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') OR current_setting('mehta.support_intake_write',true) IS DISTINCT FROM 'authorized'
 OR nullif(current_setting('mehta.actor_id',true),'') IS NULL OR length(trim(coalesce(current_setting('mehta.audit_reason',true),'')))<3 THEN
  RAISE EXCEPTION 'Support intake requires an authorised audited workflow';
 END IF;
 IF TG_TABLE_NAME IN ('crm_support_intake_events','crm_support_deliveries') AND TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Support events and deliveries are append only'; END IF;
 IF TG_TABLE_NAME='crm_support_intakes' AND TG_OP='UPDATE' THEN
  IF (NEW.company_id,NEW.credential_id,NEW.email_message_id,NEW.provider_message_id,NEW.source_hash,NEW.source,NEW.received_at,NEW.created_at)
  IS DISTINCT FROM (OLD.company_id,OLD.credential_id,OLD.email_message_id,OLD.provider_message_id,OLD.source_hash,OLD.source,OLD.received_at,OLD.created_at)
  THEN RAISE EXCEPTION 'Original Support delivery is immutable'; END IF;
  NEW.updated_at=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_support_intakes_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_support_intakes FOR EACH ROW EXECUTE FUNCTION guard_support_intake();
CREATE TRIGGER crm_support_intake_events_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_support_intake_events FOR EACH ROW EXECUTE FUNCTION guard_support_intake();
CREATE TRIGGER crm_support_intakes_no_truncate BEFORE TRUNCATE ON crm_support_intakes FOR EACH STATEMENT EXECUTE FUNCTION guard_support_intake();
CREATE TRIGGER crm_support_intake_events_no_truncate BEFORE TRUNCATE ON crm_support_intake_events FOR EACH STATEMENT EXECUTE FUNCTION guard_support_intake();
CREATE TRIGGER crm_support_deliveries_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_support_deliveries FOR EACH ROW EXECUTE FUNCTION guard_support_intake();
CREATE TRIGGER crm_support_deliveries_no_truncate BEFORE TRUNCATE ON crm_support_deliveries FOR EACH STATEMENT EXECUTE FUNCTION guard_support_intake();
