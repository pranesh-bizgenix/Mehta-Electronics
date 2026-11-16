CREATE INDEX tally_current_voucher_type_date
  ON tally_visibility_current_cache(company_id,(summary_fields->>'/stored/voucher_type'),(summary_fields->>'/stored/date') DESC)
  WHERE entity='vouchers';
