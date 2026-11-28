-- New external roles receive only their own portal grants; no staff role changes.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM roles WHERE key IN ('CUSTOMER_PORTAL','VENDOR_PORTAL')) THEN RAISE EXCEPTION 'Review pre-existing partner role identities before applying this migration'; END IF;
END $$;
INSERT INTO roles(key,name,description,requires_mfa,is_system) VALUES
 ('CUSTOMER_PORTAL','Customer portal','Scoped customer records only; reviewed membership required',true,true),
 ('VENDOR_PORTAL','Supplier portal','Scoped supplier records only; reviewed membership required',true,true);
INSERT INTO permissions(key,resource,action,description,owner_only) VALUES
 ('portal.manage','portal','A','Review and revoke partner account bindings',true),
 ('portal.customer.read','portal','R','Read own company-bound customer portal records',false),
 ('portal.customer.submit','portal','W','Submit own customer acknowledgements and complaints for staff review',false),
 ('portal.vendor.read','portal','R','Read own company-bound supplier portal records',false),
 ('portal.vendor.submit','portal','W','Submit own invited supplier replies for purchasing review',false);
INSERT INTO role_permissions(role_key,permission_key) VALUES
 ('CUSTOMER_PORTAL','portal.customer.read'),('CUSTOMER_PORTAL','portal.customer.submit'),
 ('VENDOR_PORTAL','portal.vendor.read'),('VENDOR_PORTAL','portal.vendor.submit');
CREATE TABLE crm_portal_memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id integer NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('CUSTOMER','VENDOR')),company_id uuid NOT NULL REFERENCES tally_companies(id),
 customer_id integer REFERENCES customers(id),vendor_id integer REFERENCES crm_procurement_vendors(id),
 email_hash char(64) NOT NULL CHECK(email_hash ~ '^[0-9a-f]{64}$'),
 support_owner_id integer REFERENCES users(id),support_backup_id integer REFERENCES users(id),
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','ACTIVE','REJECTED','REVOKED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 created_by integer NOT NULL REFERENCES users(id),updated_by integer NOT NULL REFERENCES users(id),
 reviewed_by integer REFERENCES users(id),review_reason text,reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='CUSTOMER' AND customer_id IS NOT NULL AND vendor_id IS NULL AND support_owner_id IS NOT NULL AND support_backup_id IS NOT NULL AND support_owner_id<>support_backup_id) OR (kind='VENDOR' AND vendor_id IS NOT NULL AND customer_id IS NULL AND support_owner_id IS NULL AND support_backup_id IS NULL)),
 CHECK(status<>'ACTIVE' OR (reviewed_by IS NOT NULL AND reviewed_by<>created_by AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND length(trim(review_reason))>=3))
);
CREATE UNIQUE INDEX crm_portal_membership_current ON crm_portal_memberships(user_id) WHERE status IN ('PENDING_REVIEW','ACTIVE');
CREATE INDEX crm_portal_membership_customer ON crm_portal_memberships(customer_id,company_id);
CREATE INDEX crm_portal_membership_vendor ON crm_portal_memberships(vendor_id,company_id);
CREATE TABLE crm_portal_rfq_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rfq_id integer NOT NULL REFERENCES crm_rfqs(id),vendor_id integer NOT NULL REFERENCES crm_procurement_vendors(id),
 company_id uuid NOT NULL REFERENCES tally_companies(id),rfq_version integer NOT NULL CHECK(rfq_version>0),
 public_snapshot jsonb NOT NULL CHECK(jsonb_typeof(public_snapshot)='object'),source_hash char(64) NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
 created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 1000),
 UNIQUE(rfq_id,vendor_id,rfq_version)
);
CREATE FUNCTION guard_portal_rfq_publications() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer;
BEGIN
 actor:=nullif(current_setting('mehta.actor_id',true),'')::integer;
 IF TG_OP<>'INSERT' OR actor IS NULL OR current_setting('mehta.portal_review_write',true) IS DISTINCT FROM 'authorized' OR NEW.created_by<>actor OR NEW.reason IS DISTINCT FROM current_setting('mehta.audit_reason',true) THEN RAISE EXCEPTION 'Use independent supplier portal publication'; END IF;
 IF NOT EXISTS(SELECT 1 FROM crm_rfqs r JOIN crm_rfq_vendors v ON v.rfq_id=r.id JOIN crm_purchase_requests p ON p.id=r.request_id JOIN crm_order_workflows w ON w.sales_order_id=p.sales_order_id WHERE r.id=NEW.rfq_id AND r.version=NEW.rfq_version AND r.status='OPEN' AND NOT r.is_deleted AND r.created_by IS NOT NULL AND r.created_by<>actor AND v.vendor_id=NEW.vendor_id AND NOT v.is_deleted AND NOT p.is_deleted AND w.public_snapshot->>'companyId'=NEW.company_id::text) THEN RAISE EXCEPTION 'Publish only a current invited RFQ independently of its creator'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_portal_rfq_publications_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_portal_rfq_publications FOR EACH ROW EXECUTE FUNCTION guard_portal_rfq_publications();
CREATE TRIGGER crm_portal_rfq_publications_truncate BEFORE TRUNCATE ON crm_portal_rfq_publications FOR EACH STATEMENT EXECUTE FUNCTION guard_portal_rfq_publications();
CREATE TABLE crm_portal_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),membership_id uuid NOT NULL REFERENCES crm_portal_memberships(id),
 request_key uuid NOT NULL UNIQUE,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 kind text NOT NULL CHECK(kind IN ('COMPLAINT','RFQ_REPLY')),rfq_id integer REFERENCES crm_rfqs(id),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=131072),
 status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','LINKED','REJECTED')),
 operation_id uuid REFERENCES crm_operations(id),reply_id integer REFERENCES crm_rfq_vendor_replies(id),reply_version integer CHECK(reply_version>0),
 public_message text CHECK(length(public_message)<=2000),review_reason text,
 created_by integer NOT NULL REFERENCES users(id),updated_by integer NOT NULL REFERENCES users(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='COMPLAINT' AND rfq_id IS NULL AND reply_id IS NULL AND reply_version IS NULL) OR (kind='RFQ_REPLY' AND rfq_id IS NOT NULL AND operation_id IS NULL)),
 CHECK((status='PENDING_REVIEW' AND operation_id IS NULL AND reply_id IS NULL AND reply_version IS NULL) OR (status='LINKED' AND ((kind='COMPLAINT' AND operation_id IS NOT NULL) OR (kind='RFQ_REPLY' AND reply_id IS NOT NULL AND reply_version IS NOT NULL))) OR (status='REJECTED' AND operation_id IS NULL AND reply_id IS NULL AND reply_version IS NULL AND public_message IS NOT NULL AND length(trim(public_message))>=3))
);
CREATE UNIQUE INDEX crm_portal_request_content ON crm_portal_requests(membership_id,request_hash);
CREATE INDEX crm_portal_requests_queue ON crm_portal_requests(kind,status,created_at DESC,id);
CREATE INDEX crm_portal_requests_member ON crm_portal_requests(membership_id,created_at DESC,id);
CREATE TABLE crm_portal_acknowledgements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),membership_id uuid NOT NULL REFERENCES crm_portal_memberships(id),
 request_key uuid NOT NULL UNIQUE,request_hash char(64) NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 entity_kind text NOT NULL CHECK(entity_kind IN ('QUOTATION','ORDER')),entity_id integer NOT NULL,entity_version integer NOT NULL CHECK(entity_version>0),
 source_hash char(64) NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),decision text NOT NULL CHECK(decision IN ('ACCEPT','CHANGE_REQUEST')),
 message text NOT NULL CHECK(length(message)<=2000),created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(membership_id,entity_kind,entity_id,entity_version)
);
CREATE FUNCTION guard_partner_portal_records() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor integer;member crm_portal_memberships;
BEGIN
 actor:=nullif(current_setting('mehta.actor_id',true),'')::integer;
 IF TG_OP IN ('DELETE','TRUNCATE') OR actor IS NULL OR current_setting('mehta.portal_write',true) IS DISTINCT FROM 'authorized' OR length(trim(coalesce(current_setting('mehta.audit_reason',true),'')))<3 THEN RAISE EXCEPTION 'Use the audited partner portal workflow'; END IF;
 IF TG_TABLE_NAME='crm_portal_memberships' THEN
  IF current_setting('mehta.portal_admin_write',true) IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'Use Owner partner-access review'; END IF;
  IF TG_OP='INSERT' AND (NEW.created_by<>actor OR NEW.updated_by<>actor OR NEW.status<>'PENDING_REVIEW' OR NEW.version<>1) THEN RAISE EXCEPTION 'New partner bindings require review'; END IF;
  IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['status','version','updated_by','updated_at','reviewed_by','review_reason','reviewed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updated_by','updated_at','reviewed_by','review_reason','reviewed_at']) OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor OR NOT ((OLD.status='PENDING_REVIEW' AND NEW.status IN ('ACTIVE','REJECTED','REVOKED')) OR (OLD.status='ACTIVE' AND NEW.status='REVOKED'))) THEN RAISE EXCEPTION 'Partner identity and reviewed history are immutable'; END IF;
 ELSE
  SELECT * INTO member FROM crm_portal_memberships WHERE id=NEW.membership_id;
  IF TG_OP='INSERT' AND (member.status IS DISTINCT FROM 'ACTIVE' OR member.user_id IS DISTINCT FROM actor OR NEW.created_by<>actor) THEN RAISE EXCEPTION 'Partner submissions require their active bound account'; END IF;
  IF TG_TABLE_NAME='crm_portal_requests' AND ((NEW.kind='COMPLAINT' AND member.kind IS DISTINCT FROM 'CUSTOMER') OR (NEW.kind='RFQ_REPLY' AND member.kind IS DISTINCT FROM 'VENDOR')) THEN RAISE EXCEPTION 'Portal request kind differs from its partner binding'; END IF;
  IF TG_OP='UPDATE' AND current_setting('mehta.portal_review_write',true) IS DISTINCT FROM 'authorized' THEN RAISE EXCEPTION 'Use the internal portal request review'; END IF;
  IF TG_TABLE_NAME='crm_portal_acknowledgements' AND TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Customer acknowledgements are immutable'; END IF;
  IF TG_TABLE_NAME='crm_portal_acknowledgements' THEN
   IF member.kind IS DISTINCT FROM 'CUSTOMER' THEN RAISE EXCEPTION 'Only a bound customer can acknowledge a document'; END IF;
   IF NEW.entity_kind='QUOTATION' AND NOT EXISTS(SELECT 1 FROM crm_quotation_workflows w JOIN quotations q ON q.id=w.quotation_id JOIN crm_quotation_versions v ON v.quotation_id=q.id AND v.version=w.version WHERE q.id=NEW.entity_id AND q.customer_id=member.customer_id AND NOT q.is_deleted AND w.version=NEW.entity_version AND w.status='SENT' AND v.public_snapshot->>'companyId'=member.company_id::text AND EXISTS(SELECT 1 FROM crm_quotation_events e WHERE e.quotation_id=q.id AND e.version=v.version AND e.action IN ('SEND','EMAIL_SENT') AND NOT e.is_deleted)) THEN RAISE EXCEPTION 'Acknowledge only the current published quotation in this customer company scope'; END IF;
   IF NEW.entity_kind='ORDER' AND NOT EXISTS(SELECT 1 FROM crm_order_workflows w JOIN sales_orders o ON o.id=w.sales_order_id WHERE o.id=NEW.entity_id AND w.customer_id=member.customer_id AND NOT o.is_deleted AND w.version=NEW.entity_version AND w.status IN ('APPROVED','PARTIALLY_DISPATCHED') AND w.public_snapshot->>'companyId'=member.company_id::text) THEN RAISE EXCEPTION 'Acknowledge only the current approved order in this customer company scope'; END IF;
  END IF;
  IF TG_TABLE_NAME='crm_portal_requests' THEN
   IF TG_OP='INSERT' AND (NEW.updated_by<>actor OR NEW.status<>'PENDING_REVIEW' OR NEW.version<>1) THEN RAISE EXCEPTION 'Portal requests start in staff review'; END IF;
   IF TG_OP='UPDATE' AND NEW.operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_operations o WHERE o.id=NEW.operation_id AND o.kind='SUPPORT' AND o.customer_id=member.customer_id) THEN RAISE EXCEPTION 'Complaint link must retain its original customer'; END IF;
   IF TG_OP='UPDATE' AND NEW.reply_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crm_rfq_vendor_replies r WHERE r.id=NEW.reply_id AND r.rfq_id=NEW.rfq_id AND r.vendor_id=member.vendor_id) THEN RAISE EXCEPTION 'Supplier reply link must retain its original invitation'; END IF;
   IF TG_OP='UPDATE' AND ((to_jsonb(NEW)-ARRAY['status','operation_id','reply_id','reply_version','public_message','review_reason','version','updated_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','operation_id','reply_id','reply_version','public_message','review_reason','version','updated_by','updated_at']) OR OLD.status<>'PENDING_REVIEW' OR NEW.status NOT IN ('LINKED','REJECTED') OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor OR actor=OLD.created_by OR NEW.review_reason IS NULL OR length(trim(NEW.review_reason))<3) THEN RAISE EXCEPTION 'An authorised staff reviewer must resolve portal requests'; END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME<>'crm_portal_acknowledgements' THEN NEW.updated_at:=clock_timestamp(); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_portal_memberships_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_portal_memberships FOR EACH ROW EXECUTE FUNCTION guard_partner_portal_records();
CREATE TRIGGER crm_portal_memberships_truncate BEFORE TRUNCATE ON crm_portal_memberships FOR EACH STATEMENT EXECUTE FUNCTION guard_partner_portal_records();
CREATE TRIGGER crm_portal_requests_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_portal_requests FOR EACH ROW EXECUTE FUNCTION guard_partner_portal_records();
CREATE TRIGGER crm_portal_requests_truncate BEFORE TRUNCATE ON crm_portal_requests FOR EACH STATEMENT EXECUTE FUNCTION guard_partner_portal_records();
CREATE TRIGGER crm_portal_acknowledgements_guard BEFORE INSERT OR UPDATE OR DELETE ON crm_portal_acknowledgements FOR EACH ROW EXECUTE FUNCTION guard_partner_portal_records();
CREATE TRIGGER crm_portal_acknowledgements_truncate BEFORE TRUNCATE ON crm_portal_acknowledgements FOR EACH STATEMENT EXECUTE FUNCTION guard_partner_portal_records();
