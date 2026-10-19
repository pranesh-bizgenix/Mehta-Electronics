ALTER TABLE tally_connectors
  ADD COLUMN IF NOT EXISTS pairing_code_hash text,
  ADD COLUMN IF NOT EXISTS pairing_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS api_base_url text,
  ADD COLUMN IF NOT EXISTS installation_id text,
  ADD COLUMN IF NOT EXISTS agent_version text,
  ADD COLUMN IF NOT EXISTS access_token_hash text,
  ADD COLUMN IF NOT EXISTS access_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_token_hash text,
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS tally_connectors_pairing_code_hash_idx
  ON tally_connectors (pairing_code_hash)
  WHERE pairing_code_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tally_connectors_access_token_hash_idx
  ON tally_connectors (access_token_hash)
  WHERE access_token_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tally_connectors_refresh_token_hash_idx
  ON tally_connectors (refresh_token_hash)
  WHERE refresh_token_hash IS NOT NULL;

ALTER TABLE tally_upload_sessions
  ADD COLUMN IF NOT EXISTS sync_job_id uuid REFERENCES tally_sync_jobs(id),
  ADD COLUMN IF NOT EXISTS sync_id text;

CREATE INDEX IF NOT EXISTS tally_upload_sessions_sync_job_idx
  ON tally_upload_sessions (sync_job_id);
