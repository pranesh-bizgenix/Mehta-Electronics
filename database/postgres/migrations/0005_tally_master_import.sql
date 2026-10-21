-- Checkpoint A: company-scoped imports. No connector schema or configuration changes.
CREATE TABLE tally_companies (
  id uuid PRIMARY KEY, name text NOT NULL UNIQUE, tally_guid text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tally_raw_payloads (
  id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES tally_companies(id),
  session_id uuid NOT NULL REFERENCES tally_upload_sessions(id), run_id uuid REFERENCES tally_sync_jobs(id),
  dataset text NOT NULL, content_hash text NOT NULL, content text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,dataset,content_hash)
);
CREATE TABLE tally_run_datasets (
  company_id uuid NOT NULL REFERENCES tally_companies(id), session_id uuid NOT NULL REFERENCES tally_upload_sessions(id),
  dataset text NOT NULL, status text NOT NULL, payload_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0, quarantined_count integer NOT NULL DEFAULT 0,
  error text, processed_at timestamptz, PRIMARY KEY(session_id,dataset)
);
CREATE TABLE tally_import_quarantine (
  id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES tally_companies(id),
  session_id uuid NOT NULL REFERENCES tally_upload_sessions(id), dataset text NOT NULL,
  record_index integer NOT NULL, reason text NOT NULL, raw_record jsonb NOT NULL,
  UNIQUE(session_id,dataset,record_index)
);
CREATE TABLE tally_import_warnings (
  id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES tally_companies(id),
  session_id uuid NOT NULL REFERENCES tally_upload_sessions(id), dataset text NOT NULL,
  warning_key text NOT NULL, message text NOT NULL, details jsonb NOT NULL,
  UNIQUE(session_id,dataset,warning_key)
);
CREATE TABLE tally_groups (
  id text PRIMARY KEY, company_id uuid NOT NULL REFERENCES tally_companies(id),
  source_key text NOT NULL, name text NOT NULL, parent_name text, tally_guid text, master_id text, alter_id text,
  opening_balance numeric(18,2), closing_balance numeric(18,2), dr_cr text CHECK(dr_cr IN ('Dr','Cr')),
  raw_record jsonb NOT NULL, session_id uuid NOT NULL REFERENCES tally_upload_sessions(id),
  fetched_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,source_key)
);
CREATE TABLE tally_ledgers (
  id text PRIMARY KEY, company_id uuid NOT NULL REFERENCES tally_companies(id),
  source_key text NOT NULL, name text NOT NULL, parent_name text, tally_guid text, master_id text, alter_id text,
  gstin text, pan text, phone text, email text, address text, contact_person text,
  opening_balance numeric(18,2), closing_balance numeric(18,2), dr_cr text CHECK(dr_cr IN ('Dr','Cr')),
  raw_record jsonb NOT NULL, session_id uuid NOT NULL REFERENCES tally_upload_sessions(id),
  fetched_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,source_key)
);
CREATE TABLE tally_stock_items (
  id text PRIMARY KEY, company_id uuid NOT NULL REFERENCES tally_companies(id),
  source_key text NOT NULL, name text NOT NULL, normalized_part_number text NOT NULL,
  parent_name text, base_unit text, description text, hsn text,
  closing_quantity_text text, closing_rate_text text, closing_value numeric(18,2),
  dr_cr text CHECK(dr_cr IN ('Dr','Cr')), raw_record jsonb NOT NULL,
  session_id uuid NOT NULL REFERENCES tally_upload_sessions(id),
  fetched_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,source_key)
);
CREATE INDEX tally_ledgers_company_name ON tally_ledgers(company_id,name);
CREATE INDEX tally_ledgers_company_parent ON tally_ledgers(company_id,parent_name);
CREATE INDEX tally_stock_company_name ON tally_stock_items(company_id,name);
CREATE INDEX tally_stock_company_matching ON tally_stock_items(company_id,normalized_part_number);
CREATE INDEX tally_groups_company_parent ON tally_groups(company_id,parent_name);
ALTER TABLE tally_sync_jobs DROP CONSTRAINT tally_sync_jobs_status_check;
ALTER TABLE tally_sync_jobs ADD CONSTRAINT tally_sync_jobs_status_check
  CHECK(status IN ('running','stored','quarantined','failed','partial','stalled'));
ALTER TABLE tally_sync_jobs ADD COLUMN last_progress_at timestamptz NOT NULL DEFAULT now();
UPDATE tally_sync_jobs SET last_progress_at=COALESCE(completed_at,started_at);
ALTER TABLE tally_upload_sessions ADD COLUMN import_summary jsonb;
-- Signed values are retained as delivered. Dr/Cr is populated ONLY when explicit in the input.
-- No implicit conversion from negative numbers to debit/credit is made.
