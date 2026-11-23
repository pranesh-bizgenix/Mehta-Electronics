-- Additive CRM customer features. No customer, pricing or classification values seeded.
INSERT INTO permissions(key,resource,action,description) VALUES
 ('customers.merge.request','customers','W','Request a reviewed duplicate-customer merge'),
 ('customers.merge.approve','customers','A','Independently approve duplicate-customer merges')
ON CONFLICT(key) DO NOTHING;

CREATE TABLE crm_customer_addresses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id integer NOT NULL REFERENCES customers(id),
 label text NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 100), kind text NOT NULL CHECK(kind IN ('BILLING','DELIVERY')),
 line1 text NOT NULL, line2 text NOT NULL DEFAULT '', city text NOT NULL, state_code text NOT NULL,
 postal_code text NOT NULL DEFAULT '', country_code text NOT NULL CHECK(country_code ~ '^[A-Z]{2}$'),
 contact_name text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', is_default boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by integer NOT NULL REFERENCES users(id), updated_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX crm_customer_address_default ON crm_customer_addresses(customer_id,kind) WHERE is_default AND status='ACTIVE';
CREATE UNIQUE INDEX crm_customer_address_label ON crm_customer_addresses(customer_id,kind,lower(label)) WHERE status='ACTIVE';
CREATE INDEX crm_customer_addresses_customer ON crm_customer_addresses(customer_id,status,created_at DESC);

CREATE TABLE crm_customer_activities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id integer NOT NULL REFERENCES customers(id),
 kind text NOT NULL CHECK(kind IN ('CALL','VISIT','MEETING','NOTE')), title text NOT NULL, notes text NOT NULL,
 occurred_at timestamptz NOT NULL, follow_up_at timestamptz, owner_id integer NOT NULL REFERENCES users(id),
 related_kind text CHECK(related_kind IN ('ENQUIRY','QUOTATION','ORDER')), related_id integer,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by integer NOT NULL REFERENCES users(id), updated_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((related_kind IS NULL)=(related_id IS NULL)), CHECK(follow_up_at IS NULL OR follow_up_at>=occurred_at)
);
CREATE INDEX crm_customer_activities_customer ON crm_customer_activities(customer_id,occurred_at DESC,id);

CREATE TABLE crm_customer_opportunities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id integer NOT NULL REFERENCES customers(id),
 title text NOT NULL, stage text NOT NULL CHECK(stage IN ('NEW','QUALIFIED','PROPOSAL','NEGOTIATION','WON','LOST')),
 expected_value numeric(20,6) CHECK(expected_value>=0), expected_close date, notes text NOT NULL DEFAULT '',
 owner_id integer NOT NULL REFERENCES users(id), enquiry_id integer REFERENCES enquiries(id), quotation_id integer REFERENCES quotations(id),
 sales_order_id integer REFERENCES sales_orders(id), close_reason text, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by integer NOT NULL REFERENCES users(id), updated_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(stage NOT IN ('WON','LOST') OR length(trim(close_reason))>=3), CHECK(stage<>'WON' OR sales_order_id IS NOT NULL)
);
CREATE INDEX crm_customer_opportunities_customer ON crm_customer_opportunities(customer_id,stage,updated_at DESC,id);

CREATE TABLE crm_customer_merge_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id integer NOT NULL REFERENCES customers(id), target_id integer NOT NULL REFERENCES customers(id),
 status text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK(status IN ('PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED')),
 fingerprint char(64) NOT NULL, snapshot jsonb NOT NULL, reason text NOT NULL CHECK(length(trim(reason))>=3),
 created_by integer NOT NULL REFERENCES users(id), decided_by integer REFERENCES users(id), decided_at timestamptz, decision_reason text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(source_id<>target_id), CHECK(decided_by IS NULL OR decided_by<>created_by)
);
CREATE UNIQUE INDEX crm_customer_merge_pending ON crm_customer_merge_requests(source_id) WHERE status='PENDING_APPROVAL';
CREATE INDEX crm_customer_merges_target ON crm_customer_merge_requests(target_id,created_at DESC);
CREATE TABLE crm_customer_merge_links (
 source_id integer PRIMARY KEY REFERENCES customers(id), target_id integer NOT NULL REFERENCES customers(id),
 request_id uuid NOT NULL UNIQUE REFERENCES crm_customer_merge_requests(id), approved_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(source_id<>target_id)
);
CREATE INDEX crm_customer_merge_links_target ON crm_customer_merge_links(target_id);

CREATE TABLE crm_customer_commercial_policies (
 company_id uuid PRIMARY KEY REFERENCES tally_companies(id), value jsonb NOT NULL CHECK(jsonb_typeof(value)='object'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_by integer NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION crm_customer_management_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Customer history is retained; use an audited lifecycle action'; END IF;
 IF current_setting('mehta.customer_management_write',true) IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'Use authorised customer management services'; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='crm_customer_merge_links' THEN RAISE EXCEPTION 'Approved customer identity links are immutable'; END IF;
 RETURN NEW;
END $$;

-- Fence new commercial writes against a concurrently approved merge. Historical
-- records keep their original IDs; ordinary updates not changing identity retain
-- their existing workflows. This uses the existing allocation transaction lock.
CREATE FUNCTION crm_customer_identity_write_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid integer;
BEGIN
 PERFORM pg_advisory_xact_lock(812731);
 cid=CASE WHEN TG_TABLE_NAME='customers' THEN (to_jsonb(NEW)->>'id')::integer ELSE (to_jsonb(NEW)->>'customer_id')::integer END;
 IF cid IS NOT NULL AND EXISTS(SELECT 1 FROM crm_customer_merge_links WHERE source_id=cid) THEN
  RAISE EXCEPTION 'Customer was merged; create new work against the surviving customer';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER customers_merged_identity BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION crm_customer_identity_write_guard();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['enquiries','quotations','sales_orders','billing_documents','crm_operations','crm_customer_rate_contracts'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF customer_id ON %I FOR EACH ROW EXECUTE FUNCTION crm_customer_identity_write_guard()',t||'_customer_identity',t);
 END LOOP;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['crm_customer_addresses','crm_customer_activities','crm_customer_opportunities','crm_customer_merge_requests','crm_customer_merge_links','crm_customer_commercial_policies'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION crm_customer_management_guard()',t||'_guard',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION crm_customer_management_guard()',t||'_no_truncate',t);
 END LOOP;
END $$;
