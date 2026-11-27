-- One reconciliation ledger for customer credits and supplier bank debits.
ALTER TABLE bank_reconciliation_matches ALTER COLUMN operation_id DROP NOT NULL;
ALTER TABLE bank_reconciliation_matches ADD COLUMN vendor_advice_id uuid REFERENCES vendor_payment_advices(id);
ALTER TABLE bank_reconciliation_matches ADD CONSTRAINT bank_match_one_source CHECK((operation_id IS NOT NULL)::integer+(vendor_advice_id IS NOT NULL)::integer=1);
CREATE UNIQUE INDEX bank_reconciliation_vendor_pair ON bank_reconciliation_matches(statement_line_id,vendor_advice_id)
 WHERE NOT is_deleted AND status IN ('PROPOSED','CONFIRMED') AND vendor_advice_id IS NOT NULL;
CREATE FUNCTION guard_bank_vendor_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.vendor_advice_id IS DISTINCT FROM OLD.vendor_advice_id THEN RAISE EXCEPTION 'Bank reconciliation source is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bank_vendor_source_guard BEFORE UPDATE ON bank_reconciliation_matches FOR EACH ROW EXECUTE FUNCTION guard_bank_vendor_source();
