# Staff provisioning - 3 November 2026

## Delivered behavior

The `/users` People tab creates individual staff accounts with name, email, optional phone, an existing active role, department, owner and backup owner. As confirmed by the user, **owner uses the existing reporting/escalation manager field** (`users.manager_user_id`); the response also retains the older manager aliases. Backup uses `users.backup_user_id`. Neither assignment grants approval permission.

An owner is required for creation. Owner and backup must be different active people, cannot be the staff member themselves, and cannot be on leave. Backup may remain explicitly unassigned, with a visible warning. This allows an organization with only one Owner to provision its first colleague without inventing a backup. Unassigned backup is not counted as coverage. Existing accounts are not automatically assigned owners or backups.

The administrator supplies a temporary password manually under the existing password policy. The application hashes it and sets the existing `must_change_password` flag. No real users, default passwords or password seeds were created. Passwords and hashes are excluded from user responses, previews and audit records. Creation has an optional idempotency key, which the native UI supplies for retry safety.

First sign-in completes any existing required MFA flow and then opens password setup in Settings. The server refuses business endpoints until a different valid password is saved; hiding navigation is only a UI convenience. Setup keeps authentication, logout and MFA setup available. Password change verifies the current password under a row lock, clears the flag, revokes other sessions and records an audit entry in the same transaction. Preferences, company scope and badge requests wait for password setup to finish.

Editing and deactivation require a reason. Deactivation changes status rather than deleting the staff record, revokes sessions and retains history. Self-deactivation and demotion/deactivation of the last active Owner are refused. Creation and access edits share an advisory transaction lock and recheck the acting account's permission. Both legacy and versioned user mutation routes use the same service. Existing work-to-backup reassignment and MFA reset remain available through their existing permissions.

## Owner and reviewer warnings

Current and proposed account changes show warnings when only one active Owner remains or a maker has no different ready reviewer for an applicable workflow. Read-only preview requests contain proposed role/status/leave/name metadata, never credentials, and do not save changes. The confirmation dialog waits for the preview and shows remaining coverage.

`src/modules/admin/reviewer-eligibility.js` checks quotations, sales orders, purchasing, GRN, contracts, operational cases, financial cases and exceptions against the existing permission service. Eligible reviewers must be active, not on leave or temporarily locked, have completed password setup, satisfy required MFA enrollment, and have the workflow's permissions. The helper excludes creator, latest editor and explicit excluded IDs when supplied. Financial cases retain their Owner/Accounts restriction. Logistics permissions retain their existing ceilings.

Coverage is an advisory account-capacity check. A provisioning preview has no individual business record or editor history; the existing record-specific approval services continue to decide approval eligibility, maker-checker restrictions and all other gates. An assigned backup without approval permission is never treated as a reviewer. No role, permission grant, business rule, automation switch or Tally write behavior changes in this task.

## Files changed for this task

- `src/modules/admin/user-admin-service.js`: shared repository, service and versioned routes.
- `src/modules/admin/reviewer-eligibility.js`: independent reviewer eligibility and capacity warnings.
- `src/app.js`: shared legacy mutations and transactional forced password setup.
- `apps/web/app/(app)/users/page.tsx`: creation, ownership, deactivation and warning UI.
- `apps/web/app/(app)/settings/page.tsx`, `apps/web/app/login/page.tsx`, `apps/web/components/shell/app-shell.tsx`: first-login password flow.
- `apps/web/lib/preferences.tsx`, `apps/web/lib/scope.tsx`: defer business requests during password setup.
- `public/app.js`: legacy staff form uses shared provisioning contracts.
- `test/user-provisioning.test.js`: new eligibility and provisioning tests.
- `test/logistics-roles.test.js`: existing creation fixture supplies required ownership metadata.
- `docs/user-provisioning.md`, `docs/client-plan-implementation.md`: behavior and verification record.

No migration added or applied: all staff fields already exist. No commit made.

## Verification

All database fixtures run against live-guarded `mehta_electronics_local` through the shared rollback helper, invoking the HTTP handler without another listener. Fixtures use `ZZTEST_` names and roll back, including the test that injects an audit failure. Password test values are generated in memory and are not seeded. Expected identity sequence gaps from rolled-back inserts are not reset.

| Command | Result |
| --- | --- |
| `node --test --test-concurrency=1 test/user-provisioning.test.js test/logistics-roles.test.js test/crm-modules.test.js test/tally-read.test.js test/quotations.test.js test/sales-orders.test.js test/procurement.test.js test/transaction-helper.test.js test/database-guard.test.js` | PASS: 36 passed, 0 failed, 0 cancelled, 0 skipped |
| `npm.cmd run lint` | PASS |
| `npm.cmd run build` | PASS: design tokens, TypeScript, Next production build, packaged artifact |
| `npm.cmd run db:verify` | PASS: 34 matching checksums, 0 pending; read-only |
| `npm.cmd test` | FAIL: 136 tests; 79 passed, 11 failed, 46 cancelled, 0 skipped |

The full run's pre-test and post-test public-table scans both passed: no `ZZTEST_` rows remain. Full-run failures remain in other legacy suites that call the prohibited database/schema helper; they were not skipped or re-enabled. Output is captured in the ignored `output/user-provisioning/full-test-run.log`.

New tests cover creator/editor exclusion, account readiness, role permissions, backup not granting approval, one-Owner and missing-reviewer warnings, serialized last-Owner protection, session/CSRF/permission checks, ownership validation, rejection of undefined Admin, forced-password flag bypass, legacy route consistency, duplicate creation, idempotency, audit-failure rollback, preview non-mutation, mandatory password change, session revocation and audited soft deactivation.

## Remaining verification and limits

The existing application was not restarted and no manual browser/visual acceptance was performed. The production artifact is built; a normal restart is required for an existing process to load backend changes. Real staff provisioning and password delivery were intentionally not exercised. Independent-session races were not tested. Backup ownership remains a visible coverage gap until a different active person is assigned. Remaining legacy suites need their own transaction conversion before the entire suite can pass.
