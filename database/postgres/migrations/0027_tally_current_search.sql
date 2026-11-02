CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Only this derived lookup is updated. All source/history tables remain append-only.
CREATE TABLE tally_visibility_current_cache (
 company_id uuid NOT NULL,entity text NOT NULL,record_key text NOT NULL,record_id text NOT NULL,
 name text NOT NULL,parent_name text,session_id uuid NOT NULL,observed_at timestamptz NOT NULL,source_system text,
 summary_fields jsonb NOT NULL,public_summary jsonb NOT NULL,financial_search text NOT NULL,public_search text NOT NULL,
 has_raw boolean NOT NULL,PRIMARY KEY(company_id,entity,record_key)
);
CREATE TABLE tally_visibility_field_catalogue (
 company_id uuid NOT NULL,entity text NOT NULL,key text NOT NULL,nonfinancial boolean NOT NULL,
 PRIMARY KEY(company_id,entity,key)
);
CREATE FUNCTION tally_search_text(fields jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT COALESCE(string_agg(value||CASE WHEN value ~ '[ÃƒÃ‚]' AND tally_display_text(value)<>value THEN E'\n'||tally_display_text(value) ELSE '' END,E'\n'),'')
 FROM (SELECT DISTINCT value FROM jsonb_each_text(fields) WHERE value IS NOT NULL AND value<>'') values_once
$$;
CREATE FUNCTION tally_summary_fields(fields jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT COALESCE(jsonb_object_agg(key,value) FILTER(WHERE key LIKE '/stored/%'),'{}'::jsonb) || jsonb_build_object(
  '/derived/gstin',(SELECT value FROM jsonb_each_text(fields) WHERE key ~ '/(PARTYGSTIN|GSTIN)(/#text)?$' AND NULLIF(value,'') IS NOT NULL LIMIT 1),
  '/derived/hsn',(SELECT value FROM jsonb_each_text(fields) WHERE key ~ '/(HSNCODE|GSTHSNCODE)(/#text)?$' AND NULLIF(value,'') IS NOT NULL LIMIT 1),
  '/derived/state',(SELECT value FROM jsonb_each_text(fields) WHERE key ~ '/STATENAME(/#text)?$' AND NULLIF(value,'') IS NOT NULL LIMIT 1),
  '/derived/encoding',EXISTS(SELECT 1 FROM jsonb_each_text(fields) WHERE value ~ '[ÃÂ�]')
 ) FROM jsonb_each(fields)
$$;
CREATE FUNCTION tally_refresh_visibility_current() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE safe jsonb; summary jsonb; source text;
BEGIN
 SELECT public_fields INTO safe FROM tally_visibility_public_fields WHERE record_id=NEW.id;
 IF safe IS NULL THEN safe:=tally_visible_fields_v2(NEW.fields,false); END IF;
 summary:=tally_summary_fields(NEW.fields);
 SELECT source_system INTO source FROM tally_source_observations WHERE session_id=NEW.session_id ORDER BY recorded_at DESC,id DESC LIMIT 1;
 INSERT INTO tally_visibility_public_fields(record_id,public_fields) VALUES(NEW.id,safe) ON CONFLICT DO NOTHING;
 INSERT INTO tally_visibility_field_catalogue(company_id,entity,key,nonfinancial)
 SELECT NEW.company_id,NEW.entity,key,jsonb_exists(safe,key) FROM jsonb_object_keys(NEW.fields) key ON CONFLICT DO NOTHING;
 INSERT INTO tally_visibility_current_cache(company_id,entity,record_key,record_id,name,parent_name,session_id,observed_at,source_system,summary_fields,public_summary,financial_search,public_search,has_raw)
 VALUES(NEW.company_id,NEW.entity,NEW.record_key,NEW.id,NEW.name,NEW.parent_name,NEW.session_id,NEW.observed_at,source,summary,
  tally_visible_fields_v2(summary,false)||jsonb_build_object('/derived/gstin',summary->'/derived/gstin','/derived/hsn',summary->'/derived/hsn','/derived/state',summary->'/derived/state','/derived/encoding',summary->'/derived/encoding'),
  tally_search_text(NEW.fields),tally_search_text(safe),NEW.raw_record<>'{}'::jsonb)
 ON CONFLICT(company_id,entity,record_key) DO UPDATE SET record_id=EXCLUDED.record_id,name=EXCLUDED.name,parent_name=EXCLUDED.parent_name,
  session_id=EXCLUDED.session_id,observed_at=EXCLUDED.observed_at,source_system=EXCLUDED.source_system,summary_fields=EXCLUDED.summary_fields,
  public_summary=EXCLUDED.public_summary,financial_search=EXCLUDED.financial_search,public_search=EXCLUDED.public_search,has_raw=EXCLUDED.has_raw
 WHERE (EXCLUDED.observed_at,EXCLUDED.has_raw,EXCLUDED.record_id)>(tally_visibility_current_cache.observed_at,tally_visibility_current_cache.has_raw,tally_visibility_current_cache.record_id);
 RETURN NEW;
END $$;
CREATE TRIGGER tally_visibility_current_cache_capture AFTER INSERT ON tally_visibility_records FOR EACH ROW EXECUTE FUNCTION tally_refresh_visibility_current();
-- A temporary trigger-free staging relation invokes the exact same capture code
-- for existing latest snapshots, without issuing UPDATE against any source row.
INSERT INTO tally_visibility_public_fields(record_id,public_fields)
 SELECT r.id,tally_visible_fields_v2(r.fields,false) FROM tally_visibility_records r
 WHERE NOT EXISTS(SELECT 1 FROM tally_visibility_public_fields p WHERE p.record_id=r.id) ON CONFLICT DO NOTHING;
WITH latest AS MATERIALIZED (
 SELECT DISTINCT ON(company_id,entity,record_key) * FROM tally_visibility_records
 ORDER BY company_id,entity,record_key,observed_at DESC,(raw_record<>'{}'::jsonb) DESC,id DESC
), prepared AS MATERIALIZED (
 SELECT r.*,p.public_fields AS safe,tally_summary_fields(r.fields) AS summary FROM latest r JOIN tally_visibility_public_fields p ON p.record_id=r.id
)
INSERT INTO tally_visibility_current_cache(company_id,entity,record_key,record_id,name,parent_name,session_id,observed_at,source_system,summary_fields,public_summary,financial_search,public_search,has_raw)
 SELECT company_id,entity,record_key,id,name,parent_name,session_id,observed_at,
 (SELECT source_system FROM tally_source_observations s WHERE s.session_id=r.session_id ORDER BY recorded_at DESC,id DESC LIMIT 1),summary,
 tally_visible_fields_v2(summary,false)||jsonb_build_object('/derived/gstin',summary->'/derived/gstin','/derived/hsn',summary->'/derived/hsn','/derived/state',summary->'/derived/state','/derived/encoding',summary->'/derived/encoding'),
 tally_search_text(fields),tally_search_text(safe),raw_record<>'{}'::jsonb FROM prepared r;
INSERT INTO tally_visibility_field_catalogue(company_id,entity,key,nonfinancial)
 SELECT company_id,entity,key,jsonb_exists(tally_visible_fields_v2(jsonb_build_object(key,null),false),key)
 FROM (SELECT DISTINCT r.company_id,r.entity,k.key FROM tally_visibility_records r CROSS JOIN LATERAL jsonb_object_keys(r.fields) k(key)) distinct_keys ON CONFLICT DO NOTHING;
CREATE INDEX tally_current_name ON tally_visibility_current_cache(company_id,entity,name,record_key);
CREATE INDEX tally_current_parent ON tally_visibility_current_cache(company_id,entity,parent_name);
CREATE INDEX tally_current_public_search ON tally_visibility_current_cache USING gin(public_search gin_trgm_ops);
CREATE INDEX tally_current_financial_search ON tally_visibility_current_cache USING gin(financial_search gin_trgm_ops);
CREATE INDEX tally_current_name_trigram ON tally_visibility_current_cache USING gin(name gin_trgm_ops);
CREATE INDEX tally_current_state ON tally_visibility_current_cache(company_id,entity,(summary_fields->>'/derived/state'));
ANALYZE tally_visibility_current_cache;
