# Exact financial values

## API and database boundary

PostgreSQL `NUMERIC` values are returned as decimal strings. This includes money,
rates, percentages and quantities stored as NUMERIC. Integer identifiers, counts,
pagination values and dates retain their existing types. JSON payloads are not
retroactively rewritten by this driver change.

Consumers must keep decimal strings through request creation, calculations and
exports. Do not convert money with `Number`, `parseFloat` or `toFixed`. The legacy
editor now submits decimal strings. Its money validator accepts an exact string
with up to 14 whole and six fractional digits; safe integer JSON inputs remain a
compatibility input, while fractional/unsafe numeric money inputs are rejected
with a request to send a decimal string. Legacy quote edits require explicit tax
and discount fields rather than inventing a tax rate.

The shared browser/server arithmetic and formatting implementation is
`public/money.js`. `src/tally-orders/decimal.js` re-exports its primitives for
existing Tally callers. Business-specific managed quotation rules remain in
`public/quotation-math.js`, using the shared minor-unit formatter. Customer
document net rates and formatting use the shared implementation as well.

## Rounding compatibility

- Legacy quotation/order summaries accumulate exact unrounded line net amounts
  and tax, then round each displayed aggregate half-up to two places. This
  preserves the legacy aggregate policy while removing binary floating point.
- Managed quotations keep their existing per-line and per-component rounding:
  CGST and SGST are rounded separately for local supply; IGST is rounded for
  interstate supply. Tiny-value results can legitimately differ between these
  branches. This change does not replace that policy.
- Signed round-off values are preserved. The shared sum helper can add an
  explicitly supplied adjustment; it does not invent an adjustment or silently
  change stored totals.
- Missing/invalid money is rejected by arithmetic. An unknown cost must not
  become zero.

## Evidence and remaining verification

`test/exact-money.test.js` covers large values, fractional arithmetic, half-up
boundaries, signed round-off, GST branches, legacy readers and the live NUMERIC
string boundary. `test/crm.test.js` also covers a real legacy edit/PDF request,
explicit tax requirements and the actual archive actor/reason, inside rollback.

The implementation log records the final full-suite and residue-check results.
Private sample financial checks are now in `test/private-financial-evidence.test.js`.
They load the supplied Johnson PO, two KONE POs, HCE OA, Connectwell AO and the
DK PDF reference attachment at run time. `src/modules/documents/financial-evidence.js`
uses the same exact money module for net, printed tax components, packing and
explicit signed round-off. The helper in `test-support/read-pdf-financial-evidence.py`
uses the locally available Python/pypdf only to extract fixture text; it does not
access the database, execute document instructions or provide email intake.

These checks cover financial evidence, not approved orders or complete S3 layout
importers. Johnson's printed line rounding differences remain visible. The
one-rupee comparison tolerance is the explicit staged PO-validation requirement,
not a newly seeded business setting or an adjustment to the CRM calculation.
No missing document grand total is invented. KONE rows missing tax/HSN are flagged;
missing tax is never converted to zero or treated as a confirmed exemption.
Connectwell's printed tax amount is checked against its declared total without
inferring an unprinted percentage. HCE and DK packing/tax/round-off comparisons use
only the components explicitly printed in the documents.

The six private checks skip with clear messages if a sample, Python or pypdf is
absent. Two mandatory synthetic tests cover supported evidence, omitted fields,
changed totals, unsupported layouts and size/unit-conversion blocks independently.
No real client names, IDs or prices are copied into committed test fixtures or
expected totals, and private values are not printed in assertion failures.

These checks do not certify future report/import workflows, S3 review/versioning,
or an external automation consumer's handling of decimal strings. The workflow
requirements remain separately tracked in the completion audit.

## Dashboard and quotation display follow-up

The Next frontend now imports the shared exact formatter/division/comparison primitives through public/money.d.ts. Compact lakh/crore labels no longer pass through Number/toFixed, and ordinary rounding no longer has a second arithmetic implementation. Numeric compatibility inputs for money must be safe integers; fractional monetary inputs must be decimal strings. Out-of-range or malformed display values remain unknown instead of being coerced.

Quotation margin flags and quantity/discount/tax bounds use exact comparisons. A positive margin with no confirmed floor has no green approval implication. Negative and at-cost states retain the existing BR-02 display meanings. No floor, cost, discount band or approval level was seeded or changed.
