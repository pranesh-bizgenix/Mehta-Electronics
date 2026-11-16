# Owner setup checklist

Added 3 November 2026. `/setup` and `GET /api/v1/setup` are restricted to the literal `OWNER` role. An explicit server check prevents a permission grant to another role from exposing readiness information. Existing session, forced password, MFA and permission gates still apply. GET is read-only; no settings, approvals, automation switches or Tally data are changed.

## Live checks and fix destinations

| Check | Live source and readiness definition | Fix destination |
| --- | --- | --- |
| Staff accounts | `users` and `user_mfa`; more than one active account, with active accounts available, password setup complete, no current lock and required MFA enrolled | `/users` |
| Second reviewer | Existing permission matrix and shared reviewer helper; current makers have a different ready reviewer for every applicable registered workflow | `/users` |
| CRM customers linked | Active `customers`, profile/fallback mappings and current imported ledgers; all active CRM customers have exactly one matching Tally master and the CRM list is nonempty | `/customers` |
| CRM items linked | Active `items`, profile/fallback mappings and current imported stock; all active CRM items have exactly one matching Tally master and the CRM list is nonempty | `/items` |
| Quotation policy | Active singleton in `crm_quotation_policy` plus a usable, current confirmed `margin.floor_percent` decision; a retained policy alone is not ready | `/quotations?tool=policy` for missing policy; `/decisions?key=margin.floor_percent` for confirmation |
| Item costs | Active CRM items with an active, nondeleted `crm_quotation_costs` record; all have recorded costs and the item list is nonempty | `/quotations?tool=costs` opens the cost drawer |
| Business rules | Existing rules registry/service and current database versions, including the quotation policy adapter; every registered rule configured | `/rules` |
| Connector | `tally_connectors` joined to `tally_connector_heartbeats`; each active profile has connected state, Tally available and its expected company selected | `/tally/connector` |
| MFA enforcement | Live role requirements and account enrollment, plus actual runtime `MFA_ENABLED`; enforcement ON, Owner role requires MFA, required active accounts enrolled | `/setup#mfa`, with links to Users/roles and Settings |
| Backup age | Latest `DATABASE_BACKUP` / `VERIFIED` database audit receipt with valid target, timestamp, nonempty size and SHA-256 metadata; snapshot no older than the existing 10-minute migration window | `/setup#backup`, with the existing backup command and audit link |

The screen displays checked time, status and evidence counts, refresh, and one repair link per row. It uses shared UI components and the relative typed API client. Owner navigation and command search include Setup; other roles do not. Quotation policy and cost query parameters are supported by the existing quotation page so links open the intended tools after session loading.

No numerical business policies are supplied. Recorded zero item cost is a configured value, not missing data; the screen does not invent a positive cost. Readiness criteria summarize technical prerequisites, not client acceptance or permission to approve a particular transaction. Maker/editor restrictions and all record-specific gates remain authoritative. Missing rules are reported even if their workflows are not currently used. No automation switch is enabled or edited.

## Backup provenance and operator steps

The existing backup command now appends a receipt to the existing database audit log after the dump, archive listing, nonempty check and local SHA-256 receipt succeed. Only metadata is recorded, not database credentials or archive contents. Failure to record the database receipt makes the command fail; a completed local archive can still exist. There is no schema change or new database connection target.

Older filesystem-only receipts are not imported or inferred. Until a new successful backup is recorded, the database checklist reports no recorded backup. The backup section instructs the operator to run `npm.cmd run db:backup` from this repository, then refresh. No background backup schedule, restore operation or web command-execution endpoint was added.

Backup age follows the already established production migration window; it is not a daily backup or retention policy. A database receipt proves verification at completion, not that the archive still exists or restores successfully. The migration runner continues independently checking the actual local file, size, checksum and freshness. Runtime MFA configuration also cannot truthfully be obtained from a database row: its actual runtime flag is explicitly reported alongside database role/enrollment state. The operator section explains setting `MFA_ENABLED=true` and restarting the same application; no environment file is edited by the screen.

## Changed files

- `src/modules/admin/setup-service.js`: repository, readiness service, Owner check and controller.
- `src/modules/container.js`: composition into existing API.
- `src/migration-backup.js`: audit verified backup receipt.
- `apps/web/app/(app)/setup/page.tsx`: checklist and operator repair instructions.
- `apps/web/app/(app)/quotations/page.tsx`: exact policy/cost drawer links.
- `apps/web/components/shell/nav-config.ts`, `app-shell.tsx`, `command-palette.tsx`: Owner-only navigation visibility.
- `test/setup.test.js`: unit and rollback database/HTTP checks.
- `docs/setup-checklist.md`, `docs/client-plan-implementation.md`: implementation and verification.

No migration, real staff account, invented business record, new service or port. No connector code, intake, outbound, send gate, approval gate or automation switch changed. No commit made.

## Verification

- `node --test --test-concurrency=1 test/setup.test.js test/user-provisioning.test.js test/migration-backup.test.js`: PASS, 13 passed, 0 failed/cancelled/skipped. Includes explicit non-Owner denial even with broad grants, unauthenticated HTTP denial, real database aggregate changes, audit receipt recording, empty CRM state, stale/future/invalid backup metadata, wrong selected company, MFA enrollment gaps and reviewer readiness. All tagged database fixtures roll back; handlers run without another listener.
- `npm.cmd run lint`: PASS.
- `npm.cmd run build`: PASS, including design tokens, TypeScript, 29 routes and packaged production artifact.
- Task-specific `git diff --check`: PASS.
- `npm.cmd run db:backup`: PASS; created a verified **218,828,326-byte** archive in ignored `backups`, with the new database audit receipt. A subsequent live service read reported **1 of 10 ready**, specifically the backup check; the other nine checks still need attention. The same live state reported 0 of 10 before backup completion. No missing business configuration was filled in.
- Actual archive freshness/size/SHA-256 gate (`requireRecentBackup`): PASS after the backup, independently of the database age row.
- `npm.cmd run db:verify`: PASS; 34 matching checksums, 0 pending, read-only.
- Shared `assertNoTestRows()` whole-public-table scan after tests: PASS, no `ZZTEST_` rows remain.
- Explicit syntax checks for new service/test files: PASS.

Full legacy suite and manual browser acceptance were not run for this task. Existing application/connector processes were not restarted. Runtime environment and role requirements are reported, not changed. Independent-session concurrency and archive restoration are not verified.
