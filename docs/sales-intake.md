# Structured sales intake and warehouse availability

This module accepts externally structured Make JSON; it does not read a mailbox,
classify emails, run Make scenarios, send messages or connect WhatsApp. The sample
walkthrough is fictional and read-only. Existing customer, enquiry, quotation,
customer-PO, sales-order, work, notification and audit records remain canonical.

## Integration boundary

`POST /api/v1/automation/intake?companyId=<CRM selling-company UUID>`

Use an expiring credential from **Administration > Automation credentials**, scoped
only to `automation.write.intake` and the intended company. Send it as
`Authorization: Bearer <token>`. Never put the token in JSON, a URL or a log. Existing
credential rate limits, IP restrictions, expiry, revocation and rotation apply.
`Idempotency-Key`, if supplied, must equal the body's event ID. Maximum JSON body:
1 MiB. Staff mutations still require their session, CSRF token and permissions.

Schema version: `1.0`. The API's existing automation contract exposes the executable
schema. Valid categories are `CUSTOMER_PO`, `QUOTATION_REQUEST`, `LEAD_ENQUIRY`.
Examples in [sales-intake-examples.json](sales-intake-examples.json) are fictional;
replace their company/customer/item identifiers with verified CRM identifiers.
Do not import these examples into business data.

Envelope: `schemaVersion`, `eventId` (or equal `idempotencyKey`), `messageType`,
`companyId`, `source`, `provenance`, `header`, `items`. Source requires system,
mailbox, message ID and timezone-bearing receipt timestamp; optional thread ID,
original text and attachment references are retained. Provenance records extractor,
version and reference. Attachments contain identity, original name, MIME type, byte
count, SHA-256 and an S3 location reference, never file bytes.

| Incoming field / accepted alias | Canonical path |
| --- | --- |
| PO Number | `header.poNumber` |
| PO Date | `header.poDate` |
| Buyer / Company Name | `header.buyerName` |
| Supplier / Vendor Name | `header.supplierName` |
| Billing Address | `header.billingAddress` |
| Delivery Address | `header.deliveryAddress` |
| GST Number | `header.gstin` |
| Contact Person | `header.contactPerson` |
| Email | `header.email` |
| Phone Number | `header.phone` |
| Item Description | `items[].description` |
| Product / Material Code | `items[].productCode` |
| HSN / SAC Code | `items[].hsn` |
| Quantity | `items[].quantity` |
| Unit of Measurement | `items[].uom` |
| Unit Price | `items[].unitPrice` |
| Discount | `items[].discount` |
| GST Rate | `items[].gstRate` |
| Taxable Amount | `items[].taxableAmount` |
| Total PO Value | `header.totalPoValue` |
| Delivery Date | `header.deliveryDate` / `items[].deliverySchedules` |
| Payment Terms | `header.paymentTerms` |
| Other Terms & Conditions | `header.otherTerms` / `items[].terms` |

Each line has a distinct `lineId`. Money and quantities are exact decimal strings
with up to six decimal places. Discount requires `{kind:"PERCENT",value:"..."}`
or `{kind:"AMOUNT",scope:"LINE",value:"..."}`. A line amount is converted only if
its meaning can be represented exactly by the existing quotation engine; otherwise
it needs review. Missing is null, not zero. An address can be text or structured
text/line1/line2/city/stateCode/pincode/country fields. Dates use YYYY-MM-DD.
Conflicting aliases, unknown fields, invalid dates/decimals and inconsistent
delivery-schedule sums return actionable validation errors.

A structurally valid but incomplete extraction is retained as `NEEDS_REVIEW`.
Customer POs additionally require PO number/date/declared total before preparation;
requests/enquiries never receive fabricated PO fields. Exact declared-taxable and
grand-total differences remain blockers. An eligible draft requires approved
customer onboarding, confirmed item/unit/HSN, cost, tax policy, price, explicit
discount and quotation validity. A failed gate never means automatic approval.

## Configuration and access

Migration `0063_sales_intake_availability.sql` adds ten `crm_*` tables for source
intakes/deliveries/document links/policies/history and versioned availability,
lines/reservations/events. It grants no role permissions and seeds no policy.
All original extractions, delivery provenance and events are immutable. Deletion
and truncation are refused; use audited lifecycle actions.
Additive correction `0064_sales_intake_guard_record_shape.sql` isolates intake-only
trigger fields from other table shapes and binds staff checks to a source
fingerprint. The applied 0063 file is not edited by this correction.

An Owner configures the selected company's **Incoming requests > Saved CRM
requests > Intake settings**. Empty configuration keeps ingestion disabled.
`ingestionEnabled:true` is a deliberate module-specific decision, not permission
to change any existing automation switch or sender. Configure approved mailbox
identities, company state/tax treatment, assignment and quotation validity.

The existing Users & Roles screen can assign `sales_intake.read` and
`sales_intake.review`. Existing `work.reassign` governs reassignment. Sales sees
assigned requests; Owner/reassignment administrators see the wider queue.
No additional role grants occur automatically. Warehouse actions use existing
`logistics.read`, `logistics.assignment.manage`, `logistics.evidence.write` and
`logistics.grn.post`; assigned Store users receive operational fields only, not
prices, costs, margins, credit, totals or commercial policy.

Configure separate tier policies for PO and enquiry flows: distinct qualifying
records, statuses, company scope and whether to count the current record. Below
five is Early Bird; five and above is Elite, as confirmed on 23 November 2026.
Saving a configured tier policy without an exact-five choice now records ELITE.
Existing explicit historical choices are retained rather than silently rewritten.
Missing policy or unscoped historical
records remain visible blockers to a label, not invented commercial privileges.
Do Not Quote remains a separate customer restriction enforced by existing gates.

Response timing starts with the first persisted assignment. Configure qualifying
response actions, reassignment attribution, cancellation exclusions and explicit
no-pause/retain-history behavior. Existing `sla.policy` controls business hours,
holidays, timezone and `turnaroundMinutes.SALES_INTAKE`; unset means no deadline.
An explicit KPI definition/reporting period is needed before showing any score.
Receipt, CRM receipt, assignment and first response remain separate timestamps.
Opening a page never counts as responding. Display timezone: Asia/Kolkata.

## Workflow and stock accounting

1. Authenticated delivery is retained atomically with original values and provenance.
2. Verified customer/item IDs or existing customer-part mappings identify records;
   ambiguous identity is reviewed, never merged by a shared email or name alone.
3. PO retains canonical PO/line/version records; lead/request retains the existing
   enquiry. An eligible workflow creates one linked quotation DRAFT.
4. Each new quotation needs a pre-order warehouse request for its current version.
   Historical quotations without this requirement retain existing behavior.
5. Logistics assigns Store staff; staff records location, quantity and evidence for
   all lines. The full available/short line list remains visible.
6. An independent eligible Logistics reviewer verifies current source evidence and
   reserves all required quantities. Short, stale, mismatched or unknown balances
   cannot pass. Commercial quotation approval remains an independent later step.
7. Relevant revision/source/policy changes invalidate availability. Cancellation and
   expiry release local holds. Conversion transfers a hold to the existing order;
   partial dispatch reduces it and completed dispatch consumes it.

Warehouse progression: REQUESTED -> CHECKING -> SHORTAGE / PARTIALLY_AVAILABLE /
READY_FOR_REVIEW -> AVAILABILITY_APPROVED. Invalidated requests require quotation
revision and fresh checks. Source changes are also rechecked by the existing
scheduler job when that scheduler is deliberately enabled; server action gates
always recheck without depending on a scheduler.

Stock comes from stable, retained item identity and a successful fresh source
receipt. Configure verified warehouse balance pointers through `locationStock`
and existing `stock.availability`; warehouse masters or movements alone are not
available stock. Per-location balances/reservations must reconcile to global
balances. Free source stock already subtracts source reservations. Only the
unreflected portion of local ACTIVE/TRANSFERRED holds is subtracted again.
An order's own source-reflected hold is added back only for its fulfilment check.
Pending dispatch reconciliation blocks unsafe availability. Allocation uses the
same transaction advisory lock as existing order operations (812731), so competing
requests cannot reserve independently. No writes are sent to Tally.

## Retry and review operations

- Retry the identical event after a timeout: it returns the existing logical result.
- Same event/source with different business data returns 409; submit a separately
  identified revision for explicit review. Do not replace the original document.
- Different event IDs with the same source, attachment hash/business data or scoped
  customer PO reuse linked records. Delivery history retains each distinct delivery.
- Fix prerequisites in the existing customer, item, pricing, quotation or receiving
  screen, then save an intake review with its current optimistic version and reason.
- Once a quotation exists, revise it in Quotations. Refresh preparation preserves
  the source link and cannot silently overwrite extracted or approved history.
- Review internal bell notifications/My Work links; no outbound messages are sent.

## Verification and release

`node --test test/sales-intake-contract.test.js test/stock-availability.test.js test/price-import-plan.test.js test/customer-po-comparison.test.js test/quotation-approval-plan.test.js test/mfa-test-account-policy.test.js`

`npm.cmd run lint`, `npm.cmd --prefix apps/web run typecheck`, `npm.cmd run build`.

`node scripts/verify-sales-intake-ui.mjs` uses the existing single listener at
127.0.0.1:3000 and fictional browser-only API fixtures. It requires a built UI and
Chrome. It refuses real API traffic and never certifies database behavior.

`$env:VERIFY_AUTHORIZED_RDS_ROLLBACK='true'; node scripts/verify-sales-intake.mjs --browser`
uses the existing narrowly authorized RDS rollback harness. It refuses to create
fixtures before migration 0063 exists and reports executed scenario IDs, record IDs,
failures and cleanup in `verification-output/sales-intake/`. No local database,
alternate test database, integration activation or deployment is performed.
It also requires corrective migration 0064. The optional `--browser` uses the
actual APIs and records in that same rollback and the existing single listener.
Run the separate UI-fixture verifier when this listener is free, not concurrently.

`node scripts/verify-sales-intake-locks.mjs` with the same explicit RDS opt-in
tests advisory-lock exclusion/release using two independent connections and no
business writes. It is distinct from simultaneous duplicate HTTP delivery, which
cannot be proven merely by Promise.all on the serialized rollback harness.

`node scripts/verify-sales-intake-transactions.mjs` verifies the optional
`productionTransactions` mode used by this operational verifier. All existing
target/TLS checks, SQL restrictions, workflow savepoints, setting restoration and
the outer rollback remain mandatory. SQL errors inside a workflow abort that
workflow, as in production; they are not silently repaired statement by statement.
Root inspections retain statement-error recovery. Other callers and ordinary local
tests keep their existing default mode. Ten actual RDS cases verify SQL-error
rollback, same-connection recovery, no outer commit and zero retained test users.

Apply migrations only through the existing runner with a complete verified backup
inside the unchanged ten-minute window. Release requires actual persisted and
browser workflow evidence; a passing unit test or sample screen is insufficient.
The release artifact must include both 0063 and 0064: the existing startup runner
refuses a database containing migrations absent from an older application bundle.
Confirm mailbox/provider access, counting statuses/current-record inclusion, assignment, SLA/KPI, location
evidence and all commercial policies before adoption. The provided price workbook
also needs duplicate/formula/invalid-price/MOQ and unmatched-item review; the confirmed
0.63 -> 63% discount and exact matched-item UOM fallback do not activate a price list.
