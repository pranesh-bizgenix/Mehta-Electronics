-- Independent CRM stock-consumption evidence. No quantities, business rules or
-- historical movements are seeded, inferred, subtracted or silently adopted.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
CREATE TABLE crm_stock_consumptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES tally_companies(id),item_id integer NOT NULL REFERENCES items(id),
 sales_order_id integer NOT NULL REFERENCES sales_orders(id),order_line_id integer NOT NULL REFERENCES sales_order_lines(id),
 shipment_id integer NOT NULL REFERENCES crm_shipments(id),stock_check_id uuid NOT NULL REFERENCES stock_check_log(id),
 quantity numeric(30,6) NOT NULL CHECK(quantity>0),uom text NOT NULL CHECK(length(trim(uom)) BETWEEN 1 AND 30),
 basis text NOT NULL CHECK(basis IN ('FREE_STOCK','RESERVED_STOCK')),reservation_key text CHECK(reservation_key IS NULL OR length(reservation_key) BETWEEN 1 AND 250),
 source_session_id uuid NOT NULL REFERENCES tally_upload_sessions(id),source_observed_at timestamptz NOT NULL,source_record_key text NOT NULL,source_record_id text NOT NULL REFERENCES tally_visibility_records(id),
 created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 2000),UNIQUE(shipment_id,order_line_id),
 CHECK((basis='FREE_STOCK' AND reservation_key IS NULL) OR (basis='RESERVED_STOCK' AND reservation_key IS NOT NULL))
);
CREATE TABLE crm_stock_consumption_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),consumption_id uuid NOT NULL UNIQUE REFERENCES crm_stock_consumptions(id),
 source_session_id uuid NOT NULL REFERENCES tally_upload_sessions(id),source_observed_at timestamptz NOT NULL,source_record_key text NOT NULL,source_record_id text NOT NULL REFERENCES tally_visibility_records(id),
 reviewer_id integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 evidence_reference text NOT NULL CHECK(length(trim(evidence_reference)) BETWEEN 3 AND 2000),
 attested_in_tally boolean NOT NULL CHECK(attested_in_tally),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 request_key uuid NOT NULL UNIQUE,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX crm_stock_consumptions_company_item ON crm_stock_consumptions(company_id,item_id);
CREATE INDEX crm_stock_consumptions_order ON crm_stock_consumptions(sales_order_id);
CREATE INDEX crm_stock_consumptions_line ON crm_stock_consumptions(order_line_id);
CREATE INDEX crm_stock_consumptions_check ON crm_stock_consumptions(stock_check_id);
CREATE INDEX crm_stock_consumptions_source ON crm_stock_consumptions(source_session_id);
CREATE INDEX crm_stock_consumptions_source_record ON crm_stock_consumptions(source_record_id);
CREATE INDEX crm_stock_consumptions_actor ON crm_stock_consumptions(created_by);
CREATE INDEX crm_stock_consumptions_created ON crm_stock_consumptions(created_at);
CREATE INDEX crm_stock_reviews_source ON crm_stock_consumption_reviews(source_session_id);
CREATE INDEX crm_stock_reviews_source_record ON crm_stock_consumption_reviews(source_record_id);
CREATE INDEX crm_stock_reviews_reviewer ON crm_stock_consumption_reviews(reviewer_id);
CREATE INDEX crm_stock_reviews_created ON crm_stock_consumption_reviews(created_at);
CREATE FUNCTION crm_stock_reserved_owner(source_company uuid,crm_order integer,reservation text) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH source AS (
  SELECT record_key,nullif(summary_fields->>'/stored/guid','') AS guid,nullif(summary_fields->>'/stored/master_id','') AS master_id
  FROM tally_visibility_current_cache WHERE company_id=source_company AND entity='vouchers' AND summary_fields->>'/stored/voucher_type'='Sales Order'
   AND (lower(nullif(summary_fields->>'/stored/guid',''))=lower(reservation)
    OR nullif(summary_fields->>'/stored/guid','') IS NULL AND summary_fields->>'/stored/master_id'=reservation)
 ), bindings AS (
  SELECT DISTINCT j.crm_sales_order_id FROM tally_sync_job_items j JOIN source s
   ON j.external_id=ANY(ARRAY[s.record_key,s.guid,s.master_id,'guid:'||s.guid,'master:'||s.master_id])
  WHERE j.company_id=source_company AND upper(j.status) IN ('STORED','SUCCEEDED','SUCCESS','IN_TALLY') AND j.crm_sales_order_id IS NOT NULL
 ) SELECT (SELECT count(*) FROM source)=1 AND (SELECT count(*) FROM bindings)=1 AND EXISTS(SELECT 1 FROM bindings WHERE crm_sales_order_id=crm_order)
$$;
CREATE FUNCTION crm_stock_consumption_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer; why text; movement crm_stock_consumptions%ROWTYPE;
BEGIN
 actor:=NULLIF(current_setting('mehta.actor_id',true),'')::integer;why:=NULLIF(trim(current_setting('mehta.audit_reason',true)),'');
 IF actor IS NULL OR length(coalesce(why,''))<3 OR NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND status='ACTIVE') THEN RAISE EXCEPTION 'Actual active staff actor and reason required'; END IF;
 IF NEW.reason<>why THEN RAISE EXCEPTION 'Consumption reason must match the transaction'; END IF;
 IF TG_TABLE_NAME='crm_stock_consumptions' THEN
  IF NEW.created_by<>actor OR NOT EXISTS(
   SELECT 1 FROM crm_shipments sh JOIN crm_shipment_items si ON si.shipment_id=sh.id
   JOIN sales_order_lines ol ON ol.id=si.order_line_id JOIN crm_order_workflows ow ON ow.sales_order_id=ol.sales_order_id
   JOIN stock_check_log sc ON sc.id=NEW.stock_check_id
   JOIN tally_visibility_records vr ON vr.id=NEW.source_record_id AND vr.company_id=NEW.company_id AND vr.session_id=NEW.source_session_id AND vr.entity='items' AND vr.record_key=NEW.source_record_key
   WHERE sh.id=NEW.shipment_id AND sh.sales_order_id=NEW.sales_order_id AND ol.sales_order_id=NEW.sales_order_id
    AND ol.id=NEW.order_line_id AND ol.item_id=NEW.item_id AND ol.uom=NEW.uom AND si.quantity=NEW.quantity
    AND ow.public_snapshot->>'companyId'=NEW.company_id::text AND sc.company_id=NEW.company_id AND sc.item_id=NEW.item_id
    AND sc.sales_order_id=NEW.sales_order_id AND sc.status='VERIFIED' AND sc.selected_basis=NEW.basis
    AND sc.source_session_id=NEW.source_session_id AND sc.source_observed_at=NEW.source_observed_at
    AND sc.reservation_detail->>'sourceRecordKey'=NEW.source_record_key
    AND (sc.reservation_detail->>'reservationKey') IS NOT DISTINCT FROM NEW.reservation_key
    AND (SELECT coalesce(sum(c.quantity),0) FROM crm_stock_consumptions c WHERE c.stock_check_id=sc.id)+NEW.quantity<=sc.requested_quantity
  ) THEN RAISE EXCEPTION 'Consumption must match actual shipment, company, item and verified stock evidence'; END IF;
  IF NEW.basis='RESERVED_STOCK' AND NOT crm_stock_reserved_owner(NEW.company_id,NEW.sales_order_id,NEW.reservation_key) THEN RAISE EXCEPTION 'Reserved consumption requires the unique verified retained association to this CRM order'; END IF;
 ELSE
  SELECT * INTO movement FROM crm_stock_consumptions WHERE id=NEW.consumption_id;
  IF movement.id IS NULL OR NEW.reviewer_id<>actor OR movement.created_by=actor OR NOT EXISTS(SELECT 1 FROM users WHERE id=actor AND role='OWNER' AND status='ACTIVE') THEN RAISE EXCEPTION 'A different actual active Owner must reconcile this consumption'; END IF;
  IF NEW.source_session_id=movement.source_session_id OR NEW.source_observed_at<=movement.created_at OR NEW.source_observed_at>clock_timestamp() OR NOT EXISTS(
   SELECT 1 FROM tally_run_datasets d WHERE d.session_id=NEW.source_session_id AND d.company_id=movement.company_id AND d.dataset='stockXml'
    AND d.status IN ('imported','received_empty','retained') AND d.quarantined_count=0
  ) THEN RAISE EXCEPTION 'Independent review requires a later successful source receipt in the same company'; END IF;
  IF NOT EXISTS(
   SELECT 1 FROM tally_visibility_records r JOIN tally_upload_sessions s ON s.id=r.session_id
   JOIN tally_visibility_current_cache cache ON cache.record_id=r.id AND cache.company_id=r.company_id AND cache.entity=r.entity
   JOIN crm_tally_item_links link ON link.company_id=r.company_id AND link.item_id=movement.item_id AND link.status='ACTIVE' AND NOT link.is_deleted AND link.tally_record_key IS NOT NULL
   WHERE r.id=NEW.source_record_id AND r.company_id=movement.company_id AND r.session_id=NEW.source_session_id AND r.entity='items' AND r.record_key=NEW.source_record_key
    AND (link.tally_guid IS NOT NULL AND lower(link.tally_guid)=lower(coalesce(nullif(r.fields->>'/stored/tally_guid',''),nullif(r.fields->>'/xml/GUID/#text',''),nullif(r.fields->>'/xml/GUID','')))
      OR link.tally_guid IS NULL AND link.tally_master_id=coalesce(nullif(r.fields->>'/stored/master_id',''),nullif(r.fields->>'/xml/MASTERID/#text',''),nullif(r.fields->>'/xml/MASTERID','')))
    AND nullif(s.collection_metadata->'stockXml'->>'sourceTimestamp','')::timestamptz=NEW.source_observed_at
  ) THEN RAISE EXCEPTION 'Review must bind the current retained item identity, receipt and actual source timestamp'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_stock_consumption_actor BEFORE INSERT ON crm_stock_consumptions FOR EACH ROW EXECUTE FUNCTION crm_stock_consumption_insert_guard();
CREATE TRIGGER crm_stock_consumption_review_actor BEFORE INSERT ON crm_stock_consumption_reviews FOR EACH ROW EXECUTE FUNCTION crm_stock_consumption_insert_guard();
CREATE TRIGGER crm_stock_consumptions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_stock_consumptions FOR EACH STATEMENT EXECUTE FUNCTION f1_append_only();
CREATE TRIGGER crm_stock_consumption_reviews_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_stock_consumption_reviews FOR EACH STATEMENT EXECUTE FUNCTION f1_append_only();
INSERT INTO audit_logs(entity,record_id,action,reason,new_value) VALUES('SCHEMA_MIGRATION','0053_crm_stock_consumption_evidence','MIGRATION','Add immutable dispatch consumption and independent reconciliation evidence; no history backfill or business values','{"seededMovements":false,"inferredConsumptionFormula":false}');
