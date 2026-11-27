-- Physical custody is distinct from imported Tally stock. No source balance is overwritten.
CREATE TABLE warehouse_locations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES tally_companies(id),
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 80),name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,code),UNIQUE(id,company_id)
);
CREATE TABLE warehouse_receipt_lots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_key uuid NOT NULL UNIQUE,request_hash text NOT NULL,
 grn_id integer NOT NULL REFERENCES crm_grns(id),po_line_key uuid NOT NULL,item_id integer NOT NULL REFERENCES items(id),
 location_id uuid NOT NULL,company_id uuid NOT NULL REFERENCES tally_companies(id),
 batch_number text NOT NULL CHECK(length(trim(batch_number)) BETWEEN 1 AND 100),uom text NOT NULL,quantity numeric(30,6) NOT NULL CHECK(quantity>0),
 evidence text NOT NULL CHECK(length(trim(evidence))>=3),created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','AVAILABLE','REJECTED')),verified_by integer REFERENCES users(id),verified_at timestamptz,review_reason text,
 CHECK(status<>'AVAILABLE' OR (verified_by IS NOT NULL AND verified_by<>created_by AND verified_at IS NOT NULL)),
 FOREIGN KEY(location_id,company_id) REFERENCES warehouse_locations(id,company_id),UNIQUE(id,company_id,item_id)
);
CREATE INDEX warehouse_lots_grn_line ON warehouse_receipt_lots(grn_id,po_line_key);
CREATE TABLE warehouse_lot_serials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lot_id uuid NOT NULL,company_id uuid NOT NULL,item_id integer NOT NULL,
 serial_number text NOT NULL CHECK(length(trim(serial_number)) BETWEEN 1 AND 100),status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACTIVE','REJECTED')),
 FOREIGN KEY(lot_id,company_id,item_id) REFERENCES warehouse_receipt_lots(id,company_id,item_id),
 UNIQUE(id,lot_id)
);
CREATE UNIQUE INDEX warehouse_live_serial_identity ON warehouse_lot_serials(company_id,item_id,serial_number) WHERE status<>'REJECTED';
CREATE TABLE warehouse_order_controls (
 sales_order_id integer PRIMARY KEY REFERENCES sales_orders(id),enabled_by integer NOT NULL REFERENCES users(id),enabled_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL CHECK(length(trim(reason))>=3)
);
ALTER TABLE packing_boxes ADD COLUMN version integer NOT NULL DEFAULT 1,ADD COLUMN source_fingerprint text,ADD COLUMN checked_by integer REFERENCES users(id),ADD COLUMN checked_at timestamptz,ADD COLUMN check_reason text;
CREATE TABLE warehouse_pick_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),box_id uuid NOT NULL,sales_order_id integer NOT NULL,order_line_id integer NOT NULL,
 lot_id uuid NOT NULL REFERENCES warehouse_receipt_lots(id),quantity numeric(30,6) NOT NULL CHECK(quantity>0),
 status text NOT NULL DEFAULT 'RESERVED' CHECK(status IN ('RESERVED','CONSUMED','RELEASED')),
 created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(box_id,sales_order_id) REFERENCES packing_boxes(id,sales_order_id),
 FOREIGN KEY(order_line_id,sales_order_id) REFERENCES sales_order_lines(id,sales_order_id),UNIQUE(id,lot_id)
);
CREATE INDEX warehouse_pick_lot ON warehouse_pick_allocations(lot_id,status);
CREATE INDEX warehouse_pick_box ON warehouse_pick_allocations(box_id,status);
CREATE TABLE warehouse_allocated_serials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),allocation_id uuid NOT NULL,lot_id uuid NOT NULL,serial_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'RESERVED' CHECK(status IN ('RESERVED','CONSUMED','RELEASED')),
 FOREIGN KEY(allocation_id,lot_id) REFERENCES warehouse_pick_allocations(id,lot_id),FOREIGN KEY(serial_id,lot_id) REFERENCES warehouse_lot_serials(id,lot_id)
);
CREATE UNIQUE INDEX warehouse_serial_once ON warehouse_allocated_serials(serial_id) WHERE status IN ('RESERVED','CONSUMED');
CREATE FUNCTION guard_warehouse_custody() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP IN ('DELETE','TRUNCATE') OR current_setting('mehta.warehouse_write',true) IS DISTINCT FROM 'authorized'
 OR nullif(current_setting('mehta.actor_id',true),'') IS NULL OR length(trim(coalesce(current_setting('mehta.audit_reason',true),'')))<3 THEN RAISE EXCEPTION 'Use the audited warehouse workflow'; END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='warehouse_order_controls' THEN RAISE EXCEPTION 'Packing activation evidence is immutable'; END IF;
  IF TG_TABLE_NAME='warehouse_receipt_lots' THEN
   IF (to_jsonb(NEW)-ARRAY['status','verified_by','verified_at','review_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','verified_by','verified_at','review_reason']) OR OLD.status<>'PENDING_REVIEW' OR NEW.status NOT IN ('AVAILABLE','REJECTED') OR NEW.verified_by=NEW.created_by OR NEW.verified_by::text IS DISTINCT FROM current_setting('mehta.actor_id',true) THEN RAISE EXCEPTION 'An independent reviewer must confirm immutable receipt custody'; END IF;
  END IF;
  IF TG_TABLE_NAME='warehouse_lot_serials' THEN
   IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') OR OLD.status<>'PENDING' OR NEW.status NOT IN ('ACTIVE','REJECTED') THEN RAISE EXCEPTION 'Serial identities are immutable'; END IF;
  END IF;
  IF TG_TABLE_NAME IN ('warehouse_pick_allocations','warehouse_allocated_serials') THEN
   IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') OR OLD.status<>'RESERVED' OR NEW.status NOT IN ('CONSUMED','RELEASED') THEN RAISE EXCEPTION 'Only consumption or release of a reserved allocation is permitted'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['warehouse_locations','warehouse_receipt_lots','warehouse_lot_serials','warehouse_order_controls','warehouse_pick_allocations','warehouse_allocated_serials'] LOOP
  EXECUTE format('CREATE TRIGGER warehouse_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_warehouse_custody()',t);
  EXECUTE format('CREATE TRIGGER warehouse_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION guard_warehouse_custody()',t);
 END LOOP;
END $$;
CREATE FUNCTION guard_packing_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE box_status text;
BEGIN
 IF current_setting('mehta.warehouse_write',true) IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'Use the audited packing workflow'; END IF;
 IF TG_TABLE_NAME='packing_boxes' THEN
  IF TG_OP='UPDATE' THEN
   IF (NEW.sales_order_id,NEW.box_number,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.sales_order_id,OLD.box_number,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Packing box identity is immutable'; END IF;
   IF OLD.status IN ('DISPATCHED','CANCELLED','ARCHIVED') THEN RAISE EXCEPTION 'Closed packing boxes are immutable'; END IF;
   IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Packing version must advance once'; END IF;
   IF NOT ((OLD.status='DRAFT' AND NEW.status IN ('DRAFT','PACKED','CANCELLED')) OR (OLD.status='PACKED' AND NEW.status IN ('DISPATCHED','CANCELLED'))) THEN RAISE EXCEPTION 'Invalid packing box transition'; END IF;
   IF NEW.status='PACKED' AND (NEW.checked_by IS NULL OR NEW.checked_by=NEW.created_by OR NEW.checked_at IS NULL OR NEW.source_fingerprint IS NULL) THEN RAISE EXCEPTION 'An independent packing check is required'; END IF;
  END IF;
 ELSE
  SELECT status INTO box_status FROM packing_boxes WHERE id=NEW.box_id;
  IF box_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Only draft boxes accept packing edits, scans and photos'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER packing_box_workflow BEFORE INSERT OR UPDATE ON packing_boxes FOR EACH ROW EXECUTE FUNCTION guard_packing_workflow();
CREATE TRIGGER packing_item_workflow BEFORE INSERT OR UPDATE ON packing_box_items FOR EACH ROW EXECUTE FUNCTION guard_packing_workflow();
CREATE TRIGGER packing_photo_workflow BEFORE INSERT OR UPDATE ON packing_box_photos FOR EACH ROW EXECUTE FUNCTION guard_packing_workflow();
CREATE TRIGGER packing_scan_workflow BEFORE INSERT OR UPDATE ON pick_scans FOR EACH ROW EXECUTE FUNCTION guard_packing_workflow();
