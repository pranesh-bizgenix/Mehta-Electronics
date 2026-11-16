-- Requests are reads performed by the existing authenticated Windows connector.
CREATE TABLE tally_read_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES tally_companies(id),
 connector_id uuid NOT NULL REFERENCES tally_connectors(id),
 conflict_id uuid REFERENCES tally_conflicts(id),
 entity_kind text NOT NULL,
 record_key text,
 status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','INDEXED','FAILED','CANCELLED')),
 reason text NOT NULL CHECK(length(trim(reason))>=3),
 created_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 last_session_id uuid REFERENCES tally_upload_sessions(id),
 error_code text
);
CREATE INDEX tally_read_requests_pending ON tally_read_requests(connector_id,created_at) WHERE status='REQUESTED';
CREATE INDEX tally_read_requests_company ON tally_read_requests(company_id,created_at DESC);
ALTER TABLE tally_upload_sessions ADD COLUMN read_request_ids uuid[] NOT NULL DEFAULT '{}';
CREATE TRIGGER tally_read_request_no_delete BEFORE DELETE ON tally_read_requests FOR EACH ROW EXECUTE FUNCTION crm_reject_hard_delete();
CREATE TRIGGER tally_read_request_no_truncate BEFORE TRUNCATE ON tally_read_requests FOR EACH STATEMENT EXECUTE FUNCTION crm_reject_hard_delete();
