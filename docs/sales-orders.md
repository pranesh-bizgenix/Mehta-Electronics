# Sales orders and dispatch

Open **Sales orders** in the sidebar. The module retains existing order IDs, customer history and routes. It reads already-imported Tally balances and stock; it never calls or writes to Tally, runs synchronization or changes connector code.

## Using the workflow

1. Create a manual order using **New sales order**, or open an approved/sent/won quotation and select **Create sales order**. The editor also searches eligible quotations. One order per quotation is retained from the existing CRM contract.
2. Enter the customer PO number/date, promised date, place of supply, and the total printed on the PO. Enter/edit PO part codes, quantities, rates, discounts, GST and UOM manually. A CRM item lookup supplies defaults; **Map selected CRM item** preserves an unfamiliar original PO code while linking its cost and stock identity.
3. Save the draft and upload the original PO. Supported originals are PDF, PNG and JPEG, up to 10 MB. There is no OCR or automatic line extraction.
4. Select **Verify order**. The screen compares PO and quotation lines, displays totals, saved stock, and permitted credit/margin information. Verification places the order in `HELD`, including a clean order awaiting independent review.
5. A different manager or owner reviews it. Commercial exceptions require an explicit checkbox and reason. Credit-limit or unavailable-balance exceptions require Owner review; Managers do not gain access to restricted Tally balances. Missing costs, inactive records, changed seller state and changed/unapproved source quotations must be corrected first.
6. Select **Pick list & dispatch**, pick quantities, and enter vehicle number, LR number, transporter and an e-Way bill number when applicable. Partial shipments are supported; quantities cannot exceed the remaining order quantity.
7. Upload delivery proof for each shipment, then explicitly **Confirm delivery**. The order becomes `DELIVERED` after all ordered quantities are dispatched and all shipments are delivered.
8. Use **Logistics / LR search** to find shipments by complete or partial LR number and open their orders.

Orders may be cancelled with a reason before any dispatch. Once dispatched, commercial lines and the PO original are immutable. Historical orders remain available through **Historical orders**; no existing records are silently enrolled or rewritten.

## Verification and holds

The shared quotation decimal engine calculates each line and CGST/SGST/UTGST/IGST components using exact integer arithmetic and half-up paise rounding. Seller state comes from the owner-configured quotation policy; place of supply is explicitly confirmed for standard domestic supplies. Special tax treatments remain outside this editor.

Two total comparisons are shown: entered PO total against calculated PO lines, and entered PO total against the frozen source quotation total. A difference **strictly greater than INR 1.00** creates a review flag; exactly INR 1.00 is within tolerance. Rate, quantity, discount, tax, UOM, missing/extra quote lines and jurisdiction differences are separately flagged. Matching is exact by PO part code or explicit CRM item mapping; split/merged quote lines can therefore require review.

Unknown PO codes require review. Unmapped lines must first be mapped to an active item with an owner-entered CRM cost; an unfamiliar original PO code can remain as an explicit approved exception. Existing active customer part mappings are recognised. UOM mismatches are not converted or assigned a guessed cost.

Margin uses the existing owner-configured gross-margin floor and line/total basis. Missing costs prevent approval; below-floor margins require an authorised reviewer to explicitly accept the exception. Costs and numerical margins are returned only to Owner/Manager pricing-authorised roles and stay out of general audit payloads.

Credit checks use the positive signed Tally closing balance plus other open CRM order totals plus this order, compared with the CRM credit limit. Negative balances contribute zero to debit exposure. A zero credit limit permits no credit. Missing or ambiguous linked balances hold the order; known order exposure is labelled as a subtotal, not a complete credit exposure. Credit figures remain restricted to Owner/Accounts; credit exceptions require an independent Owner.

This is a deliberately conservative check: an open CRM order may already be represented in the Tally balance, so exposure can overlap. There is no fabricated bill-level reconciliation or ageing. Reviewers must resolve/approve that business exception rather than treating the estimate as a reconciled receivable.

Stock displays imported quantity, fetch time, remaining requirement, and imported quantity less CRM dispatches recorded since that fetch. Only matching units can be compared. Missing/ambiguous or short stock creates a review exception. This is a saved-data check: there is no live Tally call, inventory adjustment, reservation or conversion. It cannot identify physical movements outside the stored import and CRM dispatch records.

Saved approval is bound to order version, PO hash, policy revision, costs, credit inputs and review flags. Relevant changes invalidate it before dispatch and require verification/review again. After the first shipment the approved source quotation snapshot is historical; later quotation edits do not rewrite the dispatched contract. Current margin, credit and stock checks still protect remaining dispatches.

## Originals, audit and retries

Original file bytes, SHA-256, original filename, detected MIME type, size, uploader and timestamps are stored in `crm_order_documents`. Originals are served only through authenticated order-read endpoints as attachments with no-store, nosniff and sandbox headers. Names cannot contain paths/control characters. Content signatures and canonical base64 are validated; this is not a malware-scanning service.

Customer plus normalised PO number is unique, preventing a second order for the same customer PO. Customer/PO identity cannot be changed by editing an order. Customer plus PO number plus original-file SHA-256 is also unique across retained PO versions. Uploading the same file again returns 409. Replacing a PO archives the previous original, increments the commercial version and invalidates approval. Archived originals remain downloadable for audit.

Delivery proof replacement is allowed before delivery and archives the prior proof; after delivery it is immutable. No physical deletion API exists. Order edits archive previous lines. Saved versions, events and shipment lines are append-only, and originals cannot be rewritten.

Dispatch requires a UUID `requestKey`. Retrying the same key and commercial dispatch details returns the original shipment without incrementing quantities again, even if the order has since been delivered. Reusing a key with different details returns 409. The UI keeps one key for each dispatch form, including retries after a network error.

Every create, revision, original upload/replacement, verification, approval, cancellation, dispatch and delivery writes an audit event. General audit entries contain public action metadata; private review snapshots are kept separately and redacted server-side according to financial/pricing permissions.

## Roles

| Role | Create/edit/verify | Independent review | Dispatch/proof/delivery | Financial balances | Costs/margins |
| --- | --- | --- | --- | --- | --- |
| Executive | Yes | No | No | Hidden | Hidden |
| Manager | Yes | Commercial exceptions | Yes | Hidden | Read |
| Accounts | Read only | No | No | Read | Hidden |
| Owner | Yes | Including credit exceptions | Yes | Read | Read |

The original creator and the latest commercial version's author cannot approve their own order. All new writes require session, CSRF, permission and a reason. Version checks reject stale edits/reviews/uploads.

## Additive schema and API

Migration `0013_sales_orders_dispatch.sql` makes the existing **CRM** `sales_orders.quotation_id` nullable for manual orders and adds archival columns to CRM order lines. It adds six tables, each with ID, creation/update timestamps, creator, status and soft-delete flag:

- `crm_order_workflows`: verification/approval state, PO identity and commercial snapshot.
- `crm_order_versions`: immutable commercial/pricing versions.
- `crm_order_events`: immutable actions and review snapshots.
- `crm_order_documents`: retained original PO and delivery-proof bytes.
- `crm_shipments`: vehicle, LR, transporter, e-Way bill and delivery state.
- `crm_shipment_items`: shipment quantities linked to original order-line IDs.

Migration `0014_dispatch_retry_guard.sql` adds the unique retry-key index on dispatch audit events. Both migrations are new; earlier migrations and raw/imported tables are unchanged. Managed order writes are guarded against bypass through older status routes. Existing unmanaged historical routes retain their behavior. Legacy order list/detail readers include manual orders and preserve their response field aliases and stored rounded totals.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/crm/order-quotes/:id` | Eligible quotation source |
| `GET/POST /api/crm/orders` | Search/status/paginated list / create |
| `GET/PUT /api/crm/orders/:id` | Detail / commercial revision |
| `POST /api/crm/orders/:id/actions` | VERIFY, APPROVE, CANCEL |
| `GET /api/crm/orders/:id/history` | Commercial versions and audit |
| `POST /api/crm/orders/:id/po-original` | Retain/replace original PO |
| `GET /api/crm/order-documents/:id` | Authenticated original download |
| `GET /api/crm/orders/:id/pick-list` | Remaining quantities and saved stock |
| `POST /api/crm/orders/:id/dispatch` | Retry-safe partial/full dispatch |
| `POST /api/crm/orders/:id/shipments/:shipment/proof` | Retain/replace delivery proof |
| `POST /api/crm/shipments/:id/deliver` | Confirm delivery, requiring proof |
| `GET /api/crm/logistics?lr=...&page=1` | LR search and pagination |

Order bodies use `customerId`, optional `quotationId`, `poNumber`, `poDate`, `promisedDate`, `poTotal`, `placeOfSupply`, `supplyType: DOMESTIC_STANDARD`, `notes`, `reason` and `lines` (`partCode`, optional `itemId`, `description`, `uom`, `quantity`, `unitPrice`, `discountPercent`, `taxPercent`). Existing edits require integer `version`. Upload JSON uses `name`, `base64`, `version`, `reason`. Approval exceptions use `acceptExceptions: true`.

Dispatch bodies use `version`, UUID `requestKey`, `vehicleNumber`, `lrNumber`, `transporter`, optional `ewayBillNumber`, `notes`, `reason`, and `lines: [{lineId, quantity}]`.

The local runner reports **14 migrations current**, with all recorded checksums matching. Before/after verification found unchanged row counts in all **48** existing business tables. The backup is retained at `%TEMP%/mehta-before-sales-orders-3b3640acb2fc.dump`.

## Verification and files

```powershell
$env:RUN_SALES_ORDER_DB_TEST='1'
node --test test/sales-orders.test.js
node scripts/verify-sales-orders.mjs
```

The PostgreSQL tests cover greater-than-Rs-1 thresholds, rate/qty/tax/margin flags, independent review, credit authority, missing approvals, duplicate originals, archived replacement files, stale costs, partial dispatch, over-dispatch prevention, retry replay, required proof, LR search, cancellation and imported-row invariance. Browser checks exercise the real UI/API/database, original download equality, a 2 MB upload beyond the old JSON limit, roles/CSRF and 390px layout. No external Tally calls or browser page errors occurred. Existing quotation tests and CRM/quotation browser regression scripts passed. Synthetic databases are retained, not silently dropped.

Evidence: [PO editor](../output/sales-orders/po-editor.png), [verification](../output/sales-orders/po-verification.png), [pick list](../output/sales-orders/pick-list-dispatch.png), [delivery audit](../output/sales-orders/delivery-audit.png), [LR search](../output/sales-orders/lr-search.png), [mobile](../output/sales-orders/lr-mobile.png), [verification report](../output/sales-orders/verification.json).

Changed files:

- `.gitattributes`
- `database/postgres/migrations/0013_sales_orders_dispatch.sql`
- `database/postgres/migrations/0014_dispatch_retry_guard.sql`
- `src/sales-orders.js`
- `src/sales-order-routes.js`
- `src/app.js` — CRM imports, registration and order handlers only.
- `src/db.js` — CRM order reader only.
- `src/rbac.js`
- `public/sales-orders.js`
- `public/app.js` — CRM navigation, modal presentation cleanup and order integration only.
- `public/quotations.js` — approved/sent/won quotation-to-order action.
- `public/design-system.css`
- `test-support/crm-module-fixture.js`
- `test-support/sales-order-fixture.js`
- `test/sales-orders.test.js`
- `scripts/verify-sales-orders.mjs`
- `docs/sales-orders.md`
- Seven linked evidence files under `output/sales-orders/`.

The pre-existing `apps/web/next-env.d.ts` edit is preserved and excluded from these commits. No connector file is changed. This work does not start, stop or restart project/connector services.
