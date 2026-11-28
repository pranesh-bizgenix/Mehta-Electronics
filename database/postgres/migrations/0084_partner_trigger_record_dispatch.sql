-- Dispatch table-specific fields in separate PL/pgSQL branches. PostgreSQL
-- resolves NEW field types before SQL boolean short-circuiting.
-- Preserve 0083 and every existing access, audit and ownership guard.
CREATE OR REPLACE FUNCTION guard_partner_portal_records() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF TG_TABLE_NAME='crm_portal_requests' THEN
   IF (NEW.kind='COMPLAINT' AND member.kind IS DISTINCT FROM 'CUSTOMER') OR (NEW.kind='RFQ_REPLY' AND member.kind IS DISTINCT FROM 'VENDOR') THEN RAISE EXCEPTION 'Portal request kind differs from its partner binding'; END IF;
  END IF;
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
