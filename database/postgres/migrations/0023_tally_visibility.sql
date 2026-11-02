-- Derived, append-only field index. Imported tables and raw bytes are untouched.
CREATE FUNCTION tally_flatten_fields(value jsonb, prefix text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result jsonb := '{}'::jsonb; entry record; child jsonb; i integer := 0;
BEGIN
  IF jsonb_typeof(value) = 'object' AND value <> '{}'::jsonb THEN
    FOR entry IN SELECT * FROM jsonb_each(value) LOOP
      result := result || tally_flatten_fields(entry.value, prefix || '/' || replace(replace(entry.key,'~','~0'),'/','~1'));
    END LOOP;
  ELSIF jsonb_typeof(value) = 'array' AND value <> '[]'::jsonb THEN
    FOR child IN SELECT * FROM jsonb_array_elements(value) LOOP
      result := result || tally_flatten_fields(child, prefix || '/' || i::text); i := i + 1;
    END LOOP;
  ELSE result := jsonb_build_object(prefix, value);
  END IF;
  RETURN result;
END $$;

CREATE TABLE tally_visibility_records (
  id text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES tally_companies(id),
  entity text NOT NULL, record_key text NOT NULL, session_id uuid NOT NULL REFERENCES tally_upload_sessions(id),
  payload_id uuid REFERENCES tally_raw_payloads(id),
  name text NOT NULL, parent_name text,
  raw_record jsonb NOT NULL, fields jsonb NOT NULL,
  content_hash text NOT NULL, observed_at timestamptz NOT NULL,
  UNIQUE(company_id,entity,record_key,session_id,content_hash)
);
CREATE INDEX tally_visibility_current ON tally_visibility_records(company_id,entity,record_key,observed_at DESC);
CREATE INDEX tally_visibility_session ON tally_visibility_records(session_id);

CREATE TABLE tally_visibility_crm_links (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES tally_companies(id),entity text NOT NULL,record_key text NOT NULL,
  crm_kind text NOT NULL CHECK(crm_kind IN ('customer','vendor','item')),crm_id integer NOT NULL,
  created_by integer NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id,entity,record_key),UNIQUE(company_id,crm_kind,crm_id)
);

CREATE FUNCTION tally_visibility_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entity_name text; snapshot jsonb; digest text;
BEGIN
  entity_name := CASE TG_TABLE_NAME WHEN 'tally_ledgers' THEN 'ledgers' WHEN 'tally_groups' THEN 'groups' ELSE 'items' END;
  snapshot := to_jsonb(NEW); digest := md5(NEW.raw_record::text);
  INSERT INTO tally_visibility_records(id,company_id,entity,record_key,session_id,name,parent_name,raw_record,fields,content_hash,observed_at)
    VALUES(md5(entity_name || NEW.id || NEW.session_id::text || digest),NEW.company_id,entity_name,NEW.id,NEW.session_id,NEW.name,NEW.parent_name,NEW.raw_record,
      tally_flatten_fields(snapshot - 'raw_record' - 'fetched_at','/stored') || tally_flatten_fields(NEW.raw_record,'/xml'),digest,NEW.fetched_at)
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER tally_visibility_ledger AFTER INSERT OR UPDATE ON tally_ledgers FOR EACH ROW EXECUTE FUNCTION tally_visibility_capture();
CREATE TRIGGER tally_visibility_group AFTER INSERT OR UPDATE ON tally_groups FOR EACH ROW EXECUTE FUNCTION tally_visibility_capture();
CREATE TRIGGER tally_visibility_item AFTER INSERT OR UPDATE ON tally_stock_items FOR EACH ROW EXECUTE FUNCTION tally_visibility_capture();

INSERT INTO tally_visibility_records(id,company_id,entity,record_key,session_id,name,parent_name,raw_record,fields,content_hash,observed_at)
SELECT md5(entity || id || session_id::text || md5(raw_record::text)),company_id,entity,id,session_id,name,parent_name,raw_record,
  tally_flatten_fields(snapshot - 'raw_record' - 'fetched_at','/stored') || tally_flatten_fields(raw_record,'/xml'),md5(raw_record::text),fetched_at
FROM (
 SELECT 'ledgers'::text entity,id,company_id,session_id,name,parent_name,raw_record,fetched_at,to_jsonb(t) snapshot FROM tally_ledgers t
 UNION ALL SELECT 'groups',id,company_id,session_id,name,parent_name,raw_record,fetched_at,to_jsonb(t) FROM tally_groups t
 UNION ALL SELECT 'items',id,company_id,session_id,name,parent_name,raw_record,fetched_at,to_jsonb(t) FROM tally_stock_items t
) records ON CONFLICT DO NOTHING;

-- Nonfinancial visibility is fail-closed: new/unknown XML tags require review.
CREATE FUNCTION tally_visible_fields(fields jsonb, financial boolean) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE WHEN financial THEN fields ELSE COALESCE(jsonb_object_agg(key,value) FILTER (WHERE
   key ~ '^/stored/(id|company_id|source_key|name|parent_name|tally_guid|master_id|alter_id|gstin|pan|phone|email|address|contact_person|normalized_part_number|base_unit|description|hsn|closing_quantity_text|session_id)$'
   OR (key ~ '^/xml/(@_NAME|@_RESERVEDNAME|GUID|MASTERID|ALTERID|PARENT|NAME|LANGUAGENAME[.]LIST|ADDRESS[.]LIST|CONTACTDETAILS[.]LIST|EMAIL|EMAILID|LEDGERCONTACT|LEDGERMOBILE|LEDGERPHONE|PHONE|CONTACTPERSON|CREATEDDATE|ALTEREDON|CURRENCYNAME|ISBILLWISEON|BASEUNITS|ADDITIONALUNITS|HSNCODE|GSTHSNCODE|PARTYGSTIN|GSTIN|INCOMETAXNUMBER|PAN|STATENAME|COUNTRYNAME|PINCODE|GSTREGISTRATIONTYPE|ISBATCHWISEON|ISPERISHABLEON|ISMRPON)(/|$)'
       AND key !~* '(balance|amount|value|price|rate|creditlimit|taxamount)')
 ),'{}'::jsonb) END FROM jsonb_each(fields)
$$;

CREATE FUNCTION tally_visibility_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Tally visibility history is append-only'; END $$;
CREATE TRIGGER tally_visibility_no_change BEFORE UPDATE OR DELETE ON tally_visibility_records FOR EACH ROW EXECUTE FUNCTION tally_visibility_immutable();
CREATE TRIGGER tally_visibility_no_truncate BEFORE TRUNCATE ON tally_visibility_records FOR EACH STATEMENT EXECUTE FUNCTION tally_visibility_immutable();
