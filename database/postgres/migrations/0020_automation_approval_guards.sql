ALTER TABLE email_drafts
  ADD COLUMN context_state text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK(context_state IN ('UNVERIFIED','READY','NEEDS_INFORMATION'));

ALTER TABLE email_send_attempts
  ALTER COLUMN approval_decision_id SET NOT NULL;

CREATE FUNCTION target_email_draft_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approval_fingerprint char(64);
BEGIN
  IF NEW.approval_request_id IS NOT NULL THEN
    SELECT payload_fingerprint INTO approval_fingerprint
    FROM approval_requests WHERE id=NEW.approval_request_id;
    IF approval_fingerprint IS NULL OR approval_fingerprint IS DISTINCT FROM NEW.content_fingerprint THEN
      RAISE EXCEPTION 'Email approval must match the current draft content fingerprint';
    END IF;
  END IF;

  IF TG_OP='UPDATE'
     AND (NEW.recipient_addresses,NEW.cc_addresses,NEW.subject,NEW.body_reference,
          NEW.content_fingerprint,NEW.linked_record_version,NEW.customer_id,
          NEW.enquiry_id,NEW.quotation_id,NEW.sales_order_id)
       IS DISTINCT FROM
         (OLD.recipient_addresses,OLD.cc_addresses,OLD.subject,OLD.body_reference,
          OLD.content_fingerprint,OLD.linked_record_version,OLD.customer_id,
          OLD.enquiry_id,OLD.quotation_id,OLD.sales_order_id)
     AND OLD.approval_request_id IS NOT NULL
     AND (NEW.approval_request_id IS NOT NULL OR NEW.status<>'DRAFT') THEN
    RAISE EXCEPTION 'Clear the prior approval and return the email draft to DRAFT before editing approved content';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER email_drafts_approval_guard
  BEFORE INSERT OR UPDATE ON email_drafts
  FOR EACH ROW EXECUTE FUNCTION target_email_draft_approval_guard();

CREATE FUNCTION target_email_send_approval_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  draft_fingerprint char(64);
  draft_context_state text;
  draft_approval_request uuid;
  request_fingerprint char(64);
  decision text;
  decision_fingerprint char(64);
BEGIN
  SELECT content_fingerprint,context_state,approval_request_id
    INTO draft_fingerprint,draft_context_state,draft_approval_request
  FROM email_drafts WHERE id=NEW.email_draft_id;
  SELECT ar.payload_fingerprint,ad.decision,ad.payload_fingerprint
    INTO request_fingerprint,decision,decision_fingerprint
  FROM approval_decisions ad
  JOIN approval_requests ar ON ar.id=ad.approval_request_id
  WHERE ad.id=NEW.approval_decision_id
    AND ad.approval_request_id=draft_approval_request;

  IF draft_context_state IS DISTINCT FROM 'READY' THEN
    RAISE EXCEPTION 'Email automation cannot send until required context is verified';
  END IF;
  IF draft_approval_request IS NULL
     OR request_fingerprint IS DISTINCT FROM draft_fingerprint
     OR decision_fingerprint IS DISTINCT FROM draft_fingerprint
     OR upper(COALESCE(decision,''))<>'APPROVED' THEN
    RAISE EXCEPTION 'Email send attempt requires approval for the exact current draft content';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER email_send_attempt_approval_guard
  BEFORE INSERT OR UPDATE ON email_send_attempts
  FOR EACH ROW EXECUTE FUNCTION target_email_send_approval_guard();
