# Completion audit of the 66-prompt pack

**Current execution authority: 6 November Master Prompt v2 (Part A, Part D, S1-S12). See the appended v2 checkpoint; earlier stage numbering and statuses are historical evidence. New automation endpoints remain PLANNED.**

Audited against the attachment supplied on 5 November 2026: **Mehta ControlDesk – Client Requirements & Dev Plan / System Status Report prompt pack**. This is a requirements audit, not client acceptance or a production certification.

**Everything is not complete.** Earlier focused passes did not prove the full pack was delivered. Tables, generic case screens and responsive layouts are not substitutes for the requested importer, reconciliation, PWA or portal workflows. Work continues in prompt order, with the previous prompt's lint/typecheck/tests/build gate checked before further feature work.

Status vocabulary: **DONE** = the named implementation has concrete evidence, with stated limits; **PARTIAL** = development or verification remains; **BLOCKED-PREM** = a client decision/input is required and no value is guessed; **OUT-OF-SCOPE** = teammate-owned messaging/intake/extraction/sending. A DONE row is not blanket production certification. Live installation, acceptance and deployment remain separate release checks.

| Prompt | Status | Evidence / precise remaining work | Owner of next action |
|---|---|---|---|
| P01 Repository audit/rules | DONE | `AGENTS.md`, `docs/audit-baseline.md`; historical observations need ongoing refresh as code changes. | Development |
| P02 Live database guard | PARTIAL | `src/database-guard.js` verifies live database identity; alternate databases/schemas and old creation helpers refuse. Audit every remaining CLI entry, including non-DB tooling, for the literal all-script requirement. `.env.example` now names the permitted database. | Development |
| P03 Backup/migration backup gate | DONE | `scripts/backup-db`, `src/migration-backup.js`, migration runner; integrity/age tests. This is not scheduled backups or a performed restore. | Development / operator |
| P04 Transaction test helper | DONE | Five requested suites plus nine additional legacy suites and web connectivity use rollback transactions / protocol spies. Latest completed guarded regression: 215 passed, 0 failed, 0 skipped. Initial and final whole-database residue checks passed; no test database was created. | Development |
| P05 Logistics roles | DONE | Role migration 0034, operational ceilings, server projection/assignment/evidence tests. No Admin role or new financial access. | Development |
| P06 User provisioning | DONE | `/users`, reporting owner/backup, first-password change, reasoned deactivation and reviewer warnings; targeted tests. Localhost review bypass is an explicit user-approved exception, not production authentication. | Owner / development |
| P07 Setup checklist | DONE | Owner-only `/setup`, live readiness and fix links; setup tests. Readiness is configuration evidence, not transaction approval. | Owner |
| P08 Customer link wizard | DONE | Tally customer review/duplicate preview, stable identity/company links, reason, audit and idempotency; wizard tests. No all-ledger automatic copy. | Reviewer |
| P09 Item link wizard | DONE | Stock-group/brand filtering, part/HSN/UOM review and `crm_tally_item_links`; migration 0035 and tests. No Tally master rewrite. | Reviewer |
| P10 Quote policy/cost setup | DONE | Field validation, CSV/XLSX cost preview/history, exact decimals and blocked states; quotation-setup tests. No business defaults confirmed by development. | Owner |
| P11 Business rules | DONE | Missing values show their blocking workflows; Owner/reason/audit and workflow guards/tests. Multi-level commercial policy decisions still need confirmation. | Prem / Owner |
| P12 Connector preparation | PARTIAL | Versioned 1.3.0 package, hash manifest, administrator/backup/verification/result-file updater. Validation-only passes; no service installation by this work. | Authorized operator |
| P13 Order company filter | DONE | Required selected company on Tally order list/detail and regression tests/index. | Development |
| P14 Full order reconciliation | DONE | Company/status counts and manual source comparison with identity/missing-number distinctions; report tests. No live completeness certification without source counts. | Tally operator |
| P15 Company scoping audit | PARTIAL | Most visibility/order/payload endpoints are covered. This audit found legacy master list/detail paths still accepting missing company; fix and tests added. Recheck every alias before closure. | Development |
| P16 Incremental/freshness | PARTIAL | Per-dataset receipt/capture/age evidence and alteration checkpoints implemented. Updated connector must run against real Tally; source time remains explicitly unknown when not delivered. | Operator / development |
| P17 Tally order detail | DONE | Detail drawer, lines/quantities/status/company, search and financial-role whitelists; order scope tests. No inferred pending quantity. | Development |
| P18 Per-order sync status | DONE | `src/tally-order-sync-state.js`, CRM list/detail evidence and tests; absence/conflict/failure are distinguished. | Development |
| P19 Conflict/recovery | PARTIAL | Conflict screen, source-policy block, reviewed resolution/audit and queued read recovery; conflict tests. Requesting recovery is not completed delivery. | Owner / operator |
| P20 Field mapping | PARTIAL / BLOCKED-PREM | Owner mapping versions/editor, real imported-record lookup, stable identity validation and dry-run XML built. Actual 13-14 mappings remain empty. See docs/tally-two-way-sync.md. | Prem / Tally expert |
| P21 Write outbox | PARTIAL / BLOCKED-PREM | Isolated tw_* snapshots/events, approvals, leases, UNKNOWN recovery, breaker/throttle, permissions and monitor built; migrations 0045/0046. All switches OFF, dry-run-only TRUE, missing settings NULL. No live acceptance. | Prem / operator |
| P22 Sales-order push | PARTIAL / BLOCKED-PREM | Guarded producers, separate connector Write execution, company/duplicate preflight, CREATE-only XML and strict read-back tested with fixtures for all three categories. Actual Tally behavior/deployment/activation unverified. No live push claimed. | Prem / operator |
| P23 Invoice read/link path | BLOCKED-PREM | Invoice-creation ownership and stable order/shipment linkage need confirmation. Read-only source invoice viewing does not complete this prompt. | Prem |
| P24 Receipts/payments read | PARTIAL | Financial-only receipt/payment, cheque, supplied-percentage/exact-amount/date searches and bill report parsing/links; tests. Installed connector delivery must be verified. | Accounts / operator |
| P25 Sync monitor | PARTIAL | `/tally/monitor`: jobs, receiving/indexing evidence, server queues, audited read/retry and retained downloads. Connector-local queue remains unreported; downloads above 16 MiB need a bounded/streamed path. | Development / operator |
| P26 Context links | DONE | Customer-to-enquiry, quote-to-order, exact history/source links; real-handler and intercepted browser tests. | Development |
| P27 Global search | DONE | CRM-first linked Tally results, selected company, permission filters, debounce and keyboard tests. Production scale benchmarking is not performed. | Development |
| P28 Screen states | PARTIAL | Static audit covers all actual routes; shared state/long-text fixes and selected desktop/mobile checks. Exhaustive per-page runtime/error/permission matrix remains. | Development |
| P29 Customer restrictions | PARTIAL | Four states, exemption and one handler exist; independent Owner clearance added. Automatic new/existing threshold definition and VIP/type routing remain. Potential-customer threshold is not falsely treated as the new/existing rule. | Prem / development |
| P30 Bulk price lists | PARTIAL | CSV/XLSX/text-PDF and manual entry share exact preview, original retention, hash replay, independent approval and activation; 15k-row tests. Reviewed supersession and real-layout/browser acceptance remain. | Development / Prem |
| P31 Locked pricing/contracts | PARTIAL | Owner-confirmed levels, dated approved source lists, exclusive contract identity and net-only quote binding implemented/tested. Supersession, historical provenance and full client acceptance remain. | Prem / development |
| P32 Remaining quote pricing | PARTIAL | Current legacy/managed summaries, document/compact formatting and margin comparisons use shared exact primitives, with six private sample financial checks. Class-specific/special/export/SEZ workflows still remain. | Development / Prem |
| P33 Stock check log | PARTIAL | Company-scoped exact stock evidence, reservation reconciliation, preview/record UI, append-only history and daily staff counts implemented. Full gate 283/0/0 with clean residue; real mappings/source delivery, order fulfillment integration and browser acceptance remain. | Development / Prem |
| P34 SKU master/import jobs | BLOCKED-PREM | A confirmed SKU master and matching rules are not identified. Import jobs and unmatched review still need implementation. | Prem / development |
| P35 Johnson PO parser | PARTIAL | Supplied private sample now has financial evidence for all 15 item rows and explicit printed-rounding differences. Complete PO/date/part/schedule normalization, review/versioning and hash retention are still not implemented. | Development |
| P36 Credit tiers/check | PARTIAL | Order credit/exposure guards and empty policy blocks exist. Confirm tier/grace/block criteria and bill-wise overdue/source rules. | Prem / Accounts |
| P37 Order change/delete | PARTIAL | Approval locking/version history exists; complete independent change requests and reasoned soft-delete chain still needed. | Development |
| P38 Procurement completeness | PARTIAL | RFQ comparison, supplier PO, GRN and differences exist. Sourcing Excel import, confirmed Connectwell-specific export and all over-quantity gates need completion. Supplied template is reference evidence. | Development / reviewer |
| P39 Siemens spreadsheets | PARTIAL | User approved deterministic spreadsheet review only; supplied consignment file is available. Manual upload/idempotency/review for both structured formats remains. Email/extraction ownership stays with other engineer. | Development |
| P40 Warehouse completion | PARTIAL | Partial dispatch, quantity protection, LR and evidence exist. Packing by box, QR picking, mandatory inward remarks/report, state/transporter configuration remain. | Development / Prem |
| P41 Invoice creation decision | BLOCKED-PREM | No invoice creator/numbering activation decision. Do not issue statutory invoices. | Prem |
| P42 GST/IRN/e-Way adapter | BLOCKED-PREM | Internal disabled adapter/storage not complete; provider/external-URL exception needs confirmation before any external calls. | Prem / development |
| P43 Bank payment report | BLOCKED-PREM | Manual parser/matching/confirmation needs Prem's bank field mapping, not yet identified. No email pull. | Prem / Accounts |
| P44 Receipts/advance | PARTIAL | Receipt confirmation/overpayment guard/partial collection hold exist. Follow-up task and complete 100% advance order hold/release chain remain. | Development |
| P45 BRS | PARTIAL | No complete manual bank-statement import, two-sided matching and audited resolution screen. | Development / Accounts |
| P46 Notes/ageing/DSO | PARTIAL | Financial source/outstanding view exists. Credit/debit links, GST mismatch, confirmed ageing/DSO calculations and complete balance UI remain. | Accounts / development |
| P47 RMA/warranty | PARTIAL | Policy-blocked generic warranty/return cases and independent decisions exist. Agreed status migration, evidence files and dealer/principal replacement tracking remain. | Prem / development |
| P48 Owner cockpit | PARTIAL | Dashboard/pipeline/SLA/decisions exist. Full cash/dispatch/margin-risk cockpit and confirmed value ranking/legend remain. | Prem / development |
| P49 Department dashboards | PARTIAL | Permission-aware dashboard sections exist; all requested department views/fields and server visibility tests remain. | Development |
| P50 Reports pack | PARTIAL | Selected charts and exports exist, not the full report pack or streamed large Excel/PDF generation. | Development / Prem for formulas |
| P51 KPI/incentives | PARTIAL | Weights can be configured; complete confirmed-event KPI implementation and incentive shell remain. No payroll changes. | Prem / development |
| P52 Shared reminders | PARTIAL | In-app bell/tasks exist. Shared multi-recipient reminder status/clear behavior and complete role-dashboard coverage need explicit verification/completion. Sending remains OFF. | Development / Prem |
| P53 Handover | PARTIAL | Backup/work/task reassignment exists. Named/configured handover approver and urgent post-approval workflow remain; no Admin role inferred. | Prem / development |
| P54 Screenshot deterrence | PARTIAL | Draft-PDF watermark does not satisfy user/time cost-screen watermark and blur-on-hidden requirement. Scope still needs confirmation. | Prem / development |
| P55 Warehouse PWA | PARTIAL | Responsive web is not an installable PWA. Manifest/service worker, safe offline drafts/QR/camera workflow remain. | Development |
| P56 Customer portal | BLOCKED-PREM | Identity, tenancy and sharing decision must precede external customer access. | Prem |
| P57 Vendor portal | BLOCKED-PREM | Portal versus reply-channel decision is outstanding. | Prem |
| P58 Security audit | PARTIAL | Session/CSRF/RBAC/rate limits/headers/error safeguards exist. Full route/upload/secrets/injection/XSS audit and complete automated findings closure remain. | Development |
| P59 MFA enforcement | PARTIAL | TOTP/recovery/role configuration exists. Setup activation/production recovery acceptance remain; localhost bypass was explicitly authorized and must not be mistaken for production enforcement. Admin is undefined. | Owner / development |
| P60 Scheduled backups | PARTIAL | Manual pg_dump/list/checksum and migration gate exist. Confirmed schedule/retention/in-app status and complete restore runbook remain. No restore is authorized. | Owner / operator / development |
| P61 Observability | PARTIAL | Basic `/api/health` and selected request/errors exist. Disk/migration/connector health contract, counters/structured redaction and alert screen remain. | Development |
| P62 Load tests | PARTIAL | No authorized load window. Prepare safe harness/purge verification first; do not execute synthetic load against the sole DB without confirmation. | User / development |
| P63 Audit search/retention | PARTIAL | Filters/append-only history and empty retention rule exist. Owner-only enforcement must be audited independently of mutable permission grants; all hard-delete affordances need review. | Development / Prem |
| P64 Production preparation | PARTIAL | Single app build/start exists. Complete process definition, variable inventory, HTTPS/release/rollback checklist remain; current `.env.example` needs correction. Do not deploy. | Development / owner |
| P65 Acceptance script | PARTIAL | Focused workflow/role/browser tests exist, not a full pack-wide acceptance script. Full rollback suite and end-to-end acceptance matrix must pass. | Development / client |
| P66 Honest report/docs | PARTIAL | F1–F17 log exists but contains historical/stale claims. Requested `output/system-status-2026-11-03/generate-report.mjs` is absent in this checkout; recreate the read-only report workflow before regeneration. | Development |

## Staged completion request S0-S10 - 5 November 2026

The subsequent staged request is authoritative. S0 is in progress; later stages have not been passed merely because reserved tables now exist. The named LLD/prompt-pack Markdown documents remain absent. The private sample tree has now received supplied references, but their contents are not business-policy confirmation or executable instructions.

| Requirement | Status | Evidence / remaining work |
|---|---|---|
| S0.1 classify tables and canonical identities | DONE | Read-only information_schema/pg_catalog generator, docs/db-schema-reference.md and schema-policy.json classify 182 base tables + four views. Preserve all compatibility models; order execution is sales_orders + crm_order_workflows, normalized PO evidence is customer_pos. |
| S0.2 PK, FK, state, money, provenance, archive and uniqueness integrity | PARTIAL | Migrations 0039-0043 repair operational status domains, five actual cache/source/company FKs, source-document identity, foundation constraints and provenance/archive metadata on 89 business tables. No unresolved findings in the narrower structural categories; 25 external/polymorphic ID exceptions and 14 geographic/source/out-of-scope status exceptions remain explicit. Legacy line provenance and per-row archive metadata now have rollback regression evidence, including legacy enquiry creation/revision and contact replacement. Migration 0044 and workflow-integrity-policy.json cover reviewed operational quantity/price checks, required identities and nullable source review fields; signed source evidence remains preserved. Missing named LLD coverage remains explicit. |
| S0.3 FK/filter indexes and ten heavy query plans | PARTIAL | Missing FK/filter indexes added. scripts/explain-schema-workload.mjs collected 32 actual repository SELECT plans, with the ten highest estimated costs recorded. No ANALYZE or load generation; no observed global production-query ranking is claimed. |
| S0.4 immutable versions/events/audit | DONE | Catalog audit verifies enabled rejecting UPDATE/DELETE/TRUNCATE guards; migration 0039 adds missing truncate guards. Rollback tests prove mutation denial on their own audit row; existing version/history tests remain in the full suite. |
| S0.5 missing workflow schema | DONE | Migration 0040 adds 21 reserved tables plus kpi_confirmed_events: stock checks, picking/packing/photo links, item factors, empty price levels, dry-run-only Tally outbox/config, vendor dues/advices, customer schedules, bank reconciliation and WRONG_ITEM claims. New records require actor/reason; independent review is bound to the actual actor. No business rows or policy values seeded. This is schema-only evidence, not completed UI/API workflows. |
| S0.6 schema tests and full gate | PARTIAL | Full guarded regression after 0042 passed 203/0/0. After 0043, enquiry actor-context and a synthetic contact fixture were corrected; the latest completed run passed 207/0/0, with both whole-database residue scans clean. Lint, web typecheck and production build (32 pages) passed. Quantity follow-up 0044 passed both new tests and the full 209/0/0 regression, with clean initial/final residue scans; lint/typecheck/build passed. The 25-workflow matrix is based on the explicit staged request, not the missing LLD. |
| S1 exact financial arithmetic | DONE | Existing monetary API/storage/summaries/PDF/display use shared exact arithmetic. Six runtime private-document financial checks cover Johnson, two KONE files, HCE, Connectwell and DK; missing source tax/HSN and printed rounding differences stay explicit. Compact dashboard amounts, margin flags and input bounds are exact. Gate: 257 passed/0 failed/0 skipped; clean initial/final residue scans, lint/typecheck/build pass. This does not mark later importers or future reports complete. |
| S2 pricing, price lists and stock | PARTIAL | Reviewed CSV/XLSX/text PDF/manual imports; Owner levels and retained quote source/contract identities; financial projections gated; stock evidence/history/daily UI implemented, full gate 283/0/0 and clean residue below. Supersession/retirement, legacy profile provenance, stock fulfillment integration and client acceptance remain. |
| S3 deterministic document workflows | PARTIAL | Supplied documents now reside privately; layout review/parser/normalization/version/reconciliation flows remain. No AI/email intake is implemented. |
| S4 procurement, warehouse and PWA | PARTIAL | Existing RFQ/PO/GRN/dispatch retained; new packing/scanning tables are foundations only. Remaining workflows and empty PWA/native decision setting still need implementation. |
| S5 receivables, payables and banking | PARTIAL | Typed bank/vendor foundations are present. Matching/confirmation/BRS/ageing/advance workflows and disabled statutory adapters remain. |
| S6 claims, tasks and dashboards | PARTIAL | Existing cases/tasks remain. WRONG_ITEM and confirmed KPI-event schema exists; reviewed first response, dashboards/reports and empty formula/incentive features remain. |
| S7 Tally integration | PARTIAL / BLOCKED-PREM | Existing read contracts/source hashes retained. New separate disabled CREATE transport, mapping/UI/outbox/recovery tested in tw_* tables; old reserved dry-run table unchanged. See G1-G9 evidence and human runbook. No live Tally verification or connector install. |
| S8 security | PARTIAL | Full route/upload/security audit, explicit production refusal of localhost review mode and complete MFA/recovery acceptance remain. No MFA setting activated. |
| S9 operations and performance | PARTIAL | Verified pg_dump backups and migration gate exist. Scheduling/retention/recovery runbook, health/alerts/process configuration and authorised load test remain. |
| S10 acceptance and final audit | PARTIAL | Final E2E acceptance script, S0 recheck, regenerated system report and release checklist remain. |
| Confirmed business decisions | BLOCKED-PREM | Margin/cost basis, levels/discount/approval limits, credit/grace, warranty, reminder/KPI/incentive formulas, price-level meaning, invoice authority, write direction/conflict winner, GST provider, portals and PWA/native remain empty where unconfirmed. Build guards and interfaces; do not infer policy from samples. |
| Messaging/intake/AI/Make/SMTP/sending | OUT-OF-SCOPE | Teammate-owned. No integration or switch activation; in-app tasks, notifications and reviewed drafts remain in scope. |

Applied migrations and backups:

- 0039_schema_integrity.sql and 0040_workflow_foundations.sql: verified backup mehta_electronics_local-2026-11-05T06-37-30-959Z-d52b3295.dump.
- 0041_schema_fk_completion.sql: the old backup was correctly rejected as stale; fresh verified backup mehta_electronics_local-2026-11-05T06-57-36-579Z-a93a155f.dump, then apply succeeded.
- 0042_tally_evidence_states.sql: verified backup mehta_electronics_local-2026-11-05T07-14-20-022Z-032cdf28.dump. Existing SUPERSEDED/MATCH lifecycle states retained. No applied file edited and no source row rewritten.

Current checks: lint, TypeScript and production build passed; four focused schema tests passed. Full-suite corrective verification is recorded below when complete. No connector installation, deployment, live-writing load test, statutory invoice issue or message send.

## Current audit fixes and verification gate

The earlier full-suite attempt was rejected by automatic review because legacy helpers remained. Nine legacy suites were converted to rollback-only tests / SQL protocol spies; HTTP checks now invoke the real handler without a socket listener. The importer adapter now supports its explicitly named nested savepoints and postgres.js bulk fragments while refusing outer commits and DDL.

This exposed a separate connector pool escaping rollback. `createApp` now gives its connector store the supplied database client. Exactly five synthetic Test PC profiles and receiving staging sessions escaped before the fix; no retained payload or imported source record was associated. Automatic review initially rejected deletion under the no-hard-delete rule. The user explicitly approved a one-time exact fixture cleanup, and those five UUIDs were removed only after identity/reference checks. Verification found zero of those five remaining. This exception does not authorize hard deletion of business records.

Additional code fixes: legacy master list/detail now require the selected company; import retention/processing timestamps use actual statement time so multiple imports inside a transaction do not tie on transaction-start time. Completion of lint/typecheck/full tests/build is recorded in `client-plan-implementation.md` as commands finish.

No deployment, Tally writes, service update, business-policy defaults, real staff account or messaging automation activation is part of this audit. Tests use fake transport implementations; committed automation settings remain untouched.

Final verification: `npm.cmd test` **PASS: 198 passed, 0 failed, 0 cancelled,
0 skipped**, including the importer-savepoint regression and fresh-connection
connector rollback assertions. Initial and final whole-database ZZTEST_ scans
passed. Root lint, TypeScript, production build (32 pages), static state audit
(31 source routes), seven intercepted browser checks and diff checks passed.
These results cover the existing implementations; they do not implement the
remaining workflows listed above or certify live Tally completeness.


## BLOCKED-PREM: guarded Tally CREATE release (5 November 2026)

Infrastructure is authorized with every production switch OFF. Required before activation: categories/order of activation; party-ledger authority; approved versioned mappings; voucher types and numbering; stable party/item/accounting ledger/godown/unit identities; date/tax/posting/discount fields; idempotency field/export method; current-company/identity/read-back probes; global/category approval mode; per-field and complete-record conflict winners; attempts/backoff/breaker/gap/cap/lease thresholds; Tally version/edition and XML-import availability. All remain empty or unverified. Human Tally backup, copied-company acceptance, connector staging/install and production sign-off remain pending.

See docs/tally-two-way-sync.md for settings and G1-G9 evidence/limits, and docs/tally-write-live-verification.md for the human runbook. Migration 0046 corrects only a function introduced in this task by 0045; this routine replacement is disclosed. No pre-task read schema definition changed. Independent-session race/load testing and installed Windows service behavior are not certified by rollback/fake-handler tests.

Final disabled-infrastructure gate: 247 tests passed, 0 failed, 0 skipped; initial/final ZZTEST_ scans clean. Connector in-process fake checks: 7 passed, 0 failed. Lint, typecheck, build and read-only schema audit pass. Native CREATE collision behavior/concurrent Tally creation must also be confirmed by the Tally expert before any live activation.

## S1 sample financial evidence follow-up

The previous goal turn made verified progress: isolated disabled write infrastructure, live OFF/empty-state evidence and its full 247-test gate were delivered. This resumed goal turn returned to the earlier S1 gap before further pricing features.

New evidence: test/private-financial-evidence.test.js reads six optional private references at run time; financial-evidence.test.js covers synthetic extraction/bad-input behavior; quotation-margin.test.js and the frontend format tests cover exact small/large/half-up boundaries. Reference PDFs are git-ignored. The HCE/Connectwell/Johnson files previously supplied in Downloads were copied into that private fixture structure without modifying the originals or importing anything into the database.

Johnson printed rounding differences are not converted into a global rounding policy. KONE missing tax/HSN stays flagged; absent tax never implies zero or exemption. Connectwell does not imply an unprinted tax percentage. Offline extraction of the supplied DK PDF reference attachment does not implement email intake. Full S3 PO/review/version workflows remain incomplete.

Private checks skip clearly if files/Python/pypdf are absent; current local files and dependencies were available. No client prices or identifiers are committed as expected values or printed by assertions. No migration, business setting, automation switch or Tally direction changed.

S1 final verified gate: npm.cmd test -> 257 passed, 0 failed, 0 skipped; both whole-database residue checks PASS. Lint, web typecheck, production build and focused diff checks PASS. Initial private-evidence gate was 255/0/0; subsequent exact compact/margin fixes added two tests. All six supplied-document checks ran locally rather than skipping. Git ignore/status evidence shows only README/.gitkeep markers eligible for tracking in the private sample tree. No migrations or business-policy values changed. S2 is next; overall S0-S10 completion remains unproven and active, with missing named-LLD coverage and later stage work retained.


## 2026-11-06 S2 import review delivery (stage remains PARTIAL)

- DONE for current CSV/XLSX slice: explicit source/worksheet/column/constant/first-row mapping; no currency, dates, MOQ or discount defaults; exact decimal checks; both duplicate rows flagged; active CRM item and unit checks; 15,000-row pure-file plan tests and the two supplied private workbook reads.
- DONE in rollback tests: original-byte retention, hash/plan replay, preview invalidation, inactive save, unset-policy block, independent approval/activation, exact canonical prices, immutable import evidence, legacy-editor protection, policy-version staleness, financial-role denial and session/CSRF HTTP checks. No actual client price list is imported by tests.
- Migration 0047 applied through existing runner after verified fresh backup mehta_electronics_local-2026-11-06T04-43-26-345Z-6aada36a.dump. Schema reference regenerated: 199 relations / 2801 columns, 43 documented exceptions / zero unresolved. Original schema snapshot bytes are unchanged; its comparison covers original tables and allows additional independent module tables.
- PARTIAL: PDF tables; price-level meaning/configuration; customer-exclusive dated price selection; reviewed retirement/supersession; old manual price-list creation still has its separate legacy lifecycle; stock-check log/daily analysis/free-versus-reserved presentation. Browser rendering/client acceptance not performed. Details: docs/price-list-imports.md.
- BLOCKED-PREM: price_lists.approval_policy reviewer permission/instructions and real import mappings/validity; price-level meaning and confirmed selection/supersession policy. No new setting value has been seeded. Existing Tally writes remain OFF and messaging remains out of scope.

Verification records: output/schema-audit/s2-price-{lint,typecheck,build,full-tests}.log. Lint/typecheck/build completed PASS; final complete-suite count is appended after the running process terminates. Initial focused gate failed one assertion-message check after activation correctly succeeded; rerun uses the independent reviewer for the immutable-mapping assertion. Both focused residue scans passed. S2 is not marked complete from this partial delivery.


S2 CSV/XLSX checkpoint final verification (2026-11-06): npm.cmd test PASS, 267 passed / 0 failed / 0 skipped, with initial and final whole-database ZZTEST scans clean (output/schema-audit/s2-price-full-tests.log). npm.cmd run lint PASS; npm.cmd --prefix apps/web run typecheck PASS; npm.cmd run build PASS (includes /items/price-imports). node scripts/preflight-schema-integrity.mjs PASS: 27 read-only checks, no findings. node scripts/audit-db-schema.mjs PASS: zero unresolved schema findings. Focused git diff --check PASS. Only the additive migration is retained in database state; all test fixtures rolled back. No real price activation or owner policy seed. S2 remains PARTIAL and the overall goal remains active; next work is the remaining PDF/levels/contracts/stock requirements, followed by S3-S10 and final acceptance audit.


## 2026-11-06 S2 PDF and price-level update (PARTIAL stage)

PDF implementation: bounded offline text extraction, explicit fixed character columns, paged raw source inspection and explicit header exclusions; original bytes/plan/source revisions retained through independent approval. Synthetic 15000-row PDF test and rollback PDF activation test pass. No real PDF price-list layout acceptance, OCR or messaging parsing claimed. docs/pdf-price-table-review.md documents dependency/limits. PDF final full gate: 271 passed, zero failed/skipped, both residue scans clean; lint/typecheck/build passed. Final pure file gate: 8/0/0.

Price-level configuration: /items/price-levels and Owner-only confirmation/clearing against independently approved source lists, revision checks and exact resolver. Existing crm_price_levels reused, no migration, seed or financial grants. Focused settings/HTTP tests 2/0/0. Final full gate for this subsequent state is pending in s2-levels-full-tests.log. Remaining: quote-editor level selection and immutable pricing-source binding; contract identity continuity on approval/send; confirmed source/currency/supersession decisions; old manual list approval consistency; stock-check/daily analysis. No level definition or calculation was selected for the client.


Final 2026-11-06 PDF/price-level configuration checkpoint: npm.cmd test PASS (273 passed, 0 failed, 0 skipped); initial and final whole-database ZZTEST residue scans both clean (output/schema-audit/s2-levels-full-tests.log). npm.cmd run lint PASS; npm.cmd --prefix apps/web run typecheck PASS; npm.cmd run build PASS, including /items/price-levels and /items/price-imports. Focused diff checks PASS. Existing schema tests pass in this full run; no schema/migration changes were made after 0047 in the previous checkpoint. All new level/import fixture state rolled back. No new migration, backup needed, real setting/price activation, live-writing load test, connector install, listener, message send or commit. PDF host/runtime/browser/client acceptance and quote-source binding remain unverified/incomplete as documented; S2 and S0-S10 goal remain active.


## 2026-11-06 S2 quotation source binding (stage PARTIAL)

Closed the retained agreement identity gap: requireContractBinding compares the current valid contract against the quotation line's saved identity; equal-priced replacements, expiry and post-approval new agreements block workflow progress and downgrade document approval until revised. Contract lookup excludes archived rows and uses the approval path's customer/item lock. No migration or source overwrite.

Wired Owner-configured levels into the quote editor: explicit net preview/apply; safe quantity-normalised source fingerprint; no calendar-day invalidation inside a still-valid period; current level/list/tier eligibility and fingerprint are checked on save and every approval/send validation. Extra discount or altered net price is rejected; changed meaning/list/tier blocks even with equal price. Sales API returns only net/currency/level/fingerprint and label choices, with session/CSRF/customer assignment checks. No new cost/margin/list financial grants, policy defaults or FX assumption. Existing INR-only quotation support blocks other currencies clearly.

Focused tests: 5 passed / 0 failed / 0 skipped before the additional HTTP response-boundary assertions; final full state is under verification in s2-source-full-tests.log. Remaining S2 items are unchanged except the now-implemented source binding: manual/import activation consistency, explicit supersession, stock-check/daily analysis and client/browser acceptance. No whole-system production claim.


Final quotation-source checkpoint (2026-11-06): npm.cmd test PASS: 276 passed / 0 failed / 0 skipped, both initial/final whole-database ZZTEST scans clean (output/schema-audit/s2-source-full-tests.log). npm.cmd run lint PASS; npm.cmd --prefix apps/web run typecheck PASS; final npm.cmd run build PASS. Existing schema tests in the full run PASS, and node scripts/preflight-schema-integrity.mjs PASS: 27 read-only checks, zero findings. Focused diff checks PASS. No migration/backup required and no fixture settings retained. Full goal is not complete: remaining S2 manual/import approval consistency, supersession, stock-check/daily analysis and acceptance, then remaining S3-S10/S0 final audit. Browser/client/live concurrency acceptance remains unverified. No Tally write activation, connector installation, new listener, outbound send, live-writing load test or commit.


## 2026-11-06 S2 manual approval consistency and price confidentiality

Manual /items/manual-price-list now preserves the creation capability through explicit field entry, row preview, inactive source review and the same independent approval/activation service as CSV/XLSX/PDF. New revisions can be prepared from retained versions. The older direct activation/edit API is blocked with a 409 message and the former direct editor now shows read-only retained history and the new review link. No business defaults are filled by the manual form; no permission grants or migration added. Retained old rows with no workflow review show NO_RETAINED_REVIEW, not a claim of confirmed approval.

Closed older financial projections: canonical price-list GET/detail require items.list_price.read, item detail omits list/discount profile values and tiers without that server permission, and the item page does not fetch/show lists to disallowed roles. Cost/margin/Tally access remains separate and unchanged. Same-name activation is locked and rejected with an explicit version message.

Focused manual/import/CRUD gate 12 passed / zero failed/skipped; final full gate pending in s2-manual-full-tests.log. Existing direct-price activation tests were replaced with bypass rejection and a dedicated retained-source/approval/exact-price/confidentiality suite, preserving feature coverage for the new workflow. S2 remains PARTIAL for reviewed supersession, stock-check/daily analysis and full acceptance. Legacy item-profile financial defaults and provenance also need final S0/S2 review; this change does not rewrite unknown historical values.


Final manual-pricing checkpoint after date serialization fix: npm.cmd test PASS, 279 passed / 0 failed / 0 skipped; both initial and final whole-database ZZTEST scans clean (output/schema-audit/s2-manual-final-full-tests.log). Focused date/manual test 3/0/0 and earlier combined focused gate 12/0/0 PASS. Root lint, explicit web typecheck, final production build, existing schema tests and focused git diff checks PASS. Existing read-only preflight: 27 checks, no findings. No migration/backup required, no retained test data or real price/rule/user seed; no Tally activation, connector installation, new listener, load-test write, messaging send or commit. Source scans show shared reviewed repository as the only canonical CRM price-list insert/activation path in src. Old direct clients must migrate to manual preview/review routes. Browser/client acceptance, approved supersession/retirement, stock/daily analysis and historical profile provenance review remain open. S2 and full S0-S10 goal stay active.


## 2026-11-06 S2 stock evidence, log and daily analysis

Added /items/stock-checks and typed client, selected-company APIs, exact quantity/reservation reconciliation and source-timestamp freshness. Existing append-only stock_check_log stores preview-bound checks with actor/reason and atomic audit; UUID retry identity prevents duplicated daily counts. Owner stock.availability configuration remains absent; missing source/mapping/threshold blocks verification. No reservation total/zero is inferred, no business value seeded, no Tally write. Existing role grants are unchanged. History is explicitly historical; users.read controls all-staff/daily access, otherwise own records only. Existing order snapshots without confirmed matching company identity cannot be attached. This does not yet replace fulfillment stock gates.

Two pure tests PASS. Initial database tests exposed incorrect assumptions about the existing Manager users.read grant; assertions were corrected to Executive, preserving existing permission behavior. Corrected database/HTTP focused tests 2/0/0 PASS; atomic audit-failure rollback was added afterwards and is covered by the pending full gate. Lint, web typecheck and production build PASS at this checkpoint. Full suite is running in output/schema-audit/s2-stock-full-tests.log; no final count claimed yet. Earlier initial focused wrapper ended with its expected assertion failures but its final whole-DB residue scan PASS. No migration, connector install, listener start, send, live Tally write or commit. See docs/stock-checks.md for behavior and remaining acceptance.


Final stock-check checkpoint (6 November 2026): npm.cmd test PASS: 283 passed / 0 failed / 0 skipped; initial and final whole-database ZZTEST residue scans PASS (output/schema-audit/s2-stock-full-tests.log). The full run includes the audit-failure rollback regression and existing schema/permission tests. npm.cmd run lint PASS; npm.cmd --prefix apps/web run typecheck PASS; npm.cmd run build PASS including /items/stock-checks. Read-only preflight PASS: 27 checks, zero findings. Focused tracked diff check and whitespace check of nine new stock files PASS. No migration added, database created/copied, real settings seeded, live Tally write, messaging send, connector installation, listener start or commit. Real stock reservation delivery/mapping, rendered-browser and independent-session acceptance, existing order fulfillment integration, reviewed price supersession/retirement and legacy profile provenance remain open. S2 and the full S0-S10 goal remain active and PARTIAL.


## 2026-11-06 S2 reviewed price-list retirement and replacement

Added /items/price-retirement and its typed relative API, reusing generic approval_requests/append-only approval_decisions under PRICE_LIST_DISPOSITION. No schema/migration or business defaults. Empty price_lists.retirement_policy blocks the flow. Exact preview shows source/replacement, linked levels and uncovered tier counts; request retries replay by UUID. Independent approval archives the old list and import review with retained source rows/bytes and atomic event/audit. Neither level mappings nor quotation lines change automatically; old bound prices block until revised. Approval reevaluates source, replacement, products, levels and policy under the quotation/level/rule and sorted source locks. No role grants, Tally write or messaging change.

Also closed approved-source unit drift: level resolution and replacement eligibility compare current product revision/part/unit with the retained activated import entry. A changed product requires a newly reviewed source revision. Focused pricing/quotation tests 7 passed / 0 failed / 0 skipped before final expanded impact assertions. Web typecheck PASS; full lint/build/test gate currently running in output/schema-audit/s2-retirement-*.log. Real policy remains absent. Browser and independent-session acceptance, stock fulfillment integration, legacy profile provenance and remaining stages remain open; the full goal is not complete. See docs/price-list-retirement.md.


## 6 November 2026: Master Prompt v2 is the current execution order

The latest user attachment 2d5a715b-069f-4efc-b783-b663658a8c2e replaces the old execution sequence with Part A automation contract, Part D decision pack, then S1-S12. Historical S0-S10/P01-P66 evidence below remains retained and must not be reimplemented merely because numbering changed. This is a broader completion request, not a production-readiness approval. Use v2 status names DONE / PARTIAL / AWAITING-CONFIRMATION / NEEDS-LIVE-VERIFY / OUT-OF-SCOPE for new entries.

FIRST-read evidence: current audit, reference-requirements-register, private-sample README/manifest and available schema/architecture were inspected. Named LLD and docs/notion/ and docs/diagrams/ are absent (only docs/architecture-decisions/ exists). Notion orchestration/diagram field alignment remains unverified; do not claim exact compatibility. Private samples remain ignored and are runtime references, not seeding authority. No proposed business value was inserted or confirmed in this checkpoint.

Prior retirement checkpoint verified: npm.cmd test 287/0/0 PASS, clean initial/final global residue scans (s2-retirement-full-tests.log); lint, explicit web typecheck and production build PASS. Schema read-only regeneration: 199 relations, 2801 columns, 43 documented exceptions, zero unresolved; preflight 27 checks, no findings. Canonical prices are retained on retirement; existing level-source product/unit drift is blocked. No migration or real retirement was performed by the rollback tests.

V2 A1 PARTIAL: design OpenAPI 3.0.3 + versioned manifest and automation-contract.md cover 16 proposed machine operations and three restricted scopes, relative paths, company/freshness envelopes, exact net pricing/stock reuse, queue/draft-only writes, immutable approval/send boundary and known source gaps. Every operation is explicitly PLANNED; no machine route/auth is implemented by the contract artifact alone. JSON syntax in automation-openapi.yaml is valid YAML 1.2.

V2 A9 PARTIAL: initial metadata-only compatibility baseline captures 20 actual automation/work/task/approval tables, 234 columns, constraints/domains/indexes/triggers, 80 permission definitions and 25 existing staff route guards. Baseline test refuses removals/changes, permits additional members, and never calls a sender or scheduler. All tables/columns/check domains/permissions/routes are listed in automation-contract.md. Runtime response snapshots and A10 mock round trips remain incomplete. Existing staff GET /api/v1/automation and PATCH /api/v1/automation/:key must remain staff-only; the service scope label does not confer staff access.

Focused automation-contract tests 3 passed / 0 failed / 0 skipped (v2-automation-contract-focused.log). New full gate pending. Next: A2 separate hashed/rotatable/revocable/company-scoped/rate-limited service credentials, additive migration after a fresh backup; then runtime read/write adapters, templates, timeline, full response/mocks and handover. Part D follows Part A; proposed decisions remain unusable until Owner confirmation. Current sole database remains mehta_electronics_local; the v2 deployment-name-setting request is not implemented in this checkpoint and no other DB was connected. No switches enabled, sends, live Tally contact, connector install, listener start, load-test run or commit.


## 6 November 2026 V2 A2 credentials and first A3 machine read

Previous v2 contract gate completed: npm.cmd test 290 passed / 0 failed / 0 skipped, both global ZZTEST scans clean; lint, typecheck and build PASS. Continued A2 with Owner-only /users/automation-credentials, explicit configuration, one-time random tokens stored only as hashes, immutable company/scope configuration, generation-bound rotation/revocation, typed client and session/CSRF/permission checks. Machine auth has a distinct credential principal, actual scope/company/IP restrictions, persisted fixed-minute accepted-event rate counting under row lock, bounded failed-peer protection, and append-only/audited lifecycle/auth events. It never becomes a staff role or uses localhost/connector auth. Only GET /api/v1/automation/switches is implemented; other 15 catalog operations remain PLANNED. No switch edit, send or Tally contact.

Migration 0048_automation_service_credentials.sql applied with existing runner after explicit fresh-backup verification: mehta_electronics_local-2026-11-06T07-54-07-342Z-c9ff7886.dump. Adds three isolated tables, seeds zero credentials/users/settings. Original compatibility baseline unchanged; additive credentials fixture protects three tables/43 columns/five route guard entries. Typed service context now restores correctly through the rollback helper. Six credential tests plus three contract tests PASS (v2-credentials-final-focused.log); earlier combined twelve including protected Tally read/schema tests PASS. Extended HTTP tests cover create/list/rotate/revoke, old-token refusal, staff/connector isolation and 429 Retry-After. Existing schema regenerated read-only: 202 relations, 2844 columns, 43 documented exceptions / zero unresolved; preflight 28 checks, no findings. Typecheck PASS. Final lint/build/full test gates running in v2-credentials-*.log; no final count claimed yet.

A2 PARTIAL pending final gates/browser and external-engineer acceptance; A3 PARTIAL (switch-state read only); A9 PARTIAL (metadata/addendum + first response boundary, full planned response snapshots incomplete); A10/A11 PARTIAL. Next: remaining scoped read adapters, queue-only write/replay infrastructure, approved templates and timeline, complete mock round-trip/handover, then decision pack and v2 S1-S12. Decision register not yet implemented, so no fabricated counts/confirmed values. Live/proxy/TLS, independent-session contention and browser acceptance unverified. No real credential/user issued, listener started, live load test, connector installation, business decision confirmation or commit.


Final A2/first-read checkpoint (6 November 2026): npm.cmd test PASS, 296 passed / 0 failed / 0 skipped, initial and final global ZZTEST residue scans clean (output/schema-audit/v2-credentials-full-tests.log). Lint, explicit web typecheck and production build PASS, including /users/automation-credentials. Final focused credential/contract tests 9/0/0 PASS; earlier combined protected Tally baseline gate 12/0/0 PASS. Schema inventory 202 relations / 2844 columns, 43 documented exceptions / zero unresolved; read-only preflight 28 checks/no findings. Focused diff/whitespace checks PASS. Backup archive is git-ignored and 219611736 bytes; migration 0048 applied only to mehta_electronics_local through existing runner after fresh verification. No real service user/credential was issued: post-gate live count was zero credentials/company scopes/events; all fixture mutations rolled back. No switches enabled, Tally contact, listener start, connector install, actual send, live-writing load test or commit.

A2 delivered in software with bounded tests; browser/TLS/proxy and external-engineer/independent-session acceptance remain NEEDS-LIVE-VERIFY. Part A still PARTIAL: only the switch-state machine read is implemented. Remaining A3 readers, queue-only A4/A5 replay and routing, template registry, timeline, full response/mock coverage and final handover precede Part D. The v2 decision register is not yet created; no decision status counts or confirmation are invented. Full v2 completion/production readiness remains unproven and active.

## 7 November 2026 integrated CRM hardening checkpoint

Implemented and integrated the Owner decision register, retained-record Tally mapping
draft/review/dry-run flow, ordered quotation approval stages, explicit Owner startup
guard, bounded retained-XML streaming, sensitive-screen watermark/focus concealment,
and company/source-bound order stock evidence through dispatch consumption and later
independent reconciliation. Migrations 0049 through 0055 are applied to the sole
`mehta_electronics_local` database; 0054 restricts reservation ownership to successful
`sales_order` associations and 0055 covers the new item foreign key. Every migration
was applied only after a verified fresh backup; no applied migration was edited.

Final integrated evidence: `npm.cmd test` PASS **353/0/0**, both whole-database
`ZZTEST_` scans clean; lint PASS; web typecheck PASS; production build PASS for all
40 routes; built-browser decision checks 5/0/0. Read-only schema inventory reports
207 tables / 2,915 columns / 43 documented exceptions / zero open findings. Schema
preflight 29 checks and workflow-quantity preflight 17 checks both report zero findings.

This checkpoint does not certify the full client plan. Customer-specific PO/supplier
readers, schedule/change workflows, broader warehouse/PWA, banking/payables,
collections, RMA, KPI/report packs, historical stock reconciliation, remaining
stock-request/quotation/procurement handoffs and real deployment acceptance remain.
Owner decisions and named Tally mapping review remain required. All automation and
live Tally write switches remain OFF; no live connector contact, message send, load
test, listener start, real credential/user creation or commit occurred.
