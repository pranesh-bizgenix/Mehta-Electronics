-- Explicit evidence associations. Never derive CRM identity from a voucher name or number.
ALTER TABLE tally_sync_job_items ADD COLUMN crm_sales_order_id integer REFERENCES sales_orders(id);
ALTER TABLE tally_conflicts ADD COLUMN crm_sales_order_id integer REFERENCES sales_orders(id);
ALTER TABLE tally_reconciliations ADD COLUMN crm_sales_order_id integer REFERENCES sales_orders(id);
CREATE INDEX tally_job_item_crm_order ON tally_sync_job_items(crm_sales_order_id,created_at DESC) WHERE crm_sales_order_id IS NOT NULL;
CREATE INDEX tally_conflict_crm_order ON tally_conflicts(crm_sales_order_id,created_at DESC) WHERE crm_sales_order_id IS NOT NULL;
CREATE INDEX tally_reconciliation_crm_order ON tally_reconciliations(crm_sales_order_id,created_at DESC) WHERE crm_sales_order_id IS NOT NULL;
