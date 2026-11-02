# SO and PO comparison: review checkpoint

Prepared 2 November 2026. This addition is not activated and is not a completed live integration.

## Agreed comparisons

1. Customer PO versus Sales Order: compare item identity, quantities, units, rates, discounts, delivered net amounts, tax rates and HSN. A customer PO is an agreement, not a supplier cost.
2. Supplier PO versus Sales Order: compare the same fields and calculate expected gross profit on explicitly matched quantities, using confirmed net prices excluding recoverable tax. Show whole-order gross profit only when every line is covered without ambiguity.

Realized profit and net profit are deliberately unavailable from orders alone. They require actual invoices, receipts, expenses and the applicable accounting treatment. No missing cost is treated as zero. No currency conversion or unit conversion is assumed.

## Prepared new files

- `src/tally-orders/decimal.js`: exact decimal arithmetic.
- `src/tally-orders/normalize.js`: retain source identity, quantities, rates, cancellation/optional status, and raw voucher/line fields.
- `src/tally-orders/parse.js`: separate Sales Order / Purchase Order parsing with explicit record failures.
- `src/tally-orders/compare.js`: both comparisons, quantity coverage, missing information, ambiguity and expected gross profit/loss.
- `src/tally-orders/flags.js`: three independent default-off flags.
- `src/tally-orders/fetchers/runtime.js`: unregistered, read-only dry-run scaffold requiring an injected whole-cycle coordinator and transport.
- `src/tally-orders/fetchers/sales-orders.js` and `purchase-orders.js`: separate entry points.
- `src/tally-orders/routes.js`: unregistered Owner/Accounts-only status and supplied-document preview endpoints. Preview does not load trusted orders from the database and does not persist results.
- `apps/web/features/order-comparison/comparison-result.tsx`: read-only presentation component using existing design-system components. Not mounted in existing pages yet.
- `test/tally-order-comparison.test.js`: 14 tests.

No existing file was edited for this addition. Existing dirty files from previous work were left intact. No migration, database backfill, production row update, service restart, flag activation or live Tally request was performed.

## Exact proposed registration edit — approval required, NOT applied

File: `src/app.js`

Add one import adjacent to existing route imports:

```js
import { tallyOrderComparisonRoutes } from './tally-orders/routes.js';
```

Add one route-registration line after the existing `tallyVisibilityRoutes` registration:

```js
...tallyOrderComparisonRoutes({route,json,readJson}),
```

This registers two new routes only:

- `GET /api/tally/order-comparison/status`
- `POST /api/tally/order-comparison/preview`

The POST remains disabled by default. Registration does not activate a fetcher, write data, or mount a comparison page. Enabling `TALLY_ORDER_COMPARISON_ENABLED=true` needs separate approval. The fetcher flags are `TALLY_FETCH_SALES_ORDERS_ENABLED` and `TALLY_FETCH_PURCHASE_ORDERS_ENABLED`; both remain false.

## Integration work still required before live operation

The audit found that generic voucher fetching already requests Sales Order / Purchase Order-compatible fields. The installed connector and source build differ. First inspect actual order payload delivery and reuse existing fields instead of duplicating fetches unnecessarily.

The current Windows connector semaphore protects individual requests, not the complete existing sync cycle. No new fetcher may run until an approved coordination mechanism excludes the whole existing cycle, including other active profiles. The new scaffold refuses execution without that coordinator; none has been registered. An in-process mock in a test is not proof of production mutual exclusion.

The XML request template is unverified against live Tally. Date windows are sequential with a configurable delay, and responses over 200 vouchers fail explicitly. This is not yet server-side record pagination. A tested pagination mechanism, bounds for historical pulls, approved off-hours schedule, timeout/retry policy and cancellation handling remain necessary before activation. No deletion is inferred from a missing voucher.

No persistence has been added. Independent per-entity watermarks, stable company + GUID/Master ID upserts, transactional header/line persistence, modified-record handling, run/error history, additive optional schema and tested rollback remain required if existing stored payloads cannot supply orders. Existing watermarks/history must remain untouched.

The UI component still needs approved data-source wiring, explicit SO/customer-PO/supplier-PO selection, trusted company scope, filters, pagination, detail/source information and live sync statistics. It must not infer an association from matching item names or order totals. It is not currently visible on the running CRM.

## Verification

- Full suite: 112 tests, 107 passed, 5 optional tests skipped, 0 failed.
- New focused suite: 14 passed, 0 failed.
- Web TypeScript check: passed (`tsc --noEmit --incremental false`).
- No browser rendering or live Tally integration verification for this addition.
- Actual new vouchers fetched: 0. Actual new vouchers persisted: 0. Live cancelled/failed/skipped counts: not measured.

The earlier observed quotation population and optional Sales Orders are not evidence of a complete Sales Order / Purchase Order import.
