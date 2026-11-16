-- Complete the existing customer-review schema. No customer or policy data changes.
CREATE INDEX crm_customer_onboarding_created_by ON crm_customer_onboarding(created_by);
CREATE INDEX crm_customer_onboarding_updated_by ON crm_customer_onboarding(updated_by);
CREATE INDEX crm_customer_onboarding_submitted_by ON crm_customer_onboarding(submitted_by);
CREATE INDEX crm_customer_onboarding_decided_by ON crm_customer_onboarding(decided_by) WHERE decided_by IS NOT NULL;
CREATE INDEX crm_customer_onboarding_events_created_by ON crm_customer_onboarding_events(created_by);
-- The older active-only index cannot support references from archived profiles.
CREATE INDEX crm_customer_profiles_backup_owner_fk ON crm_customer_profiles(backup_owner_id) WHERE backup_owner_id IS NOT NULL;
ALTER TABLE crm_customer_onboarding_events
 ADD CONSTRAINT crm_customer_onboarding_events_from_status_check
 CHECK(from_status IS NULL OR from_status IN ('PENDING_APPROVAL','APPROVED','REJECTED'));
