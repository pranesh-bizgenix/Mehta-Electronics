# CRM remaining work - 6 November 2026

## Scope and evidence

This is a source audit requested by the user, not a new feature delivery or a production certification. It excludes the separate engineer's email/WhatsApp intake, AI extraction/classification, Make/Sheets flows, outbound sending and automation API backlog. Internal CRM validation, review, tasks, Tally data integration and operational backups remain in scope.

Compared sources:

- The supplied 70-page `Mehta ControlDesk - Client Requirements & Development Plan (1).pdf`, compiled 29 October 2026, read from Downloads with the existing local Python/pypdf installation. Its original filename uses an en dash. Requirements, proposals and pending decisions remain distinct.
- The process and solution architecture diagrams attached in this conversation.
- The later Master Prompt v2, especially Part D and S1-S12, together with the earlier explicit prompts.
- Current application source, screens, migrations, tests, release gate and the latest appended implementation evidence. Historical checklist rows are not automatically current.

No database or Tally connection, server start, test execution, installation, migration or application-code change was performed for this audit. Current live setting values were not queried. File existence, recorded test results and source behavior do not replace real-user acceptance.

The supplied architecture is a target design. Its AWS services and NestJS boxes do not override the user's existing one-application/one-database constraints or require replacing the current stack.

## Existing implementation to retain

These have implementation evidence and should not be described as entirely undeveloped:

- Six defined staff roles, provisioning, owner/backup fields, permissions, reviewer warnings, setup checklist, tasks and approvals.
- Customer and item Tally linking wizards, selected-company order views, detail, reconciliation, source freshness and sync status.
- New quotation editor, policy/letterhead and cost setup/history/import, exact calculations, revisions, independent approval, PDF generation and retained pricing-source checks.
- Reviewed CSV/XLSX/text-PDF/manual price imports, price levels, customer contract binding, and reviewed retirement/replacement of price lists.
- Standalone stock preview, reservation reconciliation, source-age checks, permanent history and daily staff counts.
- Manual procurement/RFQ comparison, supplier PO and GRN operations, partial dispatch, quantity protection, LR and POD features.
- Generic finance/support cases and read-only financial source views.
- Database identity guard, rollback-test helper, manual verified backup and migration backup requirement.
- Disabled Tally write outbox, mapping editor, review/dry-run/recovery infrastructure. This does not prove live two-way sync.

Latest recorded full checkpoint: **296 passed / 0 failed / 0 skipped**, initial/final residue scans clean, lint/typecheck/build passed. The existing log was inspected; these commands were not rerun for this audit. See `output/schema-audit/v2-credentials-full-tests.log` and `docs/release-gate.md`.

## Development still required

The rows below are work areas, not invented requirement counts or percentage-complete estimates.

| Area | What still needs development | Source and present-code evidence |
|---|---|---|
| 1. Decision register | EMPTY/PROPOSED/ENTERED/CONFIRMED/REJECTED lifecycle and history; confirmed-only setting access; Owner confirmation/rejection; CSV import/diff/export and printable decision sheet; dashboard of blocked workflows. Existing Rules is not the full v2 register. | v2 D1-D6/D9-D10; `docs/release-gate.md:24`; `src/modules/rules/workflow-rules.js:9` currently reads versioned business rules. |
| 2. Customer classification and pricing classes | Confirmed new/existing/potential evaluation and customer-type/lead routing; complete Medium Discount/Dealer Network/New class rules; agreed handling of a Do Not Quote customer's PO. Existing classification is manually maintained. | PDF F2 pp15-17, F4 pp22-26; `src/modules/operations/operations-service.js:132`; `src/modules/operations/customer-gates.js:26`. |
| 3. Quotation commercial exceptions | Sequential/multiple approval stages and the complete approved class/discount hierarchy; reviewed export/SEZ/special tax treatment. Preserve existing exact pricing, source binding and independent approval. | `src/modules/rules/workflow-rules.js:36` explicitly blocks unimplemented multi-step approval; `src/quotation-workflow.js:98` rejects nonstandard supply treatment; v2 S2. |
| 4. Stock through fulfillment | Carry company/source-bound stock evidence through enquiry/request, quotation, order and purchase request; integrate reservation/freshness checks into order verification and dispatch. | PDF F4/F7/F8; `docs/stock-checks.md:67`; `src/sales-orders.js:159` still uses stored stock minus local CRM dispatches. |
| 5. SKU and migration | Reviewed SKU-master import, matching/unmatched/duplicate review, repeat-safe migration jobs, reconciliation and general import/export screens; review legacy profile defaults/provenance without rewriting unknown history. | PDF F16 pp50-52; v2 S2; `src/crm-modules.js:199`; completion audit P34. |
| 6. Customer PO readers | Complete Johnson/KONE/DK Elektro/EMR layout readers with header/part/date/schedule normalization, totals and missing tax/HSN flags, review, retained originals/hash and revised-PO versions. Existing PO recording/upload and financial sample checks do not implement this entire flow. | PDF F7 pp31-33; v2 S3; `src/sales-orders.js:50`; `src/modules/documents/financial-evidence.js:27`; completion audit P35. |
| 7. Order schedules and changes | Grundfos/GE Vernova open-order schedule import/review; complete bulk sales-order Excel path; independent change/cancellation approval, initiator/authorizer history and full PO-SO-indent traceability. | v2 S3; PDF pp32-33; `src/sales-orders.js:215` currently supports direct reasoned CANCEL, not the requested independent request chain. |
| 8. Credit evaluation | Complete tier assignment, bill-wise overdue/grace evaluation, approved exceptions and exposure reconciliation, avoiding double counting of invoices and open orders. Existing aggregate credit guards and exemption checks remain useful. | PDF F7 pp31-33; `src/sales-orders.js:187` states the overlap limitation; `src/modules/rules/business-rule-definitions.js:14`. |
| 9. Purchasing | Sourcing-sheet import; unit-conversion/landed-cost comparison; exact confirmed Connectwell form generation; full extra-quantity and vendor-bank-change approval; vendor score; finish GRN difference/three-way workflow coverage. | PDF F5/F6 pp26-30; v2 S4; `src/procurement-routes.js:22` rejects unavailable exact export; `src/procurement.js:143` reports over-receipt. |
| 10. Supplier/principal document review | Format readers/review for Connectwell AO, HCE OA, RR Kabel and KGEP documents; supplier-to-PO price/quantity/unit/date comparison and margin/delivery-risk flags; retain and link invoice, packing slip and test-report evidence. No mailbox or AI extraction implementation is included. | PDF F17 pp52-54; v2 S4; existing manual procurement is not the completed sample-reader pipeline. |
| 11. Principal spreadsheets | Siemens consignment/pending-order upload, mapping, hash dedupe, review and linked transit/open-order state; revised dates, versioned snapshots, in-app refresh job logs/retry/failure alerts. Source-refresh direction/times remain subject to confirmation. | PDF pp53-54; v2 S4; completion audit P39; supplied consignment sample documented in the reference register. |
| 12. Warehouse and mobile | Box-level packing/photos, QR pick scans, inward-but-not-dispatched report with mandatory remarks, in-app delivery follow-up tasks, state/transporter settings and installable store PWA with safe camera/offline drafts. | PDF F8 pp33-35/F15 p50; v2 S5; `0040_workflow_foundations.sql:52` and `:89` reserve packing/scanning tables but runtime workflows were not found. Responsive screens do exist. |
| 13. Invoice linkage and collections | Complete confirmed Tally-creates fetch/link/PDF-handle path, GST mismatch and credit/debit-note references; advance hold/release chain, promise/PDC, collection stages/stop conditions, partial-payment tasks, ageing/DSO and balance-confirmation workflow. Actual outbound communications are excluded. | PDF F9 pp36-37/F12 pp43-45; v2 D8/S6; `src/modules/operations/operations-service.js:27` currently records an invoice reference; `src/tally-financial-read.js` supplies source views. |
| 14. Banking and vendor payables | Manual bank report upload, UTR/amount matching and accountant confirmation; BRS statement import/two-sided match/review; vendor statements, dues, interest/TDS and payment advices; complete payment-authorization workflow. | PDF F12 pp44-45; v2 S6; `0040_workflow_foundations.sql:149`, `:177`, `:203`, `:231` provide tables, not complete runtime screens/services. Basic configured payment checks already exist. |
| 15. RMA and returns | Agreed status migration, WRONG_ITEM claim workflow, uploaded close evidence, verified invoice/supplier/challan chain, dealer/principal replacements and return-credit-note links. Store a trustworthy approved-response event for first-response timing; do not treat draft creation as response. | PDF F13 pp45-47; v2 S7; generic warranty/return cases exist; `public/operation-descriptors.js` uses text evidence; `src/modules/operations/operations-service.js:108` currently records RESPOND directly. |
| 16. Dashboards and reports | Complete Owner cash/dispatch/margin-risk cockpit, department views, employee performance, confirmed-event KPI engine, incentive shell and full Excel/PDF report pack with large-export handling. | PDF F14 pp47-50; v2 S9; `src/modules/dashboard/dashboard.js:82` implements a narrower general dashboard; `business-rule-definitions.js:19` explicitly leaves weighted KPI implementation pending. |
| 17. People and internal controls | Complete shared-recipient task/reminder clearing, approved leave handover/urgent work, configured Admin identity, sensitive-screen user/time watermark and blur. Do not create an undefined Admin role. | PDF F1/F14; v2 S9; `src/modules/admin/user-admin-service.js:120` currently reassigns work/tasks; completion audit P52-P54. |
| 18. Tally operational gaps | Finish company-scope/entrypoint audit, connector-local queue reporting, large retained-payload download path and proposed mapping generator from retained real records with Owner/expert approval. Preserve implemented read, reconciliation, version, recovery and disabled write infrastructure. | PDF F10 pp37-40; v2 D7/S8; `src/tally-sync-monitor.js:24` returns unknown local queue; monitor `page.tsx:61` disables downloads above 16 MiB. |
| 19. Security and operations | Production startup refusal when localhost review mode is enabled; full route/upload/security audit; Owner-only audit access ceiling review; confirmed retention; scheduled verified backups; health/logging/alerts; process/restart/rollback docs and safe load harness. | v2 S10-S11; PDF pp6-7; `src/local-access.js:7`, `src/config.js:29`, `src/server.js:10`; audit service currently requires `audit.read`, not an explicit Owner role. Manual backup and MFA setup already exist. |
| 20. Final acceptance and documentation | Full non-automation walkthrough, every sample through its correct reader, complete screen/permission/mobile/error matrix, final canonical-schema/query audit and regenerated status report. | PDF pp68-70; v2 S12; `docs/release-gate.md:3`; focused tests/builds alone do not establish pack-wide acceptance. |

## Prem/client confirmation or source inputs

These are separate from code gaps. The audit did not read current live rule values, so this is a confirmation checklist rather than a claim that every corresponding database setting is currently empty.

- Pricing classes/levels and approval hierarchy; discount caps, margin floor/cost basis, terms/validity, tax exceptions and historical source precedence.
- Customer thresholds, Do Not Quote PO handling, owner assignment, credit tiers/limits/grace/exposure/exemptions and exception authority.
- Confirmed SKU master and matching rules; actual stock/reservation/source mappings and acceptable source age.
- Bank report field mappings, payment authorization criteria, collection stages and financial report definitions.
- Warranty/status/complaint boundaries, response-clock policy, replacement authority and evidence requirements.
- State lead times/transporter URLs, delivery evidence and timers, principal spreadsheet refresh direction/mapping/retention.
- KPI/incentive formulas; Admin identity and handover authority; audit/backup retention and deployment choices.
- Invoice authority and Tally category directions, real mapping identities, numbering, idempotency/read-back rules and live activation approvals. The later request proposes TALLY_CREATES; developer must not confirm it for Prem.

**Already supplied:** Johnson PO, KONE part mappings, Connectwell supplier-form reference and multiple other client PDFs/workbooks/emails. Do not ask the user to upload those again. `docs/reference-requirements-register.md:78` onward supersedes earlier missing-sample claims. A confirmed universal SKU master and explicit bank field mapping were not identified in the reviewed references. Receiving a sample does not confirm it as a universal business policy.

## Conditional features

Customer/vendor portals need confirmed external identity, tenancy, sharing permissions and scope. APK/native-versus-PWA remains a client decision; latest v2 specifically requests the internal warehouse PWA. Statutory invoice creation, IRN/e-Way and external provider calls are not approved simply because a box appears in a diagram; the latest request keeps non-Tally invoice adapters disabled. Field check-in/native push require the agreed mobile scope. These are not unconditional invitations to add new servers/cloud services.

## Human/live acceptance still required

- Authorized connector installation/update and real per-company counts, timestamps, incremental sync, financial/logistics coverage and recovery checks.
- Approved Tally mappings and actual native duplicate/read-back behavior before any write activation. All switches remain OFF; fixture dry-runs are not live proof.
- Real staff roles/reviewer coverage, browser/mobile/accessibility and actual document-output acceptance.
- Hosting/HTTPS/secrets and production authentication/MFA/recovery. Localhost review authorization is not production login policy.
- Authorized load window and backup recovery drill consistent with the single-database rule.

## Recommended CRM work sequence

1. Decision register and confirmed business-setting gates, then remaining customer/quotation approval rules.
2. Connect stock checks to fulfillment; finish customer-PO review, schedule import and independent order changes.
3. Complete purchasing/supplier review, principal spreadsheets and warehouse/PWA workflows.
4. Complete invoice linkage, accounts/BRS/vendor payables and after-sales workflows.
5. Complete dashboards/people/reporting, hardening and the full acceptance walkthrough.

This sequence is a recommendation for the user's current CRM-first focus, not a claim that it has replaced the previously authorized Master Prompt v2 execution order. No development was started by this audit.

## Task report

- Changed: this CRM-only gap report and a short implementation-log entry. No application code changed.
- Files: `docs/crm-remaining-work-2026-11-06.md`, `docs/client-plan-implementation.md`.
- Migrations/backups: none; database untouched.
- Commands: PowerShell `Get-Content`/`Get-Item`, `rg`, and `git status` used for source inspection; PDF extraction succeeded with the existing local Python312/pypdf. Default `py` launch and the guessed Program Files Python path were unavailable; the existing per-user Python path worked. No dependency was installed.
- Tests: not rerun for a documentation audit. The recorded previous 296/0/0 checkpoint was inspected, not regenerated.
- Unverified/risks: current live configuration and deployed artifact, complete runtime/client acceptance, external Tally behavior and every unnamed source requirement. Older checklist wording is stale in places; latest implemented pricing retirement, manual approval consistency and quotation binding were retained as delivered. No production-ready claim or completion percentage is made.
