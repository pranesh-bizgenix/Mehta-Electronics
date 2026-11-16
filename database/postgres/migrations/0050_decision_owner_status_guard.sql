-- Correct only the function introduced in 0049. users uses status for account
-- lifecycle and has no is_deleted column. No prior migration checksum changes.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
CREATE OR REPLACE FUNCTION decision_register_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer; why text; prior integer;
BEGIN
 actor:=NULLIF(current_setting('mehta.actor_id',true),'')::integer;
 why:=NULLIF(trim(current_setting('mehta.audit_reason',true)),'');
 IF actor IS NULL OR length(coalesce(why,''))<3 OR NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND role='OWNER' AND status='ACTIVE') THEN RAISE EXCEPTION 'Actual active Owner and reason required for decision register'; END IF;
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
INSERT INTO audit_logs(entity,record_id,action,reason,new_value) VALUES('SCHEMA_MIGRATION','0050_decision_owner_status_guard','MIGRATION','Correct new decision Owner guard to use the existing users status lifecycle; no data or values seeded','{"functionIntroducedIn":"0049","seededDecisions":false}');
