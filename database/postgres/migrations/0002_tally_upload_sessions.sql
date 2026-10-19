CREATE TABLE IF NOT EXISTS tally_connector_heartbeats (
  connector_id uuid PRIMARY KEY REFERENCES tally_connectors(id) ON DELETE CASCADE,
  tally_available boolean NOT NULL,
  selected_company text,
  open_companies jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_sync_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tally_upload_sessions (
  id uuid PRIMARY KEY,
  connector_id uuid NOT NULL REFERENCES tally_connectors(id),
  company_name text NOT NULL,
  company_guid text,
  sync_from date NOT NULL,
  sync_to date NOT NULL,
  status text NOT NULL CHECK (status IN ('receiving', 'stored', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS tally_upload_chunks (
  session_id uuid NOT NULL REFERENCES tally_upload_sessions(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, field_name, sequence)
);

CREATE INDEX IF NOT EXISTS tally_upload_sessions_connector_created_idx
  ON tally_upload_sessions (connector_id, created_at DESC);
