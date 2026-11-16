-- S2: reviewed imports bridge the existing source/import registry to canonical CRM products/prices.
-- No business values, permission grants or source records are seeded.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
CREATE TABLE crm_price_import_workflows (
 id uuid PRIMARY KEY REFERENCES price_list_imports(id),
 file_sha256 char(64) NOT NULL CHECK(file_sha256 ~ '^[0-9a-f]{64}$'),
 original_bytes bytea NOT NULL CHECK(octet_length(original_bytes) BETWEEN 1 AND 8388608),
 source_format text NOT NULL CHECK(source_format IN ('CSV','XLSX','PDF_TABLE')),
 source_revision integer NOT NULL CHECK(source_revision>0),replaces_id uuid REFERENCES crm_price_import_workflows(id),
 mapping jsonb NOT NULL CHECK(jsonb_typeof(mapping)='object'),metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object'),
 plan_hash char(64) NOT NULL CHECK(plan_hash ~ '^[0-9a-f]{64}$'),
 row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 15000),
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','PENDING_APPROVAL','APPROVED','ACTIVATED','REJECTED','CANCELLED','ARCHIVED')),
 target_list_id bigint REFERENCES crm_price_lists(id),
 approval_rule_key text CHECK(approval_rule_key='price_lists.approval_policy'),approval_rule_version integer,
 FOREIGN KEY(approval_rule_key,approval_rule_version) REFERENCES business_rule_values(rule_key,version) MATCH FULL,
 approved_by integer REFERENCES users(id),approved_at timestamptz,approved_hash char(64),decision_reason text,
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 row_metadata_version smallint NOT NULL DEFAULT 1 CHECK(row_metadata_version=1),
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
 CHECK(approved_by IS NULL OR approved_by<>created_by),
 CHECK(status NOT IN ('APPROVED','ACTIVATED') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_hash IS NOT NULL AND approved_hash=plan_hash AND approval_rule_key IS NOT NULL AND approval_rule_version IS NOT NULL AND decision_reason IS NOT NULL AND length(trim(decision_reason))>=3)),
 CHECK(status<>'ACTIVATED' OR target_list_id IS NOT NULL),
 UNIQUE(file_sha256,source_revision),UNIQUE(file_sha256,plan_hash)
);
CREATE TABLE crm_price_import_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),import_id uuid NOT NULL REFERENCES crm_price_import_workflows(id),
 source_row_number integer NOT NULL CHECK(source_row_number>0),raw_row jsonb NOT NULL CHECK(jsonb_typeof(raw_row)='object'),
 item_id integer NOT NULL REFERENCES items(id),item_revision text NOT NULL,
 part_code text NOT NULL CHECK(length(trim(part_code)) BETWEEN 1 AND 200),uom text NOT NULL CHECK(length(trim(uom)) BETWEEN 1 AND 40),
 min_quantity numeric(20,6) NOT NULL CHECK(min_quantity>0),unit_price numeric(20,6) NOT NULL CHECK(unit_price>=0),
 discount_percent numeric(9,6) NOT NULL CHECK(discount_percent BETWEEN 0 AND 100),edition text,source_level text,
 activated_entry_id bigint REFERENCES crm_price_list_items(id),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 row_metadata_version smallint NOT NULL DEFAULT 1 CHECK(row_metadata_version=1),
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
 UNIQUE(import_id,source_row_number),UNIQUE(import_id,item_id,min_quantity)
);
CREATE TABLE crm_price_import_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),import_id uuid NOT NULL REFERENCES crm_price_import_workflows(id),
 action text NOT NULL CHECK(action IN ('CREATED','SUBMIT','RETURN','APPROVE','REJECT','ACTIVATE','CANCEL','ARCHIVE')),
 actor_id integer NOT NULL REFERENCES users(id),reason text NOT NULL CHECK(length(trim(reason))>=3),
 plan_hash char(64) NOT NULL CHECK(plan_hash ~ '^[0-9a-f]{64}$'),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX price_import_workflow_replace ON crm_price_import_workflows(replaces_id);
CREATE INDEX price_import_workflow_target ON crm_price_import_workflows(target_list_id);
CREATE INDEX price_import_workflow_rule ON crm_price_import_workflows(approval_rule_key,approval_rule_version);
CREATE INDEX price_import_workflow_approver ON crm_price_import_workflows(approved_by);
CREATE INDEX price_import_workflow_creator ON crm_price_import_workflows(created_by);
CREATE INDEX price_import_workflow_updater ON crm_price_import_workflows(updated_by);
CREATE INDEX price_import_workflow_deleter ON crm_price_import_workflows(deleted_by);
CREATE INDEX price_import_workflow_open ON crm_price_import_workflows(status,created_at) WHERE NOT is_deleted AND status IN ('PENDING_REVIEW','PENDING_APPROVAL','APPROVED');
CREATE INDEX price_import_workflow_status ON crm_price_import_workflows(status);
CREATE INDEX price_import_workflow_created ON crm_price_import_workflows(created_at);
CREATE INDEX price_import_entries_item ON crm_price_import_entries(item_id);
CREATE INDEX price_import_entries_activated ON crm_price_import_entries(activated_entry_id);
CREATE INDEX price_import_entries_creator ON crm_price_import_entries(created_by);
CREATE INDEX price_import_entries_updater ON crm_price_import_entries(updated_by);
CREATE INDEX price_import_entries_deleter ON crm_price_import_entries(deleted_by);
CREATE INDEX price_import_entries_created ON crm_price_import_entries(created_at);
CREATE INDEX price_import_events_import ON crm_price_import_events(import_id,created_at);
CREATE INDEX price_import_events_actor ON crm_price_import_events(actor_id);

CREATE FUNCTION crm_price_import_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer; why text;
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Price review evidence cannot be hard deleted'; END IF;
 actor:=NULLIF(current_setting('mehta.actor_id',true),'')::integer;why:=NULLIF(trim(current_setting('mehta.audit_reason',true)),'');
 IF actor IS NULL OR length(coalesce(why,''))<3 THEN RAISE EXCEPTION 'An actual actor and reason are required'; END IF;
 IF TG_OP='INSERT' AND coalesce(to_jsonb(NEW)->>'created_by',to_jsonb(NEW)->>'actor_id') IS DISTINCT FROM actor::text THEN RAISE EXCEPTION 'Actual creator required'; END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='crm_price_import_workflows' THEN
  IF NEW.status<>'PENDING_REVIEW' OR NEW.target_list_id IS NOT NULL OR NEW.approved_by IS NOT NULL OR NEW.approval_rule_version IS NOT NULL OR NEW.approved_hash IS NOT NULL OR NEW.approved_at IS NOT NULL THEN RAISE EXCEPTION 'New imports must start as unapproved reviews'; END IF;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME='crm_price_import_entries' THEN
  IF NEW.activated_entry_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM crm_price_import_workflows w WHERE w.id=NEW.import_id AND w.status='PENDING_REVIEW' AND w.created_by=actor) THEN RAISE EXCEPTION 'Rows may be staged only by the importer before submission'; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='crm_price_import_workflows' THEN
   IF NEW.status<>OLD.status AND NOT (
    (OLD.status='PENDING_REVIEW' AND NEW.status IN ('PENDING_APPROVAL','REJECTED','CANCELLED')) OR
    (OLD.status='PENDING_APPROVAL' AND NEW.status IN ('APPROVED','REJECTED','CANCELLED')) OR
    (OLD.status='APPROVED' AND NEW.status IN ('ACTIVATED','REJECTED','CANCELLED')) OR
    (OLD.status='ACTIVATED' AND NEW.status='ARCHIVED')
   ) THEN RAISE EXCEPTION 'Invalid price review status transition'; END IF;
   IF NEW.status='ACTIVATED' AND (actor=NEW.created_by OR NOT EXISTS(SELECT 1 FROM crm_price_import_entries e WHERE e.import_id=NEW.id) OR EXISTS(SELECT 1 FROM crm_price_import_entries e WHERE e.import_id=NEW.id AND e.activated_entry_id IS NULL)) THEN RAISE EXCEPTION 'Independent activation requires all approved price rows'; END IF;
   IF (to_jsonb(NEW)-ARRAY['status','target_list_id','approval_rule_key','approval_rule_version','approved_by','approved_at','approved_hash','decision_reason','updated_at','updated_by','is_deleted','deleted_at','deleted_by','delete_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','target_list_id','approval_rule_key','approval_rule_version','approved_by','approved_at','approved_hash','decision_reason','updated_at','updated_by','is_deleted','deleted_at','deleted_by','delete_reason']) THEN RAISE EXCEPTION 'Reviewed source, mapping and plan are immutable; create a new revision'; END IF;
   IF NEW.status='APPROVED' AND OLD.status<>'APPROVED' AND NEW.approved_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Approval must identify the actual independent actor'; END IF;
   IF OLD.status IN ('ACTIVATED','ARCHIVED') AND (NEW.target_list_id IS DISTINCT FROM OLD.target_list_id OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_hash IS DISTINCT FROM OLD.approved_hash) THEN RAISE EXCEPTION 'Activated approval/link evidence is immutable'; END IF;
  ELSE
   IF (to_jsonb(NEW)-ARRAY['activated_entry_id','updated_at','updated_by']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['activated_entry_id','updated_at','updated_by']) OR OLD.activated_entry_id IS NOT NULL THEN RAISE EXCEPTION 'Price import rows are immutable'; END IF;
   IF NOT EXISTS(SELECT 1 FROM crm_price_import_workflows w JOIN crm_price_list_items e ON e.id=NEW.activated_entry_id AND e.price_list_id=w.target_list_id AND e.item_id=NEW.item_id AND e.min_quantity=NEW.min_quantity AND e.unit_price=NEW.unit_price AND e.discount_percent=NEW.discount_percent WHERE w.id=NEW.import_id AND w.status='APPROVED') THEN RAISE EXCEPTION 'Rows may link only during approved activation'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER price_import_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_price_import_workflows FOR EACH ROW EXECUTE FUNCTION crm_price_import_guard();
CREATE TRIGGER price_import_no_truncate BEFORE TRUNCATE ON crm_price_import_workflows FOR EACH STATEMENT EXECUTE FUNCTION crm_price_import_guard();
CREATE TRIGGER price_import_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_price_import_entries FOR EACH ROW EXECUTE FUNCTION crm_price_import_guard();
CREATE TRIGGER price_import_entry_no_truncate BEFORE TRUNCATE ON crm_price_import_entries FOR EACH STATEMENT EXECUTE FUNCTION crm_price_import_guard();
CREATE TRIGGER price_import_event_actor BEFORE INSERT OR DELETE ON crm_price_import_events FOR EACH ROW EXECUTE FUNCTION crm_price_import_guard();
CREATE TRIGGER price_import_event_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_price_import_events FOR EACH STATEMENT EXECUTE FUNCTION f1_append_only();
CREATE TRIGGER zz_s0_row_metadata BEFORE INSERT OR UPDATE OR DELETE ON crm_price_import_workflows FOR EACH ROW EXECUTE FUNCTION s0_row_metadata_guard();
CREATE TRIGGER zz_s0_no_truncate BEFORE TRUNCATE ON crm_price_import_workflows FOR EACH STATEMENT EXECUTE FUNCTION s0_row_metadata_guard();
CREATE TRIGGER zz_s0_metadata_audit AFTER INSERT OR UPDATE ON crm_price_import_workflows FOR EACH ROW EXECUTE FUNCTION s0_row_metadata_audit('id');
CREATE TRIGGER zz_s0_row_metadata BEFORE INSERT OR UPDATE OR DELETE ON crm_price_import_entries FOR EACH ROW EXECUTE FUNCTION s0_row_metadata_guard();
CREATE TRIGGER zz_s0_no_truncate BEFORE TRUNCATE ON crm_price_import_entries FOR EACH STATEMENT EXECUTE FUNCTION s0_row_metadata_guard();
CREATE TRIGGER zz_s0_metadata_audit AFTER INSERT OR UPDATE ON crm_price_import_entries FOR EACH ROW EXECUTE FUNCTION s0_row_metadata_audit('id');
INSERT INTO audit_logs(entity,record_id,action,reason,new_value) VALUES('SCHEMA_MIGRATION','0047_reviewed_price_imports','MIGRATION','S2 source-preserving price import reviews; no business defaults or activation','{"seededBusinessValues":false,"activationAllowedWithoutApproval":false}');
