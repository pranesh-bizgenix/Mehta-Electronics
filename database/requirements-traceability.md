# Database requirements traceability

**Status:** Evidence-based provisional mapping. The proposal PDF and exact 164-row client response matrix are not available. This file uses source-section labels and repository evidence only; it intentionally invents no requirement IDs.

## Source and status vocabulary

- **CLIENT-CONFIRMED**: explicitly stated by Prem Mehta in the supplied October 23 transcript.
- **CODE-VERIFIED**: implemented and evidenced by repository code, migrations, or tests.
- **ERD-PROPOSAL**: appears in the supplied image/text ERD, not yet validated as a client-approved rule.
- **TEAM-PROPOSAL**: appears only in proposal-derived summaries or planning documents.
- **INFERRED**: structurally useful but not explicitly approved.
- **PENDING**: lacks a rule, source, or decision needed for implementation.
- **NOT IMPLEMENTED**: no corresponding runtime capability found in the inspected repository.

## Traceability

| Source | Requirement / outcome | Evidence classification | Existing implementation | Target decision / acceptance evidence |
|---|---|---|---|---|
| Supplied ERD § Parties | Legal party may hold customer/supplier roles; contacts/addresses and external mappings | ERD-PROPOSAL | Customer, CRM party, vendor, contact, and Tally mapping concepts are separate | Canonical identity, GSTIN/branch uniqueness, role vocabulary, and legacy ID mapping |
| Supplied ERD § Customer POs | Header, multiple lines, repeated part codes, multiple delivery schedules | ERD-PROPOSAL; multiple POs CLIENT-CONFIRMED | PO identity/original is attached to a sales order; no normalized PO/schedule tables | PO-to-order cardinality, schedule revisions, source totals, and line-to-item mapping |
| Supplied ERD § Supplier POs / acceptances | Supplier orders and acceptance lines map to PO lines | ERD-PROPOSAL | CRM supplier POs and acceptance document kind exist; commercial details use payload/document records | Normalize JSONB; acceptance quantity/price/schedule effects and revision policy |
| Supplied ERD § Sales orders | Header/lines and unique order number | ERD-PROPOSAL; existing sales workflow CODE-VERIFIED | Manual and quotation-derived orders, version/approval workflow, shipments | Document-number scope, customer PO link, external Tally mapping, historical behavior |
| Supplied ERD § Allocations | Demand is allocated to supplier supply | ERD-PROPOSAL | No allocation table found | Quantity cap, reallocation, cancellations, concurrency and pending-quantity formula |
| Supplied ERD § Invoices | Issuer, invoice header/lines, partial invoicing | ERD-PROPOSAL; invoice workflow client-requested | No invoice schema/posting workflow found | Source-of-truth, legal numbering, currency/tax/rounding, order link, amendments and Tally voucher behavior |
| Supplied ERD § Dispatch | Split dispatch, LR/transporter, tracking and proof | ERD-PROPOSAL; partial fulfilment CLIENT-CONFIRMED | CRM shipments/lines, LR fields, delivery proof and explicit delivery action | Invoice-vs-order dispatch link, tracking provider semantics, proof/reversal lifecycle |
| Supplied ERD § Source documents | File hash, issuer/type/review; multiple extraction runs | ERD-PROPOSAL | Domain-specific original order/supplier documents, no generic extraction model | Deduplication vs multiple associations, storage/retention, extraction version, correction/review lifecycle |
| Meeting 2026-10-23 | Generated outbound response needs employee approval | CLIENT-CONFIRMED | Existing quote email path only; generic email workflows not implemented | Approval-bound content hash/version, recipient, attachments, roles, send retry |
| Meeting 2026-10-23 | Missing/ambiguous CRM data must request details, not invent reply | CLIENT-CONFIRMED | Generic automation not implemented | Required context per workflow; fail-closed state and acceptance cases |
| Meeting 2026-10-23 | Customer-specific pricing, three pricing structures, price import | CLIENT-CONFIRMED request; details PENDING | Price-list tables and owner-managed quotation costs exist; no complete tier/import engine | Tier definitions, approval boundaries, effective dates, source workbook/PDF, precedence |
| Meeting 2026-10-23 | Hide internal list-price/discount details in customer-facing quotation | CLIENT-CONFIRMED | Current quote workflow separates private/public details | Verify all APIs, PDF, print, email attachments and logs for redaction |
| Meeting 2026-10-23 | Bank-email automation excluded | CLIENT-CONFIRMED | No bank-email workflow found | Keep excluded unless explicitly re-scoped |
| Meeting 2026-10-23 | Two-way Tally, invoices, payments/payables, BRS, cheque/PDC, GST/TDS/TCS discussed | CLIENT-REQUESTED; write/security rules PENDING | Connector is read-only; no accounting postings | Field ownership, authorization, contract, idempotency, reversals, reconciliation, and statutory rules |
| Existing CRM docs/tests | Quote, sales order, procurement, dispatch, role/audit and saved Tally behavior | CODE-VERIFIED | Implemented in current application | Preserve test outputs and API compatibility through migrations |
| Repository `docs/requirements-traceability.md` | 164 proposal requirements across 15 modules | TEAM-PROPOSAL summary; source matrix PENDING | Exact row-level source IDs/wording unavailable | Do not claim proposal compliance until matrix is supplied and traced row-by-row |

## Blocking source gaps

1. The exact proposal PDF and full 164-row response matrix, including wording, priority, and client response.
2. Approved sample rate contract/pricing files and PO/invoice/acceptance templates.
3. Field ownership and authorized Tally write contract for every supported voucher/master.
4. Accepted commercial/financial policies listed in `business-invariants.md`.

The user instructed proceeding with currently available evidence. Therefore, unsupported rows remain `PENDING` and stay outside schema triggers, calculations, automated emails, and Tally write behavior.

## Acceptance evidence format

For each later-added source row, record the original requirement ID and wording, source/page/row, decision owner/date, implementation migration/code, test command and exact case, and client acceptance evidence. Do not convert a passing test into client acceptance.
