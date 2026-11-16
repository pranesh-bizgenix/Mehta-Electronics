-- Maker-checker review for customers created inside ControlDesk.
-- Existing/Tally-linked customers are not backfilled or assigned an invented state.
CREATE TABLE crm_customer_onboarding (
  customer_id integer PRIMARY KEY REFERENCES customers(id),
  status text NOT NULL CHECK(status IN ('PENDING_APPROVAL','APPROVED','REJECTED')),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  submitted_by integer NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_by integer REFERENCES users(id),
  decided_at timestamptz,
  decision_reason text,
  duplicate_snapshot jsonb,
  created_by integer NOT NULL REFERENCES users(id),
  updated_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(duplicate_snapshot IS NULL OR jsonb_typeof(duplicate_snapshot)='array'),
  CHECK(
    (status='PENDING_APPROVAL' AND decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
    OR (status IN ('APPROVED','REJECTED') AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND length(trim(decision_reason))>=3)
  )
);

CREATE TABLE crm_customer_onboarding_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers(id),
  version integer NOT NULL CHECK(version > 0),
  action text NOT NULL CHECK(action IN ('SUBMITTED','RESUBMITTED','APPROVED','REJECTED')),
  from_status text,
  to_status text NOT NULL CHECK(to_status IN ('PENDING_APPROVAL','APPROVED','REJECTED')),
  reason text NOT NULL CHECK(length(trim(reason))>=3),
  detail jsonb,
  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX crm_customer_onboarding_status ON crm_customer_onboarding(status,updated_at);
CREATE INDEX crm_customer_onboarding_events_customer ON crm_customer_onboarding_events(customer_id,id DESC);
CREATE TRIGGER crm_customer_onboarding_no_delete BEFORE DELETE OR TRUNCATE ON crm_customer_onboarding FOR EACH STATEMENT EXECUTE FUNCTION f1_append_only();
CREATE TRIGGER crm_customer_onboarding_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_customer_onboarding_events FOR EACH STATEMENT EXECUTE FUNCTION f1_append_only();

INSERT INTO audit_logs(entity,record_id,action,reason,new_value)
VALUES('SCHEMA_MIGRATION','0057_customer_onboarding_review','MIGRATION','Add customer onboarding maker-checker workflow without backfilling or approving any customer','{"backfilledCustomers":false,"seededApprovals":false}');
