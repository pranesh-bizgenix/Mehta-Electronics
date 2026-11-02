ALTER TABLE crm_customer_controls ADD COLUMN pricing_class text CHECK(pricing_class IN ('RATE_CONTRACT','MEDIUM_DISCOUNT','DEALER_NETWORK','NEW'));
CREATE TABLE crm_customer_rate_contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id integer NOT NULL REFERENCES customers(id),item_id integer NOT NULL REFERENCES items(id),
 quantity numeric(30,6) NOT NULL CHECK(quantity>0),unit_price numeric(30,6) NOT NULL CHECK(unit_price>=0),
 valid_from date NOT NULL,valid_to date NOT NULL CHECK(valid_to>=valid_from),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','APPROVED','REJECTED')),
 reason text NOT NULL,created_by integer NOT NULL REFERENCES users(id),approved_by integer REFERENCES users(id),
 decision_reason text,created_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz,
 CHECK(approved_by IS NULL OR approved_by<>created_by)
);
CREATE INDEX crm_contracts_customer_item ON crm_customer_rate_contracts(customer_id,item_id,status,valid_from,valid_to);
CREATE FUNCTION crm_contract_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(OLD.customer_id,OLD.item_id,OLD.quantity,OLD.unit_price,OLD.valid_from,OLD.valid_to,OLD.created_by,OLD.reason)
 IS DISTINCT FROM ROW(NEW.customer_id,NEW.item_id,NEW.quantity,NEW.unit_price,NEW.valid_from,NEW.valid_to,NEW.created_by,NEW.reason)
 OR OLD.status<>'DRAFT' THEN RAISE EXCEPTION 'Contract terms and completed decisions are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_contract_no_edit BEFORE UPDATE ON crm_customer_rate_contracts FOR EACH ROW EXECUTE FUNCTION crm_contract_content_immutable();
CREATE TRIGGER crm_contract_no_delete BEFORE DELETE ON crm_customer_rate_contracts FOR EACH ROW EXECUTE FUNCTION crm_operation_immutable();
CREATE TRIGGER crm_contract_no_truncate BEFORE TRUNCATE ON crm_customer_rate_contracts FOR EACH STATEMENT EXECUTE FUNCTION crm_operation_immutable();
INSERT INTO permissions(key,resource,action,description,owner_only) VALUES
 ('contracts.manage','contracts','W','Record fixed customer-specific rate contracts',true),
 ('contracts.approve','contracts','A','Approve customer-specific rate contracts independently',true) ON CONFLICT DO NOTHING;
