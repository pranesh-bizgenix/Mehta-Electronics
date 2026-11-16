-- Technical collection evidence only; no business policy or data is seeded.
ALTER TABLE tally_upload_sessions ADD COLUMN collection_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
 CHECK (jsonb_typeof(collection_metadata)='object');
