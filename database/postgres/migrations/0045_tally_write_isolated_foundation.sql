-- New write-side storage only. Existing read tables/outbox/guards remain unchanged.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
CREATE TABLE tw_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), master_enabled boolean NOT NULL DEFAULT false,
 approval_mode text CHECK(approval_mode IN ('AUTO_AFTER_BUSINESS_APPROVAL','SEPARATE_PUSH_APPROVAL')),
 revision bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), created_by integer REFERENCES users(id), updated_by integer REFERENCES users(id),
 reason text NOT NULL CHECK(length(trim(reason))>=3)
);
INSERT INTO tw_control(reason) VALUES('Technical default: all Tally writes disabled; no business policy supplied.');
CREATE TABLE tw_mapping_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES tally_companies(id),
 category text NOT NULL CHECK(category IN ('SALES_ORDER','PURCHASE_ORDER','PARTY_LEDGER')),version integer NOT NULL CHECK(version>0),
 configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object'),configuration_hash text NOT NULL CHECK(configuration_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL CHECK(status IN ('DRAFT','APPROVED')),parent_version_id uuid REFERENCES tw_mapping_versions(id),
 created_by integer NOT NULL REFERENCES users(id),approved_by integer REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL CHECK(length(trim(reason))>=3),CHECK(status<>'APPROVED' OR approved_by IS NOT NULL),
 UNIQUE(company_id,category,version)
);
CREATE TABLE tw_categories (
 category text PRIMARY KEY CHECK(category IN ('SALES_ORDER','PURCHASE_ORDER','PARTY_LEDGER')),
 enabled boolean NOT NULL DEFAULT false,dry_run_only boolean NOT NULL DEFAULT true,paused boolean NOT NULL DEFAULT false,
 company_id uuid REFERENCES tally_companies(id),mapping_id uuid REFERENCES tw_mapping_versions(id),
 approval_mode text CHECK(approval_mode IN ('AUTO_AFTER_BUSINESS_APPROVAL','SEPARATE_PUSH_APPROVAL')),
 conflict_winner jsonb CHECK(conflict_winner IS NULL OR jsonb_typeof(conflict_winner)='object'),
 tally_version text,xml_import_verified boolean,
 max_attempts integer CHECK(max_attempts>0),backoff_seconds integer CHECK(backoff_seconds>0),
 failure_threshold integer CHECK(failure_threshold>0),min_gap_seconds integer CHECK(min_gap_seconds>0),
 per_day_cap integer CHECK(per_day_cap>0),lease_seconds integer CHECK(lease_seconds>0),
 consecutive_failures integer NOT NULL DEFAULT 0 CHECK(consecutive_failures>=0),last_sent_at timestamptz,
 revision bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by integer REFERENCES users(id),updated_by integer REFERENCES users(id),reason text NOT NULL CHECK(length(trim(reason))>=3)
);
INSERT INTO tw_categories(category,reason) VALUES
 ('SALES_ORDER','Technical default: disabled and dry-run only; business settings are not set.'),
 ('PURCHASE_ORDER','Technical default: disabled and dry-run only; business settings are not set.'),
 ('PARTY_LEDGER','Technical default: disabled and dry-run only; business settings are not set.');
CREATE TABLE tw_party_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES tally_companies(id),
 entity_type text NOT NULL CHECK(entity_type IN ('CUSTOMER','VENDOR')),entity_id text NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),snapshot_hash text NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','HELD','CANCELLED')),
 created_by integer NOT NULL REFERENCES users(id),approved_by integer REFERENCES users(id),approved_at timestamptz,
 reason text NOT NULL CHECK(length(trim(reason))>=3),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(status<>'APPROVED' OR (approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL)),
 UNIQUE(company_id,entity_type,entity_id,snapshot_hash)
);
CREATE TABLE tw_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),category text NOT NULL REFERENCES tw_categories(category),
 entity_type text NOT NULL CHECK(entity_type IN ('SALES_ORDER','PURCHASE_ORDER','CUSTOMER','VENDOR')),entity_id text NOT NULL,
 entity_version_hash text NOT NULL CHECK(entity_version_hash ~ '^[a-f0-9]{64}$'),company_id uuid NOT NULL REFERENCES tally_companies(id),
 mapping_id uuid NOT NULL REFERENCES tw_mapping_versions(id),config_revision bigint NOT NULL,control_revision bigint NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),payload_xml text NOT NULL CHECK(octet_length(payload_xml)<=1048576),
 validation_report jsonb NOT NULL CHECK(jsonb_typeof(validation_report)='object'),idempotency_key text NOT NULL UNIQUE CHECK(idempotency_key ~ '^[a-f0-9]{64}$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','CLAIMED','SENT','CONFIRMED','FAILED','UNKNOWN','CANCELLED','HELD')),
 dry_run boolean NOT NULL DEFAULT true,attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 lease_owner uuid REFERENCES tally_connectors(id),lease_token_hash text,lease_expires_at timestamptz,
 send_authorized_at timestamptz,sent_at timestamptz,confirmed_at timestamptz,available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_error text,response_xml text CHECK(response_xml IS NULL OR octet_length(response_xml)<=1048576),
 readback_xml text CHECK(readback_xml IS NULL OR octet_length(readback_xml)<=1048576),tally_voucher_ref jsonb,
 created_by integer NOT NULL REFERENCES users(id),business_maker_id integer NOT NULL REFERENCES users(id),
 approved_by integer REFERENCES users(id),approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL CHECK(length(trim(reason))>=3),
 CHECK(approved_by IS NULL OR approved_by<>business_maker_id),
 CHECK(status NOT IN ('APPROVED','CLAIMED','SENT','CONFIRMED') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
 CHECK(status<>'CONFIRMED' OR (confirmed_at IS NOT NULL AND tally_voucher_ref IS NOT NULL)),
 UNIQUE(category,entity_id,entity_version_hash)
);
CREATE INDEX tw_claim_pending ON tw_outbox(company_id,created_at,id) WHERE status IN ('PENDING','APPROVED') AND NOT dry_run;
CREATE INDEX tw_leases ON tw_outbox(lease_expires_at) WHERE status IN ('CLAIMED','SENT');
CREATE TABLE tw_outbox_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,outbox_id uuid REFERENCES tw_outbox(id),
 entity_type text NOT NULL,entity_id text NOT NULL,action text NOT NULL,
 previous_status text CHECK(previous_status IN ('PENDING','APPROVED','CLAIMED','SENT','CONFIRMED','FAILED','UNKNOWN','CANCELLED','HELD')),
 next_status text CHECK(next_status IN ('PENDING','APPROVED','CLAIMED','SENT','CONFIRMED','FAILED','UNKNOWN','CANCELLED','HELD')),
 actor_id integer REFERENCES users(id),connector_id uuid REFERENCES tally_connectors(id),reason text NOT NULL CHECK(length(trim(reason))>=3),
 detail jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(detail)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE tw_connector_capabilities (
 connector_id uuid PRIMARY KEY REFERENCES tally_connectors(id),company_id uuid NOT NULL REFERENCES tally_companies(id),
 protocol integer NOT NULL CHECK(protocol=1),version text NOT NULL,create_only boolean NOT NULL CHECK(create_only),
 reported_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE tw_document_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),outbox_id uuid NOT NULL UNIQUE REFERENCES tw_outbox(id),
 company_id uuid NOT NULL REFERENCES tally_companies(id),category text NOT NULL REFERENCES tw_categories(category),
 entity_type text NOT NULL,entity_id text NOT NULL,entity_version_hash text NOT NULL,
 tally_ref jsonb NOT NULL CHECK(jsonb_typeof(tally_ref)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(company_id,category,entity_id,entity_version_hash)
);
CREATE TABLE tw_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),category text NOT NULL REFERENCES tw_categories(category),
 company_id uuid NOT NULL REFERENCES tally_companies(id),outbox_id uuid REFERENCES tw_outbox(id),
 code text NOT NULL,status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACKNOWLEDGED')),
 message text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 acknowledged_by integer REFERENCES users(id),reason text NOT NULL CHECK(length(trim(reason))>=3)
);
CREATE TABLE tw_conflict_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),outbox_id uuid NOT NULL REFERENCES tw_outbox(id),conflict_id uuid NOT NULL REFERENCES tally_conflicts(id),
 imported_record_id text NOT NULL REFERENCES tally_visibility_records(id),comparison_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(outbox_id,imported_record_id,comparison_hash)
);
CREATE FUNCTION tw_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Tally write evidence is append-only; hard deletion/truncation is forbidden'; END $$;
CREATE FUNCTION tw_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer; connector uuid; why text; k text; before_state text; after_state text;
BEGIN
 actor:=NULLIF(current_setting('mehta.actor_id',true),'')::integer;
 connector:=NULLIF(current_setting('mehta.tw_connector_id',true),'')::uuid;
 why:=NULLIF(trim(current_setting('mehta.audit_reason',true)),'');
 IF length(coalesce(why,''))<3 OR (actor IS NULL AND connector IS NULL) THEN RAISE EXCEPTION 'An authenticated actor or connector and reason are required for write-side changes'; END IF;
 IF TG_OP='UPDATE' AND to_jsonb(NEW)?'updated_at' THEN NEW.updated_at:=clock_timestamp(); END IF;
 k:=coalesce(to_jsonb(NEW)->>'id',to_jsonb(NEW)->>'category',to_jsonb(NEW)->>'connector_id','control');
 IF TG_TABLE_NAME='tw_outbox' THEN
  IF TG_OP='UPDATE' THEN
   IF OLD.status='CONFIRMED' THEN RAISE EXCEPTION 'Confirmed Tally create evidence is immutable'; END IF;
   IF NEW.payload_xml IS DISTINCT FROM OLD.payload_xml OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.mapping_id IS DISTINCT FROM OLD.mapping_id OR NEW.entity_version_hash IS DISTINCT FROM OLD.entity_version_hash THEN RAISE EXCEPTION 'Queued create snapshot is immutable; hold it and approve a new version'; END IF;
   before_state:=OLD.status;
  END IF;
  after_state:=NEW.status;
 END IF;
 INSERT INTO tw_outbox_events(outbox_id,entity_type,entity_id,action,previous_status,next_status,actor_id,connector_id,reason,detail)
 VALUES(CASE WHEN TG_TABLE_NAME='tw_outbox' THEN (to_jsonb(NEW)->>'id')::uuid END,TG_TABLE_NAME,k,TG_OP,before_state,after_state,actor,connector,why,jsonb_build_object('revision',to_jsonb(NEW)->'revision'));
 INSERT INTO audit_logs(user_id,entity,record_id,action,reason,new_value)
 VALUES(actor,'TALLY_WRITE',TG_TABLE_NAME||':'||k,TG_OP,why,jsonb_build_object('connectorId',connector,'status',after_state,'revision',to_jsonb(NEW)->'revision')::text);
 RETURN NEW;
END $$;
INSERT INTO permissions(key,resource,action,description,owner_only) VALUES
 ('tally.write.manage','tally_write','W','Owner-only write configuration and field mappings',true),
 ('tally.write.approve','tally_write','A','Independently approve an eligible queued Tally create',false),
 ('tally.write.read','tally_write','F','View Tally create XML, responses and write-side events',false);
-- No new grants: Owner already has all_permissions; all existing grants stay unchanged.
INSERT INTO audit_logs(entity,record_id,action,reason,new_value) VALUES('SCHEMA_MIGRATION','0045_tally_write_isolated_foundation','MIGRATION','Add isolated create-only write infrastructure; existing read schema and old dry-run-only outbox remain unchanged','{"master":false,"categoriesEnabled":0,"dryRunOnly":true,"businessSettings":null}');

-- Index every new FK; audit/retention guards are attached only to new tables.
ALTER TABLE tw_control ADD COLUMN is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE tw_control ADD COLUMN deleted_at timestamptz;
ALTER TABLE tw_control ADD COLUMN deleted_by integer REFERENCES users(id);
ALTER TABLE tw_control ADD COLUMN delete_reason text;
ALTER TABLE tw_control ADD CONSTRAINT tw_reasoned_archive CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND length(trim(delete_reason))>=3));
ALTER TABLE tw_categories ADD COLUMN is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE tw_categories ADD COLUMN deleted_at timestamptz;
ALTER TABLE tw_categories ADD COLUMN deleted_by integer REFERENCES users(id);
ALTER TABLE tw_categories ADD COLUMN delete_reason text;
ALTER TABLE tw_categories ADD CONSTRAINT tw_reasoned_archive CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND length(trim(delete_reason))>=3));
ALTER TABLE tw_outbox ADD COLUMN is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE tw_outbox ADD COLUMN deleted_at timestamptz;
ALTER TABLE tw_outbox ADD COLUMN deleted_by integer REFERENCES users(id);
ALTER TABLE tw_outbox ADD COLUMN delete_reason text;
ALTER TABLE tw_outbox ADD CONSTRAINT tw_reasoned_archive CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND length(trim(delete_reason))>=3));
ALTER TABLE tw_party_reviews ADD COLUMN is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE tw_party_reviews ADD COLUMN deleted_at timestamptz;
ALTER TABLE tw_party_reviews ADD COLUMN deleted_by integer REFERENCES users(id);
ALTER TABLE tw_party_reviews ADD COLUMN delete_reason text;
ALTER TABLE tw_party_reviews ADD CONSTRAINT tw_reasoned_archive CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND length(trim(delete_reason))>=3));
ALTER TABLE tw_alerts ADD COLUMN is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE tw_alerts ADD COLUMN deleted_at timestamptz;
ALTER TABLE tw_alerts ADD COLUMN deleted_by integer REFERENCES users(id);
ALTER TABLE tw_alerts ADD COLUMN delete_reason text;
ALTER TABLE tw_alerts ADD CONSTRAINT tw_reasoned_archive CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND length(trim(delete_reason))>=3));
CREATE INDEX tw_fk_8f8edb8a9fd6a571dc ON tw_control(created_by);
CREATE INDEX tw_fk_cb6ed347a55d7d4dd9 ON tw_control(updated_by);
CREATE INDEX tw_fk_3cc306211a201f7fe0 ON tw_mapping_versions(company_id);
CREATE INDEX tw_fk_09b17b285f18dbef7c ON tw_mapping_versions(parent_version_id);
CREATE INDEX tw_fk_eab30ce29a22a8484a ON tw_mapping_versions(created_by);
CREATE INDEX tw_fk_b9efd6499edec68479 ON tw_mapping_versions(approved_by);
CREATE INDEX tw_fk_100472cadf0dc1ee60 ON tw_categories(company_id);
CREATE INDEX tw_fk_9f784698241b6f2c15 ON tw_categories(mapping_id);
CREATE INDEX tw_fk_29d573d3f5ec0fffe0 ON tw_categories(created_by);
CREATE INDEX tw_fk_d7e3a82b4c73d4040a ON tw_categories(updated_by);
CREATE INDEX tw_fk_02902f004e9c7458a9 ON tw_party_reviews(company_id);
CREATE INDEX tw_fk_090c10dcf37947c703 ON tw_party_reviews(created_by);
CREATE INDEX tw_fk_1b19f910348cfb6320 ON tw_party_reviews(approved_by);
CREATE INDEX tw_fk_047bb486f9f8e9146f ON tw_outbox(category);
CREATE INDEX tw_fk_6610d3fda9ad812847 ON tw_outbox(company_id);
CREATE INDEX tw_fk_dfd4a39973ab02c4ae ON tw_outbox(mapping_id);
CREATE INDEX tw_fk_0589003e32285a837b ON tw_outbox(lease_owner);
CREATE INDEX tw_fk_6122d442c323ba737f ON tw_outbox(created_by);
CREATE INDEX tw_fk_1e746a16c173b30c45 ON tw_outbox(business_maker_id);
CREATE INDEX tw_fk_41bda405db32b9bc76 ON tw_outbox(approved_by);
CREATE INDEX tw_fk_a2b1dc0493bc5d5ce7 ON tw_outbox_events(outbox_id);
CREATE INDEX tw_fk_c34d0a5b489242b8a3 ON tw_outbox_events(actor_id);
CREATE INDEX tw_fk_aee3d9e2e555a84256 ON tw_outbox_events(connector_id);
CREATE INDEX tw_fk_d68d2cb1436973f76f ON tw_connector_capabilities(connector_id);
CREATE INDEX tw_fk_f63cdcd4cb3aec18a4 ON tw_connector_capabilities(company_id);
CREATE INDEX tw_fk_8a083a090a15c29bb9 ON tw_document_links(outbox_id);
CREATE INDEX tw_fk_e3bc3e211e50d71db1 ON tw_document_links(company_id);
CREATE INDEX tw_fk_5f6beeee214eff858d ON tw_document_links(category);
CREATE INDEX tw_fk_b3c9eade85471c232c ON tw_alerts(category);
CREATE INDEX tw_fk_8f869629a746bd277e ON tw_alerts(company_id);
CREATE INDEX tw_fk_fc657ded7c9a1c3d17 ON tw_alerts(outbox_id);
CREATE INDEX tw_fk_6ef1bf10ccdda56d07 ON tw_alerts(acknowledged_by);
CREATE INDEX tw_fk_71849b3823961ba3c8 ON tw_conflict_observations(outbox_id);
CREATE INDEX tw_fk_707f44eb59b9bc51bf ON tw_conflict_observations(conflict_id);
CREATE INDEX tw_fk_31266a60d298239550 ON tw_conflict_observations(imported_record_id);
CREATE INDEX tw_deleted_tw_control ON tw_control(deleted_by);
CREATE INDEX tw_deleted_tw_categories ON tw_categories(deleted_by);
CREATE INDEX tw_deleted_tw_outbox ON tw_outbox(deleted_by);
CREATE INDEX tw_deleted_tw_party_reviews ON tw_party_reviews(deleted_by);
CREATE INDEX tw_deleted_tw_alerts ON tw_alerts(deleted_by);
CREATE TRIGGER tw_no_delete BEFORE DELETE ON tw_control FOR EACH ROW EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_no_truncate BEFORE TRUNCATE ON tw_control FOR EACH STATEMENT EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_audit BEFORE INSERT OR UPDATE ON tw_control FOR EACH ROW EXECUTE FUNCTION tw_audit_change();
CREATE TRIGGER tw_no_delete BEFORE DELETE ON tw_mapping_versions FOR EACH ROW EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_no_truncate BEFORE TRUNCATE ON tw_mapping_versions FOR EACH STATEMENT EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER aa_tw_immutable BEFORE UPDATE ON tw_mapping_versions FOR EACH ROW EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_audit BEFORE INSERT OR UPDATE ON tw_mapping_versions FOR EACH ROW EXECUTE FUNCTION tw_audit_change();
CREATE TRIGGER tw_no_delete BEFORE DELETE ON tw_categories FOR EACH ROW EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_no_truncate BEFORE TRUNCATE ON tw_categories FOR EACH STATEMENT EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_audit BEFORE INSERT OR UPDATE ON tw_categories FOR EACH ROW EXECUTE FUNCTION tw_audit_change();
CREATE TRIGGER tw_no_delete BEFORE DELETE ON tw_party_reviews FOR EACH ROW EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_no_truncate BEFORE TRUNCATE ON tw_party_reviews FOR EACH STATEMENT EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_audit BEFORE INSERT OR UPDATE ON tw_party_reviews FOR EACH ROW EXECUTE FUNCTION tw_audit_change();
CREATE TRIGGER tw_no_delete BEFORE DELETE ON tw_outbox FOR EACH ROW EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_no_truncate BEFORE TRUNCATE ON tw_outbox FOR EACH STATEMENT EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_audit BEFORE INSERT OR UPDATE ON tw_outbox FOR EACH ROW EXECUTE FUNCTION tw_audit_change();
CREATE TRIGGER tw_no_delete BEFORE DELETE ON tw_outbox_events FOR EACH ROW EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_no_truncate BEFORE TRUNCATE ON tw_outbox_events FOR EACH STATEMENT EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER aa_tw_immutable BEFORE UPDATE ON tw_outbox_events FOR EACH ROW EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_no_delete BEFORE DELETE ON tw_connector_capabilities FOR EACH ROW EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_no_truncate BEFORE TRUNCATE ON tw_connector_capabilities FOR EACH STATEMENT EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_audit BEFORE INSERT OR UPDATE ON tw_connector_capabilities FOR EACH ROW EXECUTE FUNCTION tw_audit_change();
CREATE TRIGGER tw_no_delete BEFORE DELETE ON tw_document_links FOR EACH ROW EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_no_truncate BEFORE TRUNCATE ON tw_document_links FOR EACH STATEMENT EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER aa_tw_immutable BEFORE UPDATE ON tw_document_links FOR EACH ROW EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_audit BEFORE INSERT OR UPDATE ON tw_document_links FOR EACH ROW EXECUTE FUNCTION tw_audit_change();
CREATE TRIGGER tw_no_delete BEFORE DELETE ON tw_alerts FOR EACH ROW EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_no_truncate BEFORE TRUNCATE ON tw_alerts FOR EACH STATEMENT EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_audit BEFORE INSERT OR UPDATE ON tw_alerts FOR EACH ROW EXECUTE FUNCTION tw_audit_change();
CREATE TRIGGER tw_no_delete BEFORE DELETE ON tw_conflict_observations FOR EACH ROW EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_no_truncate BEFORE TRUNCATE ON tw_conflict_observations FOR EACH STATEMENT EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER aa_tw_immutable BEFORE UPDATE ON tw_conflict_observations FOR EACH ROW EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_audit BEFORE INSERT OR UPDATE ON tw_conflict_observations FOR EACH ROW EXECUTE FUNCTION tw_audit_change();
