-- Link scoped company XML to the existing company ID without modifying history.
-- A company metadata snapshot and its XML snapshot are one company, not two.
CREATE TABLE tally_visibility_company_aliases (
 company_id uuid NOT NULL,record_key text NOT NULL,canonical_key text NOT NULL,
 PRIMARY KEY(company_id,record_key)
);
INSERT INTO tally_visibility_company_aliases(company_id,record_key,canonical_key)
 SELECT DISTINCT r.company_id,r.record_key,c.id::text FROM tally_visibility_records r
 JOIN tally_companies c ON c.id=r.company_id
 WHERE r.entity='companies' AND (r.record_key=c.id::text OR r.name=c.name);
CREATE INDEX tally_company_alias_canonical ON tally_visibility_company_aliases(company_id,canonical_key);
