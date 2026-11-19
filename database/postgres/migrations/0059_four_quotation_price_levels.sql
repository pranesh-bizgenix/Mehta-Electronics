-- User approved all four source workbook selling levels on 18 November 2026.
-- Change only the technical range; no prices, approval rules or grants are seeded.
SET LOCAL lock_timeout = '5s';
ALTER TABLE crm_price_levels DROP CONSTRAINT crm_price_levels_level_number_check;
ALTER TABLE crm_price_levels ADD CONSTRAINT crm_price_levels_level_number_check
 CHECK (level_number BETWEEN 1 AND 4);
