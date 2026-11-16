-- S0 typed operational quantity/price integrity. No source-data rewrite or default.
-- Nullable unreviewed parsed facts remain NULL; accounting evidence stays signed.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
ALTER TABLE "price_list_items" ADD CONSTRAINT "s0_nonnegative_list_price" CHECK ("list_price" >= 0);
ALTER TABLE "price_list_items" ADD CONSTRAINT "s0_nonnegative_net_price" CHECK ("net_price" >= 0);
ALTER TABLE "supplier_po_lines" ADD CONSTRAINT "s0_nonnegative_quantity" CHECK ("quantity" >= 0);
ALTER TABLE "supplier_po_lines" ADD CONSTRAINT "s0_nonnegative_unit_price" CHECK ("unit_price" >= 0);
ALTER TABLE "supplier_po_schedules" ADD CONSTRAINT "s0_nonnegative_quantity" CHECK ("quantity" >= 0);
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "s0_nonnegative_quantity" CHECK ("quantity" >= 0);
ALTER TABLE "rfq_vendor_reply_lines" ADD CONSTRAINT "s0_nonnegative_quantity" CHECK ("quantity" >= 0);
ALTER TABLE "rfq_vendor_reply_lines" ADD CONSTRAINT "s0_nonnegative_quoted_unit_price" CHECK ("quoted_unit_price" >= 0);
ALTER TABLE "acceptance_lines" ADD CONSTRAINT "s0_nonnegative_quantity" CHECK ("quantity" >= 0);
ALTER TABLE "acceptance_lines" ADD CONSTRAINT "s0_nonnegative_net_price" CHECK ("net_price" >= 0);
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "s0_nonnegative_received_quantity" CHECK ("received_quantity" >= 0);
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "s0_nonnegative_accepted_quantity" CHECK ("accepted_quantity" >= 0);
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "s0_nonnegative_rejected_quantity" CHECK ("rejected_quantity" >= 0);
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "s0_nonnegative_actual_unit_price" CHECK ("actual_unit_price" >= 0);
ALTER TABLE "supply_allocations" ADD CONSTRAINT "s0_nonnegative_allocated_quantity" CHECK ("allocated_quantity" >= 0);
ALTER TABLE "dispatch_lines" ADD CONSTRAINT "s0_nonnegative_quantity" CHECK ("quantity" >= 0);
ALTER TABLE goods_receipt_lines ADD CONSTRAINT s0_received_disposition CHECK (accepted_quantity + rejected_quantity <= received_quantity);
INSERT INTO audit_logs(entity,record_id,action,reason,new_value) VALUES('SCHEMA_MIGRATION','0044_workflow_quantity_checks','MIGRATION','Constrain typed operational quantities and prices; preserve nullable unreviewed facts and signed accounting evidence','{"nonnegativeChecks":16,"receiptConsistencyChecks":1,"businessRowsRewritten":false}');
