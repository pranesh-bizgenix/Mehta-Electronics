# Client plan implementation and remaining decisions

## P16‚ÄìP17 - Freshness, incremental voucher reads and order drill-down - 4 November 2026

Added permission-filtered company-scoped dataset freshness evidence to the API, shell and imported detail drawers. Successful import time, age, connector capture/window and missing source timestamps are distinct; incomplete later attempts remain visible. Connector 1.2.0 is prepared with validated alteration-ID voucher pulls after history completion, stable-identity/probe checks, date-window fallback, durable acknowledged checkpoints and full balance/master/order snapshots. No Tally writes, installed service changes or automation activation. Dedicated collection windows now guide order reconciliation instead of incorrectly assuming the general voucher batch window covers all order evidence.

Tally order rows open a detail drawer. Server projections expose source lines/quantities/dates/status/company and only explicitly supplied pending quantity. Owner/Accounts alone receive rates/totals and original XML links. Search and strict company boundaries remain intact.

Files changed: `src/tally-freshness.js`, `src/tally-collection-metadata.js`, `src/tally-order-detail.js`, order list/reconciliation/routes, connector store, Tally visibility service/routes, shell/import detail UI, `features/workflows/tally-freshness.tsx`, order drawer, connector state/snapshot/package/checkpoint/request/queue-upload services, version properties, pure diagnostic verification branch, release manifest and tests `tally-freshness.test.js`/`tally-order-scope.test.js`. See [tally-freshness-and-incremental.md](tally-freshness-and-incremental.md) for behaviour and limits; reference register now includes subsequent supplied PDFs/workbooks, duplicate dispatch email hashes and P39's explicit spreadsheet-only ownership approval.

Migration `0036_tally_collection_metadata.sql` applied through the existing runner after `npm.cmd run db:backup` verified a non-empty archive/checksum in the ignored backup directory. Only `mehta_electronics_local` was used. Commands: connector .NET build/publish PASS (0 errors), updater `-ValidateOnly` PASS (40 hashes/version; no service access), web typecheck PASS, syntax lint PASS, production build/design tokens PASS, read-only migration verification PASS (36 at this checkpoint, zero pending), guarded focused regression **24 passed, 0 failed, 0 skipped** and both database-wide residue checks PASS. Thirteen additional pure C# checks ran within the connector test. An initial detail test fixture referenced a non-existent cached source record; corrected its fixture association and reran successfully.

Unverified: browser interaction, live Tally alteration compatibility/source timestamps/completeness, actual service update/restart, real queue-crash/concurrent-source acceptance. Source restoration with reused IDs is not a deletion feed. Full-repository legacy schema-helper failures remain separate. No invented freshness threshold or business rule value was configured.

## P18‚ÄìP19 - Order-specific evidence, conflicts and read recovery - 4 November 2026

Migration `0037_tally_order_evidence_links.sql` adds explicit CRM order foreign keys/indexes to existing `tally_sync_job_items`, `tally_conflicts` and `tally_reconciliations`; applied by the existing runner after another verified backup. No associations or business rows were seeded. List/detail status reads use persisted associations, company and stable source identities; no name/number guesses. Missing attempts are labelled **Not yet synced**, explicitly stating actual Tally presence is unknown. Stored conflicts link to `/tally/conflicts`.

The new conflict screen supports selected linked-master comparisons, side-by-side evidence/current values, Owner-confirmed winning sources (empty by default), independent reviewer/reason, stale-source/link/CRM/policy checks, audited CRM-only resolution and retained obsolete comparisons. Recovery uses migration `0038_tally_read_recovery.sql`, existing heartbeat/queue and import/indexing; requested/delivered/indexed/failure states remain distinct. Known company GUIDs cannot be replaced or omitted on new uploads. No service install, Tally write, send gate or permission grant was changed.

Files: order sync state service/list/detail/UI, `src/tally-conflicts.js`, `src/tally-read-requests.js`, Tally visibility routes, business rule definitions, `/tally/conflicts` page/feature/navigation, connector store/import, connector heartbeat/state/snapshot/package/sync/API fields, migrations 0037/0038, release manifest and `test/tally-{order-sync-state,conflicts}.test.js`. Details and limits: [tally-conflict-review.md](tally-conflict-review.md).

Commands completed: P18 order regression **4 passed, 0 failed, 0 skipped**; P18/P19/freshness/rules focused regression **15 passed, 0 failed, 0 skipped**; .NET build/publish PASS (0 errors); TypeScript PASS; production build/design tokens PASS (30 routes, including conflicts); 40-file updater validation-only PASS; read-only migration verification PASS (38 checksums, zero pending). Initial tests exposed JSON string double-encoding; fixed the SQL text-to-JSON boundary and reran successfully. Broader guarded regression/residue checks are running. One backup failed with disk-full; only verified generated build cache was removed before a successful fresh backup/application of 0038. Completed backups were retained. Browser/live Tally/installed-service/concurrent-session verification remains outstanding.

## P20‚ÄìP23 - Decision blockers

Prem/Tally expert have not confirmed the 13‚Äì14 mappings, category directions/conflict ownership for write-side work, sales order push approval or invoice creator. These explicitly blocked tasks remain pending; no field mappings, posting defaults, outbox sending or invoice issuance was invented or activated. Continue with the unblocked read-only financial work (P24).

## P13‚ÄìP15 - Company boundaries and read-only order reconciliation - 4 November 2026

Implemented required selected-company validation for Tally order lists/counts, strict scoping across legacy/visibility/inspection/dashboard/source APIs and replay aliases, and global header/page selection alignment with company-keyed imported lists/details. Replay maintenance now requires explicit company scope or deliberate all-company mode. Order search matches number/party. Existing company/type/date index is sufficient; no migration was added. The register in [reference-requirements-register.md](reference-requirements-register.md) records the supplied ZIP, conflicting price levels, missing source samples and decision blockers.

`/tally` now includes Order sync verification: company/status counts, retained connector evidence, explicit run windows versus historical totals, optional independent JSON references, missing/unexpected voucher numbers and status differences. Counts-only matches cannot claim complete identity verification. Read-only comparison uses a repeatable-read transaction and does not change Tally or CRM records.

Changed files: `src/tally-order-list.js`, `src/tally-order-reconciliation.js`, `src/sales-order-routes.js`, `src/tally-read-service.js`, `src/tally-visibility-{service,repository,routes,contracts.d.ts}`, `src/overview.js`, `scripts/replay-tally-imports.mjs`, Orders/Tally pages, `features/orders/{tally-orders,order-reconciliation}.tsx`, imported list/sales document wrappers, shell company heading, rollback helper and `test/tally-order-scope.test.js`; documentation linked above and [tally-company-scope-and-orders.md](tally-company-scope-and-orders.md).

Verification so far: focused guarded test command covering order scope/read/transaction/order workflow/connector version: **18 passed, 0 failed, 0 skipped**; production build/design tokens PASS; syntax lint PASS; read-only database migration verification PASS (35 checksums, zero pending). Final residue scan result is recorded after completion below. Existing broader legacy import test still uses the prohibited schema helper and was not represented as passing. No service installation, app restart, live Tally completeness, browser acceptance or independent concurrent-session snapshot test was performed. The connector's retained XML proves delivery consistency only; independent live Tally totals remain necessary for source completeness.

## P12 - Connector update preparation and reported version - 4 November 2026

Prepared Windows connector release **1.1.0** with a reviewed SHA256 manifest covering **40 payload files**. Updater now has an explicit Administrator check with instructions, validation-only mode, both-profile registration/company preflight, unique complete service-folder backups with verified inventories and restricted ACLs, source/destination hash verification, restart/wait for both existing Mehta services, cross-profile rollback/quarantine and a result JSON. No Windows service or installed file was changed on this machine.

Heartbeats report `connectorVersion` from the loaded core assembly, preserve legacy `agentVersion` compatibility and audit changed reported versions. `/tally/connector` shows the last reported connector version beside heartbeat freshness/connection state; no prepared version is substituted for the live report. Existing token/company and screen permission checks remain intact. No migration/new permission, Tally write or automation change.

The local .NET publish, 40-file validation-only check, initial **3 focused tests**, TypeScript, syntax lint, production build/design-token check, scoped whitespace check and read-only migration verification (35 checksums, zero pending) passed. The cached-RID publish attempt failed before a successful framework-dependent publish; NuGet advisory metadata remained unavailable (NU1900). Final connector/setup/Tally-read regression: **13 passed, 0 failed, 0 skipped**. The broader guarded run including Tally-import had **15 passed, 1 failed** because its existing legacy database/schema helper is disabled by MASTER RULES; initial/final residue scans passed with no committed ZZTEST_ rows. Service installation/restart/rollback and a real new-version Windows-service heartbeat were intentionally not run. See [connector-install-verification.md](connector-install-verification.md) for changed files, later administrator commands, recovery and verification limits.

## P11 - Business rules screen and workflow prerequisites - 4 November 2026

`/rules` now lists pricing approval levels, role discount limits, credit tiers/grace days, warranty period, complaint bands, principal ordering, reminder limits, KPI weights and audit retention. Missing/cleared/invalid values show **Not set ‚Äî blocks: <workflow>**. Editors start empty; only an Owner with the existing permission can confirm or clear values, with a required reason, append-only history and audit. No rule values, role grants or automation switches are seeded/changed.

Quotation submission/approval checks confirmed pricing decisions, role limits and captured rule versions. Non-exempt order credit approval checks confirmed tiers/grace; verification fingerprints bind those versions. Supplier PO submission/approval/issue requires ordering policy, shown in review. Complaint progression requires a confirmed selected band; its response target appears in details. Existing warranty, maker-checker, credit exposure, cost and margin gates remain enforced. Multiple matching approval levels remain blocked pending multi-step implementation.

No migration/dependency changes. Final guarded rule/setup/quotation/order/procurement/logistics/provisioning regression: **31 passed, 0 failed, 0 cancelled, 0 skipped**, using only rolled-back `mehta_electronics_local` fixtures. Initial and final database-wide residue scans passed: no committed ZZTEST_ rows remain. Typecheck, syntax lint, production build/design-token check, read-only migration verifier (35 checksums, zero pending) and scoped whitespace check passed. Full repository/browser/concurrent-session verification and an app restart were not performed. See [business-rules.md](business-rules.md) for changed files, schema guidance and remaining workflow engines.

## P10 - Quotation policy and item costs setup - 4 November 2026

- Shared browser/server field validation; no default margin basis or seeded policy/cost values. Load failures remain visible and block unsafe saves.
- CSV/single-sheet XLSX costs import with a review table, exact decimal strings, active CRM part-code matching, duplicate/invalid-row blocking, reason, stale-preview protection, atomic audited saves and per-item history. No Tally writes.
- Policy and cost drawers expose before/after history with actor, timestamp and reason. Creation/submission blocks explain the missing setup and provide authorised setup links.
- Final focused setup/quotation/procurement/order tests: **14 passed, 0 failed, 0 skipped**. Earlier guarded 13-test run passed its initial/final `ZZTEST_` residue checks; the additional batch rollback test passes in the final run. Existing permission and approval/send gates remain enforced.
- No migration/dependency changes. Tests for this task use only `mehta_electronics_local` and rolled-back fixtures; historical schema-per-test descriptions below do not describe the current test method. No real policy/cost data was changed. See [quotation-setup.md](quotation-setup.md) for limits and operation. Browser acceptance and app restart remain unverified.

## P09 - Tally item review and linking - 4 November 2026

Added `/tally?entity=items` review-and-link flow with selected-company scoping, stock-group/brand/missing-brand filters, part-number and HSN/UOM duplicate review, explicit existing-product selection, reason, preview and atomic idempotent saves. Only individually selected batches of up to 100 items are saved. BR-17 is preserved: no Tally master is created or rewritten; new products reference Tally identities through `crm_tally_item_links`. Pack sizes start empty and require explicit exact decimals; no MOQ, cost or price is seeded. Existing CRM fields remain unchanged when linking.

Migration `0035_tally_item_stable_links.sql` adds source-key/GUID/Master-ID fields and uniqueness checks to the existing link table. Legacy name mappings require explicit identity review; GUID links survive source renames. Item details/setup/current visibility reconciliation recognise canonical links and preserve financial permissions, with no stock aggregation across companies. Existing role grants, automation switches and connector/outbound behavior remain unchanged.

Verified backup **218,833,097 bytes** before applying the migration through the existing runner. Live verifier reports **35 matching checksums, 0 pending**. New item tests **3 passed**; focused regression **33 passed, 0 failed/cancelled/skipped**; lint, TypeScript, production build/design-token and tracked whitespace checks passed. The shared post-regression scan found no `ZZTEST_` residue. Read-only inspection confirmed **10,988** source items and **0 explicit delivered brands**, shown honestly as missing; no real CRM products were imported. See [flow, changed files, commands and remaining limits](tally-item-wizard.md). No manual browser verification, running-service restart or commit.

## P08 - Tally customer review and linking - 4 November 2026

Added a reviewed bulk customer wizard in `/tally?entity=customers`. Candidates are limited to Sundry Debtors and descendants in an explicitly selected company. Duplicate suggestions compare GSTIN, Unicode-normalised name and phone; links are chosen by source ID and explicit CRM ID, never automatically by name. Missing/ambiguous GUID or Master ID blocks saving. Up to 100 individually selected ledgers can be previewed with a reason, then atomically created/linked through existing `tally_visibility_crm_links`. New credit values remain empty until explicitly entered; money stays decimal text. Existing customer fields and Tally records are retained.

Server validation rechecks preview fingerprints, source/target changes, permissions and link uniqueness under transaction locks. Required idempotency keys protect retries and include company in the request body. Customer/contact/link writes are audited and roll back together, including a mid-batch audit failure. CRM details/setup readiness now recognise stable visibility links; a source rename preserves linkage. The older customer visibility creation shortcut redirects callers to this reviewed flow. No role grants, migration, actual customer import, automation switches or connector/Tally writes changed.

Verification: new wizard tests **3 passed**; focused workflow/security regression **30 passed, 0 failed/cancelled/skipped**; lint, web TypeScript, final production build and read-only migration verification passed (34 checksums, 0 pending). The shared post-regression scan found no `ZZTEST_` residue. A live read-only check found **2,484** customer candidates, with stable IDs on the first 100; none were copied or linked. See [flow, endpoints, changed files and limits](tally-customer-wizard.md). No manual browser acceptance, service restart or commit.

## Owner setup checklist - 3 November 2026

Added `/setup` with server-enforced literal Owner access and Owner-only navigation/search. Ten live checks cover staff readiness, independent reviewers, exact CRM customer/item links, quotation policy, recorded costs, business rules, connector state/company, MFA and backup age. Rows link to existing repair screens; quotation links open their specific policy/cost drawers. MFA and backup sections give operator steps where no web settings action exists. No business values, accounts, roles/grants, switches or Tally writes were introduced.

The existing backup command now records a verified receipt in `audit_logs`, enabling database-backed backup age without inferring historical filesystem receipts. MFA shows actual runtime enforcement separately from database role requirements and enrollment. The existing 10-minute migration backup window is reused; a recorded receipt does not replace migration archive verification or prove restoration. No migration is required. See [sources, exact links, changed files and limits](setup-checklist.md).

Focused setup/provisioning/backup tests **13 passed, 0 failed/cancelled/skipped**; lint, production build (TypeScript/design tokens) and task diff checks passed. Database fixtures use the shared rollback helper; the final whole-public-table scan found no `ZZTEST_` residue. Actual backup command passed with a verified 218,828,326-byte archive, database receipt and independent archive freshness/hash verification. Read-only migration verification passed with 34 checksums and 0 pending. Live readiness changed from 0/10 to 1/10 after backup completion; the other nine prerequisites remain unconfigured/unready, without synthetic business values. No extra listener, manual browser verification, running-service restart or commit.

## User provisioning - 3 November 2026

Improved `/users` with audited staff creation, active role selection, owner/reporting-manager and backup ownership, manual temporary passwords with mandatory first-login change, and reasoned soft deactivation with session revocation. Per the user's clarification, owner reuses `manager_user_id`; no separate ownership field or migration is added. A selected backup must be a different available person; an explicitly unassigned backup shows a coverage warning so first-colleague provisioning remains possible when only one Owner exists. No real accounts or password seeds were created.

Current/proposed changes warn about a single active Owner and missing independent reviewer capacity. Readiness includes password setup, MFA enrollment, active/leave/lock state and existing permissions. Creator/editor exclusion is tested; backup assignment grants no approval rights. Record-specific approval gates remain authoritative. Shared legacy/versioned mutations retain server session, CSRF and permission enforcement, audit atomicity, self-deactivation protection and serialized last-Owner protection. First-login business access is blocked on the server until password change. Existing roles/grants and logistics financial ceilings are unchanged by this task.

Verification: focused security/workflow run **36 passed, 0 failed, 0 cancelled, 0 skipped**; syntax lint, production build (including TypeScript/design tokens) and read-only migration verification **PASS** (34 matching checksums, 0 pending). Full guarded run **136 tests: 79 passed, 11 failed, 46 cancelled, 0 skipped**; failures remain in other legacy suites using the disabled database/schema helper. Both whole-public-table residue scans passed. No migration, app restart, manual browser verification or commit. See [provisioning behavior, changed files, commands and limitations](user-provisioning.md).

## Logistics lead and Store staff - 3 November 2026

Reconciliation recheck of the repeated request: implementation already present; no duplicate role, grant or migration added. Re-ran `test/logistics-roles.test.js`: 3 passed, 0 failed, 0 skipped. `db:verify` passed with 34 matching checksums and 0 pending. A fresh read-only comparison confirmed both new roles exist, Admin is absent, all original role/grant/permission rows still match the pre-change baseline, and no test users or logistics fixture rows remain. Only this verification note changed during the recheck; the running app was not restarted and browser appearance was not re-verified.

Added the two operational roles through migration `0034_logistics_roles.sql` and new logistics permission keys. Logistics lead reads operational orders and manages receiving/dispatch with existing independent approval, version, exception and delivery-proof gates. Store staff read only explicitly assigned orders and write photos/item codes on GRN and dispatch. GRN actual-code writes increment the version while preserving every financial/quantity field. Dispatch observations retain the original customer PO. Admin remains undefined and cannot be created by the role service. No existing role, permission definition or grant changed; the live before/after matrix comparison passed.

The Users & roles selector/matrix now exposes the roles and their operational ceilings; the server rejects financial/other privilege escalation for them. A native `/logistics` workspace supports assignments/revocation, receiving, independent GRN review, photos/codes and dispatch/delivery. New sessions land there. New role responses exclude costs, margins, prices, totals, credit and Tally financial data, and general purchasing/order-document APIs stay denied. Assignments and immutable evidence are audited and stored in the same database; no connector, outbound or automation behavior changed. See [role matrix, endpoints, retention and verification](logistics-roles.md).

Migration applied by the existing runner after a verified 218,812,779-byte backup; live verifier reports 34 matching migration checksums and 0 pending. The backup gate correctly refused an earlier attempt while the backup was incomplete. The focused logistics and existing workflow/security run passed **32 tests, 0 failed, 0 skipped**; lint, TypeScript/token checks, production build and tracked diff whitespace checks passed. The guarded full run reports **75 passed, 11 failed, 46 cancelled, 0 skipped**; failures remain in other legacy schema fixtures. Its final residue scan passed, and the post-regression read-only check found 0 fixture users, 0 logistics assignments and 0 evidence rows with the original grants still unchanged. No running app/connector restart or manual browser verification was performed. The migration adds role/configuration and audit metadata only; all synthetic test records roll back.

## Shared rollback tests - 3 November 2026

Added `test-support/transaction.js` with a live-identity-checked, single-connection test transaction that always rolls back. Existing workflow transactions use savepoints; expected SQL errors recover at statement savepoints, and transaction-local authorization settings are restored after each workflow. The five previously opt-in suites (CRM modules, Tally read, quotations, sales orders and procurement) now run unconditionally using the existing schema and transaction-only fixtures. No database/schema/migration or application runtime changes were made.

`npm.cmd test` now uses `scripts/run-tests.mjs` to check every public table for `ZZTEST_` residue before and after the test process, including after failures. Detected rows fail the command and are never deleted automatically. Fixtures, trigger-denial mutations and raw comparisons are scoped to test records. Workbook test files now use the repository's ignored backups folder and are removed by test cleanup. See [test helper and remaining limitations](transaction-tests.md).

Verification: the five converted files plus helper checks passed **19 tests, 0 failed, 0 skipped** (16 existing tests and 3 new helper tests). `npm.cmd run lint`, explicit syntax checks for the helper/runner, and tracked diff whitespace checks passed. The guarded `npm.cmd test` completed with a failing exit status; an additional TAP summary run confirmed **129 tests: 72 passed, 11 failed, 46 cancelled, 0 skipped**, across 17 suites. The remaining failures/cancellations come from other legacy suites using the disabled temporary-schema/database helper (including top-level setup hooks that cancel their children); they were not hidden or re-enabled. Both the initial and final full public-table residue scans passed: **no ZZTEST_ rows remain**. No workbook fixture files remain in the repository backup folder. No database, schema, migration or running service was created/restarted, and no commit was made.

Commands: focused `node --test --test-concurrency=1` over the five converted files and `test/transaction-helper.test.js` PASS; `npm.cmd test` FAIL with the counts above and final residue check PASS; `node --test --test-concurrency=1 --test-reporter=tap` FAIL with the same counts; syntax lint/checks and whitespace check PASS. Full verification of the remaining legacy HTTP/migration/import suites still requires their separate transaction conversion. The helper proves single-connection idempotency; independent-session races and application deployment were not verified. Sequence gaps from rolled-back identity inserts are expected and are never reset against the live database.

## Backup command and migration safety gate - 3 November 2026

Added `node scripts/backup-db` / `npm.cmd run db:backup`: a whole-database custom-format `pg_dump` of the live-guarded `mehta_electronics_local` into timestamped, git-ignored `backups` files. Empty output is rejected and archive listing is checked before publication. A size/SHA-256 receipt ties migration eligibility to the completed archive and snapshot start time. No database, schema or migration file is created by this implementation.

The shared migration runner now checks for a matching backup from the last ten minutes after its advisory lock and before any pending migration or ledger DDL. An already-current database needs no backup. Development also requires a backup unless `--allow-migrations-without-backup` is explicitly supplied with `NODE_ENV=development`; production/test reject the flag. Startup surfaces actionable backup errors before listening. See [commands, requirements and limitations](database-backups.md).

Verification: 16 focused safety/backup tests passed with no database fixtures; `node --check scripts/backup-db`, syntax lint, production build (including TypeScript/token checks) and tracked diff whitespace checks passed. The actual backup command produced a 218,811,163-byte archive, verified its offline contents listing, and the freshness/hash gate accepted it. The new ledger query returned 33 checksums in a read-only transaction; `db:verify` confirmed 0 pending migrations. Git ignore verification passed; no test files or partial archives remain. Built runtime files match the source. No restore, pending migration application or running-service restart was performed. The existing full integration suite remains blocked by its prohibited schema fixtures.

## Single-database runtime guard ‚Äî 3 November 2026

`src/database-guard.js` now enforces `mehta_electronics_local` using the live `SELECT current_database()` result, in addition to a configuration preflight that prevents knowingly contacting another target. `src/postgres.js` gates tagged/unsafe queries and reserved connections on the same checked-out physical connection, and verifies transaction identity before application callbacks. Startup checks before bootstrap/migrations; `applyMigrations` also checks independently. Database-using operator scripts explicitly await readiness before their work; connector-store requests share the guarded factory. Pure offline tools/unit tests do not acquire a database just to run.

Database/schema administration statements are refused. The legacy schema-per-test helper now fails before any connection; its old create/drop implementation was removed. Restore and database-creation/drop tool invocation are disabled; allowed dumps verify the live target and reject positional/flag target overrides. `db:verify` now performs read-only checksum verification, without creating/copying a schema. Demo seeding and inherited alternate tenant-DB routing are disabled. No numbered migration is needed or added. Email/WhatsApp/SMTP/switches and Tally write behavior were not changed.

Focused tests use protocol doubles (functions returning query results, not a second/in-memory database) to prove another live name, missing/failed identity, pool replacement, reserved queries, transactions and migrations fail closed. Real positive verification uses only read-only transactions on the permitted database and leaves no rows behind. The legacy full integration suite remains blocked pending conversion to rollback or self-cleaning `ZZTEST_` tests; no test schemas or extra listeners were created. Existing deployed/running Node processes need the normal restart to load the new backend code. See [database guard behavior and verification](database-guard.md).

Verification: 38 focused safety/pure regression tests passed, 0 failed; syntax lint, TypeScript and root production build/token check passed. Live read-only reserved/pool transactions, connector health, JSON parameters and Tally read service passed. The read-only migration verifier matched 33 checksums with 0 pending. No business rows, schemas, database copies or migration files were created. No app/connector service restart or commit was made.

## Repository rules and baseline audit ‚Äî 3 November 2026

The root [AGENTS.md](../AGENTS.md) now records the user-supplied MASTER RULES verbatim. The [repository audit baseline](audit-baseline.md) documents the real folder layout, combined development/production startup, canonical migration runner, commands, database connection owners and callers, HTTP/external URL owners, inherited connector source, and current policy conflicts. All paths explicitly named in the rules exist. The last migration file is `0033_tally_order_lookup.sql`; the next slot is `0034_<description>.sql`, with no migration added or applied by this task.

These rules supersede historical verification, seeding and deployment instructions in this document and elsewhere: only `mehta_electronics_local` is allowed; temporary test schemas, another database, extra UI/API listeners and invented business seeds are prohibited. The existing `test-support/postgres.js` helper and several integration/browser scripts violate that policy and were not executed. New database tests must roll back a transaction or remove their own `ZZTEST_` rows in the same permitted database, with no extra listener. Test-harness adaptation is recorded as remaining work, not implemented by this documentation-only audit.

Application code, environment configuration, installed services, migrations and business records were not changed. No database connection was opened and no external destination was contacted by the audit. Email/WhatsApp, classification/extraction, outbound/SMTP, message reminders and switches remain outside this work; no switch or gate was changed. Static inspection found that the local `.env` names the required database on a loopback host; effective runtime configuration was not independently verified.

Checks run for this audit: syntax lint PASS; web TypeScript (`--incremental false`) PASS; design-token check PASS; selected pure unit tests (`apps/web/test/format.test.mjs` and `test/tally-descriptors.test.js`) 12 passed, 0 failed. Documentation/path assertions and source-fingerprint comparison validate this documentation-only change. The full test suite, migration-copy verification, production build/start and live connector/DB checks were not run. Earlier passing test records below remain historical evidence and are not authorization to rerun the old schema-based harness under the new rules.

Risks/open questions recorded in the baseline include the existing schema/listener test harness, unrestricted configured DB/origin inputs, inherited cloud/3122 connector defaults, legacy Number-based money handling and hard-delete cleanup, and the difference between universal session/CSRF wording and existing login/health/bearer-connector contracts. No application-code remediation or commit was made in this task.

Source: **Mehta ControlDesk ‚Äì Client Requirements & Development Plan (1).pdf**, 70 pages, supplied from the client's Downloads folder. This register follows its F1‚ÄìF17 feature headings. Client statements, proposed designs and unresolved decisions in that document have different authority: a proposal is not recorded stakeholder acceptance. The earlier 164-row response matrix is still unavailable; its individual requirements are not invented here.

Updated: 2 November 2026, IST. Email and WhatsApp integrations remain inactive at the user's explicit request. No messages were sent during implementation or verification.

## Workflow available in the application

1. Maintain customers, registered contacts, customer part numbers and CRM product mappings.
2. Record enquiries manually; retain incoming source messages separately with duplicate detection. Bank/spam messages produce no case, draft or reply.
3. Prepare quotations using confirmed pricing policy and exact decimal calculations; submit for independent review. Customer PDFs show net selling prices, with internal margin/cost details excluded.
4. Record an approved customer-specific fixed-quantity rate contract where applicable. Expired contracts cannot price a rate-contract customer's quote; another customer's contract never applies.
5. Retain the customer's original PO, compare against the quotation, check credit and stock, then obtain order review.
6. Create purchase requests and multi-vendor RFQs, record supplier replies, compare offers, and let a person choose the winner.
7. Independently review supplier POs, receive goods and reconcile quantities/rates. Retain supplier originals and manually verify extracted fields.
8. Dispatch approved quantities, retain LR/transport details, and confirm delivery from uploaded evidence. Time passing alone does not confirm delivery.
9. Record existing invoice references, collections, receipts and payment authorisation requests. A different authorised person confirms a receipt; partial payment leaves the collection open.
10. Track complaints, warranty and returns with an owner, distinct backup, response time and history. Warranty approval requires a confirmed policy; return approval requires inspection evidence.

## Feature coverage

‚ÄúImplemented‚Äù below means the stated internal behavior exists, not that the whole proposed feature is accepted or externally connected.

| Source feature | Internal implementation / screen | Limits and remaining inputs |
|---|---|---|
| F1 Foundation | Access matrix, audit, configurable rules, work ownership/backup, SLA engine, tasks, exceptions, switches; `/users`, `/rules`, `/work`, `/tasks`, `/exceptions`, `/audit` | Real business SLA values, escalation owners, deployment/backup schedule and acceptance still need confirmation. Unconfigured rules are shown as unavailable. |
| F2 Customers and CRM | Customer 360; assigned-salesperson checks on enquiry/quote creation; first sent executive quote binds an unassigned customer; Owner sets classification, pricing class and credit exemption; `/customers`, `/contracts` | Existing customer assignments must be reviewed by Admin. Class-specific discount formulas and approval hierarchy remain client decisions. Fixed contracts use product, customer, quantity, price and validity, with independent approval. |
| F3 Enquiry capture | Existing manual enquiries plus source-retaining manual intake, category routing, source-ID dedupe and bank/spam suppression; `/enquiries`, `/operations` | Email/WhatsApp adapters deliberately inactive. No claim of live mailbox polling, attachment OCR or model-based classification. Human-entered classification must be checked. |
| F4 Quotations | Versioned quotes, cost/policy checks, independent approval, net-price PDF, history, original attachments; `/quotations` | Confirm pricing values, company details and applicable approval policy in settings. Legacy unmanaged email cannot bypass managed approval. No external mail was sent by this work. |
| F5 Vendor RFQ | Purchase request, invitations, priced replies, side-by-side offers and human winner; `/purchasing` | Supplier invitations/reminders are not sent automatically. Actual supplier contacts and agreed terms are required. |
| F6 Purchasing and receipt | Supplier PO review, original documents, GRN, discrepancy comparison and independent posting; `/purchasing` | Customer-specific supplier templates and extraction adapters need real source documents; generic Excel export is labelled as generic. |
| F7 Customer PO and credit | PO snapshot/original, field comparison, verification fingerprint, current-source credit checks, Owner exemption, review, stock checks; `/orders` | Confirm `credit.validation` exposure basis, maximum source age and unavailable-balance policy. Until configured, non-exempt approval is blocked. This is not bill-level Tally reconciliation. |
| F8 Dispatch and delivery | Partial quantities, retry protection, LR/transporter references, delivery proof upload and evidence-based confirmation; `/orders` | No transporter integration or automatic delivery claim. Enter existing statutory transport references where applicable. |
| F9 Invoice/GST | Verified existing invoice-reference register only; Owner/Accounts; `/operations` | **Blocked:** confirm invoice origin, GST/IRN/e-Way provider, API credentials and approved statutory workflow. ControlDesk does not issue statutory invoices or fabricate IRNs. |
| F10 Tally | Read-only imported masters, complete field browser, source/history/reconciliation and permission-safe exports; `/tally` | Existing user read-only rule overrides any document proposal for two-way posting. Vouchers/invoices absent from the connector remain explicitly unavailable. See Tally visibility audit/report. |
| F11 Automated communication | Existing draft/approval gates, registered recipients, switches and audit; `/messages`, `/automations` | Integrations inactive. New reminder definitions start OFF. Material-delivered timing, templates and activation remain unconfirmed. No new automated draft generation is claimed. |
| F12 Collections and payments | Existing-invoice references, collection cases, receipt confirmation, overpayment prevention, partial-payment hold, policy/checklist-gated payment authorisation; `/operations` | No bank-feed reconciliation or payment transfer. Ageing/reminder cadence, allocation policy and bank adapter still need confirmation. Only Owner/Accounts can access financial cases. |
| F13 Support/RMA | Complaint, warranty and return workflows; revised findings retained before/after; response time; independent decisions; `/operations`, customer 360 | Configure `warranty.policy` and `payments.authorisation` only after confirmation. Proposed one-year/48-hour values were not silently adopted. RMA shipping/replacement automation is not implemented. |
| F14 Owner dashboard | Existing pipeline, SLA, exceptions, approvals, margin/activity; open support/collection counts and pending human decisions linked to exact cases; `/dashboard` | Confirm remaining business KPIs/targets. No inferred revenue from missing Tally vouchers. |
| F15 Mobile/portals | Native responsive screens using the existing design system | Separate external customer/vendor portals and identity/sharing rules remain pending. Existing internal screens do not create a public portal. |
| F16 Bulk price lists | CRM items and manually managed dated price lists/tiers; `/items` | Bulk PDF/Excel ingestion at 12‚Äì15k lines is **not complete**: needs actual files, templates, conflict rules, validation/review and scale acceptance. |
| F17 Supplier document extraction | Retained supplier originals and manual comparison/review; `/purchasing` | Automatic Connectwell/HCE/RR Kabel/Siemens extraction is **blocked on actual source samples and confirmed mappings**. Filenames listed in the plan are not sample contents. |

## New implementation

- Additive migrations `0029_client_operations.sql` and `0030_customer_contracts.sql`, with forward permission adjustment `0031_contract_reviewer_permissions.sql`: customer controls, versioned operations, immutable intake originals/events and fixed rate contracts. No imported Tally table is rewritten.
- `public/operation-descriptors.js` drives case fields, types, labels, roles and UI forms/details. Controllers, services and repositories live in `src/modules/operations`.
- Native screens: `/items`, `/purchasing`, `/orders`, `/contracts`, `/operations`; customer 360 links related cases by ID. Existing quote/Tally native screens are preserved.
- Exact amounts are retained as decimal strings/numeric columns; financial cases are rejected on the server for roles outside Owner/Accounts, including direct detail/list requests. Original intake text is restricted to those roles because it may contain financial information.
- Mutations carry reasons, versions and history; maker/checker decisions reject the creator. Source IDs and hashes prevent changed messages from replacing stored originals.
- All test writes use a random schema in the existing `DATABASE_URL` database and clean up afterwards. No separate database or alternate base connection is created.

## Verification

Commands and results are recorded here as checks finish; browser evidence is in `output/client-plan-review/verification.json` and corresponding PNGs. These are synthetic acceptance fixtures isolated from imported/business data, not mock production data.

- `npm.cmd test`: 90 passed, 0 failed, 5 explicitly optional database suites skipped.
- Focused opt-in quotation, procurement and sales-order suites: 7 passed, 0 failed before the final follow-up checks.
- Focused CRM CRUD integration suite: 3 passed; focused operations/dashboard/quote/order/procurement checks: 12 passed, one optional CRM run subsequently verified separately.
- Native browser acceptance: 10 workflow checks passed, 20 screenshots (1440/390 px, light/dark), no page errors or serious/critical structural accessibility findings (colour contrast excluded from this automated check).
- Web TypeScript and design-token checks passed.
- Native Next.js production build passed.
- `test/client-operations.test.js` verifies source dedupe/immutability, bank suppression, non-finance denial, do-not-quote, fixed contract exclusivity/exact price, expired terms, customer binding restriction, partial/full receipt confirmation, maker/checker, warranty policy and payment checks.
- `scripts/verify-client-plan.mjs` exercises real HTTP/native UI in a random schema, desktop/mobile light/dark, customer links and direct server denials. It does not run against production records.

## Activation and remaining work

Migrations are applied and their checksums validated in the existing database; see `client-plan-migration-verification.json` for the before/after imported-table integrity check. Future installations should apply additive migrations using `npm.cmd run db:migrate:postgres` before starting the updated application. Do not use demo seeding against imported business data. Review customer classifications/assignments, pricing and confirmed rules through the UI. Keep automation switches OFF while integrations are inactive.

The internal workflows are a substantial implementation of the plan. It would be inaccurate to label F1‚ÄìF17 completely delivered: the external adapters, statutory issuance, bulk parsers, vendor templates, portals and unresolved policy decisions above still require work and client inputs. No stakeholder acceptance is inferred from passing tests.

## 2026-11-04 ó Login-free localhost review

- User explicitly requested removal of login on localhost. Added opt-in `LOCAL_REVIEW_ACCESS=true` in the local ignored `.env`.
- `src/local-access.js` bootstraps a normal session for the existing first active Owner on `/api/auth/me`; it creates no users or passwords. Sessions and review entry are audited. Existing account password/MFA configuration is unchanged in the database; onboarding gates are bypassed in the local request context.
- Requires a loopback listener, loopback TCP peer, local Host with the configured port, and same-origin requests; forwarded headers grant no access. Connector authentication is unchanged. Permissions, CSRF, maker-checker and business gates still run.
- Changed: `src/local-access.js`, `src/app.js`, `src/config.js`, `test/local-access.test.js`, local `.env`, and this document. No migration.
- Verification: `node --test test/local-access.test.js` ó 2 passed, 0 failed, 0 skipped. Started the existing production listener with `npm.cmd start`; live `/api/auth/me` returned 200, Owner, mustChangePassword=false, CSRF token and session cookie; `/api/v1/me/badges` with that session returned 200. Initial sandbox attempts could not reach PostgreSQL; startup succeeded with local network access.
- Risks: anyone using this machine's localhost CRM can act as that Owner. Set `LOCAL_REVIEW_ACCESS=false` and restart to require login again. Review-mode actions share the existing Owner audit identity. No remote deployment or connector installation performed. Broader P24 work remains in progress.
- Browser verification: headless Playwright opened `/dashboard` without credentials, stayed on `/dashboard`, found the main navigation visible, and found no forced-password banner. Passed. No screenshots or secrets saved.
- `npm.cmd test -- test/local-access.test.js` was stopped while its initial whole-database residue scan was still running, to prioritize immediate review; that guarded command is not reported as passed. The direct 2-test run and live browser/API checks above passed.

## 2026-11-04 ó CRM priority: New quotation page

User redirected implementation from Tally P24 to the CRM New quotation page. P24 and later plan items remain pending; this task does not declare them complete.

### Changes
- `/quotations/new` now keeps the customer, validity, item entry, terms and quotation summary visible when Owner policy is missing. Saving remains blocked until policy and required fields are valid.
- Added a full-width responsive item grid, customer GSTIN summary and record link, unit/HSN hints, creation progress, explicit unsaved-draft state and inline save failures. Missing item cost allows a draft but still blocks submission through existing server gates.
- Policy and cost drawers open inside the editor. Closing policy refreshes policy without clearing the draft; closing costs refreshes cached item costs.
- Removed guessed 15-day validity, 18% GST and 0% discount from new lines. These start empty and require explicit values.
- New quotation accepts customer context through `customerId` (and `customer`) and existing enquiry context. Enquiry lines without linked CRM items show a review warning instead of silently producing an empty grid.
- Customer selection rejects stale asynchronous results; errors and loading state block saving. Read-only/unauthorized users cannot edit through this page. Existing server permissions and approval gates remain.
- Notes are explicitly labelled as printed on the customer quotation, matching the existing PDF/print implementation.

### Files / migrations
- `apps/web/app/(app)/quotations/new/page.tsx`
- `apps/web/features/quotations/quote-editor.tsx`
- `apps/web/features/quotations/use-quote-editor.ts`
- `apps/web/styles/workspace.css`
- `test-support/check-new-quotation.mjs` (browser-only fixtures, no persisted sample business data; live database-name guard before running)
- This implementation log. No migration and no business setup values seeded.

### Verification
- `npm.cmd --prefix apps/web run typecheck` ó PASS.
- `npm.cmd --prefix apps/web run check:tokens` ó PASS.
- `npm.cmd test -- test/quotation-setup.test.js test/quotations.test.js` ó PASS: 10 passed, 0 failed, 0 skipped; initial and final database residue checks passed. Covers missing policy, missing costs, exact arithmetic, CSRF/permission checks, audit/history and independent approval.
- `npm.cmd --prefix apps/web run build` ó PASS; final CSS correction is being rechecked before handover.
- Actual localhost page returned HTTP 200 and displayed New quotation, its fields, main navigation and the real missing-policy notice. Screenshot: `output/new-quotation-desktop.png`.
- Browser check initially identified a required-label selector mismatch, then a customer icon sizing issue and an exact-text selector mismatch for the permission message. Selectors and icon sizing corrected; final rerun recorded below.

### Limits / risks
- Real Owner policy remains unset. Draft saving is intentionally blocked until the Owner supplies it; no invented settings were inserted for demonstration.
- UI submission is exercised with browser-only intercepted responses; real backend workflows are exercised separately inside rolled-back transactions. No real quotation, customer, product or cost was created for review.
- Existing outgoing message/email ownership and send gates are unchanged. No connector build, installation or Tally write performed in this task.
- Final verification: production build PASS after the icon sizing and tablet layout correction. `node test-support/check-new-quotation.mjs` PASS: 4 passed, 0 failed, 0 skipped (missing policy, customer context/item entry/exact totals/draft request, mobile overflow, denied role). All mocked browser writes stayed in browser memory. Production listener restarted at `http://127.0.0.1:3000`; New quotation is ready for review.

## 2026-11-04 ó Quotation source and policy reconciliation

- Request: use `Quote.eml` and previously supplied documents as drafting references. Inspected the email's plain-text/HTML alternatives and reread the original F4, F2, F16 and top-level business-rule/conflict documents in the exported client plan.
- Found: the email is a request for prices with 11 item rows and a 3-set heading, not an issued quotation. No attachment, prices, global margin, approval levels or confirmed commercial policy. Set-versus-row quantity interpretation remains unconfirmed.
- Changed documentation: `docs/reference-requirements-register.md` now records source hash, row/tag/part preservation, repeated-model handling, quantity ambiguity and a requirement-to-current-implementation table. `docs/quotations.md` corrects stale startup and default-policy wording and identifies the pending cost-basis decision. This log records the review.
- Verification: Python standard email MIME parser read both alternatives from the source file; SHA256 recorded. Original HTML client-plan pages parsed as text and reviewed. No automated intake/extraction feature was implemented. No runtime code, business rows, permissions, costs, policy values or automation settings changed. No migration.
- Tests: not run for this documentation-only review. No claim of end-to-end automatic quotation pricing: customer class/contract/slab/dated-list selection, locked list prices, historic-list approval and remaining confirmed policy inputs are still pending. No source was treated as permission to send messages or populate policy values.

## 2026-11-04 ó Additional quotation request review

Read `Request for quotation.eml` in place with the standard Python MIME parser. Four RR cable specifications plus requested availability/lead time; only an inline signature JPEG. Recorded source hash, colour-quantity ambiguity and drafting implications in `docs/reference-requirements-register.md`; updated this log. No application code, database records or migrations changed. Source inspection passed; no tests run for documentation-only changes. Actual stock, lead time, certification and rates remain unverified; no global policy inferred.

## 2026-11-04 ó RFQ details implemented in the quotation workflow

### What changed
- Added optional customer RFQ reference and original quantity instructions, with an explicit final-quantity review checkbox. Drafts may retain unresolved set/colour instructions; submission, approval and mark-sent use the existing server gate and stop until quantities are confirmed. Quantities are never multiplied or consolidated automatically.
- Each quotation line can now hold source line/customer part reference, equipment tag, quoted make, requested specification, a reviewed availability statement/check date/source, and delivery lead time from PO date. All start empty. Requested compliance text is labelled as a customer requirement, not certification.
- Availability statements require a source and an actual nonfuture check date. This is manual quotation evidence, not a live inventory result; no stock count is synthesized.
- New details are validated on browser and server and stored in the existing immutable quotation version snapshots. No schema change is necessary. Existing create/revise reasons, audit events, permissions, CSRF, exact price calculations and independent approval continue to apply.
- Distinct lines for the same item retain distinct tags/references. Saved-line keys and margin display use line position, avoiding duplicate-key collisions and first-match pricing for repeated items.
- New information survives draft/revision/detail/history and duplication. Duplicates require a new quantity review. Customer print/PDF output includes RFQ reference, quantity review state and public line details. Availability source references are retained for internal review and excluded from both renderers; cost/margin/discount remain excluded as before.
- Long line specifications continue across PDF pages without repeating line quantities or money on continuation segments.

### Files changed
- `public/quotation-request.js` and `.d.ts` ó shared typed normalization, validation and quantity-review blocker.
- `src/quotation-workflow.js` ó validated snapshot fields, review gate and duplication behavior.
- `src/quotation-document.js` ó print/PDF whitelisted RFQ details and long-row pagination.
- `apps/web/features/quotations/api.ts`, `use-quote-editor.ts`, `quote-editor.tsx` ó typed inputs, per-line details, review state and saved views.
- `apps/web/styles/workspace.css` ó expandable line detail styling.
- `test/quotation-request.test.js`, `test-support/check-new-quotation.mjs` ó rollback-only workflow/API and browser-only UI fixtures.
- `docs/quotations.md`, `docs/reference-requirements-register.md`, and this implementation log.

### Migration
None. New optional fields live in the existing versioned JSON snapshots in `mehta_electronics_local`. No sample business values, users or quotations were committed.

### Commands and results
- `npm.cmd --prefix apps/web run typecheck` ó PASS.
- `npm.cmd --prefix apps/web run check:tokens` ó PASS.
- `node --check src/quotation-document.js`, `node --check src/quotation-workflow.js`, `node --check test/quotation-request.test.js` ó PASS.
- Initial guarded `npm.cmd test -- test/quotation-request.test.js test/quotation-setup.test.js test/quotations.test.js` ó 13 passed, 1 failed due to passing an Owner ID instead of an actor object in the new test fixture. Corrected the fixture. Both its initial and final whole-database residue checks passed.
- Final `node --test --test-concurrency=1 test/quotation-request.test.js test/quotation-setup.test.js test/quotations.test.js` ó PASS: **14 passed, 0 failed, 0 skipped**, with live-name-guarded, rolled-back transaction fixtures. The initial wrapper failure is not reported as a passing command.
- Final `npm.cmd --prefix apps/web run build` ó PASS (including TypeScript and design-token checks).
- `node test-support/check-new-quotation.mjs` ó PASS: **4 passed, 0 failed, 0 skipped**, including expanded mobile details, validation, draft request values and denied-role state. Browser fixture business writes were intercepted; none entered PostgreSQL.
- Scoped `git diff --check` ó PASS. Existing localhost production listener restarted with `npm.cmd start` for review.

### Not verified / remaining
Real customer quotation creation and issuance were not performed. Actual stock, supplier lead times and compliance certification remain to be verified by staff. Existing Owner quotation policy remains required and was not filled from RFQ emails. Automatic contract/slab/dated-price-list resolution, locked list-price provenance and related pending pricing decisions remain unfinished. No email intake, sending, automation switch, Tally write or connector installation was changed.

## 2026-11-04 ó P26 CRM navigation and source context

- Customer 360 New enquiry now carries the customer ID. The destination loads that exact customer, opens the CRM source tab, handles loading/failure, removes creation parameters on close and responds to same-page query changes.
- Create sales order carries the quotation ID. Orders loads the exact approved source through the existing permission/current-approval endpoint, pins customer/quotation options even outside lookup pages and preserves source decimal strings. Original customer PO number, date and total remain explicit inputs. Missing/stale source quotations block saving.
- Customer commercial history returns identity-specific links; modern quotations open their editor, enquiries/orders open exact records, historical quotations open their existing PDF and historical orders open a new read-only drawer.
- Imported customer/item/quotation/enquiry shortcuts carry entity, company and stable record key. The Tally page opens that source, handles URL changes, rejects incomplete/ambiguous context and prevents stale detail responses or unintended company fallback.
- Files: `public/crm-navigation.js` / `.d.ts`, `src/crm-modules.js`, Customer 360/history API types, quotation editor link, enquiry API/form/page, Orders page, Tally page and import/source-document components, `test/crm-navigation.test.js`, `test-support/check-crm-navigation.mjs`, this log. No migration.
- Verification: typecheck, design-token check, production build and scoped whitespace/syntax checks PASS. `npm.cmd test -- test/crm-navigation.test.js test/crm-modules.test.js test/sales-orders.test.js`: **10 passed, 0 failed, 0 skipped**, initial/final whole-database test-residue scans PASS. Backend tests invoke real handlers inside rollback transactions; no new listener/database.
- Intercepted browser check: **4 passed, 0 failed, 0 skipped** after correcting a required-field selector. Uses generated production HTML/JS and browser-only API fixtures without starting a server; covers customer preselection/same-page changes, quote prefill, stale-source rejection and stable-key/company drill-down.
- Final port check unexpectedly found an existing development process (`node src/server.js --dev`, PID 22972). Following the user's stop-server instruction, identified and stopped only that listener. Final complete browser check PASS and port 3000 has no listener. No server was started by this task.
- Limits: real user clicking with live production records remains unverified; browser writes are intercepted, workflow data tests always roll back. No business policy values, approvals, send gates, connector installation or Tally writes changed.

## 2026-11-04 ó P27 Linked Tally records in global search

### What changed
- Ctrl+K now appends linked Tally customers/items after CRM record results and explicitly labels them `Source: Tally`. Selecting a source hit opens its exact entity, company and stable record key using the P26 navigation path.
- Existing 220 ms input debounce retained. Previous requests are aborted, aborted results are ignored and result context is bound to the current term/company to prevent stale hits from remaining actionable. Up/down, Home/End and Enter are supported; the active result scrolls into view.
- Added authenticated `GET /api/crm/search/tally?companyId=...&search=...`. Requires exactly one selected company and checks customer/item read permissions independently before returning either category. Results are limited to five per category and active linked CRM records. Unlinked and unstable item identities are omitted.
- Customer matching uses an existing company/record-key link; item matching reuses canonical stable GUID/Master-ID resolution, including rename/tie handling. No name-only CRM linking or financial-field search occurs. Public results contain display identifiers, exact source/CRM links and observation time; no costs, margins, balance, stock value or raw payload.
- Files: `src/tally-global-search.js`, `src/crm-module-routes.js`, `apps/web/components/shell/command-palette.tsx`, `test/tally-global-search.test.js`, extended `test-support/check-crm-navigation.mjs`, this log. No migration or new roles/permissions/default business values.

### Verification
- New rollback-only service/real-handler test: PASS after correcting the fixture for the existing visibility-cache trigger and removing an incorrect `is_deleted` assumption from queries on legacy customer/item tables. Tests cover company isolation with identical source keys, stable/linked-only results, nonfinancial output/search, category-specific permission providers and session enforcement. Earlier failed development checks are not reported as passed.
- Latest guarded regression: `npm.cmd test -- test/tally-global-search.test.js test/crm-navigation.test.js test/tally-customer-wizard.test.js test/tally-item-wizard.test.js` ó **12 passed, 0 failed, 0 skipped**. Initial whole-database residue check passed; final residue result recorded below when complete.
- Production build/typecheck/design-token checks: PASS. Scoped syntax/whitespace checks: PASS.
- Intercepted production-asset browser check: **5 passed, 0 failed, 0 skipped**, including prior context tests plus debounce, CRM-before-Tally ordering, explicit source labels, Home/End/arrows/Enter and source navigation. No server or alternative listener started; browser fixtures never entered business tables. Final port check confirmed the CRM server stopped.

### Limits / remaining
- This verifies code and fixture behavior, not acceptance by the client against live imported data. Actual installed connector connectivity and outstanding P24/P25 work remain separate; the server was kept stopped.
- Item source search reuses the existing company-scoped canonical item reader. Production load/scale benchmarking was not performed; the unapproved load-test window remains pending. No invented latency target or freshness threshold is claimed.
- P28 onward and automatic dated/contract/slab quotation pricing remain pending; this entry does not mark the full client plan complete. No email/WhatsApp intake, outbound sending, automation switches, Tally writes, backup retention or deployment settings were changed.
- Final guarded regression completion: PASS, **12 passed / 0 failed / 0 skipped**, with both pre-test and post-test whole-database residue scans passing; no ZZTEST_ rows remain.
- Final build after stricter enquiry/source query parsing: PASS. All **5 browser assertions passed** against that final build. The browser script's final stopped-listener assertion failed because a separately launched `node src/server.js --dev` process had reappeared on port 3000 (PID 32176, parent cmd.exe PID 14252; new launch at 18:09:55 local time). This task never invoked `npm run dev`. Following the user's stop instruction, verified and stopped only PID 32176; subsequent TCP listener inspection PASS: port 3000 has no listener. The browser-script command with the listener assertion failure is not reported as an overall passing command.

## Tally logistics and store source view ‚Äî 4‚Äì5 November 2026

- Added a company-scoped, operational-only Tally panel to `/logistics`: godown masters, supported movement types, search/pagination, line drill-down and explicitly supplied batch/location/shipping/tracking fields. Quantities remain strings. Store staff cannot browse all source records; assigned CRM order access is unchanged.
- Connector source/package version 1.3.0 adds a full books-start `logisticsDocumentsXml` collection on each cycle, independent of voucher alteration checkpoints. Existing upload validation, metadata, retained payloads, source identity checks, importer and visibility indexing accept the additive dataset. Unstable/unsupported movements are retained for review. Old connectors remain compatible.
- Prepared `output/tally-sales-review/connector-prepared-1.3.0` and updated the SHA256 manifest. Ran validation only; no installed profile/service changed. First manifest validation failed because PDB files were omitted; corrected the complete file inventory and revalidated successfully. No backup/database migration is needed for these additive payloads.
- Actual guarded read-only query through the new reader: 1 imported company, 5 godowns, 0 supported movement vouchers. New live movement fetch remains dependent on an authorized connector update/run; a prepared package is not delivery evidence.
- Files: `src/tally-logistics.js`, `src/logistics-routes.js`, `src/tally-read-routes.js`, `src/connector-store.js`, `src/tally-collection-metadata.js`, `src/tally-import.js`, `src/tally-visibility-replay.js`, `apps/web/lib/scope.tsx`, logistics page and `features/workflows/tally-logistics.tsx`, connector Directory.Build.props/TallyXmlRequests/TallyService/IncrementalVerification, `docs/tally-sales-connector-update.json`, `docs/tally-logistics.md`, `test/tally-logistics.test.js`, browser harness, this log.
- Verification: guarded logistics/roles/order-scope/connector-version run completed **15 passed, 0 failed, 0 skipped**, including both initial/final whole-database residue scans. .NET Release build/publish PASS; pure connector verification **18 checks PASS**. Frontend build/typecheck/token checks PASS. Six browser assertions passed; the old harness's separate stopped-listener assertion failed because port 3000 was already active. The task did not start a listener. The harness now reports existing listener state, with explicit `--expect-stopped` available when that is the requested assertion.
- Limits: no current stock balance by godown inferred; no automatic CRM GRN/dispatch creation; no Tally writes or operational staff/assignments invented. Custom source voucher types need confirmed mappings. See `docs/tally-logistics.md`.

## P24 financial read verification and P25 sync monitor ‚Äî 5 November 2026

- Verified the existing read-only receipt/payment/instrument/bill parser and exact amount/percentage/date filtering with new rollback-only tests. Tests cover exact large decimals, source bill-row alignment, missing/ambiguous dates, company isolation, missing company, and exclusion of Manager/Executive/logistics roles from financial reads. These fixtures do not prove live receipt delivery.
- Added `/tally/monitor` and its navigation/connector-screen links. New `/api/tally/monitor` and `/api/v1/tally/monitor` show the selected company's connector health, jobs, retained upload evidence, dataset indexing evidence and pending/failed read requests separately. Retained XML download reuses the existing Owner/Accounts-only endpoint; browser downloads are bounded at 16 MiB. Payload metadata now measures UTF-8 bytes with `octet_length`.
- Permission/CSRF-protected request-read and failed/stalled job retry use the existing audited, deduplicated connector read queue. Retry requests a new read, rather than marking old jobs successful. The server queue is measured live; connector-local queue depth is explicitly unknown because the installed heartbeat does not report it. Monitor GET does not mutate job statuses.
- Files: `src/tally-sync-monitor.js`, `src/tally-visibility-routes.js`, `src/tally-visibility-repository.js`, `apps/web/app/(app)/tally/monitor/page.tsx`, connector page, `components/shell/nav-config.ts`, `test/tally-financial-read.test.js`, `test/tally-sync-monitor.test.js`, this log. No migration/new permissions/real business rows.
- Initial targeted tests: **3 passed, 0 failed, 0 skipped**. Production build/token check PASS (32 generated pages). Final combined guarded run and browser result recorded below after completion. No assertion of live Tally financial completeness or reported local connector queue size.

## P28 page-state audit and shared improvements ‚Äî 5 November 2026 (runtime audit in progress)

- Added `scripts/audit-page-states.mjs`: discovers all current page.tsx routes (31, rather than freezing the old 26-page count), follows feature components, checks source evidence for loading/empty/error/unauthorised/validation/duplicate-submit states, and lists missing evidence. `--json` emits evidence/dispositions; `--strict` fails for gaps. CLI validates the actual database name before running. Static source evidence is explicitly not a runtime coverage claim.
- Public login, navigation-only landing, redirects and form-only empty inputs have explicit dispositions. Automation's existing redirect is inspected only; no switch, intake or sending behavior changes. Shared DataTable/ErrorState permission feedback counts as delegated evidence.
- Shared ErrorState now distinguishes 401 sign-in, 403 unauthorised, 409/422 validation/conflict with field details, and unexpected failures. Content wraps long unbroken values, with table scrolling bounded by its container. Settings has an explicit loading skeleton; setup handles an empty readiness response without claiming ready. Contract rows now clear on customer changes, ignore aborted responses and show loading/error/retry states.
- Files: audit script/test, `components/ds/feedback.tsx`, `styles/components.css`, settings/setup/contracts pages, browser harness, this log. No migration or business value changes.
- Remaining: source checks cannot establish every page's runtime empty/error/permission/narrow-screen behavior. Complete the runtime matrix before marking all of P28 complete; do not treat a clean static report as proof. P29 onward and the explicitly Prem-dependent prompts are not declared complete here.

## P29 customer restriction reconciliation ‚Äî 5 November 2026 (partial)

The existing customer controls already contain NEW, EXISTING, POTENTIAL, DO_NOT_QUOTE and credit exemption, and customers have one `owner_id` salesperson. Reused these structures instead of introducing duplicate states. Ordinary quotation creation and later workflow checks retain the Do Not Quote gate.

Corrected the undefined Admin instruction to Owner review and added a customer-controls review link in the structured error/shared feedback. Clearance now requires a different Owner from the person who imposed the restriction. The maker is derived from the immutable transition audit, so subsequent unrelated edits while retaining DO_NOT_QUOTE cannot replace the maker identity. A missing maker record blocks clearance; no reviewer is guessed. Existing permissions are unchanged. One-Owner installations can remain blocked until another eligible Owner reviews; this preserves maker-checker.

Files: `src/modules/operations/customer-gates.js`, `src/modules/operations/operations-service.js`, shared feedback, `test/customer-restriction-review.test.js`; the older client-operations fixture now uses its already-existing independent Owner for clearance. That legacy test still uses a disabled temporaryDatabase helper and was not run or reported as passing. The new rollback-only test passed after fixing a test cleanup call (`modules.close` does not exist; use the scheduler stop method). No migration, live customer control change or new staff account.

Remaining P29: automatic new/existing classification threshold and its precise metric need Prem confirmation. The existing `customers.potential_threshold` rule addresses potential-customer routing, and is not represented as a confirmed new/existing rule. VIP/type routing switches are not activated. P30/P31 bulk price import/locked dated pricing still require implementation; existing manual price-list/contract screens do not satisfy their complete prompts.

### Latest completed verification checkpoint

- Combined logistics/P24/P25/P28 focused guarded run completed **19 passed, 0 failed, 0 skipped**, both initial/final whole-database residue checks PASS. The added P29 test passed individually; final combined 20-test run is pending below.
- Production build/token/typecheck PASS (32 generated pages). Static page-state audit with `--strict` PASS for all 31 source page routes, with explicit redirect/public/form dispositions; static evidence remains distinct from exhaustive runtime coverage.
- Intercepted production-asset browser checks: **7 passed, 0 failed, 0 skipped**, including logistics drill-down, monitor empty data, required reason/disabled action, 390px overflow check and shared 422 field feedback, plus previous navigation/search checks. No business writes or listener lifecycle changes. Existing port 3000 listener reported as active.
- No migration added or applied, no commit, no Windows connector service update, no automation or Tally writes. Outstanding deployment/live-source gaps and the remaining client-plan prompts are not declared complete.

### Final verification ‚Äî 5 November 2026

- `npm.cmd test -- test/customer-restriction-review.test.js test/tally-logistics.test.js test/tally-financial-read.test.js test/tally-sync-monitor.test.js test/page-states-audit.test.js test/logistics-roles.test.js test/tally-order-scope.test.js test/connector-version.test.js`: **PASS ‚Äî 20 passed, 0 failed, 0 skipped**. Initial and final whole-database ZZTEST_ scans passed; all database fixtures rolled back.
- `npm.cmd --prefix apps/web run build`: **PASS**, including design tokens, compilation, TypeScript and 32 generated pages, after the final shared drawer/header wrapping changes.
- `node test-support/check-crm-navigation.mjs`: **PASS ‚Äî 7 browser checks**, including monitor empty/validation/narrow-screen behavior and logistics source drill-down. Existing port 3000 listener reported, with no start/stop by this task.
- `node scripts/audit-page-states.mjs --strict`: **PASS ‚Äî 31 source page routes**, with shared ReasonDialog validation/submit locking counted as delegated evidence. Improving mutation detection briefly exposed four review candidates; inspection confirmed they use the existing shared ReasonDialog, so no automation/message behavior was changed. This source audit is not an exhaustive per-page runtime test.
- `node --test test/page-states-audit.test.js`, scoped `node --check` and `git diff --check`: **PASS**. Full legacy suite/load tests were not run; old disabled temporaryDatabase suites were not enabled.
- Remaining: exhaustive P28 runtime matrix, full P29 classification rules/VIP routing, P30/P31 imports and locked pricing, and subsequent unblocked prompts. Prem-dependent mappings, policy values and invoice decisions remain pending. The 1.3.0 logistics connector is prepared/validated, not installed, and its live movement import remains unverified. This checkpoint does not mark P15‚ÄìP66 complete.


## Full prompt-pack audit and test isolation repairs - 5 November 2026

The complete P01-P66 assessment is in [prompt-pack-completion-audit.md](prompt-pack-completion-audit.md). The pack is NOT complete. It distinguishes implementations from partial work, missing workflows and required client decisions.

Converted nine additional legacy suites plus web connectivity to rollback transactions. Suite hooks share the transaction; HTTP tests invoke the real handler without opening a listener. Migration protocol tests use SQL-call spies; real connection isolation checks use uncommitted tagged audit rows. The helper supports importer savepoints and bulk fragments without allowing outer commits or DDL; a dedicated regression covers this.

Tests exposed the default connector store opening its own pool despite an injected database. It now receives db.sql. Fresh-connection assertions after rollback verify that connector profiles and staging jobs disappear. Five synthetic Test PC profiles escaped earlier rollback. Automatic approval review rejected deletion under the no-hard-delete rule. The user explicitly approved only those exact fixtures. Cleanup verified exact identities and absence of retained payloads, imported source records and read requests: 5 profiles and receiving staging rows removed, 0 retained/source records removed, 0 of the five profiles remaining. This one-time exception does not authorize business-data deletion.

Also fixed required company scoping on legacy Tally master list/detail routes and their detail-button caller, with company-isolation tests. Import receipt/processing times use statement time to distinguish repeated imports inside a transaction; no Tally source timestamp is invented. Corrected .env.example to use mehta_electronics_local.

Files: src/app.js, src/tally-masters.js, src/tally-import.js, public/app.js, .env.example, test-support/transaction.js, new test-support/http-client.js, converted legacy tests, test/transaction-helper.test.js, test/tally-order-scope.test.js, test/tally-freshness.test.js, apps/web/test/connectivity.test.mjs, docs/transaction-tests.md, docs/database-guard.md, the prompt-pack audit and this log. No migration added or applied. No commit, deployment, connector installation, Tally write, real staff creation or persistent automation activation.

Commands: npm.cmd run lint PASS; npm.cmd --prefix apps/web run typecheck PASS; npm.cmd run build PASS (32 generated pages); scoped node --check and git diff --check PASS. Initial full rerun: 195 passed, 2 failed, 0 skipped; both residue scans passed. Next rerun: 196 passed, 1 failed, 0 skipped; the remaining assertion assumed a nonexistent company column on the older CRM sync-job table and is corrected to the fixture actor. Final rerun results follow when completed.

Unverified: live installed connector's new datasets/version, exhaustive page-state runtime matrix, client acceptance and remaining prompt workflows. No load test was performed; its required window remains unapproved. No missing business decision is supplied as a default.

Final full regression: 198 passed, 0 failed, 0 cancelled, 0 skipped (16 suites). Initial residue scan PASS; final scan pending. Repeated root lint/build PASS. Browser harness PASS: 7 checks, no listener started or business fixtures saved. Static page-state audit PASS: 31 source routes; this is not exhaustive runtime acceptance. Scoped syntax checks and diff whitespace checks PASS.

FINAL GUARDED RESULT: npm.cmd test exited 0: 198 passed, 0 failed, 0 cancelled, 0 skipped; initial AND final whole-database ZZTEST_ residue scans PASS. The connector post-rollback fresh-connection assertions and importer savepoint/bulk regression passed. No migration was added or applied. The complete requirements pack remains incomplete as itemized in docs/prompt-pack-completion-audit.md.


## Private client sample folder setup - 5 November 2026

User steered the active work to a filesystem-only task: no database calls, migrations, new listener or URL. Stopped the already-running prior-stage backup command; it exited interrupted, with no completed backup receipt. No migrations were applied. Earlier draft schema work remains separate and unverified.

Created tests/fixtures/client-samples with the ten requested category folders and empty .gitkeep markers, plus a README describing confidentiality, runtime-only sample loading, missing-file skips and a manifest to fill in. No client document was copied or read into a fixture. Added the three requested .gitignore patterns plus recursive-content and directory-traversal patterns needed to retain nested markers while ignoring document files.

New helper: test-support/client-samples.js. samplePath resolves a documented category and plain filename, returns null with a clear skip message when absent, optionally calls the Node test context's skip(), and refuses traversal/outside symlink targets. The single unit test creates a synthetic file under the system temp directory, exercises present/missing/traversal cases and verifies its exact temporary directory is removed. It never imports database helpers.

Verification: node --test test/client-samples.test.js PASS (1 passed, 0 failed, 0 skipped). git check-ignore -v reported .gitignore rule tests/fixtures/client-samples/**/* for a dummy sample file. Scoped git status showed only README and .gitkeep markers; git ls-files found zero tracked files under the sample tree. The dummy file was removed in finally. docs exists and its complete listing is saved to output/client-samples-setup/docs-directory.txt; no specification file was created or overwritten for this task. This existing implementation log is appended per AGENTS.md. Lint/typecheck results follow after completion. Full npm test was deliberately not invoked because its residue scans connect to the database, contrary to this task's explicit scope. No commit.

Final sample-folder checks: npm.cmd run lint PASS; npm.cmd --prefix apps/web run typecheck PASS; node --test test/client-samples.test.js PASS (1/0/0); scoped git diff --check PASS. No database command was started after the filesystem-only instruction. No migration applied, no server started, no commit. Real-document/parser acceptance awaits user-supplied files.


## S0 database integrity and private reference intake - 5 November 2026

Continued the user's S0-S10 goal after the separate filesystem-only sample setup completed. This does not mark S0 or the full goal complete. The live reference is generated read-only from information_schema/pg_catalog by scripts/audit-db-schema.mjs using scripts/lib/schema-audit.mjs. docs/schema-policy.json classifies every observed relation ACTIVE/FOUNDATION/LEGACY and records exact external/polymorphic exceptions. docs/workflow-schema-matrix.json maps 25 explicit staged workflows to real tables/columns; the named LLD/prompt-pack Markdown files are still unavailable, so full LLD coverage is not claimed.

Applied additive migrations through the existing guarded runner:
- 0039_schema_integrity.sql and 0040_workflow_foundations.sql, protected by verified backups/mehta_electronics_local-2026-11-05T06-37-30-959Z-d52b3295.dump.
- 0041_schema_fk_completion.sql, after the previous archive's age was correctly rejected by the gate and a fresh verified backups/mehta_electronics_local-2026-11-05T06-57-36-579Z-a93a155f.dump was made.
- 0042_tally_evidence_states.sql, protected by verified backups/mehta_electronics_local-2026-11-05T07-14-20-022Z-032cdf28.dump. The full suite exposed a new constraint missing the existing SUPERSEDED conflict state; source inspection also found MATCH reconciliation. Corrected with a new migration, without editing applied migration files or rewriting source rows.

Observed schema: 182 base tables and four views, 2161 columns. Added 21 reserved workflow tables and a confirmed-event view: stock checks, packing/scan/photo references, item conversion factors, empty price levels, disabled/dry-run-only Tally outbox, customer schedules, vendor dues/debit notes/advices, bank imports/matching and WRONG_ITEM claims. Actual actor/reason auditing, creator/reviewer separation, company/party composite identities, nonnegative typed operational amounts and fixed-scale decimals are constrained. Five existing truncate-guard gaps and actual missing cache/company/history FKs were repaired. No business data, real staff or confirmed policy value was seeded. No hard business delete, Tally write, connector install, new listener/URL, messaging/SMTP/AI integration, automation activation or deployment occurred.

The narrower structural audit reports zero unresolved findings: all base PKs, audited FK/index coverage, validated state constraints outside declared exceptions, fixed-scale financial storage, and immutable trigger coverage. It explicitly lists 25 external/polymorphic ID exceptions and 14 address/raw-source/teammate-owned status exceptions. This is not database perfection: legacy line provenance, per-row deletion reason/actor/time on existing mutable tables, workflow-specific NOT NULL and quantity checks still need completion. Unknown historical provenance must remain unknown. Signed raw Tally/bank balances and source amounts must not be forced nonnegative. Missing LLD source remains an explicit input limit.

scripts/explain-schema-workload.mjs generated 32 planner-only EXPLAINs for actual selected-company repository queries and recorded the ten highest estimated costs in docs/schema-query-plans.json. It did not execute ANALYZE, output business rows or run a load test. Configured company name did not identify an imported company, so the command correctly refused the implicit selection; reran with the explicit imported company UUID. No observed global runtime ranking is claimed.

Added test/schema-audit.test.js: metadata/allowlist/index validity, PK-not-a-FK regression, 25-workflow matrix, classification, empty price setting checks, reasoned archive denial, audit mutation denial, and outbox idempotency/company/dry-run/actual reviewer guards. All DB fixtures use the shared rollback helper. Initial four schema tests passed with clean initial/final residue scans. First full suite: 202 passed, 1 failed, 0 skipped (SUPERSEDED constraint regression); both residue scans clean. After 0042, focused conflicts/schema command: 6 passed, 0 failed, 0 skipped, both residue scans clean. Final full regression is running. Lint, typecheck and production build passed before the correction; final repeated gate results follow.

Received 38 supplied PDF/XLSX/EML/PNG references into tests/fixtures/client-samples with neutral filenames and a private ignored manifest containing source/hash mappings; two duplicate groups identified. Originals remain untouched. Git confirmed real references, the manifest and images are ignored; scoped status lists only README/.gitkeep placeholders. No real document values were copied into code, seeds, committed tests or public artifacts. The new payment advice and OEM strip are references, not confirmed bank mappings or automatically applied quotation branding. The screenshot's ship-together exchange is case evidence, not a universal business rule. Document-specific parsers and approved policy decisions remain outstanding.

## S0 provenance continuation - 5 November 2026

Before this change, the completed guarded full run after 0042 was 203 passed, 0 failed, 0 skipped; both residue checks passed. Lint, web typecheck and root production build passed.

Applied 0043_business_row_provenance.sql through the existing runner, protected by verified backups/mehta_electronics_local-2026-11-05T07-52-54-763Z-cf980397.dump. The command was interrupted at the tool boundary; a subsequent read-only migration-ledger check confirmed 0043 committed. No applied migration was edited. The pre/post aggregate verifier scripts/verify-row-provenance.mjs confirms nine newly added historical creation columns were not populated with invented actors/timestamps. Existing unknown creation facts remain NULL. Schema metadata now shows 182 base tables plus four views, 2583 columns, 39 explicit exceptions and zero unresolved findings in the implemented audit categories.

0043 provides creation/update/archive fields, creator immutability, new-row provenance requirements, hard-delete/truncate denial and whitelisted metadata audit on 89 business tables. Audit payloads contain metadata only, not duplicated original document contents. src/db.js legacy contact replacement requires the actual revision reason and records creator/archive actor. src/app.js legacy enquiry creation/revision now sets transaction-local actor and reason for its line writes. No business policies or real accounts were inserted. Original source data, messaging settings and Tally write direction remain unchanged.

New test/business-row-metadata.test.js covers contact reason enforcement, quote/order line creators, metadata tamper/downgrade denial and non-backfilled migration SQL. test/crm.test.js adds legacy enquiry line/archive provenance assertions. Initial focused guarded run: 36 passed, 6 failed, 0 skipped; initial and final residue scans passed. The failure was an enquiry route missing transaction actor context, with dependent pipeline assertions failing. Corrected the route; the full rerun is pending. Syntax lint and web typecheck passed; final build/rerun results will be recorded below.

Private sample inventory is now 41 reference files, two duplicate hash groups, neutral filenames and ignored local manifest. No reference values were copied into committed tests. Workflow-specific nullability/quantity review, absent named LLD evidence and later stages remain open; this checkpoint is not release acceptance.

0043 final gate: npm.cmd test PASS, 207 passed / 0 failed / 0 cancelled / 0 skipped, 16 suites, both whole-database ZZTEST_ scans clean. The prior 206/1/0 failure was a test-only contact fixture without creator metadata; explicit fixture owner fields corrected it without weakening the guard. npm.cmd run lint PASS; npm.cmd --prefix apps/web run typecheck PASS; npm.cmd run build PASS (32 pages). Local raw test log: output/schema-audit/full-regression-0043.log (ignored).

## S0 typed quantity checks - 5 November 2026

Applied 0044_workflow_quantity_checks.sql through the existing guarded runner after aggregate-only scripts/preflight-workflow-quantities.mjs passed 17 checks with zero findings. Backup: backups/mehta_electronics_local-2026-11-05T08-28-09-527Z-9b341bc0.dump (verified archive/list/checksum receipt). Adds 16 nonnegative checks on reserved operational quantities/prices and one accepted+rejected<=received guard. No business rows were rewritten, no zero defaults set, and signed invoice/credit/source totals, round-off, bank balances and free-stock shortages were changed. Optional unreviewed parsed facts stay NULL.

Files: migration 0044, docs/workflow-integrity-policy.json, scripts/preflight-workflow-quantities.mjs, test/workflow-quantity-integrity.test.js; regenerated docs/db-schema-reference.md and updated schema policy/audit. Two new rollback tests PASS: validated checks/required identities/nullability exceptions, negative values rejected by the named CHECK and zero reaches the deliberately absent parent FK; inconsistent receipt split rejected. Full npm.cmd test PASS 209 passed / 0 failed / 0 cancelled / 0 skipped, 16 suites; initial and final whole-database ZZTEST_ scans clean. npm.cmd run lint PASS; npm.cmd --prefix apps/web run typecheck PASS; npm.cmd run build PASS, 32 pages. Live metadata audit: 182 base tables, four views, 2583 columns, 39 documented exceptions, zero unresolved findings in implemented categories.

Remaining S0 limitations: named LLD/prompt-pack Markdown source files are absent, and the 25-workflow matrix is based on the explicit staged prompt. Planner cost ranking covers 32 representative application SELECTs, not observed global production runtimes; no load or independent-session concurrency run. Later feature write paths still need their own workflow validation. Proceeding with unblocked exact-money corrections, without claiming full LLD acceptance or production readiness.

## S1 exact financial boundary and legacy compatibility - 5 November 2026

Added public/money.js as the shared browser/server exact rational arithmetic, aggregate/signed-round-off summation, minor-unit formatting and Indian grouping module. src/tally-orders/decimal.js now re-exports these primitives. PostgreSQL NUMERIC parsing now returns strings rather than Number; integer counts/IDs keep their existing behavior. JSON payloads are not rewritten. Legacy db.js quotation/order readers preserve decimal line values and calculate exact totals; managed quotation adapters sum GST strings exactly. Legacy and managed PDF net-rate/amount formatting use the shared module; legacy browser forms submit decimal strings, and table sorting compares exact decimals. Dashboard compatibility totals remain strings. Legacy quote edit/conversion transactions now set actual actor/reason context so new line/archive provenance is enforced.

Preserved legacy aggregate-before-display rounding and managed per-line/component CGST+SGST versus IGST behavior. Explicit tax/discount required on legacy edits, with no guessed GST default. Unknown/invalid money blocks arithmetic. No business policy or document value was invented. No schema migration is needed for this S1 code change (latest applied schema remains 0044).

Files: public/money.js, public/quotation-math.js, public/app.js, public/ui-components.js; src/postgres.js, src/db.js, src/app.js, src/quotation-workflow.js, src/quotation-pdf.js, src/quotation-document.js, src/tally-orders/decimal.js; test/exact-money.test.js, test/crm.test.js and test/crm-modules.test.js; docs/exact-money-contract.md and the completion audit. Existing module quantity assertion updated from a JavaScript number to the exact database string contract.

Focused exact-money/CRM run first had 38 passed / 1 failed (old quantity type assertion), then the added legacy/money focused run passed 37 / 0 / 0. First full exact-money run passed 214 / 0 / 0 with both residue scans clean. After final editor/dashboard/shared-document changes, full run reports 215 passed / 0 failed / 0 cancelled / 0 skipped, 16 suites; final residue scan still pending. Lint, web typecheck and root build passed (32 pages). git diff --check passed for changed tracked application/test files. Final residue completion will be recorded below.

Remaining: runtime comparisons against private client PDF/Excel totals await their layout-specific parsers; these are not claimed verified. External automation consumers need to retain decimal strings; no live automation was exercised. Missing named LLD sources, configured business decisions and later stages remain listed in the audit. Server/connector services were not restarted or installed during this checkpoint.

S1 checkpoint final verification: npm.cmd test PASS 215 passed / 0 failed / 0 cancelled / 0 skipped, 16 suites; both initial and final whole-database ZZTEST_ residue checks PASS. Local ignored log: output/schema-audit/full-regression-exact-money-final.log. npm.cmd run lint PASS; npm.cmd --prefix apps/web run typecheck PASS; npm.cmd run build PASS (32 pages). npm.cmd run db:verify PASS: all 44 migration checksums match and zero migrations pending. scripts/audit-db-schema.mjs PASS: zero unresolved findings in implemented checks, 39 documented ID/status exceptions, 182 base tables/four views/2583 columns. No extra database or server, no live-writing load test, no connector installation, no commit. S1 remains PARTIAL for private document-layout total comparisons and exhaustive future report coverage; the implemented boundary and legacy fixes are verified. Prem's unconfirmed business policy inputs remain empty and blocking.

## Sample quotation-policy evidence check - 5 November 2026

User requested matching the supplied quotation policy strictly without assumptions. Re-read the private Quote.eml and Request for quotation.eml MIME bodies/attachments, supplied PDF headings/term labels, referenced ZIP inventory and the existing reference-requirements register. The two quotation-named emails are incoming RFQs, not issued Mehta quotations. Supplied supplier order/terms evidence is not a confirmed policy for Mehta as seller. Neither minimum margin nor margin basis was established. The earlier reference register independently records these omissions and unconfirmed cost/margin decisions.

No live quotation policy, business setting, staff account or template was written; the current policy API requires complete confirmed floor/basis/state/letterhead and there is no safe value to substitute. No application code or migration changed. Added ignored tests/fixtures/client-samples/quotation-policy-evidence.local.json with source hashes and evidence classifications, without document contact/bank/pricing values. No tests were run because this was a reference-document review, with no implementation change. Required input: an actual Mehta-issued quotation for seller letterhead/printed terms, plus Prem's explicit minimum margin and whether it applies to each line and total or total only. Customer-facing quotation samples alone may not state internal margin rules.


## 2026-11-05 - Guarded CRM-to-Tally CREATE infrastructure

Authorization: attached f3f098e4 request and user's explicit reply to build all infrastructure with production switches OFF, no business guesses, no live Tally calls or service installation. Existing messaging/automation/send gates were not changed.

Implemented:
- New isolated tw_* control, mapping, snapshot/outbox/event, party-review, capability, confirmed-reference, alert and conflict-observation storage. Master/category OFF; dry-run-only TRUE; all missing values NULL.
- Versioned Owner mappings, stable imported company/party/item/ledger/godown/unit identities, canonical approved CRM source loading, exact-decimal CREATE-only XML, escaping/size checks, explicit discount mapping, independently checked business/push approval, stale holds and post-commit producer isolation.
- Pull claims, capability/company/lease fencing, pre-send key and identity collision queries, strict import counts and mapped read-back, append-only references, idempotent result receipts, UNKNOWN read-back/manual recovery, breaker/gap/cap and alerts. Read import comparison creates existing tally_conflicts without rewriting Tally.
- Separate connector Write executor/worker/HTTP clients and DPAPI-protected durable journal; additive heartbeat capability. No modifications to protected read schedule/XML/queue/token/DPAPI files. Existing read source hashes and API/schema snapshots retained.
- Owner /tally/write screen: settings, real imported mapping record lookup, new immutable mapping versions, source/XML preview, outbox/event/response monitor, extra party review and UNKNOWN wizard. Live-only banner and active-only write summary on /tally/monitor. Disabled banner uses zero write queries.
- Human-only activation/rollback runbooks and full BLOCKED-PREM register. No app/connector service was started, stopped, installed or restarted for this task; no actual Tally request was made.

Files for this task (pre-existing unrelated changes were preserved):
- database/postgres/migrations/0045_tally_write_isolated_foundation.sql; 0046_tally_write_creation_audit.sql.
- src/modules/tally-write/{contracts,module,review,service,sources,transport,verification,xml}.js.
- Minimal integration hooks: src/app.js, src/server.js, src/sales-orders.js, src/procurement.js.
- connectors/tally-windows/TallyConnector.Core/Write/{WriteProtocol,WriteJournalStore,WriteExecutor}.cs.
- connectors/tally-windows/TallyConnector.Service/Write/{WriteWorker,WriteVerification}.cs; minimal Program.cs registration/test entry and Models/ApiContracts.cs additive heartbeat field.
- apps/web/app/(app)/tally/write/page.tsx; apps/web/features/tally-write/{api.ts,live-banner.tsx,monitor-summary.tsx}; minimal shell/app-shell.tsx and tally/monitor/page.tsx hooks.
- test/tally-write-{baseline,pure,schema,service,transport,http,hooks,failure-injection,sources,conflict-observation}.test.js.
- test-support/tally-write-{data,fixture,transport-fixture}.js; test/fixtures/tally-write/{schema-before,responses-before,read-files-before}.json.
- docs/tally-two-way-sync.md; docs/tally-write-live-verification.md; docs/prompt-pack-completion-audit.md; docs/schema-policy.json; regenerated docs/db-schema-reference.md; this implementation log.

Migrations/backup:
- Existing guarded startup migration runner applied 0045/0046 to mehta_electronics_local after a fresh verified backup: backups/mehta_electronics_local-2026-11-05T10-24-27-881Z-5e034f93.dump. No other database or schema was created/connected.
- 0046 fixes creation-event FK timing by replacing only the new write-only function introduced by 0045 and adding an AFTER INSERT trigger. This is disclosed, not described as zero routine replacement. Pre-task schema definitions are unchanged in the baseline guard.
- Read-only schema audit: 196 relations (192 base tables plus 4 views), 2744 columns, 43 documented structural exceptions, 0 unresolved findings. Four additional exceptions are explicit category-qualified canonical entity IDs, not missing ordinary FKs.

Completed step gates before the final release gate:
- Original baseline: 215 passed/0 failed/0 skipped.
- Contract baseline 217; pure module 222; isolated schema 223; producer 225; lease/readback 231; HTTP/business hooks 234; connector safety step 234; UI step 241; first final pass 244. Each completed full run passed initial/final ZZTEST_ residue checks. Logs are ignored under output/schema-audit/tally-write-*.log.
- Connector fake-handler verification: 7 passed/0 failed, no sockets, files, configuration or services accessed. These include OFF/old-server, happy replay, wrong company, lost response, crash recovery and read-back-only recovery.
- Canonical source integration: actual CRM sales order, supplier PO and extra-approved vendor loaded through WriteSources in rollback; no mocked source repository in that test.
- Full route auth matrix: every new staff mutation rejects missing session, wrong permission and bad CSRF; connector routes reject bad bearer credentials. Selected-company and disabled old-path query checks pass.
- npm.cmd run lint, npm.cmd --prefix apps/web run typecheck, npm.cmd run build and dotnet build of the existing connector service succeeded. Production build includes /tally/write.

Intermediate failures resolved rather than hidden:
- New outbox BEFORE INSERT creation-event FK error led to numbered corrective migration 0046.
- One parallel legacy stock test saw transaction timestamp/precision-sensitive availability; the same test passed serialized, as did subsequent full serialized suites. Existing stock/read semantics were not changed.
- Initial C# crash fake incorrectly allowed re-claim after reporting uncertainty; fake server state corrected, then all seven scenarios passed.
- Synthetic party fixture initially used PARTY_LEDGER as entity_type instead of CUSTOMER; fixture corrected and full category tests passed. No constraint was weakened.
- An audit documentation replacement failed on a Unicode literal passed through PowerShell; retried with ASCII prefix matching. No application/database effect.

Read-only live-state check after implementation: master false; each of SALES_ORDER/PURCHASE_ORDER/PARTY_LEDGER enabled false and dry_run_only true; company/mapping/mode/conflict/version/XML verification/all thresholds NULL; tw_outbox=0, tw_mapping_versions=0 and tw_document_links=0. No synthetic configuration persisted.

Limits/open questions:
- Every missing category authorization, field/identity/tax/posting/discount mapping, voucher numbering/name, ledger/godown/unit name, idempotency field, approval mode, conflict winner and operating threshold remains BLOCKED-PREM. Tally version/XML availability unverified. Full list in both new runbooks and completion audit.
- No real Tally XML-import acceptance, installed Windows service test, binary release/installer/hash update, independent-session race/load test, client-document financial acceptance, production MFA/deployment/backup restore or human sign-off was performed.
- Claim contender tests share the serialized rollback harness; Promise.all is not independent-session concurrency proof. Ordinary write errors are isolated, but shared-process fatal faults/resource contention cannot be ruled out.
- Kill stops new authorizations; it cannot recall a physical POST already sent. Sent/uncertain outcomes require read-back.
- Existing successful response baselines cover representative endpoint variants, not every wildcard/export/detail. G1-G9 evidence and these limits are explicitly documented.
- Normal-import comparison is Owner-initiated from the new screen, not injected into the protected read cycle. Health counters are cached observations and null until observed.
- Automatic snapshot authorship is the original business maker; actual triggering reviewer is retained in audit/events/validation provenance. Manual self-approval remains blocked.
- No commit was made. No production readiness or working live two-way-sync claim is made.

### Final release gate for disabled write infrastructure

- PASS: npm.cmd test -> 247 passed, 0 failed, 0 skipped; initial and final public-table ZZTEST_ scans clean. Final log: output/schema-audit/tally-write-release-gate.log.
- PASS: npm.cmd run lint; npm.cmd --prefix apps/web run typecheck; npm.cmd run build (existing production artifact regenerated with /tally/write); dotnet build of the existing connector project.
- PASS: dotnet run --project connectors/tally-windows/TallyConnector.Service/TallyConnector.Service.csproj --no-restore -- --verify-write -> 7 passed, 0 failed, in-process fake handlers only.
- PASS: read-only schema audit -> 196 relations, 2744 columns, 43 documented exceptions, 0 unresolved findings; original-schema/source/API baseline tests pass.
- PASS: final focused disabled-banner/hooks/auth check -> 3 passed, zero write-table queries while OFF.
- Production state confirmed read-only: all switches OFF, dry-run-only TRUE, missing configuration NULL, 0 retained outbox jobs/mapping versions/confirmed links.
- G1-G9 proof/tests/limits: docs/tally-two-way-sync.md. Human activation/rollback: docs/tally-write-live-verification.md.
- Unverified risks include native CREATE collision semantics and concurrent manual creation; preflight/import is not atomic in Tally. Health counters are cached for the last observed company, not a continuously sampled global aggregate. These limits and required human acceptance are documented.
- Infrastructure is available for review; live two-way sync and production certification remain blocked. No commit, live Tally write or connector service action was performed.


## 2026-11-05 - Resume S0-S10: S1 private financial evidence and display accuracy

Classified the previous goal turn as progress (disabled write infrastructure and verified tests/state). Read the active goal, AGENTS.md, authoritative staged attachment and current completion audit. Found sample-document comparisons and compact display arithmetic still outstanding in S1; continued there before S2.

Changed src/modules/documents/financial-evidence.js, test-support/read-pdf-financial-evidence.py, test/financial-evidence.test.js, test/private-financial-evidence.test.js, public/money.d.ts, public/quotation-margin.js/.d.ts, test/quotation-margin.test.js, apps/web/lib/format.ts, apps/web/features/quotations/use-quote-editor.ts, apps/web/test/format.test.mjs, docs/exact-money-contract.md, the private-sample README, completion audit and this log. Three previously supplied PDFs were copied into the ignored fixture tree and its private manifest was updated. No client values were copied into committed expectations.

Focused private/synthetic evidence gate: 8 passed, 0 failed, 0 skipped. Exact format/margin focused gate: 4 passed, 0 failed. Initial evidence extraction failed on inline KONE price denominators and optional/missing HSN/tax; fixed extraction bounds and retained omissions as explicit review gaps. No business values were guessed or persisted.

The first full sample-evidence gate passed 255/0/0 with clean initial/final residue checks. Subsequent source review found compact money and UI margin Number conversions; replaced them with shared exact primitives, required decimal strings for fractional money and prevented an unconfirmed margin floor from implying a green flag. Final full gate/counts recorded below when complete.

No migrations added or database backup required. No database state changed except rolled-back authorized tests. No live Tally, load test, connector installation/restart, message send, new listener, commit or policy activation. S0 named-LLD coverage and later S2-S10 requirements remain open; goal stays active.

Final S1 gate PASS: npm.cmd test -> 257 passed, 0 failed, 0 skipped; initial/final ZZTEST_ scans clean (output/schema-audit/s1-complete-financial-gate.log). Root lint, web typecheck, production build and focused git diff checks pass. The source scan found only count/file-size candidates remaining in the checked Number/toFixed patterns; these are not monetary arithmetic and were retained. Live schema tests run in the full suite. No migration was added. Git check-ignore confirmed all three additional sample PDFs ignored; git status --untracked-files=all exposes only README and .gitkeep under the sample tree. No source PDF/EML contents are tracked. S1 is marked DONE for existing arithmetic and requested financial-evidence regression; full S3 import/review workflows are not implied. Goal remains active for S2-S10 and final S0/acceptance audit.


## 2026-11-06 - S2 reviewed price-list imports in progress

Previous turn classified as progress: price parsers, explicit mapping and new migration draft. Revalidated its backup process; the 5 November backup had completed. Created a new verified backup on 6 November before applying migration 0047 via the existing database runner (1 applied, 47 total). Backup: backups/mehta_electronics_local-2026-11-06T04-43-26-345Z-6aada36a.dump. Only mehta_electronics_local was used; no second database, listener, service, message send or Tally write.

Added src/modules/pricing/{contracts,repository,service,controller}.js; explicit CSV/XLSX preview and original-byte retention; hash replay/revision checks; bulk exact-decimal staging; versioned empty approval policy; maker-checker activation; immutable source/evidence. Added typed pricing API and /items/price-imports screen, linked from Items. Legacy savePriceList refuses edits to imported lists. Added pure and rollback workflow/HTTP tests. Updated schema policy/reference and documented details/limits in docs/price-list-imports.md. The original Tally baseline JSON is untouched; its test now compares original tables while allowing new independent module tables.

Applied migration: database/postgres/migrations/0047_reviewed_price_imports.sql. No business data seeded. Read-only schema audit passes: 199 relations, 2801 columns, 43 documented exceptions, zero unresolved. Focused parser tests pass 5/0/0, including 15000-row file-only plans and private workbook literal extraction. Initial focused workflow/baseline gate had 6 passes and 1 assertion-message failure; both residue scans clean. Adjusted test actor to exercise immutability independently of the earlier independent-activation guard. Initial web typecheck found a PageHeader prop mismatch, fixed; rerun passed. Production build passed. Full rerun results are recorded when the current process completes.

S2 remains PARTIAL: PDF tables, price levels, legacy manual activation consistency, supersession/effective-date selection, customer-exclusive contract application, stock check/daily analysis and browser acceptance remain. Owner approval policy and real source mappings stay empty until confirmed. Active goal S0-S10 remains unchanged; no production-ready claim and no commit.


S2 CSV/XLSX checkpoint final verification (2026-11-06): npm.cmd test PASS, 267 passed / 0 failed / 0 skipped, with initial and final whole-database ZZTEST scans clean (output/schema-audit/s2-price-full-tests.log). npm.cmd run lint PASS; npm.cmd --prefix apps/web run typecheck PASS; npm.cmd run build PASS (includes /items/price-imports). node scripts/preflight-schema-integrity.mjs PASS: 27 read-only checks, no findings. node scripts/audit-db-schema.mjs PASS: zero unresolved schema findings. Focused git diff --check PASS. Only the additive migration is retained in database state; all test fixtures rolled back. No real price activation or owner policy seed. S2 remains PARTIAL and the overall goal remains active; next work is the remaining PDF/levels/contracts/stock requirements, followed by S3-S10 and final acceptance audit.


## 2026-11-06 - S2 PDF import verification and empty price-level configuration

Previous goal turn was progress: PDF extraction/mapping, paged inspection, exclusions, lifecycle test and verification processes; the intervening agenda reply was a status response, not a completed stage. Revalidated exact running process handles rather than restarting them. Final PDF-state full run completed 271 passed / 0 failed / 0 skipped, with clean initial/final residue scans (s2-pdf-final-full-tests.log). Focused final CSV/XLSX/PDF file checks passed 8/0/0. Root lint, web typecheck and production build passed. Runtime PDF dependency on this host is pypdf 6.14.2; requirements file pins it, but no install was performed.

PDF files: scripts/lib/price-pdf-table.py and requirements-pdf.txt; src/modules/pricing/pdf-table.js plus contracts/service/repository/import-plan updates; test-support/price-pdf-fixture.js, test/price-pdf-table.test.js and the PDF rollback lifecycle test; typed pricing API and price-imports UI; docs/pdf-price-table-review.md and updated import docs. Supports an explicitly mapped synthetic 15000-row PDF, bounded offline extraction, paged source rows, explicit header exclusions and the unchanged independent approval path. No OCR, AI or messaging intake. No additional migration, listener, connector installation, live-writing load test, Tally write or business seed.

Added src/modules/pricing/levels.js, Owner-only GET/PUT configuration routes in pricing/controller.js, /items/price-levels UI/link and test/price-levels.test.js using existing reserved crm_price_levels. Empty level meanings block; Owner explicitly selects approved source list and supported discount treatment. Exact resolver checks validity and minimum tiers, returns source fingerprints. No price-level values seeded and no permission changes. First focused tests exposed strict settings validation and JSON binding problems; corrected them. Focused final settings/HTTP tests passed 2/0/0 with rollback. Full current-state run is in progress (s2-levels-full-tests.log); lint/build handles are retained until terminal status.

S2 remains PARTIAL. Quote editor/source binding and currency rules are not yet wired; the configuration screen says so. Existing contractForLine already enforces customer/fixed-quantity/current-date/exact-net restrictions, but later ensureCurrent does not compare the retained contract identity with a replacement agreement. That gap, level source-binding, legacy manual approval consistency, supersession and stock-check/daily analysis remain. See docs/price-levels.md. No production-ready claim or commit. Goal stays active for all S0-S10.


Added docs/release-checklist.md as a working, unchecked release artifact, preserving full S0-S10 scope, missing specification coverage, human recovery/hosting/MFA/client acceptance, Python/PDF provisioning and the teammate/Tally OFF boundaries. It is not release approval. Current levels full suite reached 273 passes / zero failures / zero skips; its final residue scan is still running. Lint, web typecheck and build (including /items/price-levels) have completed PASS. Final terminal result will be appended after polling the same process handle.


Final 2026-11-06 PDF/price-level configuration checkpoint: npm.cmd test PASS (273 passed, 0 failed, 0 skipped); initial and final whole-database ZZTEST residue scans both clean (output/schema-audit/s2-levels-full-tests.log). npm.cmd run lint PASS; npm.cmd --prefix apps/web run typecheck PASS; npm.cmd run build PASS, including /items/price-levels and /items/price-imports. Focused diff checks PASS. Existing schema tests pass in this full run; no schema/migration changes were made after 0047 in the previous checkpoint. All new level/import fixture state rolled back. No new migration, backup needed, real setting/price activation, live-writing load test, connector install, listener, message send or commit. PDF host/runtime/browser/client acceptance and quote-source binding remain unverified/incomplete as documented; S2 and S0-S10 goal remain active.


## 2026-11-06 - S2 quotation source identity and configured level selection

Previous turn was progress with final 273/0/0 rollback gate and zero residue. Re-read current contract/quotation code and confirmed the retained-ID comparison gap. Added requireContractBinding and shared customer/item approval lock, excluded archived contract rows, and called it from existing ensureCurrent. Two rollback tests prove equal-priced replacements/expiry/new agreements cannot silently replace an approved quote source, and stale document status drops to DRAFT until revision.

Added src/modules/pricing/quotation-source.js and net-only quotation level-label/preview endpoints. Drafts retain pricingSelection; shared validation rechecks source fingerprint, current eligibility and exact net/no additional discount at save, submit, approve and send. Normalised quantity and omitted asOf from identity avoid false changes across equivalent formatting/valid calendar days. Preview uses existing quote lock before source locks. No currency conversion is invented; non-INR remains blocked by the existing quotation currency limitation.

Frontend: level-price.tsx, quote editor/view-model/types wire explicit preview/apply with retained selection on reload, explicit manual-source removal, and protection from late preview responses after changed inputs. Settings screen text updated. Sales response contains only level/opaque fingerprint/net/currency; no list/discount internals or new cost/margin access. Added quotation-contract-binding.test.js and quotation-price-source.test.js; expanded level stability test. Focused 5/0/0, typecheck PASS. Full current suite/lint/build are running in s2-source-* logs; same process handles will be polled. Documentation/audit updated, no migration or policy value seeded. No listener/install/live write/load test/message send/commit. S2 and full goal remain active for the remaining manual approval/supersession/stock workflows and S3-S10.


Final quotation-source checkpoint (2026-11-06): npm.cmd test PASS: 276 passed / 0 failed / 0 skipped, both initial/final whole-database ZZTEST scans clean (output/schema-audit/s2-source-full-tests.log). npm.cmd run lint PASS; npm.cmd --prefix apps/web run typecheck PASS; final npm.cmd run build PASS. Existing schema tests in the full run PASS, and node scripts/preflight-schema-integrity.mjs PASS: 27 read-only checks, zero findings. Focused diff checks PASS. No migration/backup required and no fixture settings retained. Full goal is not complete: remaining S2 manual/import approval consistency, supersession, stock-check/daily analysis and acceptance, then remaining S3-S10/S0 final audit. Browser/client/live concurrency acceptance remains unverified. No Tally write activation, connector installation, new listener, outbound send, live-writing load test or commit.


## 2026-11-06 - S2 manual price-list review and financial projection fixes

Previous turn was progress (retained quote contract/level sources, final 276/0/0 and clean residue). Read AGENTS/current manual editor/routes/tests and found direct canonical activation plus broad item-read list-price exposure. Implemented ManualPriceService (pricing/manual.js), manual preview/save endpoints and /items/manual-price-list. Manual row values are all explicit decimal strings; selected canonical units/identities are retained as escaped CSV in the existing import source workflow. Preview/save hold the same outer transaction so canonical item identities cannot be reassigned between source construction and plan validation. Shared existing hash replay, policy-version blocks, independent approval and exact bulk activation. Explicit exact-source revision selection is optional; no automatic retirement or policy assumption.

Replaced the old direct mutator with a 409 immutable-version migration message, and replaced the direct modal with retained price detail plus a reviewed-manual-revision link. Added NO_RETAINED_REVIEW evidence labels for old canonical rows. Read routes require existing list-price permission, item projection omits list/discount/tier values without it, and allowed CRM price reading stays independent from Tally financial role configuration. Existing permission grants were not changed. Same-name activation uses an advisory lock and a clear conflict. Added manual-price-list.test.js and adapted old direct-activation assertions to the new requirement; dedicated workflow tests preserve manual creation/approval coverage. Focused tests passed 12/0/0, typecheck PASS. Full tests/lint/build running in s2-manual-* logs.

Files: pricing/manual, controller, repository/service; crm-modules/routes; Items/manual screens; manual and CRM tests; import/audit docs and this log. No migration, backup, real price activation, policy/user seed, new listener, connector install, Tally write, live-writing load test, send or commit. Reviewed supersession, stock/daily analysis and real/browser acceptance remain S2; final audit will also revisit legacy item-profile financial defaults/provenance without inventing historical facts. Full S0-S10 goal remains active.


The first complete manual gate passed 279/0/0 with both whole-database residue scans clean. A guarded read-only driver probe showed CURRENT_DATE arrives as a Date and serializes to a timestamp, so canonical list/detail responses now explicitly cast date and discount fields to text; manual revision inputs receive YYYY-MM-DD. Added exact date-only and retained approval evidence assertions. Focused date/flow rerun passed 3/0/0. Final full rerun is still active in s2-manual-final-full-tests.log; final root lint, web typecheck and production build PASS. The build contains /items/manual-price-list. Existing PostgreSQL 27-check preflight passed without findings. Source scan confirms canonical list INSERT/activation in src now occurs only in the shared reviewed repository. No business values or prior status facts were rewritten.


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

## 6 November 2026 - CRM-only remaining-work audit

User requested an exact remaining CRM development list excluding messaging/AI/Make/outbound automation. Read the supplied 70-page client requirements PDF with the existing local per-user Python312/pypdf, reviewed the attached diagrams, current source/screens/schema, latest checkpoints and v2 Part D/S1-S12. Added docs/crm-remaining-work-2026-11-06.md, separating missing workflows, confirmations, conditional portals/mobile/statutory adapters and human/live acceptance. Existing reviewed pricing retirement/imports/levels/quotation binding and standalone stock checks are retained as implemented; stale earlier missing-supersession/sample claims do not govern this audit.

Concrete remaining code includes decision register, class/multi-step approval logic, stock fulfillment integration, full customer/supplier document review and schedule imports, independent order changes, warehouse packing/QR/PWA, bank/BRS/vendor payables, full RMA, dashboards/KPI/reporting and production hardening. Supplied Johnson/KONE/Connectwell references are already available; no repeat upload requested. Current live rule values were not queried. Prior 296/0/0 regression log inspected, not rerun. No app code, migration, database/Tally connection, backup, listener, installation, send, settings activation or commit. Documentation-only scope; no completion percentage or production certification.


## 6 November 2026 - Owner decision register frontend and discussion sheet

Added Owner-only /decisions with live register summary, status/area/search filters, evidence and unconfirmed source suggestions, affected-workflow links, direct entry and optional explicit Owner confirmation, reasoned individual/bulk confirmation/rejection/clearing, append-only version history, live CSV export, reviewed CSV import (Entered only), and printable sheet. Plain tier/role/discount/credit/payment/KPI/working-calendar forms preserve exact decimal strings and start without answers. Added Owner dashboard readiness card and navigation link. The static docs/prem-decision-sheet.md and CSV cover 46 current catalogue questions; static answers and live versions remain blank, and users are directed to export live versions before import. Proposed document suggestions never auto-fill or confirm answers.

Frontend verification: npm.cmd --prefix apps/web run typecheck PASS; node --test apps/web/test/decisions.test.mjs PASS (7 passed / 0 failed / 0 skipped); node apps/web/scripts/check-tokens.mjs PASS; focused tracked git diff --check PASS. Root integration runs full lint/test/build/schema gates separately. No database or Tally connection, migration, real policy/account seed, server start, connector install, send or commit performed by this frontend task. Rendered-browser, print-dialog/mobile/accessibility, separate-session acceptance and later decision/workflow coverage remain unverified. This entry does not mark Part D or production complete.


## 7 November 2026 - Bound order stock fulfillment increment

Added explicit immutable saved-company binding and per-line free/reserved stock basis to /orders. Shared confirmed stock policy and retained source freshness now govern order verification and actual dispatch; repeated item demand uses exact decimals. Reserved fulfillment requires a unique successful native Sales Order association to this exact CRM order/company, never a name/PO guess. Dispatch retains immutable stock checks, consumption and audit atomically. New imports do not reset pending CRM movement uncertainty; a different actual active Owner must independently attest the exact movement against later fresh retained evidence. Historical untracked shipments remain visibly blocked without automatic backfill or guessed company adoption.

Added typed relative APIs, operational evidence display and Owner pending-consumption review on Orders, plus active schema classifications and docs/order-stock-fulfillment.md. Applied migration 0053 is unchanged; root coordinates additive 0054 to require the actual sales_order entity kind in the database ownership function. Runtime now applies that same entity-kind restriction; its new wrong-kind regression awaits the coordinated post-0054 gate.

Corrected focused gate before the final entity-kind defense: npm.cmd test -- test/order-stock-fulfillment.test.js test/sales-orders.test.js apps/web/test/order-stock.test.mjs PASS (10 passed, 0 failed, 0 skipped), initial and final whole-database ZZTEST residue scans PASS; log output/schema-audit/order-stock-corrected-focused.log. The first combined focused run had six failures; strict line-shape validation/test correction and explicit synthetic receipt clock_timestamp fixed the stock failures. The procurement Python PATH failure is a separate target-host environment dependency. Web typecheck, syntax checks and design token check PASS. Real connector freshness, independent-session races and browser acceptance remain unverified. Stock requests/quotation/procurement handoff, historical migration review and unassociated reservation mapping remain separate work; no full stock workflow completion or production-readiness claim. No listener, Tally write, automation activation, real business setting/fixture seed or commit.


Final order-stock checkpoint (7 November 2026): root applied additive 0054 after verified fresh backup; applied 0053 was not edited. Runtime and database now require entity_kind='sales_order' for reservation ownership, with negative wrong-kind and ambiguous/shared-identity coverage. Guarded command npm.cmd test -- test/order-stock-fulfillment.test.js test/sales-orders.test.js apps/web/test/order-stock.test.mjs PASS: 10 passed / 0 failed / 0 skipped; initial and final whole-database ZZTEST residue scans PASS; terminal exit 0. Evidence: output/schema-audit/order-stock-final-focused.log. Web typecheck and design-token check PASS; syntax checks PASS. Sources frozen for root's combined regression. Real browser stock-flow acceptance, live connector evidence and independent-session contention remain unverified. No additional database connection/test/migration was run after releasing the exclusive test slot.


## 7 November 2026 - One-click role permission matrix

Simplified the Owner Users & roles permission matrix: every editable permission checkbox now saves immediately without asking the user to type a reason. The client sends a precise event-derived audit reason, and the existing server transaction, session, CSRF, access.manage permission, access-matrix event and audit log remain enforced. The UI shows success/failure feedback and prevents concurrent checkbox changes. Owner, owner-only and approved Logistics/Store restrictions remain locked and are explained beside the matrix; no permissions, database settings, automation switches or Tally writes were changed. Added a pure policy helper and focused tests for automatic audit wording and protected-cell behavior. Verification: web typecheck PASS; focused test 2 passed / 0 failed / 0 skipped; root syntax lint PASS; design-token check PASS; production Next.js build PASS with 40 routes; focused diff check PASS. Browser click acceptance against a running server remains unverified.

### 2026-11-07 - CRM screen watermark removed
- Removed the shared sensitive-screen watermark overlay from the application shell.
- Removed the overlay component, helper, stylesheet import, styling, and dedicated watermark test.
- Server permissions and financial field access controls remain enforced.
- Verification: web TypeScript typecheck passed; repository search found no remaining watermark references under apps/web.

### 2026-11-07 - Customer master completeness and onboarding review
- Added nullable customer backup owner, territory, dealership and brand relationship fields without seeding business values.
- Completed modern customer create/edit coverage for PAN, billing and shipping addresses, city, state, PIN, notes, ownership and relationship data.
- Removed silent credit defaults for new customers and required explicit credit terms and an account owner.
- Enforced server-side duplicate review across normalized name, GSTIN, PAN, phone and email with an audited explanation.
- Added versioned customer onboarding review with maker-checker approval/rejection, stale-version protection and retained events.
- Customer edits return an approved record to pending review; manually created customers cannot create sales orders until independently approved. Existing Tally/legacy customers were not backfilled or assigned an invented status.
- Applied migrations 0056 and 0057 after verified backups. Focused CRM, quotation, conflict and sales-order tests passed across their final reruns; no ZZTEST_ residue remained. Lint, web typecheck, migration verification and production build passed.

### 2026-11-07 - Tally write navigation visibility
- Added an Owner-only **Tally write operations** sidebar link to /tally/write, gated by 	ally.write.manage.
- Existing master/category switches, dry-run, mapping, approval and outbox safety controls remain unchanged and OFF by default.
- Verification: web TypeScript typecheck passed.

## Repository checkpoint ó 2026-11-16
- Collected the current CRM, Tally connector, UI, migration, documentation, test, and review-artifact changes for the requested repository commit.
- Ignored local Next.js verification builds and compiled connector output packages.
- Validation: npm.cmd run lint passed. Full tests, production builds, and database migrations were not run for this commit-only task.



## 16 November 2026 - Stored order comparison completion

Owner/Accounts can explicitly select retained order documents on the Tally orders screen. TALLY_ORDER_COMPARISON_ENABLED gates the read-only endpoint and UI. The local setting is enabled for acceptance. Sources are company-scoped and read in one snapshot; incomplete, optional, cancelled or unidentified documents cannot report a complete margin. Customer PO entries require stable explicit CRM/Tally item links. No live fetcher, Tally write or automation switch was enabled.

The focused comparison and schema run passed 6 tests with zero failures, cancellations or skips. Browser/API/DB acceptance is recorded separately in verification-output/2026-11-16/browser-results.json. The old supplied-document preview remains unregistered.


## 16 November 2026 - Quotation currency symbol correction

Changed the customer document currency prefix from a question mark to the rupee character, retaining shared exact-decimal Indian grouping. Added precision/zero/discounted-price regression coverage. node --test test/quotation-currency.test.js passed 1 test, zero failures. The actual browser-created quotation PDF was downloaded and parsed with the correct net rate, tax total and terms; visual rendering evidence is saved separately before final completion reporting. No pricing policy or actual customer data was changed.


## 16 November 2026 - Legacy acceptance fixture repair

Converted fixture identifiers to VERIFY- while retaining single-database rollback isolation. Removed inherited-local-matrix assumptions from CRM/foundation/dashboard fixtures; tests explicitly arrange seed-role grants inside their rollback transaction. Replaced colliding sample GST IDs, corrected case-insensitive identity fixtures and the registered quotation recipient, and made the reminder test rule explicit. Historical connector schema snapshots remain unchanged: tests preserve every original object exactly while permitting additive objects checked by the schema audit. No sending or approval control was weakened.

Focused repair rerun passed 65 of 66 tests with no cancellations; the remaining new comparison fixture was then corrected and passed its separate run. Final full-suite totals are recorded in verification-output/2026-11-16/full-suite-final.log, rather than inferred from earlier reports.


## 16 November 2026 - Owner setup checklist acceptance

The real Owner UI and API returned all ten checks with explanations and repair links; no prerequisite was forced ready. The pre-change real-data snapshot had zero of ten ready. Staff readiness, independent reviewers, exact customer/item links, quotation policy and costs, unset business rules, connector/company status, MFA and backup age remain independently reported. Business values remain BLOCKED: NEEDS CLIENT DECISION wherever not confirmed. See verification-output/2026-11-16/live-setup.json for actual gaps and setup-ui-check.json for controlled UI acceptance. The verified migration backup created today may legitimately change the backup check; it does not configure any business policy.


## 16 November 2026 - Stock workflow browser acceptance and balances

Orders now displays retained Tally on-hand, reserved and free balances separately, alongside the selected stock basis and explicit dispatch availability. The text distinguishes retained source balances from an invented live balance and explains unresolved movement holds. No inferred subtraction, automatic reconciliation or stock policy default was introduced.

Real browser/API/DB acceptance with rollback fixtures verified a saved immutable company binding, rejection of dispatch with zero free stock, one valid four-unit dispatch, persisted immutable stock consumption and Owner pending-movement visibility. Existing tests separately cover audit rollback and independent reconciliation. Evidence: verification-output/2026-11-16/company-binding-check.json, dispatch-check.json, movement-check.json and browser-results.json. Real live Tally freshness remains unverified.


## 16 November 2026 - Customer review schema integrity and UI verification

Prepared and displayed additive migration 0058_customer_review_integrity_indexes.sql before execution. The existing backup command verified a 219744653-byte archive; only then did the existing runner apply six missing FK indexes and the nullable onboarding from-status check. No customer, approval, role grant or business policy was seeded by the migration. Updated schema classifications for the two existing onboarding tables. Read-only verification reports 58 matching checksums and zero pending migrations; focused schema/comparison tests passed six tests.

Browser acceptance separately checks customer creation, creator denial, blocked pre-review orders, independent Owner approval, duplicate review, immediate permission saving, live-session access changes and audit entries. Those outcomes are recorded in the dated browser evidence, not inferred from the migration or historic test notes.


## 16 November 2026 - Live Tally freshness limitation

The configured Tally XML endpoint did not respond to a bounded read-only company-export request. Live freshness is NOT TESTABLE here: Tally must be running with XML export enabled at the configured local address, the intended company open, and the existing Windows connector online with a successful current receipt. No write request or switch activation was sent.

Read-only inspection still confirms 575 stored sales documents (570 Sales Quotations and five Sales Orders). Retained counts are not proof of a current live sync. Evidence: verification-output/2026-11-16/live-tally.json and live-setup.json.


## 16 November 2026 - Large retained XML viewer defect

Browser acceptance found that rendering the complete 30991457-byte salesDocumentsXml payload did not produce a usable visible original view. The retained payload API itself returned the original correctly. Fixed only the existing viewer: show a clearly labelled 65536-character preview, retain the existing full-original download endpoint, and label copying as Copy preview when truncated. Both the record-detail and retained-payload entry points use the bound. Source bytes remain unchanged.

A real browser then opened the preview, matched it to the beginning of the retained source, downloaded the full original and verified byte length and SHA-256 equality. The same read-only check confirmed 575 retained sales documents. Evidence: verification-output/2026-11-16/tally-original-check.json, feature-5.png, tally-view-final.log and browser-results.json. This is a 16 November fix, not an earlier delivery claim; live Tally freshness remains NOT TESTABLE.


## 16 November 2026 - Customer PO selection identifier regression

Actual customer-PO comparison acceptance exposed an unquoted SQL alias in the existing order list: PostgreSQL folded poNumber to ponumber, so the new selector displayed undefined instead of the customer PO reference. Quoted the alias to preserve the existing typed API contract and added an exact identifier assertion to the existing sales-order lifecycle regression. No order identity, pricing or approval behavior changed.

The focused sales-order and linked-search run passed three tests with zero failures/cancellations/skips. The complete full-suite rerun is recorded separately.
