-- S0 reserved workflow foundations. No rows or business-policy values are seeded.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
ALTER TABLE sales_order_lines ADD CONSTRAINT s0_order_line_identity UNIQUE(id,sales_order_id);
ALTER TABLE crm_shipments ADD CONSTRAINT s0_shipment_identity UNIQUE(id,sales_order_id);
ALTER TABLE logistics_evidence ADD CONSTRAINT s0_evidence_identity UNIQUE(id,sales_order_id);

CREATE TABLE item_pack_factors (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
item_id integer NOT NULL REFERENCES items(id),from_uom text NOT NULL CHECK(length(trim(from_uom))>0),
 to_uom text NOT NULL CHECK(length(trim(to_uom))>0),factor numeric(30,12) NOT NULL CHECK(factor>0),
 valid_from date NOT NULL,valid_to date CHECK(valid_to>=valid_from),source_document_id uuid REFERENCES source_documents(id),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','ARCHIVED')),
 approved_by integer REFERENCES users(id),approval_reason text,CHECK(approved_by IS NULL OR approved_by<>created_by),
 UNIQUE(item_id,from_uom,to_uom,valid_from)
);

CREATE TABLE crm_price_levels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
level_number smallint NOT NULL UNIQUE CHECK(level_number BETWEEN 1 AND 3),label text,
 meaning jsonb,configuration jsonb,CHECK(meaning IS NULL OR jsonb_typeof(meaning)='object'),
 CHECK(configuration IS NULL OR jsonb_typeof(configuration)='object'),
 status text NOT NULL DEFAULT 'NOT_SET' CHECK(status IN ('NOT_SET','CONFIRMED','ARCHIVED')),
 CHECK(status<>'CONFIRMED' OR (label IS NOT NULL AND length(trim(label))>0 AND meaning IS NOT NULL AND configuration IS NOT NULL))
);

CREATE TABLE stock_check_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
company_id uuid NOT NULL REFERENCES tally_companies(id),item_id integer NOT NULL REFERENCES items(id),
 sales_order_id integer REFERENCES sales_orders(id),requested_quantity numeric(30,6) NOT NULL CHECK(requested_quantity>0),
 stock_in_hand numeric(30,6),reserved_quantity numeric(30,6) CHECK(reserved_quantity>=0),
 free_quantity numeric(30,6) GENERATED ALWAYS AS (stock_in_hand-reserved_quantity) STORED,
 source_session_id uuid REFERENCES tally_upload_sessions(id),source_observed_at timestamptz,
 selected_basis text CHECK(selected_basis IN ('FREE_STOCK','RESERVED_STOCK')),reservation_detail jsonb,
 status text NOT NULL DEFAULT 'UNVERIFIED' CHECK(status IN ('UNVERIFIED','VERIFIED','STALE','REVIEW_REQUIRED')),
 reason text NOT NULL CHECK(length(trim(reason))>=3),
 CHECK(status<>'VERIFIED' OR (stock_in_hand IS NOT NULL AND reserved_quantity IS NOT NULL AND source_observed_at IS NOT NULL AND source_session_id IS NOT NULL AND selected_basis IS NOT NULL))
);

CREATE TABLE packing_boxes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
sales_order_id integer NOT NULL REFERENCES sales_orders(id),shipment_id integer REFERENCES crm_shipments(id),
 box_number text NOT NULL CHECK(length(trim(box_number))>0),notes text,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PACKED','DISPATCHED','CANCELLED','ARCHIVED')),
 UNIQUE(sales_order_id,box_number),UNIQUE(id,sales_order_id),
 FOREIGN KEY(shipment_id,sales_order_id) REFERENCES crm_shipments(id,sales_order_id)
);

CREATE TABLE packing_box_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
box_id uuid NOT NULL,sales_order_id integer NOT NULL REFERENCES sales_orders(id),order_line_id integer NOT NULL,
 quantity numeric(30,6) NOT NULL CHECK(quantity>0),
 FOREIGN KEY(box_id,sales_order_id) REFERENCES packing_boxes(id,sales_order_id),
 FOREIGN KEY(order_line_id,sales_order_id) REFERENCES sales_order_lines(id,sales_order_id),
 UNIQUE(box_id,order_line_id)
);

CREATE TABLE packing_box_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
box_id uuid NOT NULL,sales_order_id integer NOT NULL REFERENCES sales_orders(id),evidence_id integer NOT NULL,
 FOREIGN KEY(box_id,sales_order_id) REFERENCES packing_boxes(id,sales_order_id),
 FOREIGN KEY(evidence_id,sales_order_id) REFERENCES logistics_evidence(id,sales_order_id),UNIQUE(box_id,evidence_id)
);

CREATE TABLE pick_scans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
sales_order_id integer NOT NULL REFERENCES sales_orders(id),order_line_id integer NOT NULL,
 shipment_id integer,box_id uuid,scanned_code text NOT NULL CHECK(length(trim(scanned_code))>0),
 quantity numeric(30,6) NOT NULL CHECK(quantity>0),request_key uuid NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','MATCHED','MISMATCH','REJECTED')),
 FOREIGN KEY(order_line_id,sales_order_id) REFERENCES sales_order_lines(id,sales_order_id),
 FOREIGN KEY(shipment_id,sales_order_id) REFERENCES crm_shipments(id,sales_order_id),
 FOREIGN KEY(box_id,sales_order_id) REFERENCES packing_boxes(id,sales_order_id)
);

CREATE TABLE customer_schedule_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
customer_id integer NOT NULL REFERENCES customers(id),company_id uuid NOT NULL REFERENCES tally_companies(id),
 source_document_id uuid NOT NULL REFERENCES source_documents(id),layout_key text NOT NULL,
 file_sha256 char(64) NOT NULL CHECK(file_sha256 ~ '^[0-9a-f]{64}$'),parser_version text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','APPROVED','REJECTED','FAILED','ARCHIVED')),
 approved_by integer REFERENCES users(id),approval_reason text,CHECK(approved_by IS NULL OR approved_by<>created_by),
 UNIQUE(customer_id,company_id,file_sha256),UNIQUE(id,customer_id)
);

CREATE TABLE customer_open_order_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
import_id uuid NOT NULL,customer_id integer NOT NULL REFERENCES customers(id),
 sales_order_id integer REFERENCES sales_orders(id),order_line_id integer,source_line_key text NOT NULL,
 po_number text NOT NULL,part_code text NOT NULL,schedule_date date,quantity numeric(30,6) NOT NULL CHECK(quantity>=0),
 dispatched_quantity numeric(30,6) CHECK(dispatched_quantity>=0 AND dispatched_quantity<=quantity),
 uom text NOT NULL,raw_row jsonb NOT NULL CHECK(jsonb_typeof(raw_row)='object'),
 status text NOT NULL DEFAULT 'UNMATCHED' CHECK(status IN ('UNMATCHED','MATCHED','PARTIALLY_DISPATCHED','CLOSED','REVIEW_REQUIRED','ARCHIVED')),
 FOREIGN KEY(import_id,customer_id) REFERENCES customer_schedule_imports(id,customer_id),
 FOREIGN KEY(order_line_id,sales_order_id) REFERENCES sales_order_lines(id,sales_order_id) MATCH FULL,
 UNIQUE(import_id,source_line_key)
);

CREATE TABLE vendor_statements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
vendor_id integer NOT NULL REFERENCES crm_procurement_vendors(id),company_id uuid NOT NULL REFERENCES tally_companies(id),
 source_document_id uuid NOT NULL REFERENCES source_documents(id),statement_date date NOT NULL,
 file_sha256 char(64) NOT NULL CHECK(file_sha256 ~ '^[0-9a-f]{64}$'),currency_code char(3) NOT NULL,
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','CONFIRMED','REJECTED','ARCHIVED')),
 approved_by integer REFERENCES users(id),CHECK(approved_by IS NULL OR approved_by<>created_by),
 UNIQUE(vendor_id,company_id,file_sha256),UNIQUE(id,vendor_id)
);

CREATE TABLE vendor_due_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
statement_id uuid NOT NULL,vendor_id integer NOT NULL REFERENCES crm_procurement_vendors(id),
 supplier_po_id integer REFERENCES crm_supplier_pos(id),invoice_number text NOT NULL,source_line_key text NOT NULL,
 invoice_date date,due_date date,amount numeric(30,6) NOT NULL CHECK(amount>=0),currency_code char(3) NOT NULL,
 paid_amount numeric(30,6) CHECK(paid_amount>=0 AND paid_amount<=amount),
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','OPEN','PARTIALLY_PAID','PAID','DISPUTED','ARCHIVED')),
 FOREIGN KEY(statement_id,vendor_id) REFERENCES vendor_statements(id,vendor_id),UNIQUE(statement_id,source_line_key),UNIQUE(id,vendor_id)
);

CREATE TABLE vendor_debit_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
vendor_id integer NOT NULL REFERENCES crm_procurement_vendors(id),due_line_id uuid,
 source_document_id uuid REFERENCES source_documents(id),note_number text NOT NULL,note_date date NOT NULL,
 amount numeric(30,6) NOT NULL CHECK(amount>0),currency_code char(3) NOT NULL,reason text NOT NULL CHECK(length(trim(reason))>=3),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','ARCHIVED')),
 approved_by integer REFERENCES users(id),CHECK(approved_by IS NULL OR approved_by<>created_by),
 FOREIGN KEY(due_line_id,vendor_id) REFERENCES vendor_due_lines(id,vendor_id),UNIQUE(vendor_id,note_number)
);

CREATE TABLE vendor_payment_advices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
vendor_id integer NOT NULL REFERENCES crm_procurement_vendors(id),due_line_id uuid,
 source_document_id uuid REFERENCES source_documents(id),advice_number text NOT NULL,payment_date date NOT NULL,
 amount numeric(30,6) NOT NULL CHECK(amount>0),currency_code char(3) NOT NULL,
 tds_amount numeric(30,6) CHECK(tds_amount>=0 AND tds_amount<=amount),interest_amount numeric(30,6) CHECK(interest_amount>=0),
 transaction_reference text,status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING_APPROVAL','APPROVED','CONFIRMED','REJECTED','ARCHIVED')),
 approved_by integer REFERENCES users(id),CHECK(approved_by IS NULL OR approved_by<>created_by),
 FOREIGN KEY(due_line_id,vendor_id) REFERENCES vendor_due_lines(id,vendor_id),UNIQUE(vendor_id,advice_number)
);

CREATE TABLE bank_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
company_id uuid NOT NULL REFERENCES tally_companies(id),account_reference text NOT NULL,
 currency_code char(3) NOT NULL,status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','INACTIVE','ARCHIVED')),
 UNIQUE(company_id,account_reference),UNIQUE(id,company_id)
);

CREATE TABLE bank_statement_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),source_document_id uuid NOT NULL REFERENCES source_documents(id),
 file_sha256 char(64) NOT NULL CHECK(file_sha256 ~ '^[0-9a-f]{64}$'),layout_key text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','APPROVED','REJECTED','FAILED','ARCHIVED')),
 approved_by integer REFERENCES users(id),CHECK(approved_by IS NULL OR approved_by<>created_by),
 UNIQUE(bank_account_id,file_sha256),UNIQUE(id,bank_account_id)
);

CREATE TABLE bank_statement_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
import_id uuid NOT NULL,bank_account_id uuid NOT NULL REFERENCES bank_accounts(id),source_line_key text NOT NULL,
 transaction_date date NOT NULL,value_date date,direction text NOT NULL CHECK(direction IN ('DEBIT','CREDIT')),
 amount numeric(30,6) NOT NULL CHECK(amount>0),balance numeric(30,6),utr text,narration text,
 raw_row jsonb NOT NULL CHECK(jsonb_typeof(raw_row)='object'),
 status text NOT NULL DEFAULT 'UNMATCHED' CHECK(status IN ('UNMATCHED','PARTIALLY_MATCHED','MATCHED','DISPUTED','ARCHIVED')),
 FOREIGN KEY(import_id,bank_account_id) REFERENCES bank_statement_imports(id,bank_account_id),
 UNIQUE(bank_account_id,source_line_key)
);

CREATE TABLE bank_reconciliation_matches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
statement_line_id uuid NOT NULL REFERENCES bank_statement_lines(id),operation_id uuid NOT NULL REFERENCES crm_operations(id),
 amount numeric(30,6) NOT NULL CHECK(amount>0),reason text NOT NULL CHECK(length(trim(reason))>=3),
 status text NOT NULL DEFAULT 'PROPOSED' CHECK(status IN ('PROPOSED','CONFIRMED','REJECTED','ARCHIVED')),
 confirmed_by integer REFERENCES users(id),confirmed_at timestamptz,
 CHECK(confirmed_by IS NULL OR confirmed_by<>created_by),
 CHECK(status<>'CONFIRMED' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),UNIQUE(statement_line_id,operation_id)
);

CREATE TABLE crm_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
operation_id uuid NOT NULL UNIQUE REFERENCES crm_operations(id),customer_id integer NOT NULL REFERENCES customers(id),
 sales_order_id integer REFERENCES sales_orders(id),source_document_id uuid REFERENCES source_documents(id),
 claim_type text NOT NULL CHECK(claim_type IN ('WARRANTY','SHORTAGE','DAMAGE','RETURN','WRONG_ITEM')),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_PROGRESS','PENDING_APPROVAL','APPROVED','REJECTED','RESOLVED','ARCHIVED')),
 approved_reply_at timestamptz,reply_approved_by integer REFERENCES users(id),
 CHECK(reply_approved_by IS NULL OR reply_approved_by<>created_by)
);

CREATE TABLE kpi_formula_settings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 is_deleted boolean NOT NULL DEFAULT false,deleted_at timestamptz,deleted_by integer REFERENCES users(id),delete_reason text,
 CHECK(NOT is_deleted OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_reason IS NOT NULL AND length(trim(delete_reason))>=3)),
metric_key text NOT NULL UNIQUE,formula jsonb,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 CHECK(formula IS NULL OR jsonb_typeof(formula)='object'),
 status text NOT NULL DEFAULT 'NOT_SET' CHECK(status IN ('NOT_SET','CONFIRMED','ARCHIVED')),
 CHECK(status<>'CONFIRMED' OR formula IS NOT NULL)
);

CREATE TABLE tally_write_category_config (
 category text NOT NULL CHECK(length(trim(category))>0),company_id uuid NOT NULL REFERENCES tally_companies(id),
 direction text CHECK(direction IN ('READ_ONLY','CRM_TO_TALLY','BIDIRECTIONAL')),
 conflict_winner text CHECK(conflict_winner IN ('TALLY','CRM','MANUAL_REVIEW')),
 enabled boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 CHECK(NOT enabled OR (direction IS NOT NULL AND direction<>'READ_ONLY' AND conflict_winner IS NOT NULL)),PRIMARY KEY(category,company_id)
);
CREATE TABLE tally_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),category text NOT NULL,company_id uuid NOT NULL REFERENCES tally_companies(id),
 sales_order_id integer REFERENCES sales_orders(id),idempotency_key text NOT NULL UNIQUE,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),payload_sha256 char(64) NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
 dry_run boolean NOT NULL DEFAULT true CHECK(dry_run),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','DRY_RUN','PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED')),
 approved_by integer REFERENCES users(id),approval_reason text,CHECK(approved_by IS NULL OR approved_by<>created_by),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer REFERENCES users(id),
 FOREIGN KEY(category,company_id) REFERENCES tally_write_category_config(category,company_id)
);
CREATE VIEW kpi_confirmed_events AS
 SELECT 'QUOTATION'::text AS source_type,id::text AS event_key,quotation_id::text AS record_key,
 created_by AS actor_id,created_at,action FROM crm_quotation_events WHERE action='APPROVE'
 UNION ALL SELECT 'ORDER',id::text,sales_order_id::text,created_by,created_at,action
 FROM crm_order_events WHERE action IN ('APPROVE','DISPATCHED','DELIVERED')
 UNION ALL SELECT 'OPERATION',id::text,record_id::text,actor_id,created_at,action
 FROM crm_operation_events WHERE action IN ('APPROVE','CONFIRM','RESOLVE');
CREATE FUNCTION s0_foundation_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer; why text;
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'Archive with a reason; hard deletion is forbidden'; END IF;
 actor:=NULLIF(current_setting('mehta.actor_id',true),'')::integer;
 why:=NULLIF(current_setting('mehta.audit_reason',true),'');
 IF actor IS NULL OR length(trim(coalesce(why,'')))<3 THEN RAISE EXCEPTION 'Audit actor and reason are required'; END IF;
 IF TG_OP='INSERT' AND NEW.created_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Creator must match the audit actor'; END IF;
 IF to_jsonb(NEW)->>'status' IN ('APPROVED','CONFIRMED')
    AND (TG_OP='INSERT' OR to_jsonb(NEW)->>'status' IS DISTINCT FROM to_jsonb(OLD)->>'status')
    AND (to_jsonb(NEW) ? 'approved_by' OR to_jsonb(NEW) ? 'confirmed_by')
    AND coalesce(to_jsonb(NEW)->>'approved_by',to_jsonb(NEW)->>'confirmed_by') IS DISTINCT FROM actor::text THEN
   RAISE EXCEPTION 'The actual audit actor must be the independent reviewer';
 END IF;

 IF TG_OP='UPDATE' THEN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'Creation provenance is immutable'; END IF;
  NEW.updated_by:=actor;NEW.updated_at:=clock_timestamp();
 END IF;
 INSERT INTO audit_logs(user_id,entity,record_id,action,old_value,new_value,reason)
 VALUES(actor,TG_TABLE_NAME,coalesce(to_jsonb(NEW)->>'id',to_jsonb(NEW)->>'category'),TG_OP,
 CASE WHEN TG_OP='UPDATE' THEN row_to_json(OLD)::text END,row_to_json(NEW)::text,why);
 RETURN NEW;
END $$;
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON item_pack_factors FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON item_pack_factors FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON crm_price_levels FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON crm_price_levels FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON stock_check_log FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON stock_check_log FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON packing_boxes FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON packing_boxes FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON packing_box_items FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON packing_box_items FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON packing_box_photos FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON packing_box_photos FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON pick_scans FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON pick_scans FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON customer_schedule_imports FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON customer_schedule_imports FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON customer_open_order_lines FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON customer_open_order_lines FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON vendor_statements FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON vendor_statements FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON vendor_due_lines FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON vendor_due_lines FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON vendor_debit_notes FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON vendor_debit_notes FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON vendor_payment_advices FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON vendor_payment_advices FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON bank_accounts FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON bank_accounts FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON bank_statement_imports FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON bank_statement_imports FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON bank_statement_lines FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON bank_statement_lines FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON bank_reconciliation_matches FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON bank_reconciliation_matches FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON crm_claims FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON crm_claims FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON kpi_formula_settings FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON kpi_formula_settings FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON tally_outbox FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON tally_outbox FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_audit BEFORE INSERT OR UPDATE OR DELETE ON tally_write_category_config FOR EACH ROW EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_foundation_no_truncate BEFORE TRUNCATE ON tally_write_category_config FOR EACH STATEMENT EXECUTE FUNCTION s0_foundation_audit_guard();
CREATE TRIGGER s0_append_only BEFORE UPDATE ON stock_check_log FOR EACH ROW EXECUTE FUNCTION f1_append_only();
CREATE TRIGGER s0_append_only BEFORE UPDATE ON pick_scans FOR EACH ROW EXECUTE FUNCTION f1_append_only();
CREATE FUNCTION s0_packing_photo_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM logistics_evidence WHERE id=NEW.evidence_id AND sales_order_id=NEW.sales_order_id AND photo_bytes IS NOT NULL) THEN
 RAISE EXCEPTION 'A retained photo for this order is required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER s0_packing_photo BEFORE INSERT OR UPDATE ON packing_box_photos FOR EACH ROW EXECUTE FUNCTION s0_packing_photo_guard();
CREATE UNIQUE INDEX s0_bank_utr ON bank_statement_lines(bank_account_id,utr) WHERE utr IS NOT NULL AND length(trim(utr))>0 AND NOT is_deleted;
CREATE INDEX s0_stock_check_daily ON stock_check_log(company_id,created_at,created_by);
CREATE INDEX s0_schedule_late ON customer_open_order_lines(customer_id,schedule_date) WHERE status IN ('MATCHED','PARTIALLY_DISPATCHED') AND NOT is_deleted;
CREATE INDEX s0_vendor_open_due ON vendor_due_lines(vendor_id,due_date) WHERE status IN ('OPEN','PARTIALLY_PAID') AND NOT is_deleted;
CREATE INDEX s0_bank_unmatched ON bank_statement_lines(bank_account_id,transaction_date) WHERE status IN ('UNMATCHED','PARTIALLY_MATCHED') AND NOT is_deleted;

INSERT INTO audit_logs(entity,record_id,action,reason,new_value) VALUES('SCHEMA_MIGRATION','0040_workflow_foundations','MIGRATION','S0 additive reserved workflow tables; no business rows, business defaults or automation activation','{"foundationOnly":true,"tallyLiveWritesAllowed":false}');

ALTER TABLE item_pack_factors ADD COLUMN approved_at timestamptz;
ALTER TABLE item_pack_factors ADD CONSTRAINT s0_item_pack_factors_review CHECK(status NOT IN ('APPROVED','CONFIRMED') OR (approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL AND approval_reason IS NOT NULL AND length(trim(approval_reason))>=3));
ALTER TABLE customer_schedule_imports ADD COLUMN approved_at timestamptz;
ALTER TABLE customer_schedule_imports ADD CONSTRAINT s0_customer_schedule_imports_review CHECK(status NOT IN ('APPROVED','CONFIRMED') OR (approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL AND approval_reason IS NOT NULL AND length(trim(approval_reason))>=3));
ALTER TABLE vendor_statements ADD COLUMN approval_reason text;
ALTER TABLE vendor_statements ADD COLUMN approved_at timestamptz;
ALTER TABLE vendor_statements ADD CONSTRAINT s0_vendor_statements_review CHECK(status NOT IN ('APPROVED','CONFIRMED') OR (approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL AND approval_reason IS NOT NULL AND length(trim(approval_reason))>=3));
ALTER TABLE vendor_debit_notes ADD COLUMN approval_reason text;
ALTER TABLE vendor_debit_notes ADD COLUMN approved_at timestamptz;
ALTER TABLE vendor_debit_notes ADD CONSTRAINT s0_vendor_debit_notes_review CHECK(status NOT IN ('APPROVED','CONFIRMED') OR (approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL AND approval_reason IS NOT NULL AND length(trim(approval_reason))>=3));
ALTER TABLE vendor_payment_advices ADD COLUMN approval_reason text;
ALTER TABLE vendor_payment_advices ADD COLUMN approved_at timestamptz;
ALTER TABLE vendor_payment_advices ADD CONSTRAINT s0_vendor_payment_advices_review CHECK(status NOT IN ('APPROVED','CONFIRMED') OR (approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL AND approval_reason IS NOT NULL AND length(trim(approval_reason))>=3));
ALTER TABLE bank_statement_imports ADD COLUMN approval_reason text;
ALTER TABLE bank_statement_imports ADD COLUMN approved_at timestamptz;
ALTER TABLE bank_statement_imports ADD CONSTRAINT s0_bank_statement_imports_review CHECK(status NOT IN ('APPROVED','CONFIRMED') OR (approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL AND approval_reason IS NOT NULL AND length(trim(approval_reason))>=3));
ALTER TABLE tally_outbox ADD COLUMN approved_at timestamptz;
ALTER TABLE tally_outbox ADD CONSTRAINT s0_tally_outbox_review CHECK(status NOT IN ('APPROVED','CONFIRMED') OR (approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL AND approval_reason IS NOT NULL AND length(trim(approval_reason))>=3));

-- Composite identity checks prevent retaining a relationship under the wrong party.
ALTER TABLE sales_orders ADD CONSTRAINT s0_sales_order_customer_identity UNIQUE(id,customer_id);
ALTER TABLE crm_supplier_pos ADD CONSTRAINT s0_supplier_po_vendor_identity UNIQUE(id,vendor_id);
ALTER TABLE crm_operations ADD CONSTRAINT s0_operation_customer_identity UNIQUE(id,customer_id);
ALTER TABLE customer_open_order_lines ADD CONSTRAINT s0_customer_schedule_order_fk FOREIGN KEY(sales_order_id,customer_id) REFERENCES sales_orders(id,customer_id);
ALTER TABLE vendor_due_lines ADD CONSTRAINT s0_vendor_due_po_fk FOREIGN KEY(supplier_po_id,vendor_id) REFERENCES crm_supplier_pos(id,vendor_id);
ALTER TABLE crm_claims ADD CONSTRAINT s0_claim_customer_fk FOREIGN KEY(operation_id,customer_id) REFERENCES crm_operations(id,customer_id);
ALTER TABLE crm_claims ADD COLUMN approved_by integer REFERENCES users(id), ADD COLUMN approved_at timestamptz, ADD COLUMN approval_reason text;
ALTER TABLE crm_claims ADD CONSTRAINT s0_claim_decision CHECK(status<>'APPROVED' OR (approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL AND approval_reason IS NOT NULL AND length(trim(approval_reason))>=3));
