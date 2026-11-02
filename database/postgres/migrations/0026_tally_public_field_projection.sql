CREATE FUNCTION tally_flatten_fields_fast(value jsonb,prefix text DEFAULT '') RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT AS $$
 WITH RECURSIVE nodes(path,node) AS (
  SELECT prefix,value UNION ALL
  SELECT n.path||'/'||replace(replace(child.key,'~','~0'),'/','~1'),child.value
  FROM nodes n CROSS JOIN LATERAL (
   SELECT key,value FROM jsonb_each(CASE WHEN jsonb_typeof(n.node)='object' THEN n.node ELSE '{}'::jsonb END)
   UNION ALL
   SELECT (ordinality-1)::text,element FROM jsonb_array_elements(CASE WHEN jsonb_typeof(n.node)='array' THEN n.node ELSE '[]'::jsonb END) WITH ORDINALITY AS a(element,ordinality)
  ) child
 ) SELECT COALESCE(jsonb_object_agg(path,node) FILTER(WHERE jsonb_typeof(node) NOT IN ('array','object') OR node IN ('{}'::jsonb,'[]'::jsonb)),'{}'::jsonb) FROM nodes
$$;
CREATE OR REPLACE FUNCTION tally_flatten_fields(value jsonb,prefix text DEFAULT '') RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT tally_flatten_fields_fast(value,prefix) $$;
CREATE FUNCTION tally_visible_fields_v2(fields jsonb,financial boolean) RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE WHEN financial THEN fields ELSE tally_visible_fields(fields,false) || COALESCE(jsonb_object_agg(key,value) FILTER(WHERE
   (key ~ '^/xml/.*/(HSNCODE|GSTHSNCODE|GSTIN|PARTYGSTIN|GSTREGISTRATIONTYPE|STATENAME|COUNTRYNAME|PINCODE|INCOMETAXNUMBER|PAN|LEDGERPHONE|LEDGERMOBILE|PHONE|MOBILE|EMAIL|EMAILID|CONTACTPERSON|LEDGERCONTACT|CREATEDDATE|ALTEREDON|MODIFYDATE|BILLCREDITPERIOD|CREDITPERIOD|CREDITDAYS|BASICUSERDESCRIPTION|DESCRIPTION|CONVERSION|DENOMINATOR)(/#text|/@_TYPE)?$'
     AND key !~* '(balance|amount|value|price|rate|creditlimit|taxamount)') OR key IN ('/stored/created_at','/stored/fetched_at')
 ),'{}'::jsonb) END FROM jsonb_each(fields)
$$;
CREATE TABLE tally_visibility_public_fields (record_id text PRIMARY KEY,public_fields jsonb NOT NULL);
CREATE FUNCTION tally_capture_public_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO tally_visibility_public_fields(record_id,public_fields) VALUES(NEW.id,tally_visible_fields_v2(NEW.fields,false)) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
INSERT INTO tally_visibility_public_fields(record_id,public_fields) SELECT id,tally_visible_fields_v2(fields,false) FROM tally_visibility_records ON CONFLICT DO NOTHING;
CREATE TRIGGER tally_public_fields_no_change BEFORE UPDATE OR DELETE ON tally_visibility_public_fields FOR EACH ROW EXECUTE FUNCTION tally_visibility_immutable();
CREATE TRIGGER tally_public_fields_no_truncate BEFORE TRUNCATE ON tally_visibility_public_fields FOR EACH STATEMENT EXECUTE FUNCTION tally_visibility_immutable();
