-- Structured Make intake and pre-order availability. No fixtures or live switches.
INSERT INTO permissions(key,resource,action,description) VALUES
 ('sales_intake.read','sales_intake','R','Read structured sales intake and source evidence'),
 ('sales_intake.review','sales_intake','W','Resolve and prepare structured sales requests')
ON CONFLICT(key) DO NOTHING;

CREATE TABLE crm_sales_intake_policies (
 company_id uuid PRIMARY KEY REFERENCES tally_companies(id),value jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(value)='object'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),updated_by integer NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE crm_sales_intake_policy_versions (
 company_id uuid NOT NULL REFERENCES tally_companies(id),version integer NOT NULL CHECK(version>0),value jsonb NOT NULL CHECK(jsonb_typeof(value)='object'),
 created_by integer NOT NULL REFERENCES users(id),reason text NOT NULL CHECK(length(trim(reason))>=3),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(company_id,version)
);
CREATE TABLE crm_sales_intakes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES tally_companies(id),
 credential_id uuid NOT NULL REFERENCES automation_service_credentials(id),message_type text NOT NULL CHECK(message_type IN ('CUSTOMER_PO','QUOTATION_REQUEST','LEAD_ENQUIRY')),
 source_system text NOT NULL,mailbox text NOT NULL,message_id text NOT NULL,thread_id text,source_received_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),original_payload jsonb NOT NULL,normalized jsonb NOT NULL,business_hash char(64) NOT NULL,
 customer_id integer REFERENCES customers(id),relationship text NOT NULL DEFAULT 'NEW' CHECK(relationship IN ('NEW','EXISTING')),
 classification text NOT NULL DEFAULT 'NEW' CHECK(classification IN ('NEW','EXISTING','DO_NOT_QUOTE')),tier jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'NEEDS_REVIEW' CHECK(status IN ('NEEDS_REVIEW','PREPARED','CANCELLED')),
 blockers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(blockers)='array'),resolutions jsonb NOT NULL DEFAULT '{}'::jsonb,
 enquiry_id integer UNIQUE REFERENCES enquiries(id),quotation_id integer UNIQUE REFERENCES quotations(id),customer_po_id uuid REFERENCES customer_pos(id),sales_order_id integer REFERENCES sales_orders(id),
 assigned_to integer REFERENCES users(id),first_assigned_at timestamptz,first_response_at timestamptz,response_policy jsonb,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by integer NOT NULL REFERENCES users(id),updated_by integer NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,source_system,mailbox,message_id),UNIQUE(id,company_id)
);
CREATE INDEX crm_sales_intakes_queue ON crm_sales_intakes(company_id,status,received_at DESC,id);
CREATE INDEX crm_sales_intakes_owner ON crm_sales_intakes(assigned_to,received_at DESC);
CREATE INDEX crm_sales_intake_timing ON crm_sales_intakes(company_id,first_assigned_at,id);
CREATE TABLE crm_sales_intake_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES tally_companies(id),event_id text NOT NULL,
 intake_id uuid NOT NULL REFERENCES crm_sales_intakes(id),business_hash char(64) NOT NULL,credential_id uuid NOT NULL REFERENCES automation_service_credentials(id),
 source jsonb NOT NULL,provenance jsonb NOT NULL,original_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(company_id,event_id),FOREIGN KEY(intake_id,company_id) REFERENCES crm_sales_intakes(id,company_id)
);
CREATE TABLE crm_sales_intake_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),intake_id uuid NOT NULL REFERENCES crm_sales_intakes(id),
 source_document_id uuid NOT NULL REFERENCES source_documents(id),attachment_id text NOT NULL,UNIQUE(intake_id,attachment_id)
);
CREATE TABLE crm_sales_intake_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,intake_id uuid REFERENCES crm_sales_intakes(id),company_id uuid NOT NULL REFERENCES tally_companies(id),
 action text NOT NULL,actor_id integer REFERENCES users(id),credential_id uuid REFERENCES automation_service_credentials(id),
 reason text NOT NULL CHECK(length(trim(reason))>=3),detail jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE crm_quotation_availability (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES tally_companies(id),
 quotation_id integer NOT NULL REFERENCES quotations(id),quotation_version integer NOT NULL CHECK(quotation_version>0),
 intake_id uuid REFERENCES crm_sales_intakes(id),quote_fingerprint char(64) NOT NULL,
 status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','CHECKING','SHORTAGE','PARTIALLY_AVAILABLE','READY_FOR_REVIEW','AVAILABILITY_APPROVED','INVALIDATED','CANCELLED')),
 assigned_store_id integer REFERENCES users(id),reviewed_by integer REFERENCES users(id),reviewed_at timestamptz,decision_fingerprint char(64),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(quotation_id,quotation_version),FOREIGN KEY(intake_id,company_id) REFERENCES crm_sales_intakes(id,company_id),CHECK(reviewed_by IS NULL OR reviewed_by<>created_by),
 CHECK(status<>'AVAILABILITY_APPROVED' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND decision_fingerprint IS NOT NULL))
);
CREATE INDEX crm_quotation_availability_queue ON crm_quotation_availability(status,created_at DESC);
CREATE TABLE crm_quotation_availability_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL REFERENCES crm_quotation_availability(id),
 quotation_line_id integer NOT NULL REFERENCES quotation_lines(id),source_line_id text NOT NULL,item_id integer NOT NULL REFERENCES items(id),
 description text NOT NULL,quantity numeric(20,6) NOT NULL CHECK(quantity>0),uom text NOT NULL,
 warehouse_key text,checked_quantity numeric(20,6) CHECK(checked_quantity>=0),checked_by integer REFERENCES users(id),checked_at timestamptz,evidence text,
 UNIQUE(request_id,quotation_line_id),UNIQUE(request_id,source_line_id)
);
CREATE TABLE crm_quote_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),availability_line_id uuid NOT NULL REFERENCES crm_quotation_availability_lines(id),
 company_id uuid NOT NULL REFERENCES tally_companies(id),item_id integer NOT NULL REFERENCES items(id),warehouse_key text NOT NULL,uom text NOT NULL,
 quantity numeric(20,6) NOT NULL CHECK(quantity>0),status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','RELEASED','TRANSFERRED','CONSUMED')),
 sales_order_id integer REFERENCES sales_orders(id),source_fingerprint char(64) NOT NULL,created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((status<>'TRANSFERRED') OR sales_order_id IS NOT NULL)
);
CREATE UNIQUE INDEX crm_quote_reservation_one_active ON crm_quote_reservations(availability_line_id) WHERE status IN ('ACTIVE','TRANSFERRED');
CREATE INDEX crm_quote_reservation_balance ON crm_quote_reservations(company_id,item_id,warehouse_key) WHERE status IN ('ACTIVE','TRANSFERRED');
CREATE TABLE crm_quotation_availability_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,request_id uuid NOT NULL REFERENCES crm_quotation_availability(id),
 action text NOT NULL,actor_id integer REFERENCES users(id),version integer NOT NULL,reason text NOT NULL CHECK(length(trim(reason))>=3),
 detail jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION crm_sales_intake_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Sales intake records are retained; use an audited lifecycle action'; END IF;
 IF current_setting('mehta.sales_intake_write',true) IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'Use authorised sales intake services'; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME IN ('crm_sales_intake_policy_versions','crm_sales_intake_deliveries','crm_sales_intake_documents','crm_sales_intake_events','crm_quotation_availability_events') THEN RAISE EXCEPTION 'Intake evidence and events are immutable'; END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='crm_sales_intakes' AND
  (NEW.original_payload,NEW.normalized,NEW.business_hash,NEW.source_system,NEW.mailbox,NEW.message_id,NEW.company_id,NEW.received_at,NEW.source_received_at)
  IS DISTINCT FROM (OLD.original_payload,OLD.normalized,OLD.business_hash,OLD.source_system,OLD.mailbox,OLD.message_id,OLD.company_id,OLD.received_at,OLD.source_received_at)
 THEN RAISE EXCEPTION 'Original extraction is immutable; retain a reviewed revision separately'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['crm_sales_intake_policies','crm_sales_intake_policy_versions','crm_sales_intakes','crm_sales_intake_deliveries','crm_sales_intake_documents','crm_sales_intake_events','crm_quotation_availability','crm_quotation_availability_lines','crm_quote_reservations','crm_quotation_availability_events'] LOOP
 EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION crm_sales_intake_guard()',name||'_guard',name);
 EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION crm_sales_intake_guard()',name||'_no_truncate',name);
 END LOOP;
END $$;
