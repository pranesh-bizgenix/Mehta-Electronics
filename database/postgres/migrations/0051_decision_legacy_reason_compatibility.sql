-- Preserve the existing quotation policy's 3..2000-character reason contract.
-- Only the new decision history bound changes; new decision endpoints keep
-- their 1000-character request limit. Existing applied files are unchanged.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
ALTER TABLE decision_register
 DROP CONSTRAINT decision_register_reason_check,
 ADD CONSTRAINT decision_register_reason_check CHECK(length(trim(reason)) BETWEEN 3 AND 2000);
INSERT INTO audit_logs(entity,record_id,action,reason,new_value) VALUES('SCHEMA_MIGRATION','0051_decision_legacy_reason_compatibility','MIGRATION','Preserve existing Owner quotation-policy reasons in the new decision history; no business values seeded','{"historyReasonMaximum":2000,"newDecisionApiReasonMaximum":1000,"seededDecisions":false}');
