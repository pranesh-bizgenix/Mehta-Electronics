-- Retain CRM child history instead of replacing contacts/lines through physical deletion.
ALTER TABLE customer_contacts ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','ARCHIVED'));
ALTER TABLE customer_contacts ADD COLUMN is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE customer_contacts ADD COLUMN created_by integer REFERENCES users(id);
ALTER TABLE enquiry_lines ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','ARCHIVED'));
ALTER TABLE enquiry_lines ADD COLUMN is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE enquiry_lines ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE enquiry_lines ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE enquiry_lines ADD COLUMN created_by integer REFERENCES users(id);
CREATE INDEX customer_contacts_active ON customer_contacts(customer_id) WHERE NOT is_deleted;
CREATE INDEX enquiry_lines_active ON enquiry_lines(enquiry_id,position) WHERE NOT is_deleted;
