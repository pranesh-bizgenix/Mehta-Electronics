-- Device location is optional evidence, never attendance/payroll verification.
CREATE TABLE crm_field_visits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_key uuid NOT NULL UNIQUE,
 request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 customer_id integer NOT NULL REFERENCES customers(id), staff_id integer NOT NULL REFERENCES users(id),
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 200),
 location_source text NOT NULL CHECK(location_source IN ('BROWSER','MANUAL_NOTE')),
 location_note text NOT NULL CHECK(length(trim(location_note)) BETWEEN 3 AND 1000),
 latitude numeric(9,6), longitude numeric(10,6), accuracy_metres numeric(10,2), device_captured_at timestamptz,
 checked_in_at timestamptz NOT NULL DEFAULT clock_timestamp(), checked_out_at timestamptz,
 status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK(status IN ('IN_PROGRESS','COMPLETED','CANCELLED')),
 activity_id uuid UNIQUE REFERENCES crm_customer_activities(id), closing_note text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_by integer NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((location_source='BROWSER' AND latitude IS NOT NULL AND longitude IS NOT NULL AND accuracy_metres IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 AND accuracy_metres>0 AND accuracy_metres<=100000 AND device_captured_at IS NOT NULL) OR (location_source='MANUAL_NOTE' AND latitude IS NULL AND longitude IS NULL AND accuracy_metres IS NULL AND device_captured_at IS NULL)),
 CHECK((status='IN_PROGRESS' AND checked_out_at IS NULL AND activity_id IS NULL AND closing_note IS NULL) OR (status='COMPLETED' AND checked_out_at>=checked_in_at AND activity_id IS NOT NULL AND closing_note IS NOT NULL AND length(trim(closing_note))>=3) OR (status='CANCELLED' AND checked_out_at>=checked_in_at AND activity_id IS NULL AND closing_note IS NOT NULL AND length(trim(closing_note))>=3))
);
CREATE UNIQUE INDEX crm_field_visits_one_open ON crm_field_visits(staff_id) WHERE status='IN_PROGRESS';
CREATE INDEX crm_field_visits_customer ON crm_field_visits(customer_id,checked_in_at DESC,id);
CREATE FUNCTION guard_field_visits() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer;
BEGIN
 actor:=nullif(current_setting('mehta.actor_id',true),'')::integer;
 IF TG_OP IN ('DELETE','TRUNCATE') OR actor IS NULL OR current_setting('mehta.field_visit_write',true) IS DISTINCT FROM 'authorized' OR length(trim(coalesce(current_setting('mehta.audit_reason',true),'')))<3 THEN RAISE EXCEPTION 'Use the audited field visit workflow'; END IF;
 IF TG_OP='INSERT' AND (NEW.staff_id<>actor OR NEW.updated_by<>actor OR NEW.version<>1 OR NEW.status<>'IN_PROGRESS') THEN RAISE EXCEPTION 'Check in as the signed-in staff member'; END IF;
 IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['status','checked_out_at','activity_id','closing_note','version','updated_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','checked_out_at','activity_id','closing_note','version','updated_by','updated_at']) OR OLD.status<>'IN_PROGRESS' OR NEW.status NOT IN ('COMPLETED','CANCELLED') OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor OR (NEW.status='COMPLETED' AND OLD.staff_id<>actor)) THEN RAISE EXCEPTION 'Visit identity and closed history are immutable'; END IF;
 IF NEW.status='COMPLETED' AND NOT EXISTS(SELECT 1 FROM crm_customer_activities a WHERE a.id=NEW.activity_id AND a.customer_id=NEW.customer_id AND a.owner_id=NEW.staff_id AND a.kind='VISIT' AND a.occurred_at=NEW.checked_in_at) THEN RAISE EXCEPTION 'Completed visit must link its own customer activity'; END IF;
 IF TG_OP='INSERT' THEN NEW.checked_in_at:=clock_timestamp(); ELSE NEW.checked_out_at:=clock_timestamp(); END IF;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER crm_field_visits_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_field_visits FOR EACH ROW EXECUTE FUNCTION guard_field_visits();
CREATE TRIGGER crm_field_visits_truncate BEFORE TRUNCATE ON crm_field_visits FOR EACH STATEMENT EXECUTE FUNCTION guard_field_visits();
