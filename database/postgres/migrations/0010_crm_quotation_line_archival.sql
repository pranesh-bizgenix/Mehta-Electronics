-- Keep existing quotation revisions compatible while retaining their CRM line records.
ALTER TABLE quotation_lines ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','ARCHIVED'));
ALTER TABLE quotation_lines ADD COLUMN is_deleted boolean NOT NULL DEFAULT false;
CREATE INDEX quotation_lines_active ON quotation_lines(quotation_id,position) WHERE NOT is_deleted;
