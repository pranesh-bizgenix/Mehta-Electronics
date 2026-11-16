-- V2 A2: isolated service principals. No credentials, users or scope grants seeded.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
CREATE TABLE automation_service_credentials (
 id uuid PRIMARY KEY,
 label text NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 120),
 token_hash char(64) NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 generation integer NOT NULL DEFAULT 1 CHECK(generation>0),
 scopes jsonb NOT NULL CHECK(jsonb_typeof(scopes)='array' AND jsonb_array_length(scopes) BETWEEN 1 AND 3 AND scopes <@ '["automation.read","automation.write.drafts","automation.write.intake"]'::jsonb),
 owner_id integer NOT NULL REFERENCES users(id),backup_owner_id integer NOT NULL REFERENCES users(id),CHECK(owner_id<>backup_owner_id),
 expires_at timestamptz NOT NULL,
 rate_per_minute integer NOT NULL CHECK(rate_per_minute BETWEEN 1 AND 100000),
 ip_allowlist jsonb NOT NULL CHECK(jsonb_typeof(ip_allowlist)='array' AND jsonb_array_length(ip_allowlist)<=100),
 config_hash char(64) NOT NULL CHECK(config_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 row_metadata_version smallint NOT NULL DEFAULT 1 CHECK(row_metadata_version=1),
 CHECK(expires_at>created_at),
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3))
);
CREATE TABLE automation_service_companies (
 credential_id uuid NOT NULL REFERENCES automation_service_credentials(id),
 company_id uuid NOT NULL REFERENCES tally_companies(id),PRIMARY KEY(credential_id,company_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 row_metadata_version smallint NOT NULL DEFAULT 1 CHECK(row_metadata_version=1),
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3))
);
CREATE TABLE automation_service_credential_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),credential_id uuid NOT NULL REFERENCES automation_service_credentials(id),
 action text NOT NULL CHECK(action IN ('CREATE','ROTATE','REVOKE','AUTH_ACCEPTED','AUTH_REFUSED')),
 generation integer NOT NULL CHECK(generation>0),
 actor_kind text NOT NULL CHECK(actor_kind IN ('OWNER','SERVICE','UNAUTHENTICATED')),
 actor_user_id integer REFERENCES users(id),actor_credential_id uuid REFERENCES automation_service_credentials(id),
 reason text NOT NULL CHECK(length(trim(reason))>=3),
 request_key text CHECK(request_key IS NULL OR request_key ~ '^[a-f0-9-]{36}$'),
 details jsonb NOT NULL CHECK(jsonb_typeof(details)='object' AND octet_length(details::text)<=8192 AND NOT(details ?| ARRAY['token','tokenHash','token_hash','authorization','secret'])),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(credential_id,request_key),
 CHECK((actor_kind='OWNER' AND actor_user_id IS NOT NULL AND actor_credential_id IS NULL) OR
       (actor_kind='SERVICE' AND actor_user_id IS NULL AND actor_credential_id=credential_id) OR
       (actor_kind='UNAUTHENTICATED' AND actor_user_id IS NULL AND actor_credential_id IS NULL))
);
CREATE INDEX automation_credential_owner ON automation_service_credentials(owner_id);
CREATE INDEX automation_credential_backup ON automation_service_credentials(backup_owner_id);
CREATE INDEX automation_credential_creator ON automation_service_credentials(created_by);
CREATE INDEX automation_credential_updater ON automation_service_credentials(updated_by);
CREATE INDEX automation_credential_deleter ON automation_service_credentials(deleted_by);
CREATE INDEX automation_credential_status ON automation_service_credentials(status,expires_at);
CREATE INDEX automation_credential_created ON automation_service_credentials(created_at);
CREATE INDEX automation_company_company ON automation_service_companies(company_id);
CREATE INDEX automation_company_creator ON automation_service_companies(created_by);
CREATE INDEX automation_company_updater ON automation_service_companies(updated_by);
CREATE INDEX automation_company_deleter ON automation_service_companies(deleted_by);
CREATE INDEX automation_company_created ON automation_service_companies(created_at);
CREATE INDEX automation_credential_event_user ON automation_service_credential_events(actor_user_id);
CREATE INDEX automation_credential_event_actor ON automation_service_credential_events(actor_credential_id);
CREATE INDEX automation_credential_event_created ON automation_service_credential_events(created_at);
CREATE INDEX automation_credential_event_rate ON automation_service_credential_events(credential_id,created_at) WHERE action='AUTH_ACCEPTED';

CREATE FUNCTION automation_service_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer; why text;
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Service credentials cannot be hard deleted'; END IF;
 actor:=NULLIF(current_setting('mehta.actor_id',true),'')::integer;why:=NULLIF(trim(current_setting('mehta.audit_reason',true)),'');
 IF actor IS NULL OR length(coalesce(why,''))<3 OR NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND role='OWNER' AND status='ACTIVE') THEN RAISE EXCEPTION 'Actual active Owner and reason required'; END IF;
 IF TG_OP='INSERT' AND NEW.created_by<>actor THEN RAISE EXCEPTION 'Actual Owner creator required'; END IF;
 IF TG_TABLE_NAME='automation_service_credentials' THEN
  IF TG_OP='INSERT' AND (NEW.status<>'ACTIVE' OR NEW.generation<>1 OR NEW.is_deleted) THEN RAISE EXCEPTION 'New service credentials require initial active generation'; END IF;
  IF TG_OP='UPDATE' THEN
   IF OLD.status<>'ACTIVE' OR NEW.generation<>OLD.generation+1 THEN RAISE EXCEPTION 'Only an active credential can rotate or revoke once'; END IF;
   IF (NEW.status='ACTIVE' AND NEW.token_hash=OLD.token_hash) OR (NEW.status='REVOKED' AND NEW.token_hash<>OLD.token_hash) THEN RAISE EXCEPTION 'Invalid credential rotation or revocation'; END IF;
   IF (to_jsonb(NEW)-ARRAY['token_hash','generation','status','updated_at','updated_by']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['token_hash','generation','status','updated_at','updated_by']) THEN RAISE EXCEPTION 'Credential scope/config is immutable; provision a new credential'; END IF;
  END IF;
 ELSE
  IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM automation_service_credentials WHERE id=NEW.credential_id AND created_by=actor AND status='ACTIVE') THEN RAISE EXCEPTION 'Company scope can only be added by its actual credential Owner'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION automation_service_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer; principal uuid;
BEGIN
 actor:=NULLIF(current_setting('mehta.actor_id',true),'')::integer;
 principal:=NULLIF(current_setting('mehta.automation_credential_id',true),'')::uuid;
 IF NEW.actor_kind='OWNER' AND (NEW.actor_user_id IS DISTINCT FROM actor OR NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND role='OWNER' AND status='ACTIVE')) THEN RAISE EXCEPTION 'Actual Owner event actor required'; END IF;
 IF NEW.actor_kind='SERVICE' AND NEW.actor_credential_id IS DISTINCT FROM principal THEN RAISE EXCEPTION 'Actual service event actor required'; END IF;
 IF NEW.actor_kind='UNAUTHENTICATED' AND NEW.action<>'AUTH_REFUSED' THEN RAISE EXCEPTION 'An unauthenticated caller cannot authorise an action'; END IF;
 IF NEW.action IN ('CREATE','ROTATE','REVOKE') AND NEW.actor_kind<>'OWNER' THEN RAISE EXCEPTION 'Credential changes require Owner'; END IF;
 IF NEW.action='AUTH_ACCEPTED' AND NEW.actor_kind<>'SERVICE' THEN RAISE EXCEPTION 'Accepted authentication requires a service principal'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER automation_credential_owner BEFORE INSERT OR UPDATE OR DELETE ON automation_service_credentials FOR EACH ROW EXECUTE FUNCTION automation_service_owner_guard();
CREATE TRIGGER automation_credential_no_truncate BEFORE TRUNCATE ON automation_service_credentials FOR EACH STATEMENT EXECUTE FUNCTION automation_service_owner_guard();
CREATE TRIGGER automation_company_owner BEFORE INSERT OR UPDATE OR DELETE ON automation_service_companies FOR EACH ROW EXECUTE FUNCTION automation_service_owner_guard();
CREATE TRIGGER automation_company_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON automation_service_companies FOR EACH STATEMENT EXECUTE FUNCTION f1_append_only();
CREATE TRIGGER automation_event_actor BEFORE INSERT ON automation_service_credential_events FOR EACH ROW EXECUTE FUNCTION automation_service_event_guard();
CREATE TRIGGER automation_event_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON automation_service_credential_events FOR EACH STATEMENT EXECUTE FUNCTION f1_append_only();
CREATE TRIGGER zz_s0_row_metadata BEFORE INSERT OR UPDATE OR DELETE ON automation_service_credentials FOR EACH ROW EXECUTE FUNCTION s0_row_metadata_guard();
CREATE TRIGGER zz_s0_metadata_audit AFTER INSERT OR UPDATE ON automation_service_credentials FOR EACH ROW EXECUTE FUNCTION s0_row_metadata_audit('id');
CREATE TRIGGER zz_s0_row_metadata BEFORE INSERT OR UPDATE OR DELETE ON automation_service_companies FOR EACH ROW EXECUTE FUNCTION s0_row_metadata_guard();
CREATE TRIGGER zz_s0_metadata_audit AFTER INSERT OR UPDATE ON automation_service_companies FOR EACH ROW EXECUTE FUNCTION s0_row_metadata_audit('credential_id,company_id');
INSERT INTO audit_logs(entity,record_id,action,reason,new_value) VALUES('SCHEMA_MIGRATION','0048_automation_service_credentials','MIGRATION','V2 isolated service credentials; no users, secrets, grants or switches seeded','{"seededCredentials":false,"switchesChanged":false}');
