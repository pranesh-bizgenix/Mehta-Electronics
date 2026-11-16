# Order stock evidence and independent reconciliation

This increment connects saved customer orders to the existing confirmed stock availability policy. It does not write to Tally or change any automation or write-sync switch.

## Order entry and review

- `/orders` requires an explicit imported Tally company when saving a new order. That company is stored in the order snapshot and cannot be changed after binding. Header browsing changes never rebind an order. If a source quotation already carries a company, the order must match it.
- Each line has an explicit stock basis. Missing basis is allowed in a draft but blocks fulfillment. Free-stock lines cannot carry a reservation identity.
- Reserved stock requires the exact native Sales Order GUID, or Master ID when no GUID exists, and a retained source voucher. A successful existing `tally_sync_job_items.crm_sales_order_id` association with `entity_kind='sales_order'` must uniquely bind that voucher to this CRM order in the same company. A different entity kind, selected name, PO number, allocation label or voucher alone cannot prove ownership. New unassociated reserved orders remain blocked; this increment does not invent a mapping workflow.
- Repeated item/UOM/basis/reservation demands are added using exact decimal arithmetic. Combined demand also cannot exceed source on-hand stock.
- Verification and actual dispatch share the stable CRM item link, original retained receipt, confirmed `stock.availability` policy, source timestamp, latest sync status and reservation quantity checks. Upload/import time never substitutes for a source timestamp.
- `/orders` shows operational stock evidence, source freshness, pending movement counts and clear blocked states. Existing financial permissions and logistics ceilings are unchanged.

## Dispatch and local consumption

Actual dispatch rejects every unresolved stock issue, even when an order reviewer accepted commercial exceptions. The existing global order lock, exact pick limits and dispatch retry receipt remain in place. An exact successful retry returns its original shipment before checking a newer source, version or approval.

Dispatch appends a verified stock check and an immutable `crm_stock_consumptions` row for each shipped line in the same transaction as the shipment, fulfillment quantities and audit. An audit failure rolls the entire dispatch back. The rows retain the actual company, item, source record, receipt, source timestamp, stock basis and dispatcher.

Pending consumption is an uncertainty hold for that company/item. **The system does not guess whether Tally has already deducted it, subtract it again, or reset it merely because a new import arrived.** This prevents presenting an unverified available balance as current.

## Independent Owner reconciliation

The Owner section on `/orders` reads pending movements for an explicitly chosen company. A different actual active Owner with `rules.manage` must review a later successful, fresh source receipt and independently verify that it includes the exact dispatched movement. The reviewer supplies an evidence reference, reason and explicit attestation.

The preview fingerprint binds the retained source and actor. Submission rechecks the source under the order lock and appends immutable reconciliation history and audit. UUID/hash replay prevents duplicate reviews or changed commands reusing a key. The database independently validates the different Owner, company, item identity, current retained record, actual receipt source timestamp and later non-future observation.

After reconciliation and a source change, a partially dispatched order must be verified and approved again before another batch can dispatch. Availability alone is never treated as proof of movement reconciliation.

Relative endpoints:

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /api/crm/order-stock-sources?companyId=...` | `orders.update` | Operational retained Sales Order identities |
| `GET /api/crm/stock-consumptions?companyId=...` | Actual active Owner and `rules.manage` | Up to 100 pending movements |
| `GET /api/crm/stock-consumptions/:id/preview` | Actual active Owner and `rules.manage` | Later-source eligibility and fingerprint |
| `POST /api/crm/stock-consumptions/:id/review` | Actual active Owner and `rules.manage`, session and CSRF | Independent attestation, reason, evidence and UUID replay |

## Deliberately bounded remaining work

- Historical shipments without consumption evidence cause `LEGACY_STOCK_REVIEW_REQUIRED`. This increment does not backfill, adopt a guessed company or clear historical movements. They need a separate reviewed migration/reconciliation workflow.
- A legacy order without a saved company is visibly blocked for fulfillment. An undispatched editable order may be explicitly revised to select its company; dispatched historical orders cannot be silently revised.
- Unassociated or ambiguous reserved orders need a separately reviewed stable identity mapping before reserved fulfillment can proceed.
- Stock requests, quotation stock checks, shortage procurement handoff, pick-stage reservation planning and a reviewed historical reconciliation workflow remain separate increments. This document does not claim those are complete.
- The mapping fields and source age must be confirmed by the Owner. No business values are seeded by migration `0053_crm_stock_consumption_evidence.sql`.

## Verification record

Focused regression coverage is in `test/order-stock-fulfillment.test.js` and the updated partial-delivery flow in `test/sales-orders.test.js`. Tests use synthetic `ZZTEST_` data in the shared rollback transaction and explicitly simulate later retained source receipts. Real client documents and business records are not changed. Actual command results are recorded in the task report; the presence of tests alone is not a passing claim.


### Final focused result (7 November 2026)

After root applied additive migration 0054, the guarded command `npm.cmd test -- test/order-stock-fulfillment.test.js test/sales-orders.test.js apps/web/test/order-stock.test.mjs` passed **10 tests, 0 failures, 0 skips**. Both the initial and final whole-database `ZZTEST_` residue checks passed; process exit was 0. Evidence is `output/schema-audit/order-stock-final-focused.log`. Web typecheck, syntax checks and design-token checks passed. The tests cover wrong entity-kind, ambiguous/shared native ownership, exact aggregate demand, source freshness, no exception override, immutable pending consumption, later independent Owner reconciliation, retry, audit rollback and HTTP boundaries. No real Tally connection or real document/business data was changed.

Full combined regression, browser acceptance of this new stock flow, live receipt verification and independent-session concurrency acceptance are separate checks; this focused result does not claim them complete. Migration 0053 remains unchanged after application; 0054 adds the actual Sales Order kind restriction to the native association guard.
