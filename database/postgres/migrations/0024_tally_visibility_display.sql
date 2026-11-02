-- Serialization/display helpers only. Existing imported and derived rows remain unchanged.
CREATE FUNCTION tally_serialized_fields(fields jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT COALESCE(jsonb_object_agg(key,CASE WHEN jsonb_typeof(value)='number' THEN to_jsonb(value #>> '{}') ELSE value END),'{}'::jsonb)
 FROM jsonb_each(fields)
$$;

CREATE FUNCTION tally_display_text(original text) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE repaired text := original; candidate text; pass integer;
BEGIN
 FOR pass IN 1..2 LOOP
  IF repaired !~ '[ÃÂ]' THEN EXIT; END IF;
  BEGIN
   candidate := convert_from(convert_to(repaired,'WIN1252'),'UTF8');
   IF length(regexp_replace(candidate,'[^ÃÂ�]','','g')) >= length(regexp_replace(repaired,'[^ÃÂ�]','','g')) THEN EXIT; END IF;
   repaired := candidate;
  EXCEPTION WHEN OTHERS THEN EXIT;
  END;
 END LOOP;
 RETURN repaired;
END $$;
