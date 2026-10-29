-- F1 platform foundation: database-stored access matrix, MFA, versioned rules,
-- record ownership and SLA, exception queue, automation switches, outbound
-- checklist, tasks, idempotency and job logs.
-- Business values (SLA policy, margin floor, discount levels, ...) are NOT seeded:
-- unset rules block the workflows that depend on them.

-- ---------------------------------------------------------------------------
-- Roles and permissions
-- ---------------------------------------------------------------------------
CREATE TABLE roles (
  key text PRIMARY KEY CHECK (key ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  description text,
  requires_mfa boolean NOT NULL DEFAULT false,
  all_permissions boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id)
);

INSERT INTO roles(key,name,description,requires_mfa,all_permissions,is_system) VALUES
  ('OWNER','Owner','Business owner and final approver.',true,true,true),
  ('MANAGER','Manager','Existing manager role.',false,false,true),
  ('EXECUTIVE','Executive','Existing sales executive role.',false,false,true),
  ('ACCOUNTS','Accounts','Existing accounts role.',false,false,true);

-- users.role was a fixed CHECK list; it now references the editable roles table.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid='users'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE users ADD CONSTRAINT users_role_fk FOREIGN KEY (role) REFERENCES roles(key);

ALTER TABLE users
  ADD COLUMN backup_user_id integer REFERENCES users(id),
  ADD COLUMN manager_user_id integer REFERENCES users(id),
  ADD COLUMN department text CHECK (department IN ('SALES','OPERATIONS','ACCOUNTS','CUSTOMER_SUPPORT')),
  ADD COLUMN on_leave boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT users_backup_not_self CHECK (backup_user_id IS NULL OR backup_user_id <> id),
  ADD CONSTRAINT users_manager_not_self CHECK (manager_user_id IS NULL OR manager_user_id <> id);

CREATE TABLE permissions (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  resource text NOT NULL,
  action text NOT NULL CHECK (action IN ('R','W','A','F')),
  description text NOT NULL,
  owner_only boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_key text NOT NULL REFERENCES roles(key),
  permission_key text NOT NULL REFERENCES permissions(key),
  granted_by integer REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_key, permission_key)
);

-- Append-only change history; its max(id) doubles as the cache version.
CREATE TABLE access_matrix_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_key text NOT NULL,
  permission_key text,
  change text NOT NULL CHECK (change IN ('GRANT','REVOKE','ROLE_CREATED','ROLE_UPDATED','SEED')),
  old_value jsonb,
  new_value jsonb,
  reason text NOT NULL CHECK (length(trim(reason)) >= 3),
  changed_by integer REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO permissions(key,resource,action,description,owner_only) VALUES
  ('dashboard.read','dashboard','R','View dashboards',false),
  ('users.read','users','R','View users',false),
  ('users.create','users','W','Create users',true),
  ('users.update','users','W','Edit users, reset passwords and MFA',true),
  ('access.read','access','R','View the role and permission matrix',false),
  ('access.manage','access','W','Edit roles, permissions and field privacy',true),
  ('customers.read','customers','R','View customers',false),
  ('customers.create','customers','W','Create customers',false),
  ('customers.update','customers','W','Edit customers',false),
  ('customers.duplicates','customers','R','Run duplicate checks',false),
  ('customers.approve','customers','A','Approve new customers for billing and merges',false),
  ('customers.credit_exempt','customers','W','Set the credit-exempt flag',true),
  ('customers.do_not_quote','customers','W','Set or clear Do Not Quote',false),
  ('customers.dues.read','customers','F','See customer dues and balances',false),
  ('items.read','items','R','View items and price lists',false),
  ('items.create','items','W','Create items',false),
  ('items.update','items','W','Edit items and price lists',false),
  ('items.list_price.read','items','F','See list price and discount (internal only)',false),
  ('enquiries.read','enquiries','R','View enquiries',false),
  ('enquiries.create','enquiries','W','Create enquiries',false),
  ('enquiries.update','enquiries','W','Edit and assign enquiries',false),
  ('quotations.read','quotations','R','View quotations',false),
  ('quotations.create','quotations','W','Create quotations',false),
  ('quotations.update','quotations','W','Revise and submit quotations',false),
  ('quotations.status','quotations','W','Record quotation outcomes',false),
  ('quotations.send','quotations','W','Send approved quotations',false),
  ('quotations.approve','quotations','A','Approve quotations',false),
  ('quotations.cost.read','quotations','F','See cost and margin',false),
  ('quotations.cost.manage','quotations','W','Enter item costs',true),
  ('quotations.policy.manage','quotations','W','Edit quotation policy and letterhead',true),
  ('orders.read','orders','R','View sales orders',false),
  ('orders.create','orders','W','Create sales orders',false),
  ('orders.update','orders','W','Edit and verify sales orders',false),
  ('orders.review','orders','A','Review held sales orders',false),
  ('orders.dispatch','orders','W','Dispatch and confirm delivery',false),
  ('orders.credit.review','orders','A','Approve credit exceptions',true),
  ('purchasing.read','purchasing','R','View purchasing',false),
  ('purchasing.write','purchasing','W','Edit purchasing records',false),
  ('purchasing.approve','purchasing','A','Approve purchasing records',false),
  ('tally.read','tally','R','View stored Tally data',false),
  ('tally.sync','tally','W','Request a Tally read',false),
  ('tally.connector.manage','tally','W','Pair and revoke Tally connectors',true),
  ('audit.read','audit','R','Search the audit trail',false),
  ('rules.read','rules','R','View business rules',false),
  ('rules.manage','rules','W','Edit business rules',true),
  ('automation.read','automation','R','View automation switches',false),
  ('automation.enable','automation','W','Turn automation switches ON or change rollout stage',true),
  ('automation.disable','automation','W','Turn automation switches OFF',false),
  ('exceptions.read','exceptions','R','View the exception queue',false),
  ('exceptions.raise','exceptions','W','Raise exceptions and backdating requests',false),
  ('exceptions.decide','exceptions','A','Approve or reject exceptions',false),
  ('work.read','work','R','View owned work and SLA',false),
  ('work.reassign','work','W','Reassign open work',false),
  ('tasks.read','tasks','R','View tasks',false),
  ('tasks.write','tasks','W','Create, update and forward tasks',false),
  ('tasks.assign','tasks','A','Assign tasks to other users',false),
  ('outbound.read','outbound','R','View outbound drafts',false),
  ('outbound.approve','outbound','A','Approve outbound drafts',false),
  ('outbound.checklist.manage','outbound','W','Tick the customer/category checklist',true);

-- Seed reproduces the previous hard-coded matrix (src/rbac.js before this
-- migration), plus read-only visibility of the new F1 screens.
-- audit.read is not seeded for MANAGER/ACCOUNTS: the client's proposed matrix
-- (F1) gives the audit trail to the owner only. The owner can grant it.
INSERT INTO role_permissions(role_key,permission_key)
SELECT r, p FROM (VALUES
  ('EXECUTIVE','dashboard.read'),('EXECUTIVE','customers.read'),('EXECUTIVE','customers.create'),('EXECUTIVE','customers.update'),
  ('EXECUTIVE','customers.duplicates'),('EXECUTIVE','items.read'),('EXECUTIVE','enquiries.read'),('EXECUTIVE','enquiries.create'),
  ('EXECUTIVE','enquiries.update'),('EXECUTIVE','quotations.read'),('EXECUTIVE','quotations.create'),('EXECUTIVE','quotations.update'),
  ('EXECUTIVE','orders.read'),('EXECUTIVE','orders.create'),('EXECUTIVE','orders.update'),
  ('EXECUTIVE','work.read'),('EXECUTIVE','tasks.read'),('EXECUTIVE','tasks.write'),('EXECUTIVE','exceptions.raise'),
  ('MANAGER','dashboard.read'),('MANAGER','users.read'),('MANAGER','customers.read'),('MANAGER','customers.create'),
  ('MANAGER','customers.update'),('MANAGER','customers.duplicates'),('MANAGER','items.read'),('MANAGER','items.create'),
  ('MANAGER','items.update'),('MANAGER','enquiries.read'),('MANAGER','enquiries.create'),('MANAGER','enquiries.update'),
  ('MANAGER','quotations.read'),('MANAGER','quotations.create'),('MANAGER','quotations.update'),('MANAGER','quotations.status'),
  ('MANAGER','quotations.send'),('MANAGER','quotations.approve'),('MANAGER','quotations.cost.read'),('MANAGER','orders.read'),
  ('MANAGER','orders.create'),('MANAGER','orders.update'),('MANAGER','orders.review'),('MANAGER','orders.dispatch'),
  ('MANAGER','purchasing.read'),('MANAGER','purchasing.write'),('MANAGER','purchasing.approve'),('MANAGER','tally.read'),
  ('MANAGER','tally.sync'),('MANAGER','items.list_price.read'),
  ('MANAGER','work.read'),('MANAGER','tasks.read'),('MANAGER','tasks.write'),('MANAGER','exceptions.raise'),
  ('ACCOUNTS','dashboard.read'),('ACCOUNTS','customers.read'),('ACCOUNTS','customers.update'),('ACCOUNTS','customers.duplicates'),
  ('ACCOUNTS','items.read'),('ACCOUNTS','enquiries.read'),('ACCOUNTS','quotations.read'),('ACCOUNTS','orders.read'),
  ('ACCOUNTS','tally.read'),('ACCOUNTS','tally.sync'),('ACCOUNTS','customers.dues.read'),
  ('ACCOUNTS','work.read'),('ACCOUNTS','tasks.read'),('ACCOUNTS','tasks.write'),('ACCOUNTS','exceptions.raise')
) AS seed(r,p);

INSERT INTO access_matrix_events(role_key,change,new_value,reason)
SELECT key,'SEED',jsonb_build_object('allPermissions',all_permissions,'requiresMfa',requires_mfa),'Seeded from the existing four-role matrix'
FROM roles;

-- ---------------------------------------------------------------------------
-- MFA (TOTP) and recovery codes
-- ---------------------------------------------------------------------------
CREATE TABLE user_mfa (
  user_id integer PRIMARY KEY REFERENCES users(id),
  secret_ciphertext text NOT NULL,
  enabled_at timestamptz,
  last_used_step bigint,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id integer NOT NULL REFERENCES users(id),
  code_hash char(64) NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);

ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;

-- ---------------------------------------------------------------------------
-- Versioned business rules (values only; definitions live in code)
-- ---------------------------------------------------------------------------
CREATE TABLE business_rule_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL CHECK (rule_key ~ '^[a-z][a-z0-9_.]+$'),
  version integer NOT NULL CHECK (version > 0),
  value jsonb,
  is_cleared boolean NOT NULL DEFAULT false,
  reason text NOT NULL CHECK (length(trim(reason)) >= 3),
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_key, version),
  CHECK (is_cleared OR value IS NOT NULL)
);
CREATE INDEX business_rule_values_current ON business_rule_values(rule_key, version DESC);

-- ---------------------------------------------------------------------------
-- Ownership, SLA and escalation for every business record
-- ---------------------------------------------------------------------------
CREATE TABLE work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type ~ '^[A-Z][A-Z_]+$'),
  entity_id text NOT NULL,
  title text NOT NULL,
  department text CHECK (department IN ('SALES','OPERATIONS','ACCOUNTS','CUSTOMER_SUPPORT')),
  owner_user_id integer REFERENCES users(id),
  backup_user_id integer REFERENCES users(id),
  assignment_reason text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','WAITING','DONE','CANCELLED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  sla_state text NOT NULL DEFAULT 'NOT_CONFIGURED' CHECK (sla_state IN ('NOT_CONFIGURED','RUNNING','BREACHED','MET','STOPPED')),
  sla_rule_version integer,
  sla_timezone text,
  escalation_level integer NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 2),
  escalated_to_user_id integer REFERENCES users(id),
  last_escalated_at timestamptz,
  escalation_blocked_reason text,
  closed_at timestamptz,
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_reason text,
  UNIQUE (entity_type, entity_id),
  CHECK (backup_user_id IS NULL OR owner_user_id IS NULL OR backup_user_id <> owner_user_id),
  CHECK (NOT is_deleted OR length(trim(coalesce(deleted_reason,''))) >= 3)
);
CREATE INDEX work_items_owner_open ON work_items(owner_user_id, due_at) WHERE status IN ('OPEN','IN_PROGRESS','WAITING') AND NOT is_deleted;
CREATE INDEX work_items_backup_open ON work_items(backup_user_id) WHERE status IN ('OPEN','IN_PROGRESS','WAITING') AND NOT is_deleted;
CREATE INDEX work_items_due ON work_items(due_at) WHERE sla_state = 'RUNNING';

CREATE TABLE work_item_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_item_id uuid NOT NULL REFERENCES work_items(id),
  event text NOT NULL,
  from_user_id integer REFERENCES users(id),
  to_user_id integer REFERENCES users(id),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  actor_user_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_item_events_item ON work_item_events(work_item_id, id);

-- ---------------------------------------------------------------------------
-- Exception queue (decisions recorded in approval_requests/approval_decisions)
-- ---------------------------------------------------------------------------
CREATE TABLE exception_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_type text NOT NULL CHECK (exception_type ~ '^[A-Z][A-Z_]+$'),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','APPROVED','REJECTED','WITHDRAWN')),
  department text CHECK (department IN ('SALES','OPERATIONS','ACCOUNTS','CUSTOMER_SUPPORT')),
  raised_by integer NOT NULL REFERENCES users(id),
  record_creator_id integer REFERENCES users(id),
  approval_request_id uuid NOT NULL UNIQUE REFERENCES approval_requests(id),
  decided_by integer REFERENCES users(id),
  decided_at timestamptz,
  decision_reason text,
  backdate_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'OPEN' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND length(trim(coalesce(decision_reason,''))) >= 3)),
  CHECK (decided_by IS NULL OR (decided_by <> raised_by AND decided_by IS DISTINCT FROM record_creator_id))
);
CREATE UNIQUE INDEX exception_cases_open_unique ON exception_cases(exception_type, entity_type, entity_id, fingerprint) WHERE status = 'OPEN';
CREATE INDEX exception_cases_queue ON exception_cases(status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Automation switches (one per workflow, default OFF)
-- ---------------------------------------------------------------------------
CREATE TABLE automation_switches (
  workflow_key text PRIMARY KEY REFERENCES workflow_definitions(workflow_key),
  enabled boolean NOT NULL DEFAULT false,
  rollout_stage text NOT NULL DEFAULT 'DRAFT_AND_APPROVAL' CHECK (rollout_stage IN ('DRAFT_AND_APPROVAL','SELECTIVE')),
  updated_by integer REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE automation_switch_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workflow_key text NOT NULL REFERENCES automation_switches(workflow_key),
  field text NOT NULL CHECK (field IN ('enabled','rollout_stage')),
  old_value text NOT NULL,
  new_value text NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) >= 3),
  changed_by integer NOT NULL REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO workflow_definitions(workflow_key,name,description,status) VALUES
  ('email_intake','Email enquiry intake','Poll connected mailboxes and create enquiry records.','DRAFT'),
  ('whatsapp_intake','WhatsApp enquiry intake','Accept WhatsApp webhook messages as enquiry records.','DRAFT'),
  ('enquiry_acknowledgement','Enquiry acknowledgement draft','Prepare a receipt-only acknowledgement draft for approval.','DRAFT'),
  ('quotation_email','Quotation email draft','Prepare a quotation email draft for employee approval.','DRAFT'),
  ('stock_only_reply','Stock-only reply draft','Prepare a stock-only reply for configured customer groups.','DRAFT'),
  ('quotation_follow_up','Quotation follow-up reminders','Create follow-up reminders for sent quotations.','DRAFT'),
  ('task_reminders','Task reminders','Send task reminders through the notification channel.','DRAFT'),
  ('sla_escalation','SLA escalation','Escalate overdue records owner to backup to manager.','DRAFT')
ON CONFLICT (workflow_key) DO NOTHING;
INSERT INTO automation_switches(workflow_key) SELECT workflow_key FROM workflow_definitions ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Outbound gate: owner's customer/category checklist and manual-response list
-- ---------------------------------------------------------------------------
CREATE TABLE customer_message_checklist (
  customer_id integer NOT NULL REFERENCES customers(id),
  category text NOT NULL CHECK (category ~ '^[a-z][a-z0-9_]+$'),
  ticked boolean NOT NULL DEFAULT false,
  updated_by integer NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (length(trim(reason)) >= 3),
  PRIMARY KEY (customer_id, category)
);

CREATE TABLE manual_response_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id integer REFERENCES customers(id),
  item_id integer REFERENCES items(id),
  reason text NOT NULL CHECK (length(trim(reason)) >= 3),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_by integer REFERENCES users(id),
  archived_at timestamptz,
  archive_reason text,
  CHECK ((customer_id IS NULL) <> (item_id IS NULL))
);
CREATE UNIQUE INDEX manual_response_customer ON manual_response_exceptions(customer_id) WHERE status='ACTIVE' AND customer_id IS NOT NULL;
CREATE UNIQUE INDEX manual_response_item ON manual_response_exceptions(item_id) WHERE status='ACTIVE' AND item_id IS NOT NULL;

ALTER TABLE email_drafts
  ADD COLUMN workflow_key text REFERENCES workflow_definitions(workflow_key),
  ADD COLUMN message_category text,
  ADD COLUMN body_text text,
  ADD COLUMN gate_result jsonb;

-- ---------------------------------------------------------------------------
-- Task board (S-19)
-- ---------------------------------------------------------------------------
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  description text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','FORWARDED','DONE')),
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','AUTO')),
  department text CHECK (department IN ('SALES','OPERATIONS','ACCOUNTS','CUSTOMER_SUPPORT')),
  owner_user_id integer NOT NULL REFERENCES users(id),
  backup_user_id integer REFERENCES users(id),
  due_at timestamptz,
  parent_task_id uuid REFERENCES tasks(id),
  forwarded_to_task_id uuid REFERENCES tasks(id),
  entity_type text,
  entity_id text,
  next_reminder_at timestamptz,
  reminder_count integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_by integer NOT NULL REFERENCES users(id),
  updated_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_reason text,
  CHECK (NOT is_deleted OR length(trim(coalesce(deleted_reason,''))) >= 3),
  CHECK (status <> 'FORWARDED' OR forwarded_to_task_id IS NOT NULL)
);
CREATE INDEX tasks_owner_open ON tasks(owner_user_id, status, due_at) WHERE NOT is_deleted;
CREATE INDEX tasks_reminder_due ON tasks(next_reminder_at) WHERE status IN ('OPEN','IN_PROGRESS') AND NOT is_deleted;

CREATE TABLE task_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks(id),
  event text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  reason text,
  actor_user_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reminders ADD COLUMN task_id uuid REFERENCES tasks(id);
ALTER TABLE reminders ADD COLUMN work_item_id uuid REFERENCES work_items(id);

-- ---------------------------------------------------------------------------
-- Idempotency keys and scheduler job logs
-- ---------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  user_id integer NOT NULL REFERENCES users(id),
  key text NOT NULL CHECK (length(key) BETWEEN 8 AND 200),
  method text NOT NULL,
  path text NOT NULL,
  request_sha256 char(64) NOT NULL,
  status_code integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE job_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name text NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED','SKIPPED')),
  message text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX job_logs_recent ON job_logs(job_name, run_at DESC);

-- Audit search (S-25): user / date / module / record.
CREATE INDEX IF NOT EXISTS audit_logs_user_time ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_record ON audit_logs(entity, record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_time ON audit_logs(created_at DESC);

-- ---------------------------------------------------------------------------
-- Append-only guards
-- ---------------------------------------------------------------------------
CREATE FUNCTION f1_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

CREATE TRIGGER access_matrix_events_append_only BEFORE UPDATE OR DELETE ON access_matrix_events FOR EACH ROW EXECUTE FUNCTION f1_append_only();
CREATE TRIGGER business_rule_values_append_only BEFORE UPDATE OR DELETE ON business_rule_values FOR EACH ROW EXECUTE FUNCTION f1_append_only();
CREATE TRIGGER work_item_events_append_only BEFORE UPDATE OR DELETE ON work_item_events FOR EACH ROW EXECUTE FUNCTION f1_append_only();
CREATE TRIGGER automation_switch_events_append_only BEFORE UPDATE OR DELETE ON automation_switch_events FOR EACH ROW EXECUTE FUNCTION f1_append_only();
CREATE TRIGGER task_events_append_only BEFORE UPDATE OR DELETE ON task_events FOR EACH ROW EXECUTE FUNCTION f1_append_only();
CREATE TRIGGER approval_decisions_append_only BEFORE UPDATE OR DELETE ON approval_decisions FOR EACH ROW EXECUTE FUNCTION f1_append_only();

CREATE FUNCTION f1_no_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be deleted; archive them with a reason', TG_TABLE_NAME;
END $$;
CREATE TRIGGER work_items_no_delete BEFORE DELETE ON work_items FOR EACH ROW EXECUTE FUNCTION f1_no_hard_delete();
CREATE TRIGGER exception_cases_no_delete BEFORE DELETE ON exception_cases FOR EACH ROW EXECUTE FUNCTION f1_no_hard_delete();
CREATE TRIGGER tasks_no_delete BEFORE DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION f1_no_hard_delete();
CREATE TRIGGER roles_no_delete BEFORE DELETE ON roles FOR EACH ROW EXECUTE FUNCTION f1_no_hard_delete();

-- Owner-only permissions can only be held by roles with all_permissions.
CREATE FUNCTION f1_owner_only_permission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM permissions WHERE key = NEW.permission_key AND owner_only) THEN
    RAISE EXCEPTION 'Permission % is reserved for the owner', NEW.permission_key;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER role_permissions_owner_only BEFORE INSERT OR UPDATE ON role_permissions FOR EACH ROW EXECUTE FUNCTION f1_owner_only_permission_guard();
