-- D7: isolated, append-only mapping review evidence. No source data or switches changed.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
CREATE TABLE tw_mapping_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 mapping_id uuid NOT NULL UNIQUE REFERENCES tw_mapping_versions(id),
 company_id uuid NOT NULL REFERENCES tally_companies(id),
 generator_version text NOT NULL CHECK(length(generator_version) BETWEEN 1 AND 40),
 source_fingerprint char(64) NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=524288),
 expert_name text CHECK(expert_name IS NULL OR length(trim(expert_name)) BETWEEN 2 AND 200),
 expert_reference text CHECK(expert_reference IS NULL OR length(trim(expert_reference)) BETWEEN 3 AND 1000),
 expert_reviewed_at timestamptz,
 request_key uuid NOT NULL UNIQUE,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 2000),
 CHECK((expert_name IS NULL AND expert_reference IS NULL AND expert_reviewed_at IS NULL) OR
       (expert_name IS NOT NULL AND expert_reference IS NOT NULL AND expert_reviewed_at IS NOT NULL))
);
CREATE INDEX tw_mapping_evidence_company ON tw_mapping_evidence(company_id,created_at);
CREATE INDEX tw_mapping_evidence_creator ON tw_mapping_evidence(created_by);
CREATE FUNCTION tw_mapping_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer; why text; mapping tw_mapping_versions%ROWTYPE; parent tw_mapping_versions%ROWTYPE; source tw_mapping_evidence%ROWTYPE;
BEGIN
 actor:=NULLIF(current_setting('mehta.actor_id',true),'')::integer;
 why:=NULLIF(trim(current_setting('mehta.audit_reason',true)),'');
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND role='OWNER' AND status='ACTIVE') OR NEW.created_by<>actor OR NEW.reason IS DISTINCT FROM why THEN RAISE EXCEPTION 'Actual active Owner and matching reason required for mapping evidence'; END IF;
 SELECT * INTO mapping FROM tw_mapping_versions WHERE id=NEW.mapping_id;
 IF mapping.id IS NULL OR mapping.company_id<>NEW.company_id OR mapping.created_by<>actor THEN RAISE EXCEPTION 'Mapping evidence must belong to its actual company and creator'; END IF;
 IF mapping.status='APPROVED' THEN
  SELECT * INTO parent FROM tw_mapping_versions WHERE id=mapping.parent_version_id;
  SELECT * INTO source FROM tw_mapping_evidence WHERE mapping_id=parent.id;
  IF parent.id IS NULL OR parent.status<>'DRAFT' OR parent.company_id<>mapping.company_id OR parent.category<>mapping.category OR parent.configuration_hash<>mapping.configuration_hash OR parent.created_by=actor OR mapping.approved_by<>actor THEN RAISE EXCEPTION 'A different Owner must approve the exact retained draft'; END IF;
  IF source.id IS NULL OR source.source_fingerprint<>NEW.source_fingerprint OR source.evidence IS DISTINCT FROM NEW.evidence OR NEW.expert_name IS NULL OR NEW.expert_reference IS NULL OR NEW.expert_reviewed_at IS NULL THEN RAISE EXCEPTION 'Unchanged retained evidence and named Tally expert review required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aa_tw_mapping_evidence_guard BEFORE INSERT ON tw_mapping_evidence FOR EACH ROW EXECUTE FUNCTION tw_mapping_evidence_guard();
CREATE TRIGGER aa_tw_mapping_evidence_immutable BEFORE UPDATE OR DELETE ON tw_mapping_evidence FOR EACH ROW EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_mapping_evidence_no_truncate BEFORE TRUNCATE ON tw_mapping_evidence FOR EACH STATEMENT EXECUTE FUNCTION tw_reject_change();
CREATE TRIGGER tw_mapping_evidence_audit BEFORE INSERT ON tw_mapping_evidence FOR EACH ROW EXECUTE FUNCTION tw_audit_change();
CREATE FUNCTION tw_mapping_approval_evidence_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM tw_mapping_evidence WHERE mapping_id=NEW.id AND expert_name IS NOT NULL AND expert_reference IS NOT NULL AND expert_reviewed_at IS NOT NULL) THEN RAISE EXCEPTION 'Approved mappings require independent Owner and named expert evidence'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER tw_mapping_approved_evidence AFTER INSERT ON tw_mapping_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tw_mapping_approval_evidence_required();
INSERT INTO audit_logs(entity,record_id,action,reason,new_value) VALUES('SCHEMA_MIGRATION','0052_tally_mapping_review_evidence','MIGRATION','Retain isolated draft-mapping evidence and independent Owner/expert approval; no source data, mappings or switches seeded','{"sourceWrites":false,"switchesChanged":false,"seededMappings":false}');
