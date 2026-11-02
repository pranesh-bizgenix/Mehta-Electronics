-- F2/F3/F9/F12/F13: additive operational records, never statutory/Tally writes.
CREATE TABLE crm_customer_controls (
 customer_id integer PRIMARY KEY REFERENCES customers(id),
 classification text NOT NULL CHECK(classification IN ('NEW','EXISTING','POTENTIAL','DO_NOT_QUOTE')),
 credit_exempt boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1,
 reason text NOT NULL,updated_by integer NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE crm_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN ('INTAKE','INVOICE','COLLECTION','RECEIPT','PAYMENT','SUPPORT','WARRANTY','RETURN')),
 reference text NOT NULL UNIQUE,title text NOT NULL,
 customer_id integer REFERENCES customers(id),
 owner_id integer NOT NULL REFERENCES users(id),backup_id integer REFERENCES users(id),
 status text NOT NULL DEFAULT 'OPEN',version integer NOT NULL DEFAULT 1,
 payload jsonb NOT NULL DEFAULT '{}',
 first_response_at timestamptz,due_at timestamptz,closed_at timestamptz,
 created_by integer NOT NULL REFERENCES users(id),updated_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(backup_id IS NULL OR backup_id<>owner_id)
);
CREATE INDEX crm_operations_kind_status ON crm_operations(kind,status,updated_at DESC,id);
CREATE INDEX crm_operations_customer ON crm_operations(customer_id,kind);
CREATE INDEX crm_operations_owner ON crm_operations(owner_id,status,due_at);
CREATE INDEX crm_operations_search ON crm_operations USING gin(to_tsvector('simple',title||' '||reference));
CREATE TABLE crm_operation_events (
 id bigserial PRIMARY KEY,record_id uuid NOT NULL REFERENCES crm_operations(id),
 action text NOT NULL,from_status text,to_status text,version integer NOT NULL,
 reason text NOT NULL,detail jsonb NOT NULL DEFAULT '{}',
 actor_id integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_operation_events_record ON crm_operation_events(record_id,id DESC);
CREATE TABLE crm_intake_originals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),record_id uuid NOT NULL UNIQUE REFERENCES crm_operations(id),
 channel text NOT NULL CHECK(channel IN ('EMAIL','WHATSAPP','MANUAL')),
 external_id text NOT NULL,sha256 text NOT NULL,original_text text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(channel,external_id)
);
CREATE FUNCTION crm_operation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Original messages and workflow events are immutable'; END $$;
CREATE TRIGGER crm_intake_no_change BEFORE UPDATE OR DELETE ON crm_intake_originals FOR EACH ROW EXECUTE FUNCTION crm_operation_immutable();
CREATE TRIGGER crm_events_no_change BEFORE UPDATE OR DELETE ON crm_operation_events FOR EACH ROW EXECUTE FUNCTION crm_operation_immutable();
CREATE TRIGGER crm_intake_no_truncate BEFORE TRUNCATE ON crm_intake_originals FOR EACH STATEMENT EXECUTE FUNCTION crm_operation_immutable();
CREATE TRIGGER crm_events_no_truncate BEFORE TRUNCATE ON crm_operation_events FOR EACH STATEMENT EXECUTE FUNCTION crm_operation_immutable();
INSERT INTO permissions(key,resource,action,description,owner_only) VALUES
 ('operations.read','operations','R','View customer support and incoming messages',false),
 ('operations.write','operations','W','Create and progress customer support and intake',false),
 ('operations.approve','operations','A','Approve sensitive support decisions',true),
 ('collections.read','collections','R','View invoice references, receipts and collections',false),
 ('collections.write','collections','W','Record collections and receipts',false),
 ('collections.approve','collections','A','Confirm receipts and authorise payments',false),
 ('customers.controls','customers','W','Set customer restrictions and credit exemption',true)
 ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_key,permission_key)
 SELECT r.key,p.key FROM roles r CROSS JOIN permissions p
 WHERE (r.key IN ('EXECUTIVE','MANAGER','ACCOUNTS') AND p.key IN ('operations.read','operations.write'))
 OR (r.key='ACCOUNTS' AND p.key IN ('collections.read','collections.write','collections.approve')) ON CONFLICT DO NOTHING;
INSERT INTO workflow_definitions(workflow_key,name,description,status) VALUES
 ('payment_reminders','Payment reminder drafts','Verified outstanding facts and approval required; stop on resolution.','DRAFT'),
 ('supplier_reminders','Supplier reminder drafts','Owner-configured interval; no unattended sending.','DRAFT'),
 ('delivery_follow_up','Delivery follow-up drafts','Elapsed time is not delivery evidence.','DRAFT'),
 ('material_delivered','Material-delivered acknowledgement','Requires confirmed delivery evidence and owner activation.','DRAFT'),
 ('warranty_follow_up','Warranty follow-up drafts','Human decision and configured policy required.','DRAFT') ON CONFLICT DO NOTHING;
INSERT INTO automation_switches(workflow_key) SELECT workflow_key FROM workflow_definitions ON CONFLICT DO NOTHING;
