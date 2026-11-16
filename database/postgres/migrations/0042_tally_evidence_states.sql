-- Preserve existing runtime states omitted by S0's new constraints.
-- Additive state-domain correction; no source data or business record is rewritten.
SET LOCAL lock_timeout = '5s';
ALTER TABLE tally_conflicts DROP CONSTRAINT s0_tally_conflicts_status_check;
ALTER TABLE tally_conflicts ADD CONSTRAINT s0_tally_conflicts_status_check
  CHECK(status IN ('OPEN','RESOLVED','DISMISSED','SUPERSEDED')) NOT VALID;
ALTER TABLE tally_conflicts VALIDATE CONSTRAINT s0_tally_conflicts_status_check;
ALTER TABLE tally_reconciliations DROP CONSTRAINT s0_tally_reconciliations_status_check;
ALTER TABLE tally_reconciliations ADD CONSTRAINT s0_tally_reconciliations_status_check
  CHECK(status IN ('PENDING_REVIEW','MATCH','MATCHED','MISMATCH','REVIEWED','APPROVED','REJECTED')) NOT VALID;
ALTER TABLE tally_reconciliations VALIDATE CONSTRAINT s0_tally_reconciliations_status_check;
INSERT INTO audit_logs(entity,record_id,action,reason,new_value)
 VALUES('SCHEMA_MIGRATION','0042_tally_evidence_states','MIGRATION',
 'Preserve existing SUPERSEDED conflict and MATCH reconciliation states; full-suite regression evidence',
 '{"rewritesSourceData":false,"sendGatesChanged":false}');
