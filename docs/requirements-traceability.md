# Requirements traceability register

## Source status

The supplied master prompt contains a proposal-derived scope summary and counts for 15 modules totaling 164 requirements. The referenced **Mehta-Siemens-ControlDesk-Complete-Programme-Proposal (Version 2.0, 26 August 2026)** PDF and its complete 164-row response matrix were not present in the repository or supplied attachment when this register was prepared. The summary is usable as a planning index; it is not a substitute for exact requirement IDs, wording, priority, or acceptance evidence.

No requirement IDs or acceptance criteria are invented here. Add one row per source requirement only after the authoritative matrix is supplied. Preserve each source ID and wording verbatim in the populated register.

## Status vocabulary

- **CONFIRMED** — stated by an available source; cite that source.
- **CLARIFICATION REQUIRED** — an interpretation, rule, or input is missing.
- **APPROVED** — the responsible stakeholder approved a recorded interpretation/design.
- **IMPLEMENTED** — working code exists; cite files and behavior.
- **TESTED** — a recorded test verifies the behavior; cite command/test/evidence.
- **ACCEPTED** — the agreed acceptance criteria are met and accepted by the designated stakeholder.
- **BLOCKED** — progress depends on missing decisions, data, access, or services.

These are evidence states, not a single linear lifecycle. Record evidence and approver/date for each applicable state. Do not infer APPROVED, TESTED, or ACCEPTED from implementation or a passing build.

## Module index

Counts below are copied from the supplied proposal-derived summary. They are placeholders for indexing, not fabricated requirement IDs.

| Module | Summary count | Current repository evidence (initial inventory) | Planning status |
|---|---:|---|---|
| A. Customer and CRM | 14 | Customer and contact records, duplicate detection, ownership fields in `src/app.js` and `src/db.js` | Partial implementation; row-level traceability blocked on matrix |
| B. Channel enquiries | 10 | Manual enquiry records and assignment | Partial; channel adapters and extraction not evidenced |
| C. Quotation and pricing | 15 | Quotations, revisions, PDFs, email, status flow and order conversion | Partial; approved price/version and commercial policies not evidenced |
| D. Vendor RFQ and purchasing | 12 | No corresponding module found in initial inventory | Not evidenced; traceability blocked |
| E. Order, stock and dispatch | 15 | Sales orders and statuses | Partial; inventory and dispatch workflows not evidenced |
| F. Billing, GST and Tally | 16 | Read-only Tally sync and reconciliation; no posting path | Partial; statutory and posting requirements blocked on policy/provider confirmation |
| G. Receivables | 9 | No corresponding module found | Not evidenced; traceability blocked |
| H. After-sales and returns | 5 | No corresponding module found | Not evidenced; traceability blocked |
| I. Reports and owner MIS | 15 | Pipeline dashboard metrics | Partial; KPI definitions and broader reports not evidenced |
| J. Mobile and portal | 6 | Browser UI exists | Requested mobile/portal workflows not evidenced |
| P. Accountability | 7 | User roles, enquiry assignment, audit log | Partial; reassignment/SLA/incentive requirements not evidenced |
| X. Controls and audit | 15 | RBAC, session protections, duplicate checks, audit log | Partial; maker-checker, 2FA and other controls not evidenced |
| N. Integrations | 8 | Read-only Tally, SMTP email, PDFKit | Partial; other providers and approved contracts not evidenced |
| Q. Security and scale | 12 | Authentication and session-security tests; no production readiness evidence | Partial; deployment, recovery, scale and security targets require approval |
| M. Masters and migration | 5 | Customer/item masters, Tally reconciliation, demo seed | Partial; migration scope and reconciliation criteria not evidenced |
| **Total** | **164** |  |  |

“Not evidenced” means not identified in the initial source inventory; it is not a claim that the business does not need the capability.

## Requirement row template

Populate one row per authoritative matrix entry. Use the source's ID and wording exactly; leave unknown values explicitly unknown.

| Source ID | Exact source wording | Module | Source/version/page or row | Status | Interpretation / decision link | Implementation evidence | Test evidence | Acceptance evidence | Owner / date | Blocker |
|---|---|---|---|---|---|---|---|---|---|---|
| Pending source matrix | Pending source matrix | Pending | Pending | BLOCKED | — | — | — | — | — | 164-row matrix unavailable |

## Baseline evidence

The existing repository checks passed during Phase 0: `npm.cmd test` (21 passing), `npm.cmd run lint`, and `npm.cmd run build`. This is repository baseline evidence only; it does not establish proposal compliance or acceptance. Link individual tests to exact requirements only after the matrix is available.
