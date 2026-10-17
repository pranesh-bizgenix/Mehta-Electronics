# Business-rule clarification register

## Purpose and evidence boundary

This register captures decisions needed before implementing commercial, financial, inventory, or statutory behavior. The supplied master prompt provides proposal-derived summaries, but the named proposal PDF and the 164-row matrix are unavailable. No specific threshold, calculation, state transition, or acceptance criterion below is treated as approved.

Record each answer with the decision maker, approval date, effective date, affected requirement IDs (once supplied), examples, and test cases. Until then, the affected operation is blocked or remains at its existing behavior.

## Clarifications requiring business approval

| Topic | Confirmed from available source | Clarification needed | Safe interim treatment |
|---|---|---|---|
| Price versions | Quotations exist; proposal summary calls for effective price versions | Version ownership, effective intervals, precedence, retroactivity, snapshot fields, expired/future version behavior | Do not add automated price selection or rewrite issued quotations |
| Margin thresholds | Proposal summary mentions floor margins and below-cost reporting | Margin/cost definition, included costs, per-item/order basis, thresholds by brand/customer/role, override authority and expiry | No new margin calculation or commercial approval threshold |
| Credit policy | Customer credit fields exist; proposal summary calls for holds/releases | Exposure formula and source, overdue treatment, credit days, tolerance, hold scope, release roles, override audit | Do not automate a new credit hold or release |
| Financial precision and rounding | Existing schema stores monetary amounts as `REAL`; proposal requires exact representation | Currency/currencies, scale, line-vs-document calculation order, tax/discount rounding mode, cash rounding, display precision, historical-data treatment | Preserve legacy values; do not silently round or migrate live records |
| Tax rules | Quotation lines have a tax percentage field; summary includes HSN/tax and statutory workflows | Tax source, place-of-supply logic, inclusive/exclusive prices, cess/rounding, effective dates, exemptions, validation source | Existing values are not proof of statutory correctness; no statutory invoice calculation |
| Invoice numbering | Proposal summary mentions numbering | Series by company/location/year/document type, reset policy, reservations, gaps, cancellation, concurrency and legal constraints | No invoice-number generation or posting implementation |
| Approvals / segregation | Current roles exist; summary calls for maker-checker and approvals | Actions requiring approval, thresholds, approver roles, self-approval, delegation, expiry, emergency override and evidence | Do not infer that OWNER or administrator can approve every transaction |
| Stock reservations | Proposal summary calls for reservations and allocation policy | Inventory source, available-to-promise formula, warehouse/lot/serial scope, priority, expiry/release, oversell and backorder behavior | No reservation or availability promise |
| Partial fulfilment | Proposal summary calls for partial dispatch and outstanding quantities | Allowed quantity changes, split shipments, shortage/backorder transitions, cancellation, rounding and order completion rules | Existing order statuses do not authorize dispatch behavior |
| Receipt allocation | Receivables summary calls for receipt allocation and statement imports | Source of receipt truth, reference matching, partial/multiple allocation, reversals, duplicates, unapplied cash and reconciliation | Do not allocate or mark any balance paid automatically |
| Tally posting | Current connector is read-only; Tally is described as statutory accounting system of record | Tally version, deployment, company, authorized write path/API, document ownership, payload contract, idempotency keys, duplicate/uncertain outcomes, reconciliation and operator rights | Keep the connector read-only; a request/timeout is never evidence of a successful posting |

## Additional blocking inputs

- Approved proposal PDF and exact 164-row response matrix, including original IDs and wording.
- Business owner for each decision and named acceptance authority.
- Approved customer/item master, migration source, data-cleaning rules, history window, and reconciliation tolerances.
- Role/record visibility matrix and separate system-administration versus commercial-approval responsibilities.
- Approved integration accounts/contracts for Tally, WhatsApp, email, GST/IRP/e-way providers, and bank statements as applicable.
- Deployment topology, user/concurrency targets, availability, recovery point and recovery time objectives.

## Decision record template

For each resolved item, record: decision ID; question; options considered; chosen rule; worked examples; source requirement IDs; approver/date; effective date; impacted schema/API/UI; audit requirements; test cases; rollback/recovery approach. A discussion or implementation is not approval.
