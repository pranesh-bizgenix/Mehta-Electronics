-- Physical custody extends existing support operations; it never creates saleable stock.
CREATE TABLE crm_material_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation_id uuid NOT NULL UNIQUE REFERENCES crm_operations(id),
 claim_id uuid NOT NULL UNIQUE REFERENCES crm_claims(id),
 customer_id integer NOT NULL REFERENCES customers(id),company_id uuid NOT NULL REFERENCES tally_companies(id),
 invoice_document_id uuid NOT NULL REFERENCES billing_documents(id),invoice_line integer NOT NULL CHECK(invoice_line>=0),
 item_id integer NOT NULL REFERENCES items(id),quantity numeric(18,6) NOT NULL CHECK(quantity>0),uom text NOT NULL CHECK(length(trim(uom))>0),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 status text NOT NULL DEFAULT 'WAITING_MATERIAL' CHECK(status IN ('WAITING_MATERIAL','PARTIALLY_RECEIVED','RECEIVED','INSPECTED','SUPPLIER_PENDING','REMEDY_PENDING','CLOSED','CANCELLED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(operation_id,customer_id) REFERENCES crm_operations(id,customer_id)
);
CREATE INDEX crm_material_cases_invoice ON crm_material_cases(invoice_document_id,invoice_line);
CREATE INDEX crm_material_cases_queue ON crm_material_cases(status,created_at DESC,id);
CREATE INDEX crm_material_cases_company ON crm_material_cases(company_id,customer_id);
CREATE TABLE crm_material_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),case_id uuid NOT NULL REFERENCES crm_material_cases(id),
 request_key uuid NOT NULL UNIQUE,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 action text NOT NULL CHECK(action IN ('OPEN','RECEIVE','INSPECT','SUPPLIER_HANDOVER','SUPPLIER_RESULT','REPLACEMENT','CREDIT_LINK','ORIGINAL_RETURN','CLOSE','CANCEL')),
 quantity numeric(18,6) CHECK(quantity>0),supplier_po_id integer REFERENCES crm_supplier_pos(id),shipment_id integer REFERENCES crm_shipments(id),shipment_line_id integer REFERENCES sales_order_lines(id),credit_adjustment_id uuid REFERENCES crm_invoice_adjustments(id),data jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(data)='object'),
 actor_id integer NOT NULL REFERENCES users(id),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_material_events_case ON crm_material_events(case_id,created_at,id);
CREATE FUNCTION guard_material_custody() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer;
BEGIN
 actor:=nullif(current_setting('mehta.actor_id',true),'')::integer;
 IF TG_OP IN ('DELETE','TRUNCATE') OR actor IS NULL OR current_setting('mehta.material_write',true) IS DISTINCT FROM 'authorized' OR length(trim(coalesce(current_setting('mehta.audit_reason',true),'')))<3 THEN RAISE EXCEPTION 'Use the audited support material workflow'; END IF;
 IF TG_TABLE_NAME='crm_material_events' THEN
  IF TG_OP<>'INSERT' OR NEW.actor_id<>actor OR NEW.reason IS DISTINCT FROM current_setting('mehta.audit_reason',true) THEN RAISE EXCEPTION 'Material events are immutable and actor-bound'; END IF;
 ELSE
  IF TG_OP='INSERT' AND (NEW.created_by<>actor OR NEW.updated_by<>actor OR NEW.version<>1 OR NEW.status<>'WAITING_MATERIAL') THEN RAISE EXCEPTION 'Material case must start with its real creator'; END IF;
  IF TG_OP='UPDATE' AND ((NEW.id,NEW.operation_id,NEW.claim_id,NEW.customer_id,NEW.company_id,NEW.invoice_document_id,NEW.invoice_line,NEW.item_id,NEW.quantity,NEW.uom,NEW.snapshot,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.operation_id,OLD.claim_id,OLD.customer_id,OLD.company_id,OLD.invoice_document_id,OLD.invoice_line,OLD.item_id,OLD.quantity,OLD.uom,OLD.snapshot,OLD.created_by,OLD.created_at) OR NEW.version<>OLD.version+1 OR OLD.status IN ('CLOSED','CANCELLED')) THEN RAISE EXCEPTION 'Material identity and closed history are immutable'; END IF;
  NEW.updated_by:=actor;NEW.updated_at:=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_material_cases_write BEFORE INSERT OR UPDATE OR DELETE ON crm_material_cases FOR EACH ROW EXECUTE FUNCTION guard_material_custody();
CREATE TRIGGER crm_material_cases_no_truncate BEFORE TRUNCATE ON crm_material_cases FOR EACH STATEMENT EXECUTE FUNCTION guard_material_custody();
CREATE TRIGGER crm_material_events_write BEFORE INSERT OR UPDATE OR DELETE ON crm_material_events FOR EACH ROW EXECUTE FUNCTION guard_material_custody();
CREATE TRIGGER crm_material_events_no_truncate BEFORE TRUNCATE ON crm_material_events FOR EACH STATEMENT EXECUTE FUNCTION guard_material_custody();
