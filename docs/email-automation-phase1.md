# Email automation — Phase 1

This is a separate read-only module. It adds an inbox, email details, attachment metadata, processing monitor, basic dashboard, integration monitor and basic error center. It does not ingest, process, send, retry, replay, edit or approve anything. Existing CRM screens and the Tally connector are unchanged.

## Enable and assign access

The default is OFF. Set `EMAIL_AUTOMATION_ENABLED=true` in the deployment environment, then rebuild (`npm.cmd run build`) and restart the existing single server. Development also needs a restart after changing the flag. Use the same flag for build and server processes. No deployment environment file was changed by this implementation. Disable by removing the flag or setting it to `false`, rebuilding and restarting.

When OFF, all `/email-automation/*` pages and `/api/v1/email-automation/*` APIs return 404, and the sidebar section is absent. A new path-limited Next proxy enforces the page status before the shared layout streams. It does not match existing routes.

After applying migration 0061, an Owner opens **Administration → Users & roles → Role permissions** (`/users?tab=roles`). Find the `email_automation` resource and explicitly grant:

- `email_automation.read`: inbox, details, attachments, processing, dashboard and errors.
- `email_automation.integrations.read`: integration monitor, separately.

Assign the chosen role to staff in the existing People tab. The existing access matrix records these changes. No role grants are inserted by this module. Owner retains the application's existing wildcard access; this implementation does not introduce that behavior. Existing logistics restrictions remain in effect. Use a suitable custom role when needed rather than changing existing role policies.

## Data and privacy

Default `EMAIL_AUTOMATION_DATA_MODE=mock` uses only fictional fixtures inside `src/modules/email-automation/mock-adapter.js`. Every record screen labels them Sample data. They are never seeded into any table. The browser verification intercepts API requests and also persists no fixture records.

Set `EMAIL_AUTOMATION_DATA_MODE=stored` to read existing canonical `email_messages` and `email_threads`, plus the new prefixed read models. There is no ingestion writer. Source-document names/type/size are joined through `source_documents`; only S3 bucket/key references are stored in new tables. No file contents, body contents, credentials, presigned URLs or external downloads are stored or retrieved by this module. Stored message bodies show an unavailable explanation. Sample bodies are escaped plain text, never rendered as HTML.

Stored mode currently covers the latest 1,000 emails and up to 1,000 linked attachments/runs. When truncated, the UI explicitly says counts and filters cover that window. Matching CRM records are links to existing pages by canonical integer ID, filtered by the user's existing CRM read permissions. The destination retains its existing authorization checks.

Gmail, S3 and AI provider always report **Not configured** because no real checks exist. PostgreSQL uses `SELECT 1` for each integration-page load and reports Connected only after success, or Unavailable on failure. Provider errors and connection strings are not returned. The `automation_integration_status` table is reserved for future verified status metadata; Phase 1 does not trust stored status as proof of current connectivity.

Successful GET access records use the existing audit log with `entity='email-automation'`, the actual actor and a fixed `VIEW_*` action. Sample access uses `record_id='module'`; no sample record IDs or fixture metadata are inserted. Stored detail access records only the canonical email ID. Old/new values and reason are null. Email bodies, subjects, addresses, attachment names and contents are excluded. These real access audit events are the only module-related request writes. The existing Audit page already discovers entity filters dynamically, so it was not edited.

## Files

Added:

- `apps/web/app/(app)/email-automation/layout.tsx` and seven page routes: `inbox`, `inbox/[id]`, `attachments`, `processing`, `dashboard`, `integrations`, `errors`.
- `apps/web/features/email-automation/config.ts`, `contracts.ts`, `screens.tsx`, `screens.module.css`.
- `apps/web/proxy.ts`: new module paths only, disabled-page 404 guard.
- `src/modules/email-automation/mock-adapter.js`, `repository.js`, `routes.js`.
- `database/postgres/migrations/0061_email_automation_read_models.sql`.
- `test/email-automation.test.js`, `test/email-automation-http.test.js`.
- `apps/web/test/email-automation-nav.test.mjs`.
- `scripts/verify-email-automation-ui.mjs`, `scripts/migrate-email-automation.mjs`.
- This guide and `docs/email-automation-shared-files.diff`.

Modified shared files only:

- `src/config.js`: default-OFF flag and adapter mode configuration.
- `src/app.js`: one import and one backend route registration.
- `apps/web/next.config.ts`: expose the same build flag to the new UI paths/navigation.
- `apps/web/components/shell/nav-config.ts`: conditional collapsible EMAIL AUTOMATION group.
- `apps/web/components/shell/app-shell.tsx`: generalized group open state/rendering, keeping Administration's label, default closed state, active-route expansion and collapsed-sidebar behavior.

No existing CRM table definitions, migrations, Audit page or Tally code were edited. The two new permission catalogue rows are the explicitly requested permission additions; no role assignment changes are made. The dedicated guide records this slice instead of editing the existing implementation-plan document, honoring the shared-file restriction.

## Migration

0061 adds `automation_email_metadata`, `automation_attachments`, `automation_processing_runs` and `automation_integration_status`, with foreign keys to existing canonical records and indexes for email/run lookup. It adds only the two permission catalogue keys, with no business data, fixture rows or role grants.

The dedicated migration helper refuses to run unless 0061 is the sole pending migration and every existing migration checksum matches. It creates and verifies a fresh full backup before invoking the existing migration runner. It never skips the repository's backup guard. Configure `PG_BIN` to installed PostgreSQL client tools when required, then run `node scripts/migrate-email-automation.mjs`. Do not run it again after migration is current; use the existing migration status/runner for ordinary deployment checks.

## Test manually

1. With flag OFF, request each new page/API: expect 404. Existing `/api/health` must remain 200 and the sidebar must have no Email Automation group.
2. Enable, rebuild/restart, grant the intended role keys, and sign in normally with the existing MFA requirements.
3. Open the inbox, search a subject/sender and filter a status; check the empty state with a non-matching term. Open an email and confirm its attachment/run IDs match the other screens.
4. Check all seven screens, including a narrow mobile viewport. The email section and Administration should expand independently.
5. Check Integration monitor: Gmail/S3/AI must not say Connected; PostgreSQL must have a real check timestamp.
6. Try an ungranted role: no module navigation or protected data. Grant only the general read key: Integration monitor must remain restricted.
7. POST/PUT/PATCH/DELETE to a new GET path: expect 405 when enabled; expect 404 when disabled. No action buttons are exposed.
8. Inspect the existing Audit page's `email-automation` filter after a successful real access event; confirm IDs/actions/actors only.

## Verification results

| Check | Before changes | After changes |
| --- | --- | --- |
| `npm.cmd test` | Blocked before execution by the existing local-database-only test guard because this workspace uses the authorized RDS database | Same guard blocks the full suite; not reported as a passing suite |
| `npm.cmd run build` | Passed, existing 42 static pages generated | Passed, existing pages plus seven dynamic module routes and the path-limited proxy |
| Existing purchasing regression tests | 10 passed | 10 passed within the focused regression run |
| Focused frontend/config/auth/purchasing/module regression run | Purchasing baseline above | 41 passed, 0 failed, 2 opt-in database tests skipped in this run |
| `npm.cmd run lint` | Not separately run before editing | Passed |
| Explicit RDS rollback HTTP verification | Not applicable | After migration: 3 passed, 0 failed, 0 skipped, including stored-adapter SQL |
| Browser verification with intercepted APIs | Not applicable | 13 checks passed, zero browser runtime errors; desktop and 390px mobile screenshots saved |

The broader attempted regression run also encountered two existing local-only database tests (connectivity and live NUMERIC verification) blocked by the same environment guard. The final focused run excludes those two database-dependent files rather than bypassing their guard. Its command is:

```powershell
$emailRegressionTests = (Get-ChildItem apps/web/test -Filter '*.test.mjs' | Where-Object Name -ne 'connectivity.test.mjs').FullName
node --test @emailRegressionTests test/local-access.test.js test/purchase-documents.test.js test/email-automation.test.js test/email-automation-http.test.js
```

The separately authorized database check used `VERIFY_AUTHORIZED_RDS_ROLLBACK=true` for `node --test test/email-automation-http.test.js`. It verified real sessions, authenticated GETs, MFA rejection, no automatic role grants and privacy-safe audit events inside an outer transaction that rolled back. It creates no users or mailbox fixtures. After the successful migration on 19 November 2026, the same check was rerun: all three tests passed, including the stored-adapter queries against the new schema, with no skipped tests.

Browser testing used the existing listener, an ephemeral frontend-only flag override and intercepted in-memory API responses. Both the override and earlier configuration experiment were restored. No real mailbox traffic or ingestion was exercised. It covered the six landing screens, email details, shared attachment IDs, empty searches, API errors, existing Administration expansion, independent module collapse, denied roles and narrow-screen overflow. Screenshots and detailed results are in ignored `verification-output/email-automation/2026-11-19/`.

Final live checks with the restored OFF flag: `/email-automation/inbox`, `/email-automation/attachments` and `/api/v1/email-automation/emails` return 404; existing `/api/health` returns 200. Handler tests cover all seven API paths when OFF and reject POST/PUT/PATCH/DELETE with 405 when enabled.

**Deployment resolved — 19 November 2026:** the initial full backup exceeded the existing ten-minute freshness limit, so migration 0061 was correctly blocked. A subsequent full backup completed and passed archive, checksum and freshness verification. The existing guarded runner then applied exactly `0061_email_automation_read_models.sql` successfully: one migration applied, 61 total. No backup guard, existing migration or application source code was changed to resolve startup. The development server was started on the existing port 3000; `/api/health` and `/login` both returned 200. The module remains default OFF, so its pages and APIs still return 404. The two permission catalogue keys now exist and can be assigned through Users & roles; no role grants or mailbox fixtures were inserted.

Automatic approval review initially rejected a broad backup/migration command because unrelated migrations had not been ruled out. Read-only ledger/checksum evidence and the 0061-only helper resolved that approval concern. The later successful backup and migration resolved the technical freshness blocker without weakening the check.

## Needs confirmation

- Which staff/custom roles should receive each permission, and whether future access must be scoped per mailbox/company/customer.
- Which real mailbox and ingestion service will populate the canonical records and the new read models; no pipeline is included here.
- Gmail, S3 and AI provider health-check contracts, credential ownership and acceptable check freshness.
- Email/body/attachment retention, access policy and whether future file preview/download is allowed.
- Whether the first deployment should remain in labeled sample mode or use stored metadata, and whether the 1,000-record window needs database-wide search/pagination before live mailbox rollout.

Phase 2 review queues, routing rules, workflows, drafts, approvals, templates and switches remain excluded.
