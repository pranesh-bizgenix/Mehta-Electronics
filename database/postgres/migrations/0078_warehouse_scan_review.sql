-- Scan facts remain immutable. A mistaken scan may only be rejected, with
-- review evidence, while its packing box is still in draft.
ALTER TABLE pick_scans ADD COLUMN reviewed_by integer REFERENCES users(id),
 ADD COLUMN reviewed_at timestamptz,ADD COLUMN review_reason text;
DROP TRIGGER s0_append_only ON pick_scans;
CREATE FUNCTION guard_warehouse_scan_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('mehta.warehouse_write',true) IS DISTINCT FROM 'authorized'
 OR nullif(current_setting('mehta.actor_id',true),'') IS NULL
 OR (to_jsonb(NEW)-ARRAY['status','reviewed_by','reviewed_at','review_reason','updated_at','updated_by','row_metadata_version'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','reviewed_at','review_reason','updated_at','updated_by','row_metadata_version'])
 OR OLD.status NOT IN ('MATCHED','MISMATCH') OR NEW.status<>'REJECTED'
 OR NEW.reviewed_by::text IS DISTINCT FROM current_setting('mehta.actor_id',true)
 OR NEW.reviewed_at IS NULL OR length(trim(coalesce(NEW.review_reason,'')))<3 THEN
  RAISE EXCEPTION 'Scan facts are immutable; use the audited incorrect-scan rejection workflow';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER warehouse_scan_review BEFORE UPDATE ON pick_scans FOR EACH ROW EXECUTE FUNCTION guard_warehouse_scan_review();
