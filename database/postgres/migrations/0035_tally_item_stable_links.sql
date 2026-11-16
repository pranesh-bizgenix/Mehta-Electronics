-- Additive CRM link identity. Existing name-based mappings remain unchanged.
ALTER TABLE crm_tally_item_links
  ADD COLUMN tally_record_key text,
  ADD COLUMN tally_guid text,
  ADD COLUMN tally_master_id text,
  ADD CONSTRAINT crm_tally_item_links_stable_identity CHECK (
    (tally_record_key IS NULL AND tally_guid IS NULL AND tally_master_id IS NULL) OR
    (NULLIF(btrim(tally_record_key),'') IS NOT NULL AND
      (NULLIF(btrim(tally_guid),'') IS NOT NULL OR NULLIF(btrim(tally_master_id),'') IS NOT NULL))
  );
CREATE UNIQUE INDEX crm_tally_item_links_source_key
  ON crm_tally_item_links(company_id,tally_record_key) WHERE tally_record_key IS NOT NULL AND status='ACTIVE' AND NOT is_deleted;
CREATE UNIQUE INDEX crm_tally_item_links_guid
  ON crm_tally_item_links(company_id,lower(tally_guid)) WHERE tally_guid IS NOT NULL AND status='ACTIVE' AND NOT is_deleted;
CREATE UNIQUE INDEX crm_tally_item_links_master
  ON crm_tally_item_links(company_id,tally_master_id) WHERE tally_guid IS NULL AND tally_master_id IS NOT NULL AND status='ACTIVE' AND NOT is_deleted;
