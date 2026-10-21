CREATE TABLE IF NOT EXISTS tally_connectors (
  id uuid PRIMARY KEY,
  profile_name text NOT NULL,
  expected_company_name text NOT NULL,
  expected_company_guid text,
  machine_name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'error')),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  last_sync_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS tally_sync_jobs (
  id uuid PRIMARY KEY,
  connector_id uuid NOT NULL REFERENCES tally_connectors(id),
  company_name text NOT NULL,
  company_guid text,
  status text NOT NULL CHECK (status IN ('running', 'stored', 'quarantined', 'failed')),
  message text,
  record_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS tally_sync_jobs_connector_started_idx
  ON tally_sync_jobs (connector_id, started_at DESC);
