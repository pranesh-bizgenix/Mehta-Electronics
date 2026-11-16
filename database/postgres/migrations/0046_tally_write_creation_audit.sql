-- Fix audit ordering only in the new write-side routine introduced in 0045.
-- No pre-task read table, function, trigger, constraint or index is changed.
-- The outbox creation event is appended AFTER the parent insert so its FK is valid.
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION tw_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
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
 IF NOT (TG_TABLE_NAME='tw_outbox' AND TG_OP='INSERT') THEN
 INSERT INTO tw_outbox_events(outbox_id,entity_type,entity_id,action,previous_status,next_status,actor_id,connector_id,reason,detail)
 VALUES(CASE WHEN TG_TABLE_NAME='tw_outbox' THEN (to_jsonb(NEW)->>'id')::uuid END,TG_TABLE_NAME,k,TG_OP,before_state,after_state,actor,connector,why,jsonb_build_object('revision',to_jsonb(NEW)->'revision'));
 END IF;
 INSERT INTO audit_logs(user_id,entity,record_id,action,reason,new_value)
 VALUES(actor,'TALLY_WRITE',TG_TABLE_NAME||':'||k,TG_OP,why,jsonb_build_object('connectorId',connector,'status',after_state,'revision',to_jsonb(NEW)->'revision')::text);
 RETURN NEW;
END $$;
CREATE FUNCTION tw_record_outbox_created() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO tw_outbox_events(outbox_id,entity_type,entity_id,action,next_status,actor_id,connector_id,reason)
 VALUES(NEW.id,'tw_outbox',NEW.id::text,'INSERT',NEW.status,
 NULLIF(current_setting('mehta.actor_id',true),'')::integer,
 NULLIF(current_setting('mehta.tw_connector_id',true),'')::uuid,
 current_setting('mehta.audit_reason',true));
 RETURN NEW;
END $$;
CREATE TRIGGER tw_created_event AFTER INSERT ON tw_outbox FOR EACH ROW EXECUTE FUNCTION tw_record_outbox_created();
INSERT INTO audit_logs(entity,record_id,action,reason,new_value) VALUES('SCHEMA_MIGRATION','0046_tally_write_creation_audit','MIGRATION','Correct new write-only outbox creation event ordering without changing any baseline read schema or guard','{"baselineReadSchemaChanged":false,"writeOnlyCorrection":true}');
