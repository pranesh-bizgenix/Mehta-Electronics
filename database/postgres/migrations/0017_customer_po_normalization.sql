CREATE TABLE parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL CHECK(length(trim(legal_name)) > 0),
  normalized_name text NOT NULL CHECK(length(trim(normalized_name)) > 0),
  gstin text,
  pan text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer NOT NULL REFERENCES users(id),
  updated_by integer NOT NULL REFERENCES users(id)
);
CREATE INDEX parties_normalized_name ON parties(normalized_name);

CREATE TABLE party_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id),
  role text NOT NULL CHECK(role IN ('CUSTOMER','SUPPLIER','ISSUER','TRANSPORTER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer NOT NULL REFERENCES users(id),
  UNIQUE(party_id,role)
);

CREATE TABLE party_external_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id),
  source_system text NOT NULL CHECK(length(trim(source_system)) > 0),
  entity_type text NOT NULL CHECK(length(trim(entity_type)) > 0),
  external_id text NOT NULL CHECK(length(trim(external_id)) > 0),
  company_id uuid REFERENCES tally_companies(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer NOT NULL REFERENCES users(id),
  CHECK((source_system='TALLY') = (company_id IS NOT NULL))
);
CREATE UNIQUE INDEX party_external_mapping_unscoped
  ON party_external_mappings(source_system,entity_type,external_id) WHERE company_id IS NULL;
CREATE UNIQUE INDEX party_external_mapping_company
  ON party_external_mappings(source_system,company_id,entity_type,external_id) WHERE company_id IS NOT NULL;
CREATE INDEX party_external_mapping_party ON party_external_mappings(party_id);

CREATE TABLE parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_code citext NOT NULL UNIQUE,
  description text NOT NULL,
  brand text,
  hsn_code text,
  base_uom text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','SUPERSEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer NOT NULL REFERENCES users(id),
  updated_by integer NOT NULL REFERENCES users(id)
);

CREATE TABLE part_external_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES parts(id),
  source_system text NOT NULL CHECK(length(trim(source_system)) > 0),
  entity_type text NOT NULL CHECK(length(trim(entity_type)) > 0),
  external_id text NOT NULL CHECK(length(trim(external_id)) > 0),
  company_id uuid REFERENCES tally_companies(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer NOT NULL REFERENCES users(id),
  CHECK((source_system='TALLY') = (company_id IS NOT NULL))
);
CREATE UNIQUE INDEX part_external_mapping_unscoped
  ON part_external_mappings(source_system,entity_type,external_id) WHERE company_id IS NULL;
CREATE UNIQUE INDEX part_external_mapping_company
  ON part_external_mappings(source_system,company_id,entity_type,external_id) WHERE company_id IS NOT NULL;
CREATE INDEX part_external_mapping_part ON part_external_mappings(part_id);

CREATE TABLE customer_pos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_party_id uuid NOT NULL REFERENCES parties(id),
  legacy_customer_id integer NOT NULL REFERENCES customers(id),
  po_number text NOT NULL CHECK(length(trim(po_number)) > 0),
  po_number_key text NOT NULL CHECK(length(trim(po_number_key)) > 0),
  po_date date NOT NULL,
  currency_code text NOT NULL DEFAULT 'INR' CHECK(currency_code ~ '^[A-Z]{3}$'),
  source_total numeric(20,6) NOT NULL CHECK(source_total >= 0),
  calculated_total numeric(20,6) NOT NULL CHECK(calculated_total >= 0),
  place_of_supply text NOT NULL CHECK(place_of_supply ~ '^(0[1-9]|[12][0-9]|3[0-8])$'),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by integer NOT NULL REFERENCES users(id),
  updated_by integer NOT NULL REFERENCES users(id),
  UNIQUE(customer_party_id,po_number_key),
  UNIQUE(id,legacy_customer_id)
);
CREATE INDEX customer_pos_customer_date ON customer_pos(customer_party_id,po_date DESC);

CREATE TABLE customer_po_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_po_id uuid NOT NULL REFERENCES customer_pos(id),
  legacy_sales_order_line_id integer UNIQUE REFERENCES sales_order_lines(id),
  part_id uuid REFERENCES parts(id),
  line_number integer NOT NULL CHECK(line_number > 0),
  original_part_number text NOT NULL CHECK(length(trim(original_part_number)) > 0),
  description text NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK(quantity > 0),
  uom text NOT NULL CHECK(length(trim(uom)) > 0),
  unit_price numeric(20,6) NOT NULL CHECK(unit_price >= 0),
  discount_percent numeric(9,6) NOT NULL DEFAULT 0 CHECK(discount_percent BETWEEN 0 AND 100),
  tax_percent numeric(9,6) NOT NULL DEFAULT 0 CHECK(tax_percent BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer NOT NULL REFERENCES users(id)
);
CREATE UNIQUE INDEX customer_po_line_active_number
  ON customer_po_lines(customer_po_id,line_number) WHERE status='ACTIVE';
CREATE INDEX customer_po_lines_part ON customer_po_lines(part_id);

CREATE TABLE po_line_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_line_id uuid NOT NULL REFERENCES customer_po_lines(id),
  schedule_number integer NOT NULL CHECK(schedule_number > 0),
  schedule_date date NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK(quantity > 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer NOT NULL REFERENCES users(id),
  UNIQUE(po_line_id,schedule_number)
);

CREATE TABLE customer_po_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_po_id uuid NOT NULL REFERENCES customer_pos(id),
  version integer NOT NULL CHECK(version > 0),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  reason text NOT NULL CHECK(length(trim(reason)) >= 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer NOT NULL REFERENCES users(id),
  UNIQUE(customer_po_id,version)
);

ALTER TABLE sales_orders
  ADD COLUMN customer_po_id uuid,
  ADD CONSTRAINT sales_orders_customer_po_fk
    FOREIGN KEY(customer_po_id,customer_id) REFERENCES customer_pos(id,legacy_customer_id);
CREATE UNIQUE INDEX sales_orders_customer_po_unique
  ON sales_orders(customer_po_id) WHERE customer_po_id IS NOT NULL;
ALTER TABLE sales_order_lines
  ADD COLUMN customer_po_line_id uuid REFERENCES customer_po_lines(id);
CREATE UNIQUE INDEX sales_order_lines_customer_po_line_unique
  ON sales_order_lines(customer_po_line_id) WHERE customer_po_line_id IS NOT NULL;

CREATE FUNCTION crm_customer_po_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Customer PO version history is immutable';
END $$;
CREATE TRIGGER customer_po_versions_immutable
  BEFORE UPDATE OR DELETE ON customer_po_versions
  FOR EACH ROW EXECUTE FUNCTION crm_customer_po_version_guard();
CREATE TRIGGER customer_po_versions_no_truncate
  BEFORE TRUNCATE ON customer_po_versions
  FOR EACH STATEMENT EXECUTE FUNCTION crm_customer_po_version_guard();
