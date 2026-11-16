# Tally company scope and order verification (P13–P15)

## Company boundary

Business reads require exactly one `companyId` referencing an imported company. Missing, duplicate, malformed and unknown identifiers fail; APIs do not silently choose the first company. This applies to order lists/reconciliation, legacy read APIs, the field browser, source inspection, retained payloads, dashboard reads and public replay routes, including `/api/v1/tally` aliases. Detail and replay identifiers are checked within that company, including when voucher numbers or record keys coincide across companies.

The header and Tally page share the same company selection. Company changes remount imported lists/details to discard previous-company state. A visible company heading also appears on mobile. CRM customers, products and workflow records remain shared CRM records; the heading explicitly describes the Tally browsing company.

Company catalogues intentionally expose company IDs/names to populate selection. Connector administration exposes profile/job health metadata; uploads remain bound to their authenticated connector/session and expected company. Database backups and migrations intentionally operate on the one permitted database. The replay maintenance script now requires `--company-id=<UUID>` or deliberate `--all-companies`; this is not an unscoped public business endpoint.

## Orders

`GET /api/crm/tally-orders?companyId=<UUID>` returns only that company's imported sales/purchase order vouchers. Optional `kind`, `search`, `page`, `pageSize` filters apply to both counts and rows. Search matches voucher number/party. The existing index in `0033_tally_order_lookup.sql` already starts with company and voucher type; no migration was needed.

## Reconciliation

In `/tally`, choose **Order sync verification**. The report compares stored voucher counts per source status against dedicated Sales Order/Purchase Order XML retained from the last delivered connector run for that company. Connector comparisons use that run's date window; retained historical totals are labelled separately. Source statuses mean recorded, optional, cancelled or deleted, not fulfilment status.

An independent reference can be pasted or uploaded as JSON with:

```json
{
  "companyId": "<selected imported company UUID>",
  "complete": true,
  "scope": {"mode": "DATE_WINDOW", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD"},
  "datasets": [
    {"kind": "sales_orders", "counts": [{"status": "RECORDED", "count": 0}], "vouchers": []},
    {"kind": "purchase_orders", "counts": [{"status": "RECORDED", "count": 0}], "vouchers": []}
  ]
}
```

Each count is `{ "status": "RECORDED", "count": <integer> }`; each voucher is `{ "number": "<source number>", "status": "RECORDED" }`. The zero counts above illustrate an explicitly empty reference, not default business data. Replace them with actual Tally counts. Use `ALL_RETAINED` without dates for an explicitly complete historical reference. Omit `vouchers` for counts-only evidence: that cannot produce an identity-verified PASS. Mismatches list missing/unexpected voucher numbers and differing statuses. Duplicate identities prevent a full identity verification. Missing receipts, malformed payloads, quarantined records or oversized evidence produce an unverified result rather than a fabricated pass.

These endpoints perform database reads only, in a repeatable-read snapshot. They do not pull from Tally, persist reference data or alter source vouchers. Matching the last connector XML proves consistency with delivered evidence, not completeness against a currently running Tally instance.

## Verification limits

`test/tally-order-scope.test.js` exercises the real handlers within rollback transactions, with companies sharing voucher numbers/record keys, explicit company validation, foreign detail/replay rejection, scoped exports, CSRF, count comparison and unchanged caches. The test transaction helper maps nested read-only transactions to savepoints; concurrent independent-session snapshot behaviour and the actual Windows connector/Tally machine require separate acceptance. No migration or service installation was performed.
