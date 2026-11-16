-- CRM-only Owner decision register. No decision values, users or settings seeded.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
CREATE TABLE decision_register (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 decision_key text NOT NULL CHECK(decision_key ~ '^[a-z][a-z0-9_.]{1,159}$'),
 version integer NOT NULL CHECK(version>0),UNIQUE(decision_key,version),
 area text NOT NULL CHECK(length(trim(area)) BETWEEN 1 AND 120),
 plain_question text NOT NULL CHECK(length(trim(plain_question)) BETWEEN 1 AND 2000),
 options_json jsonb NOT NULL CHECK(jsonb_typeof(options_json)='array' AND jsonb_array_length(options_json)<=3),
 value_json jsonb CHECK(value_json IS NULL OR (jsonb_typeof(value_json)<>'null' AND octet_length(value_json::text)<=32768)),
 evidence_source text CHECK(evidence_source IS NULL OR length(evidence_source)<=2000),
 status text NOT NULL CHECK(status IN ('EMPTY','PROPOSED','ENTERED','CONFIRMED','REJECTED')),
 entered_by integer NOT NULL REFERENCES users(id),
 confirmed_by integer REFERENCES users(id),confirmed_at timestamptz,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 blocks_workflows jsonb NOT NULL CHECK(jsonb_typeof(blocks_workflows)='array' AND jsonb_array_length(blocks_workflows)<=100),
 canonical_version integer CHECK(canonical_version IS NULL OR canonical_version>0),
 canonical_hash char(64) CHECK(canonical_hash IS NULL OR canonical_hash ~ '^[a-f0-9]{64}$'),
 request_key uuid NOT NULL,
 created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((status='EMPTY' AND value_json IS NULL) OR (status<>'EMPTY' AND value_json IS NOT NULL)),
 CHECK((status='CONFIRMED' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND canonical_hash IS NOT NULL) OR
       (status<>'CONFIRMED' AND confirmed_by IS NULL AND confirmed_at IS NULL AND canonical_hash IS NULL AND canonical_version IS NULL))
);
CREATE TABLE decision_register_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_key uuid NOT NULL UNIQUE,
 actor_id integer NOT NULL REFERENCES users(id),
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 operation text NOT NULL CHECK(length(operation) BETWEEN 1 AND 200),
 response_body jsonb NOT NULL CHECK(jsonb_typeof(response_body)='object' AND octet_length(response_body::text)<=2097152),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX decision_register_entered_by ON decision_register(entered_by);
CREATE INDEX decision_register_confirmed_by ON decision_register(confirmed_by);
CREATE INDEX decision_register_creator ON decision_register(created_by);
CREATE INDEX decision_register_created ON decision_register(created_at);
CREATE INDEX decision_register_status ON decision_register(status,decision_key);
CREATE INDEX decision_register_request ON decision_register(request_key);
CREATE INDEX decision_register_requests_actor ON decision_register_requests(actor_id);
CREATE INDEX decision_register_requests_created ON decision_register_requests(created_at);

CREATE FUNCTION decision_register_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer; why text; prior integer;
BEGIN
 actor:=NULLIF(current_setting('mehta.actor_id',true),'')::integer;
 why:=NULLIF(trim(current_setting('mehta.audit_reason',true)),'');
 IF actor IS NULL OR length(coalesce(why,''))<3 OR NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND role='OWNER' AND status='ACTIVE' AND NOT is_deleted) THEN RAISE EXCEPTION 'Actual active Owner and reason required for decision register'; END IF;
 IF TG_TABLE_NAME='decision_register_requests' THEN
  IF NEW.actor_id<>actor THEN RAISE EXCEPTION 'Decision request actor must be the actual Owner'; END IF;
 ELSE
  PERFORM pg_advisory_xact_lock(hashtext('rule:'||NEW.decision_key));
  PERFORM pg_advisory_xact_lock(hashtext('decision:'||NEW.decision_key));
  SELECT coalesce(max(version),0) INTO prior FROM decision_register WHERE decision_key=NEW.decision_key;
  IF NEW.created_by<>actor OR NEW.version<>prior+1 OR NEW.reason<>why THEN RAISE EXCEPTION 'Decision creator, reason and contiguous version must match the transaction'; END IF;
  IF NEW.status='CONFIRMED' AND NEW.confirmed_by<>actor THEN RAISE EXCEPTION 'Only the actual Owner can confirm a decision'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER decision_register_actual_owner BEFORE INSERT ON decision_register FOR EACH ROW EXECUTE FUNCTION decision_register_insert_guard();
CREATE TRIGGER decision_register_requests_actual_owner BEFORE INSERT ON decision_register_requests FOR EACH ROW EXECUTE FUNCTION decision_register_insert_guard();
CREATE TRIGGER decision_register_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON decision_register FOR EACH STATEMENT EXECUTE FUNCTION f1_append_only();
CREATE TRIGGER decision_register_requests_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON decision_register_requests FOR EACH STATEMENT EXECUTE FUNCTION f1_append_only();
INSERT INTO audit_logs(entity,record_id,action,reason,new_value) VALUES('SCHEMA_MIGRATION','0049_crm_decision_register','MIGRATION','Add append-only Owner decision register and request receipts; no values or users seeded','{"seededDecisions":false,"automationChanged":false}');
