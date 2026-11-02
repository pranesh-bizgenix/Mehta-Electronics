-- New source metadata only. Historical sources are deliberately not guessed.
CREATE TABLE tally_source_observations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES tally_sync_jobs(id),
  session_id uuid REFERENCES tally_upload_sessions(id),
  source_system text NOT NULL CHECK(source_system IN ('direct_xml','tally_engine','bizgenix')),
  retry_count integer CHECK(retry_count>=0),next_sync_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tally_source_observation_job ON tally_source_observations(job_id,recorded_at DESC);
CREATE TRIGGER tally_source_no_change BEFORE UPDATE OR DELETE ON tally_source_observations FOR EACH ROW EXECUTE FUNCTION tally_visibility_immutable();
CREATE TRIGGER tally_source_no_truncate BEFORE TRUNCATE ON tally_source_observations FOR EACH STATEMENT EXECUTE FUNCTION tally_visibility_immutable();
