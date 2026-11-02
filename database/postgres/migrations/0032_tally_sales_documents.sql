-- Read-only source documents reuse the existing append-only Tally index.
-- Keep financial amounts outside the public projection; expose source identifiers/status only.
CREATE OR REPLACE FUNCTION tally_visible_fields_v2(fields jsonb,financial boolean) RETURNS jsonb LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE WHEN financial THEN fields ELSE tally_visible_fields(fields,false) || COALESCE(jsonb_object_agg(key,value) FILTER(WHERE
   (key ~ '^/xml/.*/(HSNCODE|GSTHSNCODE|GSTIN|PARTYGSTIN|GSTREGISTRATIONTYPE|STATENAME|COUNTRYNAME|PINCODE|INCOMETAXNUMBER|PAN|LEDGERPHONE|LEDGERMOBILE|PHONE|MOBILE|EMAIL|EMAILID|CONTACTPERSON|LEDGERCONTACT|CREATEDDATE|ALTEREDON|MODIFYDATE|BILLCREDITPERIOD|CREDITPERIOD|CREDITDAYS|BASICUSERDESCRIPTION|DESCRIPTION|CONVERSION|DENOMINATOR)(/#text|/@_TYPE)?$'
     AND key !~* '(balance|amount|value|price|rate|creditlimit|taxamount)')
   OR key IN ('/stored/created_at','/stored/fetched_at','/stored/voucher_type','/stored/voucher_number','/stored/date','/stored/party_name','/stored/reference','/stored/is_optional','/stored/is_cancelled','/stored/voucher_status','/stored/guid','/stored/master_id','/stored/alter_id')
 ),'{}'::jsonb) END FROM jsonb_each(fields)
$$;
CREATE INDEX tally_sales_document_date ON tally_visibility_current_cache(company_id,entity,(summary_fields->>'/stored/date')) WHERE entity IN ('quotations','enquiries');
CREATE INDEX tally_sales_document_status ON tally_visibility_current_cache(company_id,entity,(summary_fields->>'/stored/voucher_status')) WHERE entity IN ('quotations','enquiries');
