-- Complete the CRM-owned customer profile without inventing any business value.
-- All new fields are nullable and must be entered or confirmed by staff.
ALTER TABLE crm_customer_profiles
  ADD COLUMN backup_owner_id integer REFERENCES users(id),
  ADD COLUMN territory text,
  ADD COLUMN dealership text,
  ADD COLUMN brand_relationships jsonb,
  ADD CONSTRAINT crm_customer_profile_brands_array
    CHECK (brand_relationships IS NULL OR jsonb_typeof(brand_relationships) = 'array');

CREATE INDEX crm_customer_profiles_backup_owner
  ON crm_customer_profiles(backup_owner_id)
  WHERE backup_owner_id IS NOT NULL AND NOT is_deleted;

INSERT INTO audit_logs(entity,record_id,action,reason,new_value)
VALUES(
  'SCHEMA_MIGRATION',
  '0056_customer_master_completeness',
  'MIGRATION',
  'Add nullable customer ownership and relationship fields; no business values or customer data seeded',
  '{"seededValues":false,"customerRowsChanged":false}'
);
