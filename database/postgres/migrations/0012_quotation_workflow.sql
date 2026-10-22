-- CRM only. Existing quotation identities remain compatible with order/history routes.
CREATE TABLE crm_quotation_policy (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 singleton boolean NOT NULL DEFAULT true UNIQUE CHECK(singleton),
 floor_percent numeric(9,6) NOT NULL CHECK(floor_percent BETWEEN 0 AND 100),
 margin_basis text NOT NULL CHECK(margin_basis IN ('LINE_AND_TOTAL','TOTAL')),
 seller_state text NOT NULL CHECK(seller_state ~ '^(0[1-9]|[12][0-9]|3[0-8])$'),
 letterhead jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status='ACTIVE'), is_deleted boolean NOT NULL DEFAULT false CHECK(NOT is_deleted)
);
CREATE TABLE crm_quotation_costs (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, item_id integer NOT NULL UNIQUE REFERENCES items(id),
 unit_cost numeric(20,6) NOT NULL CHECK(unit_cost>=0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status='ACTIVE'), is_deleted boolean NOT NULL DEFAULT false CHECK(NOT is_deleted)
);
CREATE TABLE crm_quotation_workflows (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, quotation_id integer NOT NULL UNIQUE REFERENCES quotations(id),
 version integer NOT NULL DEFAULT 1, policy_revision integer NOT NULL,
 place_of_supply text NOT NULL CHECK(place_of_supply ~ '^(0[1-9]|[12][0-9]|3[0-8])$'),
 public_snapshot jsonb NOT NULL, private_snapshot jsonb NOT NULL,
 duplicate_of integer REFERENCES quotations(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','WON','LOST','EXPIRED','CANCELLED')),
 is_deleted boolean NOT NULL DEFAULT false CHECK(NOT is_deleted)
);
CREATE TABLE crm_quotation_versions (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, quotation_id integer NOT NULL REFERENCES quotations(id), version integer NOT NULL,
 public_snapshot jsonb NOT NULL, private_snapshot jsonb NOT NULL, reason text NOT NULL CHECK(length(trim(reason))>=3),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id), status text NOT NULL DEFAULT 'RECORDED' CHECK(status='RECORDED'), is_deleted boolean NOT NULL DEFAULT false CHECK(NOT is_deleted), UNIQUE(quotation_id,version)
);
CREATE TABLE crm_quotation_events (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, quotation_id integer REFERENCES quotations(id), version integer,
 action text NOT NULL, reason text NOT NULL CHECK(length(trim(reason))>=3), public_detail jsonb NOT NULL DEFAULT '{}', private_detail jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id), status text NOT NULL DEFAULT 'RECORDED' CHECK(status='RECORDED'), is_deleted boolean NOT NULL DEFAULT false CHECK(NOT is_deleted)
);
CREATE INDEX crm_quotation_workflow_status ON crm_quotation_workflows(status,updated_at DESC);
CREATE INDEX crm_quotation_event_history ON crm_quotation_events(quotation_id,id);

CREATE FUNCTION crm_quote_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Quotation records cannot be deleted or truncated'; END IF;
 IF current_setting('mehta.quotation_write',true) IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'Use the quotation workflow service'; END IF;
 IF TG_TABLE_NAME IN ('crm_quotation_versions','crm_quotation_events') AND TG_OP='UPDATE' THEN RAISE EXCEPTION 'Quotation history is immutable'; END IF;
 IF TG_OP='UPDATE' THEN NEW.updated_at=now(); END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['crm_quotation_policy','crm_quotation_costs','crm_quotation_workflows','crm_quotation_versions','crm_quotation_events'] LOOP
 EXECUTE format('CREATE TRIGGER quote_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION crm_quote_guard()',t);
 EXECUTE format('CREATE TRIGGER quote_truncate_guard BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION crm_quote_guard()',t);
 END LOOP;
END $$;
CREATE FUNCTION crm_managed_quote_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE qid integer;
BEGIN
 IF TG_TABLE_NAME='quotations' THEN qid=OLD.id; ELSE qid=COALESCE(NEW.quotation_id,OLD.quotation_id); END IF;
 IF EXISTS(SELECT 1 FROM crm_quotation_workflows WHERE quotation_id=qid) AND current_setting('mehta.quotation_write',true) IS DISTINCT FROM 'authorized' THEN
 RAISE EXCEPTION 'Managed quotations must use the approval workflow';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER managed_quote_guard BEFORE UPDATE ON quotations FOR EACH ROW EXECUTE FUNCTION crm_managed_quote_guard();
CREATE TRIGGER managed_quote_line_guard BEFORE INSERT OR UPDATE ON quotation_lines FOR EACH ROW EXECUTE FUNCTION crm_managed_quote_guard();
