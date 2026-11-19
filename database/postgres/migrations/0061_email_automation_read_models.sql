-- Additive read models only. No fixtures, grants, ingestion or existing schema changes.
INSERT INTO permissions(key,resource,action,description) VALUES
 ('email_automation.read','email_automation','R','View email automation messages, attachments, processing and errors'),
 ('email_automation.integrations.read','email_automation','R','View email automation integration health')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE automation_email_metadata (
 email_id uuid PRIMARY KEY REFERENCES email_messages(id),
 processing_status text NOT NULL DEFAULT 'Unknown' CHECK(processing_status IN ('Unknown','Pending','Processed','Failed')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE automation_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email_id uuid NOT NULL REFERENCES email_messages(id),
 source_document_id uuid NOT NULL REFERENCES source_documents(id),
 s3_bucket text, s3_key text, status text NOT NULL DEFAULT 'Unavailable' CHECK(status IN ('Available','Unavailable')),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((s3_bucket IS NULL) = (s3_key IS NULL)),
 CHECK (s3_bucket IS NULL OR (length(trim(s3_bucket))>0 AND length(trim(s3_key))>0)),
 CHECK (status <> 'Available' OR s3_bucket IS NOT NULL), UNIQUE(email_id,source_document_id)
);
CREATE INDEX automation_attachments_email_idx ON automation_attachments(email_id,created_at DESC);
CREATE TABLE automation_processing_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email_id uuid NOT NULL REFERENCES email_messages(id),
 stage text NOT NULL CHECK(length(trim(stage))>0),status text NOT NULL CHECK(status IN ('Pending','Running','Succeeded','Failed')),
 started_at timestamptz,finished_at timestamptz,error_code text CHECK(error_code ~ '^[A-Z0-9_]{1,80}$'),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(finished_at IS NULL OR (started_at IS NOT NULL AND finished_at>=started_at))
);
CREATE INDEX automation_processing_runs_email_idx ON automation_processing_runs(email_id,created_at DESC);
CREATE INDEX automation_processing_runs_failed_idx ON automation_processing_runs(created_at DESC) WHERE status='Failed';
CREATE TABLE automation_integration_status (
 provider text PRIMARY KEY CHECK(provider IN ('Gmail','PostgreSQL','S3','AI provider')),
 status text NOT NULL DEFAULT 'Unknown' CHECK(status IN ('Unknown','Not configured','Connected','Unavailable')),
 checked_at timestamptz, CHECK(status<>'Connected' OR checked_at IS NOT NULL)
);
