-- Prevent unaudited physical removal of CRM business history. Raw imports are excluded.
CREATE FUNCTION crm_reject_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CRM business records must be inactivated or archived with an audit entry'; END;
$$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['customers','customer_contacts','items','enquiries','enquiry_lines','quotations','quotation_lines','sales_orders','sales_order_lines'] LOOP
    EXECUTE format('CREATE TRIGGER crm_no_hard_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION crm_reject_hard_delete()',t);
    EXECUTE format('CREATE TRIGGER crm_no_business_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION crm_reject_hard_delete()',t);
  END LOOP;
END $$;
