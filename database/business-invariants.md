# Business invariants

**Evidence labels:** `CODE-VERIFIED` describes current implementation; `CLIENT-CONFIRMED` is explicitly stated in the supplied 2026-10-23 meeting; `ERD-PROPOSAL` is a proposed relationship/field; `PENDING` is not an approved rule.

## Current invariants to preserve

| Rule | Evidence | Implementation consequence |
|---|---|---|
| A quotation revision is versioned; issued/terminal quote content is not silently rewritten. | `CODE-VERIFIED`: quotation workflow migration and `docs/quotations.md` | Retain immutable versions/events and require version checks on edits/actions. |
| A quotation's customer-facing output must not expose private pricing/policy details. | `CODE-VERIFIED`: role-based redaction and quotation document behavior | Keep public and private snapshots distinct; test HTTP/PDF/print output, not only UI visibility. |
| Current standard domestic GST quotation flow requires explicit place of supply and configured seller state. | `CODE-VERIFIED`: `docs/quotations.md` | Do not broaden tax scope or infer tax rate from HSN. Special supplies remain blocked. |
| Existing quote calculation uses exact arithmetic and paise rounding; PostgreSQL stores numeric values. | `CODE-VERIFIED`: shared quotation math and `NUMERIC(20,6)` columns | Do not replace with JS floating-point totals or change rounding without approval. |
| The order workflow supports manual orders and quote-derived orders, multiple lines, independent review, dispatch, and delivery proof. | `CODE-VERIFIED`: order migration, routes, and `docs/sales-orders.md` | Keep manual-order and historical-order paths and existing API behavior. |
| Dispatch retries use a request key and cannot increment shipped quantity twice; stale approvals/versions are rejected. | `CODE-VERIFIED`: order/dispatch workflow and tests | Preserve idempotency, order-version checks, and transaction boundaries. |
| A shipment is not confirmed delivered merely because it was dispatched or a tracking state arrived. | `CODE-VERIFIED`: explicit delivery confirmation/proof workflow | Keep carrier events separate from human/system delivery confirmation evidence. |
| A customer plus normalized PO identity is unique in the existing order workflow; original uploads are retained/archived, not overwritten. | `CODE-VERIFIED`: `docs/sales-orders.md` | Preserve this existing rule unless a reviewed change establishes a broader PO-to-orders model. |
| Supplier prices/margins and selected Tally financial fields are restricted to authorized roles. | `CODE-VERIFIED`: procurement/Tally routes and RBAC | Enforce server-side row/field redaction and keep sensitive data out of general audit payloads. |
| Procurement receipts and supplier documents require review/independent actions and retain immutable originals/history. | `CODE-VERIFIED`: `docs/procurement.md` and migration 0015 | Maintain reviewer identity, version/fingerprint checks, and no hard-delete behavior. |
| Tally import/connector integration does not write vouchers or mutate Tally. | `CODE-VERIFIED`: README, Tally service/routes, and connector implementation | No new Tally write path may be added implicitly during schema redesign. |

## Client-confirmed meeting evidence

1. Generated outbound customer email must not send until an employee approves it.
2. When CRM data is incomplete or ambiguous, the automation must ask for the missing details rather than send an unsupported response.
3. Customers can have multiple POs/orders; partial billing/fulfilment and pending quantities matter.
4. Repeat customers may have customer-specific pricing and workflows; customer-facing quotations should not reveal internal list-price/discount details discussed in the meeting.
5. The discussed workflow explicitly excluded bank-email automation.
6. The client asked for pricing-list maintenance/import and PO extraction support. The exact file formats, validation, rules, and acceptance outcomes are not in the supplied evidence.

These statements establish desired behavior but do not define all database constraints, authorization roles, timeout values, thresholds, or exception workflows.

## ERD hypotheses requiring validation

- A customer party can have many customer POs; a PO can have many lines; a line can have many delivery schedules.
- A supplier PO can have many lines and acceptance documents; an acceptance can contain multiple lines tied to supplier PO lines.
- Customer order demand can be allocated across supplier PO lines.
- Sales invoices can be partially linked to order lines; dispatch can be split over multiple documents/lines.
- A source document can have multiple extraction runs and business-record associations.
- Parties may hold multiple roles.

Implement these only with the relationship/scoping choices in the target migration and compatibility contract made explicit.

## Pending business decisions: no inferred database enforcement

| Area | Pending rule |
|---|---|
| Party identity | Whether GSTIN is unique by legal party, branch, registration, or company; how duplicates and historical GSTIN changes are handled. |
| Document numbers | Uniqueness scope by issuer, company, location, fiscal year, document type, and cancellation/reissue. |
| Customer POs | Whether one PO creates one or multiple sales orders; schedule totals, amendments, accepted quantity, and duplicate handling. |
| Supplier acceptance | Whether an acceptance revises or supplements PO quantity/price/schedules; maximum accepted quantity; multiple acceptance policy. |
| Allocation | Whether over-allocation is prohibited, when allocations can be moved/cancelled, and how pending quantity is computed across revisions. |
| Invoice/dispatch | Whether invoices require a sales order; invoice cancellation/amendment; dispatch-before-invoice; authorized delivery reversal and proof rules. |
| Pricing | The three tiers, precise discount calculation/order, effective date precedence, customer/brand override, margin floor, approval thresholds, and price import format. |
| Finance | Currency, financial scale, tax-inclusive/exclusive treatment, calculation/rounding order, freight/packing/rounding, statutory GST/HSN/TDS/TCS, receipts/payables, credit/debit notes, and reconciliation tolerances. |
| Tally | System of record per field/entity, write authorization, duplicate/uncertain outcomes, cancellation, retry/idempotency, conflict resolution, and reconciliation ownership. |
| Automation | Approved email intents/templates, mailbox scopes, response-time windows, reminders/SLA, attachment policy, and approval delegation. |
| Document extraction | Supported types, model/provider, confidence semantics, human-correction rules, retention, and acceptance criteria. |
| Accounting controls | Payment matching/reversal, bank reconciliation/BRS, cheque/PDC states, approval separation, and audit retention. |

Do not add a hard `CHECK`, trigger, unique constraint, or automatic status transition that assumes one of these pending answers.
