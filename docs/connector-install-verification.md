# Connector update and version verification — 4 November 2026

## Prepared only

No Windows service was installed, stopped, started or reconfigured for this task. No installed service folder or ProgramData profile was changed. Builds and validation wrote only workspace artifacts and temporary test files; database test records were rolled back. The running connector will keep its current version until an administrator applies the prepared update later.

Prepared release: **1.2.0**, framework-dependent Windows .NET 8 service, **40 payload files** under `output/tally-sales-review/connector-prepared-1.2.0`. The reviewed manifest is `docs/tally-sales-connector-update.json`, containing every payload SHA256, core/executable hashes, exact company/app binding and the two existing profiles:

- `BizgenixTallyConnector-mehta-electronics`
- `BizgenixTallyConnector-mehta-electric-corporation-from`

This updates existing services only; missing or differently registered services fail preflight. It does not install prerequisites, create services, change databases, enable automation or write to Tally. Use the complete repository plus its prepared release/manifest on the Tally PC; the web application's `dist` directory alone is not the updater package.

## Safe validation now / application later

From the repository root, validation only:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-tally-sales-connector.ps1 -ValidateOnly
```

This checks local .NET 8 runtime presence, release boundaries, reparse points, all 40 source hashes, exact manifest coverage and the core assembly version. It writes a result JSON. It does **not** read installed profiles, query/control services, change ACLs or copy into Program Files. Validation-only can run without elevation; it records whether the current process is elevated.

**For a later authorised update on the Tally PC only**, open Windows PowerShell using **Run as administrator**, change to the complete repository root, then run:

```powershell
.\scripts\update-tally-sales-connector.ps1
```

Apply mode checks Administrator rights first and explains those steps if missing. It checks both manifest profiles, their expected company and existing app URL, each service executable path and stable initial service states. These installed-service checks were deliberately not run during preparation.

## Backup, copy, restart and recovery

1. Create a unique timestamp/GUID run folder under `backups/connector-update/`. Restrict it to Administrators and SYSTEM before copying; service appsettings can contain sensitive local configuration. `backups/` is git-ignored.
2. Stop **both** Mehta services and wait up to 30 seconds for each to reach Stopped.
3. Copy each entire current service folder, including existing appsettings, hidden files and nested directories. Verify every original file by SHA256 and file count. Save `inventory-sha256.json` beside each backup. Both full backups must pass before copying any release file.
4. Recheck each source payload hash, copy it into the checked service directory, then verify the destination hash. Local `appsettings*.json` are excluded from the release payload. ProgramData credentials, selected-company configuration, checkpoints and queue files are never overwritten.
5. Start both services and wait for Running. A service reaching Running does not establish successful Tally sync; verify the next authenticated heartbeat and sync history separately.
6. On failure after changes begin, stop both peers, restore every original file from verified backups and verify its hash. Files newly introduced by the failed update are moved into backup quarantine rather than deleted. Restore the original Running/Stopped states. A stop or restore failure is reported as manual recovery required; the script does not claim success.

Result JSON is always attempted on normal success/failure at:

`output/tally-sales-review/connector-update-results/<timestamp-guid>.json`

It includes mode, phase, expected version, timestamps, backup location, per-profile backup/copy/running checks, rollback state and a safe error message. Raw configuration, bearer tokens and exception dumps are not written. Result files and prepared binary folders are git-ignored. A killed process/power loss cannot guarantee `finally` execution: use the unique full-folder backups and their inventories for manual recovery, keeping both services stopped until the files are consistent. No service deletion or database operation is part of recovery.

## Running version in ControlDesk

`Directory.Build.props` assigns connector version `1.2.0` to the shared Windows projects. `ConnectorMetadata.CurrentVersion` reads the core assembly actually loaded by the process; it does not infer the installed version from a file on disk or the app server's expected release.

The Windows heartbeat now sends `connectorVersion` and retains `agentVersion` for compatibility. ControlDesk validates the explicit build string and stores it in the existing `tally_connectors.agent_version` column. An authenticated changed version writes a `TALLY_CONNECTOR / VERSION_REPORTED` audit event with before/after strings and a system actor; repeated identical heartbeats do not duplicate that event. Legacy `agentVersion`-only heartbeats still work. Existing connector token/company authentication is unchanged; machine heartbeat endpoints use bearer/token authentication rather than an employee session/CSRF token.

`/api/tally-connector/status` exposes `connector_version` without credentials. It is null until a heartbeat exists. `/tally/connector` shows **Last reported connector version** beside the existing heartbeat age, connection state and company identity. Offline status remains explicit; a retained version is not presented as proof that the service is running now.

After a later update, refresh that screen, select each profile and confirm a new heartbeat reporting `1.2.0`, the intended company and a successful sync. Do not infer application of the update from the prepared release or validation result alone. Existing management permission/session/MFA checks protect the status screen. No new role or permission is added.

## Rebuilding a future reviewed release

Change the shared connector version for the next release. The command that succeeded here, using existing cached dependencies, was:

```powershell
dotnet publish connectors/tally-windows/TallyConnector.Service/TallyConnector.Service.csproj -c Release --self-contained false --no-restore -o output/tally-sales-review/connector-prepared-1.2.0
```

Update the manifest's version/output directory and regenerate/review hashes for **all** payload files, excluding every `appsettings*.json`. Include the native executable, service DLL and core DLL; match the top-level hashes to those entries. Then rerun validation-only. A rebuilt binary with different bytes intentionally fails the old reviewed manifest; never bypass a hash mismatch. A fresh checkout may need its normal dependency restore before publishing; no dependency installation/restore was performed for this task.

An initial publish explicitly selecting `win-x64` with `--no-restore` failed because the cached assets lacked that RID target. The ordinary framework-dependent publish above succeeded. It emitted NU1900 warnings because cached NuGet vulnerability metadata could not be retrieved in this restricted environment; dependency advisory status was not verified.

## Changed files and verification

- `scripts/update-tally-sales-connector.ps1`
- `docs/tally-sales-connector-update.json`
- `connectors/tally-windows/Directory.Build.props`
- `connectors/tally-windows/TallyConnector.Core/Services/ConnectorMetadata.cs`
- `connectors/tally-windows/TallyConnector.Core/Services/ApiService.cs`
- `connectors/tally-windows/TallyConnector.Core/Models/ApiContracts.cs`
- `src/connector-store.js` and `src/app.js` (optional injected store for same-transaction handler tests)
- `apps/web/app/(app)/tally/connector/page.tsx`
- `test/connector-version.test.js`
- `test-support/check-connector-update.ps1`
- `.gitignore`, this guide and `docs/client-plan-implementation.md`

No migration is needed: existing version/heartbeat and audit storage is reused.

Initial focused tests: **3 passed, 0 failed, 0 skipped**. The PowerShell helper exercises nine checks for parse validity, non-Administrator rejection, validation-only eligibility, path traversal rejection, correct/wrong hashes, restoring overwritten files, quarantining added files and validation isolation. It loads only updater function definitions and uses a checked `ZZTEST_` temporary directory under workspace backups; no service operation is executed. Another test invokes only `-ValidateOnly` against the real prepared payload. The database/real-handler test uses `withTestTransaction` on `mehta_electronics_local` for explicit/legacy versions, version-change audit dedupe, invalid versions, wrong company, invalid bearer, status session checks and credential suppression. No second listener or database is created.

`npm.cmd --prefix apps/web run typecheck`, `npm.cmd run lint`, `npm.cmd run build` (including design tokens), scoped `git diff --check` and `npm.cmd run db:verify` passed. Migration verifier: **35 matching checksums, zero pending**. Final focused connector/setup/Tally-read regression: **13 passed, 0 failed, 0 skipped**. The broader guarded run including Tally-import had **15 passed, 1 failed**: its existing import integration test calls the legacy database/schema helper disabled by MASTER RULES (TEST_SCHEMA_DISABLED). The initial/final residue scans passed with no committed ZZTEST_ rows. This pre-existing test-fixture failure was not bypassed or used to create a database. Installed-service stop/copy/restart/rollback, an actual new heartbeat from a Windows service, browser acceptance and NuGet advisory checks remain unverified by design. The full repository suite was not run.


Final focused command: `node --test --test-concurrency=1 test/connector-version.test.js test/setup.test.js test/tally-read.test.js` (13 passed). Broader guarded command: `npm.cmd test -- test/connector-version.test.js test/setup.test.js test/tally-read.test.js test/tally-import.test.js` (15 passed, 1 legacy-fixture failure; residue scans passed). Subsequent syntax checks for the changed store/test and final updater validation-only checks also passed. No apply-mode execution was performed.
