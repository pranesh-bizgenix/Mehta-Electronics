-- Additive target-domain schema. Existing CRM contracts remain unchanged.
-- Pending commercial and accounting policies are intentionally not enforced here.

CREATE TABLE brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  principal_party_id uuid REFERENCES parties(id),
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id)
);
CREATE INDEX brands_name_idx ON brands(name);
CREATE INDEX brands_principal_idx ON brands(principal_party_id);

CREATE TABLE units_of_measure (
  code citext PRIMARY KEY,
  name text NOT NULL,
  dimension text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unit_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_uom_code citext NOT NULL REFERENCES units_of_measure(code),
  to_uom_code citext NOT NULL REFERENCES units_of_measure(code),
  conversion_factor numeric(30,12) NOT NULL CHECK(conversion_factor > 0),
  valid_from date,
  valid_to date,
  source_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id)
);
CREATE INDEX unit_conversions_lookup_idx ON unit_conversions(from_uom_code,to_uom_code);

ALTER TABLE parts
  ADD COLUMN brand_id uuid REFERENCES brands(id),
  ADD COLUMN base_uom_code citext REFERENCES units_of_measure(code);
CREATE INDEX parts_brand_id_idx ON parts(brand_id);
CREATE INDEX parts_base_uom_code_idx ON parts(base_uom_code);

CREATE TABLE party_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id),
  identifier_type text NOT NULL,
  identifier_value text NOT NULL,
  issuer_scope text,
  source_system text,
  valid_from date,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id)
);
CREATE INDEX party_identifiers_party_idx ON party_identifiers(party_id);
CREATE INDEX party_identifiers_lookup_idx ON party_identifiers(identifier_type,identifier_value);

CREATE TABLE party_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id),
  name text NOT NULL,
  designation text,
  email citext,
  phone text,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  valid_from date,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id)
);
CREATE INDEX party_contacts_party_idx ON party_contacts(party_id);
CREATE INDEX party_contacts_email_idx ON party_contacts(email) WHERE email IS NOT NULL;

CREATE TABLE party_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id),
  address_type text NOT NULL,
  line_1 text,
  line_2 text,
  city text,
  district text,
  state text,
  postal_code text,
  country_code text,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  valid_from date,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id)
);
CREATE INDEX party_addresses_party_idx ON party_addresses(party_id);
CREATE INDEX party_addresses_postal_idx ON party_addresses(postal_code);

CREATE TABLE part_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES parts(id),
  identifier_type text NOT NULL,
  identifier_value text NOT NULL,
  party_id uuid REFERENCES parties(id),
  company_id uuid REFERENCES tally_companies(id),
  source_system text,
  valid_from date,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id)
);
CREATE INDEX part_identifiers_part_idx ON part_identifiers(part_id);
CREATE INDEX part_identifiers_lookup_idx ON part_identifiers(identifier_type,identifier_value);
CREATE INDEX part_identifiers_party_idx ON part_identifiers(party_id) WHERE party_id IS NOT NULL;
CREATE INDEX part_identifiers_company_idx ON part_identifiers(company_id) WHERE company_id IS NOT NULL;

CREATE TABLE source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_sha256 char(64) NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
  document_type text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  byte_count bigint NOT NULL CHECK(byte_count >= 0),
  storage_reference text NOT NULL,
  issuer_party_id uuid REFERENCES parties(id),
  ingestion_source text,
  ingestion_reference text,
  lifecycle_state text NOT NULL DEFAULT 'RECEIVED',
  ingested_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id)
);
CREATE INDEX source_documents_hash_idx ON source_documents(content_sha256);
CREATE INDEX source_documents_type_time_idx ON source_documents(document_type,ingested_at DESC);
CREATE INDEX source_documents_issuer_idx ON source_documents(issuer_party_id) WHERE issuer_party_id IS NOT NULL;

ALTER TABLE customer_pos
  ADD COLUMN source_document_id uuid REFERENCES source_documents(id);
CREATE INDEX customer_pos_source_document_idx ON customer_pos(source_document_id) WHERE source_document_id IS NOT NULL;
ALTER TABLE customer_po_lines
  ADD COLUMN source_rate numeric(20,6),
  ADD COLUMN source_tax jsonb,
  ADD COLUMN source_line_total numeric(20,6),
  ADD COLUMN source_row_reference text;
ALTER TABLE po_line_schedules
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN source_reference text;

CREATE TABLE price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_party_id uuid REFERENCES parties(id),
  brand_id uuid REFERENCES brands(id),
  name text NOT NULL,
  currency_code char(3),
  version integer NOT NULL,
  valid_from date,
  valid_to date,
  status text NOT NULL DEFAULT 'DRAFT',
  source_document_id uuid REFERENCES source_documents(id),
  source_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id)
);
CREATE INDEX price_lists_owner_validity_idx ON price_lists(owner_party_id,valid_from,valid_to);
CREATE INDEX price_lists_brand_validity_idx ON price_lists(brand_id,valid_from,valid_to);

CREATE TABLE price_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id uuid NOT NULL REFERENCES price_lists(id),
  part_id uuid REFERENCES parts(id),
  source_part_identifier text,
  list_price numeric(20,6),
  discount_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  net_price numeric(20,6),
  currency_code char(3),
  valid_from date,
  valid_to date,
  source_row_number integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  CHECK(jsonb_typeof(discount_components)='array')
);
CREATE INDEX price_list_items_list_part_idx ON price_list_items(price_list_id,part_id);
CREATE INDEX price_list_items_source_part_idx ON price_list_items(source_part_identifier) WHERE source_part_identifier IS NOT NULL;

CREATE TABLE price_list_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid NOT NULL REFERENCES source_documents(id),
  target_price_list_id uuid REFERENCES price_lists(id),
  source_format text,
  parser_name text,
  parser_version text,
  status text NOT NULL DEFAULT 'RECEIVED',
  reviewed_by integer REFERENCES users(id),
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id)
);
CREATE INDEX price_list_imports_document_idx ON price_list_imports(source_document_id);
CREATE INDEX price_list_imports_status_idx ON price_list_imports(status,created_at DESC);

CREATE TABLE price_list_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES price_list_imports(id),
  row_number integer NOT NULL,
  raw_row jsonb NOT NULL,
  parsed_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_state text NOT NULL DEFAULT 'PENDING',
  validation_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  part_id uuid REFERENCES parts(id),
  accepted_price_list_item_id uuid REFERENCES price_list_items(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(raw_row) IN ('object','array')),
  CHECK(jsonb_typeof(parsed_fields)='object'),
  CHECK(jsonb_typeof(validation_messages)='array')
);
CREATE INDEX price_list_import_rows_import_idx ON price_list_import_rows(import_id,row_number);
CREATE INDEX price_list_import_rows_state_idx ON price_list_import_rows(validation_state);

CREATE TABLE supplier_po_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_po_id integer NOT NULL REFERENCES crm_supplier_pos(id),
  line_number integer NOT NULL,
  part_id uuid REFERENCES parts(id),
  supplier_part_number text,
  description text,
  quantity numeric(20,6),
  uom_code citext REFERENCES units_of_measure(code),
  source_uom text,
  unit_price numeric(20,6),
  currency_code char(3),
  tax_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_line_reference text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  CHECK(jsonb_typeof(tax_components)='array')
);
CREATE INDEX supplier_po_lines_po_idx ON supplier_po_lines(supplier_po_id,line_number);
CREATE INDEX supplier_po_lines_part_idx ON supplier_po_lines(part_id) WHERE part_id IS NOT NULL;

CREATE TABLE purchase_request_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id integer NOT NULL REFERENCES crm_purchase_requests(id),
  sales_order_line_id integer REFERENCES sales_order_lines(id),
  line_number integer,
  part_id uuid REFERENCES parts(id),
  description text,
  quantity numeric(20,6),
  uom_code citext REFERENCES units_of_measure(code),
  source_part_number text,
  source_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  CHECK(jsonb_typeof(source_values)='object')
);
CREATE INDEX purchase_request_lines_request_idx ON purchase_request_lines(purchase_request_id,line_number);
CREATE INDEX purchase_request_lines_order_line_idx ON purchase_request_lines(sales_order_line_id) WHERE sales_order_line_id IS NOT NULL;

CREATE TABLE rfq_vendor_reply_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reply_id integer NOT NULL REFERENCES crm_rfq_vendor_replies(id),
  line_number integer,
  part_id uuid REFERENCES parts(id),
  description text,
  quantity numeric(20,6),
  uom_code citext REFERENCES units_of_measure(code),
  quoted_unit_price numeric(20,6),
  currency_code char(3),
  tax_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  lead_time jsonb,
  validity_date date,
  source_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  CHECK(jsonb_typeof(tax_components)='array'),
  CHECK(jsonb_typeof(source_values)='object')
);
CREATE INDEX rfq_vendor_reply_lines_reply_idx ON rfq_vendor_reply_lines(reply_id,line_number);
CREATE INDEX rfq_vendor_reply_lines_part_idx ON rfq_vendor_reply_lines(part_id) WHERE part_id IS NOT NULL;

CREATE TABLE supplier_po_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_po_line_id uuid NOT NULL REFERENCES supplier_po_lines(id),
  schedule_number integer NOT NULL,
  schedule_date date,
  quantity numeric(20,6),
  version integer NOT NULL DEFAULT 1,
  source_reference text,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id)
);
CREATE INDEX supplier_po_schedules_line_idx ON supplier_po_schedules(supplier_po_line_id,schedule_number);

CREATE TABLE supplier_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_po_id integer NOT NULL REFERENCES crm_supplier_pos(id),
  acceptance_number text,
  supplier_reference text,
  acceptance_date date,
  source_total numeric(20,6),
  round_off numeric(20,6),
  currency_code char(3),
  source_document_id uuid REFERENCES source_documents(id),
  legacy_supplier_document_id integer UNIQUE REFERENCES crm_supplier_documents(id),
  status text NOT NULL DEFAULT 'RECEIVED',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id)
);
CREATE INDEX supplier_acceptances_po_idx ON supplier_acceptances(supplier_po_id,acceptance_date);
CREATE INDEX supplier_acceptances_document_idx ON supplier_acceptances(source_document_id) WHERE source_document_id IS NOT NULL;

CREATE TABLE acceptance_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acceptance_id uuid NOT NULL REFERENCES supplier_acceptances(id),
  supplier_po_line_id uuid REFERENCES supplier_po_lines(id),
  line_number integer,
  source_line_reference text,
  quantity numeric(20,6),
  uom_code citext REFERENCES units_of_measure(code),
  net_price numeric(20,6),
  currency_code char(3),
  source_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  CHECK(jsonb_typeof(source_values)='object')
);
CREATE INDEX acceptance_lines_acceptance_idx ON acceptance_lines(acceptance_id,line_number);
CREATE INDEX acceptance_lines_po_line_idx ON acceptance_lines(supplier_po_line_id) WHERE supplier_po_line_id IS NOT NULL;

CREATE TABLE goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_grn_id integer UNIQUE REFERENCES crm_grns(id),
  supplier_po_id integer NOT NULL REFERENCES crm_supplier_pos(id),
  receipt_number text,
  receipt_date date,
  source_document_id uuid REFERENCES source_documents(id),
  status text NOT NULL DEFAULT 'RECEIVED',
  version integer NOT NULL DEFAULT 1,
  reviewed_by integer REFERENCES users(id),
  reviewed_at timestamptz,
  posted_by integer REFERENCES users(id),
  posted_at timestamptz,
  review_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  CHECK(jsonb_typeof(review_evidence)='object')
);
CREATE INDEX goods_receipts_po_idx ON goods_receipts(supplier_po_id,receipt_date);
CREATE INDEX goods_receipts_status_idx ON goods_receipts(status,created_at DESC);

CREATE TABLE goods_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goods_receipt_id uuid NOT NULL REFERENCES goods_receipts(id),
  supplier_po_line_id uuid REFERENCES supplier_po_lines(id),
  line_number integer,
  part_id uuid REFERENCES parts(id),
  description text,
  received_quantity numeric(20,6),
  accepted_quantity numeric(20,6),
  rejected_quantity numeric(20,6),
  uom_code citext REFERENCES units_of_measure(code),
  actual_unit_price numeric(20,6),
  currency_code char(3),
  tax_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_line_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  CHECK(jsonb_typeof(tax_components)='array')
);
CREATE INDEX goods_receipt_lines_receipt_idx ON goods_receipt_lines(goods_receipt_id,line_number);
CREATE INDEX goods_receipt_lines_po_line_idx ON goods_receipt_lines(supplier_po_line_id) WHERE supplier_po_line_id IS NOT NULL;

CREATE TABLE supply_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_line_id integer NOT NULL REFERENCES sales_order_lines(id),
  supplier_po_line_id uuid NOT NULL REFERENCES supplier_po_lines(id),
  allocated_quantity numeric(20,6) NOT NULL,
  uom_code citext REFERENCES units_of_measure(code),
  status text NOT NULL DEFAULT 'ACTIVE',
  version integer NOT NULL DEFAULT 1,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id)
);
CREATE INDEX supply_allocations_order_line_idx ON supply_allocations(sales_order_line_id,status);
CREATE INDEX supply_allocations_supplier_line_idx ON supply_allocations(supplier_po_line_id,status);

CREATE TABLE sales_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer_party_id uuid REFERENCES parties(id),
  customer_party_id uuid REFERENCES parties(id),
  invoice_number text NOT NULL,
  invoice_date date,
  currency_code char(3),
  source_system text,
  source_company_id uuid REFERENCES tally_companies(id),
  source_voucher_id text,
  source_voucher_key text,
  source_document_id uuid REFERENCES source_documents(id),
  supplied_subtotal numeric(20,6),
  supplied_tax_total numeric(20,6),
  supplied_total numeric(20,6),
  calculated_subtotal numeric(20,6),
  calculated_tax_total numeric(20,6),
  calculated_total numeric(20,6),
  status text NOT NULL DEFAULT 'RECORDED',
  cancellation_reference text,
  amended_invoice_id uuid REFERENCES sales_invoices(id),
  version integer NOT NULL DEFAULT 1,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  CHECK(jsonb_typeof(source_snapshot)='object')
);
CREATE INDEX sales_invoices_customer_date_idx ON sales_invoices(customer_party_id,invoice_date DESC);
CREATE INDEX sales_invoices_issuer_number_idx ON sales_invoices(issuer_party_id,invoice_number);
CREATE INDEX sales_invoices_source_key_idx ON sales_invoices(source_company_id,source_voucher_key) WHERE source_voucher_key IS NOT NULL;
CREATE INDEX sales_invoices_status_date_idx ON sales_invoices(status,invoice_date DESC);

CREATE TABLE invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES sales_invoices(id),
  sales_order_line_id integer REFERENCES sales_order_lines(id),
  part_id uuid REFERENCES parts(id),
  line_number integer,
  description text,
  source_part_number text,
  quantity numeric(20,6),
  uom_code citext REFERENCES units_of_measure(code),
  source_uom text,
  unit_price numeric(20,6),
  discount_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  tax_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  charge_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  supplied_line_total numeric(20,6),
  calculated_line_total numeric(20,6),
  source_line_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  CHECK(jsonb_typeof(discount_components)='array'),
  CHECK(jsonb_typeof(tax_components)='array'),
  CHECK(jsonb_typeof(charge_components)='array')
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines(invoice_id,line_number);
CREATE INDEX invoice_lines_order_line_idx ON invoice_lines(sales_order_line_id) WHERE sales_order_line_id IS NOT NULL;
CREATE INDEX invoice_lines_part_idx ON invoice_lines(part_id) WHERE part_id IS NOT NULL;

CREATE TABLE dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_shipment_id integer UNIQUE REFERENCES crm_shipments(id),
  sales_order_id integer REFERENCES sales_orders(id),
  transporter_party_id uuid REFERENCES parties(id),
  lr_number text,
  lr_date date,
  vehicle_number text,
  eway_bill_number text,
  status text NOT NULL DEFAULT 'RECORDED',
  source_document_id uuid REFERENCES source_documents(id),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id)
);
CREATE INDEX dispatches_order_idx ON dispatches(sales_order_id,lr_date DESC);
CREATE INDEX dispatches_transporter_idx ON dispatches(transporter_party_id,lr_date DESC);
CREATE INDEX dispatches_lr_search_idx ON dispatches(upper(lr_number)) WHERE lr_number IS NOT NULL;

CREATE TABLE dispatch_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES dispatches(id),
  invoice_line_id uuid REFERENCES invoice_lines(id),
  sales_order_line_id integer REFERENCES sales_order_lines(id),
  line_number integer,
  quantity numeric(20,6),
  uom_code citext REFERENCES units_of_measure(code),
  source_line_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id)
);
CREATE INDEX dispatch_lines_dispatch_idx ON dispatch_lines(dispatch_id,line_number);
CREATE INDEX dispatch_lines_invoice_line_idx ON dispatch_lines(invoice_line_id) WHERE invoice_line_id IS NOT NULL;
CREATE INDEX dispatch_lines_order_line_idx ON dispatch_lines(sales_order_line_id) WHERE sales_order_line_id IS NOT NULL;

CREATE TABLE tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES dispatches(id),
  source text NOT NULL,
  source_event_id text,
  idempotency_key text,
  status text NOT NULL,
  event_at timestamptz NOT NULL,
  location text,
  evidence_reference text,
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id integer REFERENCES users(id),
  CHECK(jsonb_typeof(event_payload)='object')
);
CREATE INDEX tracking_events_dispatch_time_idx ON tracking_events(dispatch_id,event_at DESC);
CREATE INDEX tracking_events_source_event_idx ON tracking_events(source,source_event_id) WHERE source_event_id IS NOT NULL;

CREATE TABLE delivery_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES dispatches(id),
  confirmed_at timestamptz NOT NULL,
  confirmed_by integer REFERENCES users(id),
  proof_document_id uuid REFERENCES source_documents(id),
  reason text,
  confirmation_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(confirmation_payload)='object')
);
CREATE INDEX delivery_confirmations_dispatch_idx ON delivery_confirmations(dispatch_id,confirmed_at DESC);

CREATE TABLE extraction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES source_documents(id),
  engine_name text NOT NULL,
  engine_version text,
  model_name text,
  model_version text,
  run_at timestamptz NOT NULL DEFAULT now(),
  raw_result jsonb NOT NULL,
  result_sha256 char(64) CHECK(result_sha256 IS NULL OR result_sha256 ~ '^[0-9a-f]{64}$'),
  validation_outcome jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'COMPLETED',
  created_by integer REFERENCES users(id),
  CHECK(jsonb_typeof(validation_outcome)='object')
);
CREATE INDEX extraction_runs_document_time_idx ON extraction_runs(document_id,run_at DESC);

CREATE TABLE extracted_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES extraction_runs(id),
  field_name text NOT NULL,
  raw_value jsonb,
  normalized_value jsonb,
  confidence numeric(12,8),
  page_number integer,
  region jsonb,
  validation_state text NOT NULL DEFAULT 'UNREVIEWED',
  validation_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(validation_details)='object')
);
CREATE INDEX extracted_fields_run_idx ON extracted_fields(run_id,field_name);
CREATE INDEX extracted_fields_state_idx ON extracted_fields(validation_state);

CREATE TABLE document_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES source_documents(id),
  extraction_run_id uuid REFERENCES extraction_runs(id),
  reviewer_id integer NOT NULL REFERENCES users(id),
  decision text NOT NULL,
  reason text,
  review_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(review_payload)='object')
);
CREATE INDEX document_reviews_document_time_idx ON document_reviews(document_id,reviewed_at DESC);

CREATE TABLE field_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extracted_field_id uuid NOT NULL REFERENCES extracted_fields(id),
  prior_value jsonb,
  corrected_value jsonb NOT NULL,
  reviewer_id integer NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  corrected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX field_corrections_field_time_idx ON field_corrections(extracted_field_id,corrected_at DESC);

CREATE TABLE document_customer_po_links (
  source_document_id uuid NOT NULL REFERENCES source_documents(id),
  customer_po_id uuid NOT NULL REFERENCES customer_pos(id),
  association_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  PRIMARY KEY(source_document_id,customer_po_id,association_role)
);
CREATE TABLE document_supplier_po_links (
  source_document_id uuid NOT NULL REFERENCES source_documents(id),
  supplier_po_id integer NOT NULL REFERENCES crm_supplier_pos(id),
  association_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  PRIMARY KEY(source_document_id,supplier_po_id,association_role)
);
CREATE TABLE document_acceptance_links (
  source_document_id uuid NOT NULL REFERENCES source_documents(id),
  acceptance_id uuid NOT NULL REFERENCES supplier_acceptances(id),
  association_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  PRIMARY KEY(source_document_id,acceptance_id,association_role)
);
CREATE TABLE document_invoice_links (
  source_document_id uuid NOT NULL REFERENCES source_documents(id),
  invoice_id uuid NOT NULL REFERENCES sales_invoices(id),
  association_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  PRIMARY KEY(source_document_id,invoice_id,association_role)
);
CREATE TABLE document_dispatch_links (
  source_document_id uuid NOT NULL REFERENCES source_documents(id),
  dispatch_id uuid NOT NULL REFERENCES dispatches(id),
  association_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  PRIMARY KEY(source_document_id,dispatch_id,association_role)
);
CREATE TABLE document_order_links (
  source_document_id uuid NOT NULL REFERENCES source_documents(id),
  sales_order_id integer NOT NULL REFERENCES sales_orders(id),
  association_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  PRIMARY KEY(source_document_id,sales_order_id,association_role)
);
CREATE TABLE document_enquiry_links (
  source_document_id uuid NOT NULL REFERENCES source_documents(id),
  enquiry_id integer NOT NULL REFERENCES enquiries(id),
  association_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  PRIMARY KEY(source_document_id,enquiry_id,association_role)
);
CREATE TABLE document_quotation_links (
  source_document_id uuid NOT NULL REFERENCES source_documents(id),
  quotation_id integer NOT NULL REFERENCES quotations(id),
  association_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  PRIMARY KEY(source_document_id,quotation_id,association_role)
);
CREATE TABLE document_purchase_request_links (
  source_document_id uuid NOT NULL REFERENCES source_documents(id),
  purchase_request_id integer NOT NULL REFERENCES crm_purchase_requests(id),
  association_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  PRIMARY KEY(source_document_id,purchase_request_id,association_role)
);
CREATE TABLE document_rfq_links (
  source_document_id uuid NOT NULL REFERENCES source_documents(id),
  rfq_id integer NOT NULL REFERENCES crm_rfqs(id),
  association_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  PRIMARY KEY(source_document_id,rfq_id,association_role)
);
CREATE TABLE document_goods_receipt_links (
  source_document_id uuid NOT NULL REFERENCES source_documents(id),
  goods_receipt_id uuid NOT NULL REFERENCES goods_receipts(id),
  association_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  PRIMARY KEY(source_document_id,goods_receipt_id,association_role)
);

CREATE TABLE tally_sync_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES tally_sync_jobs(id),
  company_id uuid NOT NULL REFERENCES tally_companies(id),
  entity_kind text NOT NULL,
  external_id text NOT NULL,
  source_version text,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  error_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(error_detail)='object')
);
CREATE UNIQUE INDEX tally_sync_job_items_idempotency_idx ON tally_sync_job_items(job_id,idempotency_key);
CREATE INDEX tally_sync_job_items_entity_idx ON tally_sync_job_items(company_id,entity_kind,external_id);
CREATE INDEX tally_sync_job_items_status_idx ON tally_sync_job_items(status,created_at);

CREATE TABLE tally_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES tally_companies(id),
  job_item_id uuid REFERENCES tally_sync_job_items(id),
  party_mapping_id uuid REFERENCES party_external_mappings(id),
  part_mapping_id uuid REFERENCES part_external_mappings(id),
  entity_kind text NOT NULL,
  external_id text NOT NULL,
  conflict_type text NOT NULL,
  source_snapshot jsonb NOT NULL,
  crm_snapshot jsonb,
  status text NOT NULL DEFAULT 'OPEN',
  resolution text,
  resolution_reason text,
  resolved_by integer REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id)
);
CREATE INDEX tally_conflicts_company_status_idx ON tally_conflicts(company_id,status,created_at DESC);
CREATE INDEX tally_conflicts_job_item_idx ON tally_conflicts(job_item_id) WHERE job_item_id IS NOT NULL;

CREATE TABLE tally_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES tally_companies(id),
  job_id uuid REFERENCES tally_sync_jobs(id),
  entity_kind text NOT NULL,
  period_start date,
  period_end date,
  source_snapshot jsonb NOT NULL,
  result_summary jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_REVIEW',
  reviewed_by integer REFERENCES users(id),
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  CHECK(jsonb_typeof(result_summary)='object')
);
CREATE INDEX tally_reconciliations_company_time_idx ON tally_reconciliations(company_id,created_at DESC);
CREATE INDEX tally_reconciliations_status_idx ON tally_reconciliations(status,created_at DESC);

CREATE TABLE workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  owner_user_id integer REFERENCES users(id),
  status text NOT NULL DEFAULT 'DRAFT',
  active_version uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id)
);

CREATE TABLE workflow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id uuid NOT NULL REFERENCES workflow_definitions(id),
  version integer NOT NULL,
  trigger_type text NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_reference text,
  status text NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  UNIQUE(workflow_definition_id,version),
  UNIQUE(id,workflow_definition_id),
  CHECK(jsonb_typeof(configuration)='object')
);
ALTER TABLE workflow_definitions
  ADD CONSTRAINT workflow_definitions_active_version_fk
  FOREIGN KEY(active_version) REFERENCES workflow_versions(id);

CREATE TABLE workflow_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id uuid NOT NULL REFERENCES workflow_definitions(id),
  workflow_version_id uuid NOT NULL REFERENCES workflow_versions(id),
  idempotency_key text NOT NULL,
  trigger_reference text,
  input_snapshot jsonb NOT NULL,
  input_sha256 char(64),
  status text NOT NULL DEFAULT 'QUEUED',
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  last_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workflow_version_id,idempotency_key),
  FOREIGN KEY(workflow_version_id,workflow_definition_id)
    REFERENCES workflow_versions(id,workflow_definition_id),
  CHECK(input_sha256 IS NULL OR input_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX workflow_executions_status_idx ON workflow_executions(status,created_at);
CREATE INDEX workflow_executions_definition_idx ON workflow_executions(workflow_definition_id,created_at DESC);

CREATE TABLE workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES workflow_executions(id),
  step_key text NOT NULL,
  attempt_number integer NOT NULL,
  status text NOT NULL,
  input_snapshot jsonb,
  result_snapshot jsonb,
  error_detail jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(execution_id,step_key,attempt_number)
);
CREATE INDEX workflow_steps_execution_idx ON workflow_steps(execution_id,created_at);

CREATE TABLE approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type text NOT NULL,
  requested_by integer NOT NULL REFERENCES users(id),
  payload_fingerprint char(64) NOT NULL CHECK(payload_fingerprint ~ '^[0-9a-f]{64}$'),
  record_version integer,
  payload_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(payload_snapshot)='object')
);
CREATE INDEX approval_requests_status_idx ON approval_requests(status,created_at);
CREATE INDEX approval_requests_requester_idx ON approval_requests(requested_by,created_at DESC);

CREATE TABLE approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_request_id uuid NOT NULL REFERENCES approval_requests(id),
  decision text NOT NULL,
  decided_by integer NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  payload_fingerprint char(64) NOT NULL CHECK(payload_fingerprint ~ '^[0-9a-f]{64}$'),
  decided_at timestamptz NOT NULL DEFAULT now(),
  decision_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK(jsonb_typeof(decision_metadata)='object')
);
CREATE INDEX approval_decisions_request_idx ON approval_decisions(approval_request_id,decided_at DESC);

CREATE TABLE email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  mailbox_address citext NOT NULL,
  provider_account_id text,
  secret_reference text,
  granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'DISABLED',
  connected_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  CHECK(jsonb_typeof(granted_scopes)='array')
);
CREATE INDEX email_accounts_address_idx ON email_accounts(mailbox_address);

CREATE TABLE email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_account_id uuid NOT NULL REFERENCES email_accounts(id),
  provider_thread_id text NOT NULL,
  customer_id integer REFERENCES customers(id),
  enquiry_id integer REFERENCES enquiries(id),
  quotation_id integer REFERENCES quotations(id),
  sales_order_id integer REFERENCES sales_orders(id),
  subject text,
  status text NOT NULL DEFAULT 'OPEN',
  first_message_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(email_account_id,provider_thread_id)
);
CREATE INDEX email_threads_customer_idx ON email_threads(customer_id,last_message_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX email_threads_order_idx ON email_threads(sales_order_id,last_message_at DESC) WHERE sales_order_id IS NOT NULL;

CREATE TABLE email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_account_id uuid NOT NULL REFERENCES email_accounts(id),
  thread_id uuid REFERENCES email_threads(id),
  provider_message_id text,
  direction text NOT NULL,
  sender_address citext,
  recipient_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  parsed_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  safe_body_reference text,
  received_at timestamptz,
  sent_at timestamptz,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(recipient_addresses)='array'),
  CHECK(jsonb_typeof(cc_addresses)='array'),
  CHECK(jsonb_typeof(parsed_headers)='object')
);
CREATE UNIQUE INDEX email_messages_provider_id_idx ON email_messages(email_account_id,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX email_messages_thread_time_idx ON email_messages(thread_id,COALESCE(received_at,sent_at,created_at) DESC);

CREATE TABLE email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_execution_id uuid REFERENCES workflow_executions(id),
  customer_id integer REFERENCES customers(id),
  enquiry_id integer REFERENCES enquiries(id),
  quotation_id integer REFERENCES quotations(id),
  sales_order_id integer REFERENCES sales_orders(id),
  recipient_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  cc_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text NOT NULL,
  body_reference text NOT NULL,
  content_fingerprint char(64) NOT NULL CHECK(content_fingerprint ~ '^[0-9a-f]{64}$'),
  linked_record_version integer,
  approval_request_id uuid REFERENCES approval_requests(id),
  status text NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  CHECK(jsonb_typeof(recipient_addresses)='array'),
  CHECK(jsonb_typeof(cc_addresses)='array')
);
CREATE INDEX email_drafts_status_idx ON email_drafts(status,created_at DESC);
CREATE INDEX email_drafts_customer_idx ON email_drafts(customer_id,created_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX email_drafts_order_idx ON email_drafts(sales_order_id,created_at DESC) WHERE sales_order_id IS NOT NULL;

CREATE TABLE email_draft_documents (
  email_draft_id uuid NOT NULL REFERENCES email_drafts(id),
  source_document_id uuid NOT NULL REFERENCES source_documents(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  PRIMARY KEY(email_draft_id,source_document_id)
);

CREATE TABLE email_send_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_draft_id uuid NOT NULL REFERENCES email_drafts(id),
  approval_decision_id uuid REFERENCES approval_decisions(id),
  attempt_number integer NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL,
  provider_message_id text,
  provider_response jsonb,
  error_detail jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(email_draft_id,attempt_number),
  UNIQUE(email_draft_id,idempotency_key)
);
CREATE INDEX email_send_attempts_status_idx ON email_send_attempts(status,started_at);

CREATE TABLE reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assigned_user_id integer REFERENCES users(id),
  customer_id integer REFERENCES customers(id),
  enquiry_id integer REFERENCES enquiries(id),
  quotation_id integer REFERENCES quotations(id),
  sales_order_id integer REFERENCES sales_orders(id),
  title text NOT NULL,
  detail text,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'OPEN',
  completion_reason text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id)
);
CREATE INDEX reminders_assignee_due_idx ON reminders(assigned_user_id,due_at) WHERE status NOT IN ('DONE','CANCELLED');
CREATE INDEX reminders_customer_due_idx ON reminders(customer_id,due_at) WHERE customer_id IS NOT NULL;

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id integer NOT NULL REFERENCES users(id),
  reminder_id uuid REFERENCES reminders(id),
  channel text NOT NULL,
  delivery_state text NOT NULL DEFAULT 'PENDING',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  last_error jsonb,
  scheduled_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(payload)='object')
);
CREATE UNIQUE INDEX notifications_idempotency_idx ON notifications(user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX notifications_user_state_idx ON notifications(user_id,delivery_state,scheduled_at);

CREATE TABLE procurement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id integer REFERENCES crm_purchase_requests(id),
  rfq_id integer REFERENCES crm_rfqs(id),
  supplier_po_id integer REFERENCES crm_supplier_pos(id),
  goods_receipt_id uuid REFERENCES goods_receipts(id),
  action text NOT NULL,
  version integer,
  reason text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id integer REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(jsonb_typeof(detail)='object')
);
CREATE INDEX procurement_events_request_idx ON procurement_events(purchase_request_id,created_at DESC) WHERE purchase_request_id IS NOT NULL;
CREATE INDEX procurement_events_rfq_idx ON procurement_events(rfq_id,created_at DESC) WHERE rfq_id IS NOT NULL;
CREATE INDEX procurement_events_supplier_po_idx ON procurement_events(supplier_po_id,created_at DESC) WHERE supplier_po_id IS NOT NULL;
CREATE INDEX procurement_events_receipt_idx ON procurement_events(goods_receipt_id,created_at DESC) WHERE goods_receipt_id IS NOT NULL;

CREATE FUNCTION target_immutable_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; corrections must be recorded as new rows', TG_TABLE_NAME;
END
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'workflow_versions','workflow_steps','approval_decisions','email_messages',
    'email_send_attempts','tracking_events','delivery_confirmations',
    'extraction_runs','extracted_fields','document_reviews','field_corrections',
    'procurement_events'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION target_immutable_history_guard()',
      table_name || '_immutable', table_name
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION target_immutable_history_guard()',
      table_name || '_no_truncate', table_name
    );
  END LOOP;
END
$$;
