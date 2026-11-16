# Repository audit baseline

Audited: **3 November 2026, Asia/Kolkata**. Authority: [root MASTER RULES](../AGENTS.md). This is a static repository baseline; it does not certify that historical code complies with those rules.

**Subsequent enforcement update:** [database-guard.md](database-guard.md) records the implemented live database guard. The observations below remain the original audit snapshot: schema-per-test creation, restore execution and alternate tenant routing have since been disabled, script preflights added, and `db:verify` changed to read-only checksum verification. Its old “DO NOT RUN: creates schemas” description is historical; other legacy integration harnesses remain blocked.

## 1. Scope and audit method

- Repository root: `Mehta-Electronics/`, the folder containing the root `package.json`, `src/` and `apps/`. The enclosing desktop folder and sibling projects are outside scope.
- Reviewed the complete first-party source/file inventory across `src/`, `apps/web/`, `public/`, `scripts/`, `database/`, `test/`, `test-support/`, `connectors/tally-windows/`, and repository documentation; traced database factories, their callers, HTTP clients, URL configuration and listener creation. Inspected source scripts retained under `output/` as well.
- A content fingerprint was recorded for **397 source/configuration/test/migration files** so this documentation task can check that application files were not modified. Credentials/environment files were excluded from that fingerprint inventory.
- Third-party `node_modules/`, `.git/`, generated `.next*/`, .NET `bin/` and `obj/`, binaries, captures and repeated `dist/` copies are not independent application source and were excluded from line-by-line connection-site listings. Generated copies can contain the same old connections as their source.
- The local `.env` was parsed only to verify the database name and loopback-host classification. No connection string, credential, token, personal record or environment value was copied into this document. No database connection was opened, no SQL was executed and no external URL was contacted for this audit.
- Files already modified/untracked before this task were preserved. The earlier system report is historical evidence, not a replacement for these new rules.

## 2. Confirmed paths and folder layout

All paths explicitly named in the MASTER RULES exist. No correction to those rules' paths was necessary.

| Rule/reference | Verified actual path | Result |
|---|---|---|
| Single combined listener | `src/controldesk-server.js` | Exists; creates the HTTP server and dispatches UI/API |
| Server entry point | `src/server.js` | Exists; starts that listener |
| Windows connector | `connectors/tally-windows/` | Exists; .NET projects plus inherited source/experiments |
| Existing migrations directory | `database/postgres/migrations/` | Exists |
| Last migration file on disk | `database/postgres/migrations/0033_tally_order_lookup.sql` | Exists; highest numbered migration is 0033 |
| Next migration slot | `database/postgres/migrations/0034_<description>.sql` | Reserved naming pattern; **no migration created** |
| Required implementation log | `docs/client-plan-implementation.md` | Exists; updated for this audit |
| Migration implementation | `src/migrations.js` | Exists |
| Database startup integration | `src/db.js` | Exists |

```text
Mehta-Electronics/
  AGENTS.md                       Current mandatory rules
  package.json / package-lock.json
  .env                            Local ignored settings; never publish
  .env.example                    Configuration template; not live settings
  src/
    server.js                     Combined app startup/shutdown
    controldesk-server.js          One UI/API HTTP listener
    app.js                        API composition, auth and compatibility routes
    config.js                     Environment loading
    postgres.js / db.js            PostgreSQL factory, transactions and startup
    migrations.js                 Ordered/checksummed migration runner
    core/                         Errors, schemas, HTTP, runtime, scheduler
    modules/                      Controllers/services/repositories
    tally-orders/                 Default-off comparison/fetch scaffolding
    assets/                       Bundled PDF font/licence
    quotation-*, sales-*, procurement*, tally-* and other commercial modules
  apps/web/
    app/                          Next.js App Router pages/layouts
    components/ds/                Shared UI components
    components/shell/             Navigation, shell, search
    features/                     Typed feature UI and API wrappers
    lib/                          Relative API client, session, scope/preferences
    styles/                       Tokens, base, shared component/workspace CSS
    scripts/check-tokens.mjs       Static token check
    test/                         Formatting + legacy DB connectivity tests
    next.config.ts / tsconfig.json / package.json
  public/                         Legacy browser UI + shared JS/math/descriptors
  database/
    postgres/migrations/          Current canonical 0001–0033 SQL files
    diagrams/ and *.md            Domain/schema design and historical plans
  connectors/tally-windows/
    TallyConnectorAgent.slnx
    TallyConnector.Core/          Existing connector API/XML/queue/credentials
    TallyConnector.Service/       Existing Windows service/worker
    TallyConnector.Setup/         Existing Windows pairing/setup UI
    src/, drizzle/                Inherited GI TypeScript/SQL source; not the app
    tally-engine/                 Inherited Node agent/diagnostic scripts
    experiments/                  Inherited separate-server experiment
    docs/                         Historical upstream instructions
  scripts/                        Build, lint, migrations, diagnostics/verification
  test/ / test-support/           Existing Node tests and fixtures
  docs/                           Current/historical implementation documentation
  data/                           Ignored local data/artifacts
  dist/                           Ignored generated production copy
  output/                         Reports, captures, release/verification artifacts
  node_modules/                   Installed root dependencies
```

There is no current `apps/api/` business backend. References to it in architecture proposals describe a target, not an existing path. The sibling `tally_connector-main` is outside this repository and outside the allowed scope. No additional repository was created.

The inherited `connectors/tally-windows/src/lib/db/tenant-resolver.ts` imports `./client`, but `connectors/tally-windows/src/lib/db/client.ts` is absent. Do not invent or rebuild that missing upstream application.

## 3. How to start the existing app

Run commands from the repository root in PowerShell. Existing dependencies must already be installed; this audit did not install packages or use network package registries.

### Development

```powershell
npm.cmd run dev
```

The root script executes `node src/server.js --dev`. It uses development mode and defaults `NEXT_DIST_DIR` to `.next-dev`. The normal address is **http://127.0.0.1:3000**. A single listener serves both Next.js UI and business APIs.

### Production

```powershell
npm.cmd run build
npm.cmd start
```

The root build executes `scripts/build.mjs`: runs the token check, invokes the local Next.js production build from `apps/web/`, then replaces `dist/` with a generated production copy. The build fixes its child `NEXT_DIST_DIR=.next`, disables Next telemetry and removes `MEHTA_API_URL` from that child environment. It does not start a listener or deliberately open the business database.

The start script executes `node src/server.js`, using production mode unless already overridden. Pending migrations run before listening. Startup can also bootstrap an Owner on an empty user table and backfill missing document revisions; startup is **not a read-only verification command**.

Do not start another instance if the listener is already running. Do not invoke standalone `next dev`, `next start`, a preview server, a separate API server or a new port. `npm.cmd --prefix apps/web run dev` and `... run start` delegate to the root scripts; they are not a reason to start another process.

`src/config.js` loads root `.env`, then fills unset values from `.env.local`; preexisting process environment variables take precedence. `HOST`/`PORT` remain configurable in historical code, but the new rules do not authorize changing the endpoint. A previously exported environment variable can override the file.

### Same-origin API contract

`src/controldesk-server.js` dispatches `/api/*` and `/quotation-print.css` to the existing backend; other paths/assets go to Next.js. `apps/web/lib/api/client.ts` uses relative paths, cookies, CSRF on writes, no-store requests and typed responses/errors. Its feature callers use `/api/...`.

`apps/web/next.config.ts` retains an optional `MEHTA_API_URL` rewrite for old isolated UI verification. **Do not set or use it to introduce a second/remote backend under the MASTER RULES.** The current configuration is not a code-level allowlist preventing every possible external origin.

## 4. Canonical migrations and database configuration

The permitted database is **`mehta_electronics_local` only**. Static inspection of the local `.env` found that database name and a loopback database host. No live connection was made, so this is configuration evidence, not verification of the server/session's effective database.

Startup chain:

1. `src/server.js` calls `getConfig()`, then `openDatabase(config)`.
2. `src/db.js` calls `createDatabase(config)`, then `applyMigrations(db.sql)`.
3. `src/postgres.js` owns the `postgres` driver connection factory and transaction connection handling.
4. `src/migrations.js` reads `database/postgres/migrations/` in order, checks contiguous filenames, takes an advisory transaction lock, compares stored SHA-256 checksums and records forward applications in `mehta_schema_migrations`.
5. Applied SQL files must not be edited. The next new file is `0034_<description>.sql`, applied to this same database through the existing startup runner.

`npm.cmd run db:migrate:postgres` / `scripts/migrate-postgres.mjs` also exists and calls the same runner directly. It is recorded as an existing capability, **not used here**; the MASTER RULES specify the existing startup runner as the migration application path.

The application pool and connector-store pool are separate connection pools to the configured database, not two database products. `src/connector-store.js` calls the same central factory.

Important existing limitations:

- `src/postgres.js`, `src/db.js` and `src/connector-store.js` accept their configured URL; they do not universally enforce the allowed database name. Some operator scripts have their own name guard; others do not. Do not assume a global guard exists.
- `createDatabase(config)` and connector-store construction still accept a `databaseSchema` option used by old tests. That is historical code, not permission to use a test schema.
- No first-party `.db`, `.sqlite` or `.sqlite3` files were found outside dependency/build exclusions. No SQLite or Docker database was opened or created.
- The inherited `connectors/tally-windows/drizzle/0012_connector_lifecycle.sql` is not part of the ControlDesk startup runner. Do not apply it as an alternate migration stream.

## 5. Commands, current safety and results

| Purpose | Existing command from repository root | This audit |
|---|---|---|
| Full test suite | `npm.cmd test` → `node --test --test-concurrency=1` | **NOT RUN: prohibited schema creation and extra listeners in existing tests** |
| Web test script | `npm.cmd --prefix apps/web test` | **NOT RUN: discovers DB/listener connectivity test** |
| Safe selected pure unit tests | `node --test --test-concurrency=1 apps/web/test/format.test.mjs test/tally-descriptors.test.js` | **PASS: 12 passed, 0 failed**; no DB/network/listeners |
| Syntax lint | `npm.cmd run lint` | **PASS**; parses JS/MJS with `node --check`, does not execute tests |
| Web typecheck | `npm.cmd --prefix apps/web run typecheck -- --incremental false` | **PASS**; `tsc --noEmit`, incremental output disabled |
| Design tokens | `npm.cmd --prefix apps/web run check:tokens` | **PASS** |
| Full production artifact build | `npm.cmd run build` | **NOT RUN** for this documentation-only task; described from inspected script |
| UI-only production build | `npm.cmd --prefix apps/web run build` | **NOT RUN**; does not create the root `dist/` artifact |
| Migration-copy verification | `npm.cmd run db:verify` | **DO NOT RUN**: `verify-migrations-copy.mjs` creates a temporary schema |
| Demo seed | `npm.cmd run seed:demo` | **DO NOT RUN**: writes invented business rows |
| Backup/restore | `npm.cmd run db:backup -- <path>` and `src/database-backup.js` restore helper | Existing capability only; **not run**, no dump/restore/copy authorized |
| Static documentation/path/immutability checks | Inline Node assertions and targeted `git diff --check` | **PASS**: eight rules, 33 contiguous migration files, required paths, local Markdown links, secret-value non-disclosure and 397 unchanged source-file hashes |

The pure tests emit Node's existing module-type performance warning for `apps/web/lib/format.ts`; tests still pass. It was not fixed in this documentation-only task.

### Existing tests that violate the new rules

`test-support/postgres.js` exposes `temporarySchema()` / `temporaryDatabase()`, uses `CREATE SCHEMA test_...`, shadow tables/search_path and `DROP SCHEMA ... CASCADE`. This directly conflicts with MASTER RULE 1 even though it uses the same base database. Do not run it.

Transitive fixture chain:

```text
test-support/postgres.js
  -> test-support/crm-module-fixture.js
     -> test-support/quotation-fixture.js
        -> test-support/sales-order-fixture.js
           -> test-support/procurement-fixture.js
```

Those fixtures are used by CRM, quotation, sales-order, procurement and client-operations tests and their browser-verification scripts. Optional database flags are not permission to activate them. Migration, backup and isolation tests also create/drop schemas directly or through the helper.

Several tests and verification tools additionally start an ephemeral HTTP server or separate Next/API listeners. MASTER RULE 2 forbids those extra listeners too. `apps/web/test/connectivity.test.mjs` is one explicit example.

Required future adaptation: tests must use a rollback transaction or `ZZTEST_`-tagged rows removed by the same test, in the single allowed database, with no new listener. Designs must account for existing application transactions and ensure cleanup survives failure; simply wrapping multi-connection HTTP tests in one transaction would not establish isolation. No test helper or application code was changed here.

## 6. Every direct database connection entry point and caller

“Connection entry point” means a driver/factory/helper that opens or selects a database, a caller of one, or an external database-tool invocation. Ordinary repositories using an already-injected `db` object are not separate database connections. Exact line-site inventory is in section 9.

| Area | Files and behavior |
|---|---|
| Core connection owner | `src/postgres.js`: `connectPostgres()` invokes `postgres(databaseUrl,...)`; `createDatabase()` wraps it |
| Configuration | `src/config.js`: loads `DATABASE_URL`; root `.env` / optional `.env.local` are configuration, never publish values |
| App startup | `src/server.js` → `src/db.js` → factory/runner |
| Connector ingestion store | `src/connector-store.js`: separate pool via `connectPostgres()`, same configured URL |
| Database client programs | `src/database-backup.js`: passes the configured host/database/user/credential through child environment to `pg_dump` / `pg_restore`; contains a restore helper |
| Direct operator connection callers | `scripts/apply-client-plan.mjs`, `audit-tally-visibility.mjs`, `backfill-tally-visibility.mjs`, `backup-database.mjs`, `capture-tally-parser-fixtures.mjs`, `finalize-tally-master-coverage.mjs`, `generate-sample-quotation.mjs`, `import-tally-master-coverage.mjs`, `import-tally-sales-documents.mjs`, `migrate-postgres.mjs`, `probe-tally-master-coverage.mjs`, `replay-tally-imports.mjs`, `report-tally-visibility.mjs`, `reset-password.mjs`, `seed-demo.mjs`, `tally-query-benchmark.mjs` |
| Direct test/verification connection callers | The `test/`, `test-support/`, `apps/web/test/` and `scripts/verify-*` / `scripts/ui-*` rows in section 9; many transitively create schemas or extra listeners |
| Retained artifact code | `output/tally-sales-review/audit-original.mjs` opens the configured database; output scripts are not automatically safe or authorized |
| Inherited upstream DB selection | `connectors/tally-windows/src/lib/db/tenant-resolver.ts` can return `tenant_database_connections.db_url`, organization-specific URL, or `DATABASE_URL`; its imported client is absent. This alternate routing must not be enabled |
| DB-derived crypto, not a connection | `connectors/tally-windows/src/lib/connectors/tally/connector-crypto.ts` references `DATABASE_URL` as a crypto fallback input; it is inventoried but does not open PostgreSQL |

`test-support/mfa.js` and pure calculation/formatting helpers do not open a database. `scripts/lib/demo-data.mjs` takes an injected DB and writes synthetic business records; it is prohibited against the allowed real database even though it is not a connection factory.

All other `src/modules/*/*-repository.js`, commercial services, `src/tally-visibility-repository.js`, `src/overview.js`, `src/tally-import.js` and related query modules use an injected handle or a handle supplied by these owners. SQL migration files define schema and guards; they do not create driver connections on their own.

## 7. Every live HTTP/external-destination owner

No destinations below were contacted by this audit. Presence in source is not authorization to use it.

| Owner / configuration | Destination and operation | Status under MASTER RULES |
|---|---|---|
| `src/controldesk-server.js`, `src/server.js` | The existing combined listener, normally `127.0.0.1:3000` | Keep this one application listener |
| `apps/web/lib/api/client.ts` | Fetches same-origin relative `/api/...`; feature/session/scope modules use this client | Approved transport pattern; no new external API URLs |
| `public/app.js` | Legacy browser `api()` wrapper uses `fetch(url,...)`; feature callers pass relative API paths | Existing legacy transport; not another frontend deployment |
| `apps/web/next.config.ts`, `apps/web/.env.example` | Optional `MEHTA_API_URL` rewrite; default literal app origin `http://127.0.0.1:3000` | Do not use old isolated/external-backend mode |
| `src/config.js`, `src/tally.js` | `TALLY_URL`, default existing Tally endpoint `http://127.0.0.1:9000`; POST XML Export with retry | Existing read-only Tally adapter, not permission for another app/server |
| `src/tally-orders/fetchers/runtime.js` | Calls injected `transport.request()`; no hardcoded target | Existing default-off scaffold; do not activate a new fetch process |
| `src/mailer.js`, `src/config.js` | Nodemailer SMTP transport from `SMTP_HOST` / port / TLS settings | Owned by other engineer; out of scope; no sending/config changes |
| `scripts/diagnose-tally.mjs` | HTTP POST to configured Tally endpoint and connector-store DB reads | Operator action, not run |
| `scripts/import-tally-master-coverage.mjs`, `import-tally-sales-documents.mjs`, `probe-tally-master-coverage.mjs` | Fetch configured Tally URL for XML exports; some also persist imports | Operator actions; not run or treated as read-only DB checks |
| `TallyConnector.Core/Services/ApiService.cs` | HttpClient to paired `ApiBaseUrl` + this app's `/api/health`, connector and ingest routes | Existing Windows connector must target this app |
| `TallyConnector.Core/Services/TallyService.cs` | HttpClient POST to configured `TallyBaseUrl` | Existing Tally read-only XML path |
| `TallyConnector.Core/Services/ConnectorMetadata.cs` | Defaults include `https://gi.bizgenix.ai`, old local `http://127.0.0.1:3122`, and Tally `:9000` | Cloud/3122 defaults conflict with current rules; document only, do not use |
| `TallyConnector.Core/Models/ConnectorConfiguration.cs`, `TallyConnector.Setup/PairingForm.cs` | Persist/select API and Tally base URLs; setup initially uses metadata defaults | Existing saved local profile must be checked before any later setup; this audit did not access ProgramData |
| `connectors/tally-windows/tally-engine/agent.mjs` | Reads `GI_URL` / optional `config.json`, default `http://localhost:3122`; raw HTTP Tally fetch and uploads to `/api/ingest/tally/chunks`; references old cloud setup URL in messages | Inherited alternate Node agent: do not start or watch |
| `connectors/tally-windows/tally-engine/diagnose.mjs` | Fetches constructed Tally host/port | Inherited operator tool, not run |
| `connectors/tally-windows/src/lib/connectors/tally/client.ts` | Raw Node HTTP request using a configured Tally host/port | Inherited upstream TypeScript adapter; not mounted in ControlDesk |
| `connectors/tally-windows/src/app/(app)/ask/page.tsx`, `connections/page.tsx`, `connections/TallyPairingPanel.tsx` | Fetch upstream relative `/api/...` | Inherited upstream pages, not a second app to launch; `ask`/classification-related code is out of scope |
| `connectors/tally-windows/experiments/codex-decision-cockpit/server.mjs` | Starts `:4173`; proxies `GI_CORE_URL`, default `http://127.0.0.1:3122` | Do not start; extra listener/upstream |
| `connectors/tally-windows/experiments/codex-decision-cockpit/app.js` | Fetches experiment's relative `/api/live-brief` | Inherited experiment only |
| Test/browser verification network calls | All section 9 entries; `fetch`, Playwright `goto`, stubbed requests and created listeners | No blanket permission to run; schema/new-port scripts prohibited |

The `TallyConnector.*` paths above are beneath `connectors/tally-windows/`. Connector application settings and deployment manifests can carry a destination through a profile/configuration; the inventory identifies their configuration owners without copying saved credentials.

No Make.com implementation was found in the ControlDesk runtime connection owners. This is not permission to add one. Existing AI/ask source under inherited connector files is not a commissioned ControlDesk integration and was not executed.

### Existing extra-listener and side-effect scripts

- Extra listeners: `scripts/preview-design.mjs`, `ui-capture-legacy.mjs`, `ui-verify.mjs`, `verify-client-plan.mjs`, `verify-combined-controldesk.mjs`, `verify-crm-modules.mjs`, `verify-overview.mjs`, `verify-procurement.mjs`, `verify-quotations.mjs`, `verify-sales-orders.mjs`, `verify-stored-tally.mjs`, `verify-tally-visibility.mjs`, `verify-ui-redesign.mjs`, plus `test/crm.test.js`, `test/dashboard-summary.test.js`, `test/foundation.test.js`, `apps/web/test/connectivity.test.mjs`. A port of `0` still creates an additional listener.
- Historical fixed UI/API addresses include ports `3197`, `3997`, `3198` and `3996`; some scripts compute further ports. Do not run these modes under the current rules.
- `scripts/verify-tally-sales-ui.mjs` and `verify-ui-polish.mjs` target an existing historical `:3198` frontend, also outside the approved single-address setup.
- `scripts/update-tally-sales-connector.ps1` stops/starts installed connector services and replaces service files, using the staged release manifest. It does not itself make HTTP calls, but it changes an external installed service and was not run.
- Import, replay, backfill, password-reset, migration and seed scripts can alter the configured DB. A script name containing “audit”, “verify” or “sample” is insufficient evidence of no side effects; `openDatabase()` itself runs migration/bootstrap/backfill behavior.
- Existing in-process scheduler intervals are not a separate worker. They do not authorize changing reminders or automation; those remain out of scope and must stay OFF.

## 8. Textual URLs that are not application connections

Keep documentation links, XML namespaces, URL-parser sentinels and package registries distinct from HTTP request sinks.

| Location | URL/reference meaning |
|---|---|
| `src/controldesk-server.js`, `src/tally-read-service.js` and verification scripts | `http://localhost`, `http://local`, `http://test`, `http://verify`, `http://benchmark` used as URL parsing bases; not automatically contacted |
| `public/index.html`, `src/procurement-xlsx.js` | W3C SVG and OpenXML namespace URIs; identifiers, not a remote data request |
| `apps/web/next-env.d.ts`, historical docs | Next.js documentation references |
| `docs/quotations.md`, `docs/tally-sales-sync-report.json` | CBIC/Tally documentation links |
| `connectors/tally-windows/docs/` | Historical cloud pilot URLs, including a Vercel deployment; not current approved endpoints |
| `connectors/tally-windows/README.md`, experiment README | Old `pnpm dev`/`:3122`/`:4173` launch instructions; superseded for this repository |
| `docs/frontend-migration-plan.md` | Historical separate UI `:3001` proposal; not the approved launch |
| Connector `launchSettings.json` and publish profiles | JSON schema / Microsoft tooling reference URLs |
| Root/web package lockfiles and .NET package references | Dependency download metadata; package restore/install can contact registries, but does not define a business integration. No install/restore ran |
| Customer profile `mailto:` / `tel:` links | Browser/device handoff when a user clicks; not server-side SMTP or proof of delivery |

Historical README instructions also endorse temporary schemas, demo seeding and restoration into another database. **AGENTS.md supersedes those instructions.** They were inventoried, not executed or silently rewritten.

## 9. File-and-line connection/configuration site inventory

This index records all first-party source matches for connection factories/callers, database URL selectors/tool calls, network request sinks and their explicit configuration selectors. Line numbers refer to the unchanged source at audit time. It includes definitions, fallback/test-injected transports and disabled/inherited code; a match is not proof of an actual connection.

The detailed interpretation is in sections 6–8. Indirect fixture users are covered by the fixture chain in section 5. All feature `api.get/post/put/patch/data` calls flow through the browser transport above; a repository's `db.prepare` call uses an injected connection and is not another database endpoint.

| File | DB/factory/configuration lines | HTTP/network/configuration/listener lines |
|---|---|---|
| [src/config.js](<../src/config.js>) | 25, 29 | 34, 45 |
| [src/connector-store.js](<../src/connector-store.js>) | 70, 71 | — |
| [src/database-backup.js](<../src/database-backup.js>) | 24, 25, 39, 40, 46, 47, 54, 55 | — |
| [src/db.js](<../src/db.js>) | 5, 6 | — |
| [src/mailer.js](<../src/mailer.js>) | — | 5 |
| [src/postgres.js](<../src/postgres.js>) | 4, 5, 6, 27, 28 | — |
| [src/server.js](<../src/server.js>) | 11 | 25 |
| [src/tally-orders/fetchers/runtime.js](<../src/tally-orders/fetchers/runtime.js>) | — | 23 |
| [src/tally.js](<../src/tally.js>) | — | 62 |
| [public/app.js](<../public/app.js>) | — | 13 |
| [scripts/apply-client-plan.mjs](<../scripts/apply-client-plan.mjs>) | 7 | — |
| [scripts/audit-tally-visibility.mjs](<../scripts/audit-tally-visibility.mjs>) | 6, 7 | — |
| [scripts/backfill-tally-visibility.mjs](<../scripts/backfill-tally-visibility.mjs>) | 6, 7 | — |
| [scripts/backup-database.mjs](<../scripts/backup-database.mjs>) | 10 | — |
| [scripts/build.mjs](<../scripts/build.mjs>) | — | 9 |
| [scripts/capture-tally-parser-fixtures.mjs](<../scripts/capture-tally-parser-fixtures.mjs>) | 7 | — |
| [scripts/diagnose-tally.mjs](<../scripts/diagnose-tally.mjs>) | — | 10 |
| [scripts/finalize-tally-master-coverage.mjs](<../scripts/finalize-tally-master-coverage.mjs>) | 6, 7 | — |
| [scripts/generate-sample-quotation.mjs](<../scripts/generate-sample-quotation.mjs>) | 8 | — |
| [scripts/import-tally-master-coverage.mjs](<../scripts/import-tally-master-coverage.mjs>) | 10, 11 | 32 |
| [scripts/import-tally-sales-documents.mjs](<../scripts/import-tally-sales-documents.mjs>) | 7 | 21 |
| [scripts/migrate-postgres.mjs](<../scripts/migrate-postgres.mjs>) | 5 | — |
| [scripts/preview-design.mjs](<../scripts/preview-design.mjs>) | — | 24, 55, 90 |
| [scripts/probe-tally-master-coverage.mjs](<../scripts/probe-tally-master-coverage.mjs>) | 6 | 15 |
| [scripts/replay-tally-imports.mjs](<../scripts/replay-tally-imports.mjs>) | 5 | — |
| [scripts/report-tally-visibility.mjs](<../scripts/report-tally-visibility.mjs>) | 9 | — |
| [scripts/reset-password.mjs](<../scripts/reset-password.mjs>) | 22 | — |
| [scripts/seed-demo.mjs](<../scripts/seed-demo.mjs>) | 5 | — |
| [scripts/tally-query-benchmark.mjs](<../scripts/tally-query-benchmark.mjs>) | 8, 9 | — |
| [scripts/ui-capture-legacy.mjs](<../scripts/ui-capture-legacy.mjs>) | 19, 20, 21 | 32, 38, 44 |
| [scripts/ui-verify.mjs](<../scripts/ui-verify.mjs>) | 48, 49, 50 | 44, 66, 75, 85, 128, 143, 158, 175, 180, 195, 209, 230, 235 |
| [scripts/verify-client-plan.mjs](<../scripts/verify-client-plan.mjs>) | 15, 17, 22 | 29, 30, 34, 50, 63, 68, 70 |
| [scripts/verify-combined-controldesk.mjs](<../scripts/verify-combined-controldesk.mjs>) | 14, 18, 23 | 29, 31, 32, 33, 34, 40, 51, 72, 92 |
| [scripts/verify-crm-modules.mjs](<../scripts/verify-crm-modules.mjs>) | — | 19, 27 |
| [scripts/verify-live-tally-sales.mjs](<../scripts/verify-live-tally-sales.mjs>) | 3 | — |
| [scripts/verify-live-tally-visibility.mjs](<../scripts/verify-live-tally-visibility.mjs>) | 11, 12 | — |
| [scripts/verify-migrations-copy.mjs](<../scripts/verify-migrations-copy.mjs>) | 17, 25 | — |
| [scripts/verify-overview.mjs](<../scripts/verify-overview.mjs>) | 11 | 19, 31 |
| [scripts/verify-procurement.mjs](<../scripts/verify-procurement.mjs>) | — | 14, 17, 19 |
| [scripts/verify-quotations.mjs](<../scripts/verify-quotations.mjs>) | — | 20, 25, 27, 42 |
| [scripts/verify-sales-orders.mjs](<../scripts/verify-sales-orders.mjs>) | — | 15, 19, 21 |
| [scripts/verify-stored-tally.mjs](<../scripts/verify-stored-tally.mjs>) | — | 18, 30, 53 |
| [scripts/verify-tally-checkpoint-a.mjs](<../scripts/verify-tally-checkpoint-a.mjs>) | 9 | 28 |
| [scripts/verify-tally-sales-ui.mjs](<../scripts/verify-tally-sales-ui.mjs>) | 8 | 13, 15, 29 |
| [scripts/verify-tally-visibility.mjs](<../scripts/verify-tally-visibility.mjs>) | 1, 18, 20, 21 | 49, 52, 61, 68 |
| [scripts/verify-ui-polish.mjs](<../scripts/verify-ui-polish.mjs>) | — | 10, 24 |
| [scripts/verify-ui-redesign.mjs](<../scripts/verify-ui-redesign.mjs>) | 18, 20, 25 | 44, 49, 54, 67 |
| [apps/web/lib/api/client.ts](<../apps/web/lib/api/client.ts>) | — | 54, 77 |
| [apps/web/next.config.ts](<../apps/web/next.config.ts>) | — | 4, 7, 20 |
| [apps/web/test/connectivity.test.mjs](<../apps/web/test/connectivity.test.mjs>) | 16, 17, 18 | 21, 33 |
| [connectors/tally-windows/experiments/codex-decision-cockpit/app.js](<../connectors/tally-windows/experiments/codex-decision-cockpit/app.js>) | — | 167 |
| [connectors/tally-windows/experiments/codex-decision-cockpit/server.mjs](<../connectors/tally-windows/experiments/codex-decision-cockpit/server.mjs>) | — | 8, 16, 54 |
| [connectors/tally-windows/src/app/(app)/ask/page.tsx](<../connectors/tally-windows/src/app/(app)/ask/page.tsx>) | — | 265, 295 |
| [connectors/tally-windows/src/app/(app)/connections/page.tsx](<../connectors/tally-windows/src/app/(app)/connections/page.tsx>) | — | 120, 541, 698 |
| [connectors/tally-windows/src/app/(app)/connections/TallyPairingPanel.tsx](<../connectors/tally-windows/src/app/(app)/connections/TallyPairingPanel.tsx>) | — | 48, 70 |
| [connectors/tally-windows/src/lib/connectors/tally/client.ts](<../connectors/tally-windows/src/lib/connectors/tally/client.ts>) | — | 83 |
| [connectors/tally-windows/src/lib/connectors/tally/connector-crypto.ts](<../connectors/tally-windows/src/lib/connectors/tally/connector-crypto.ts>) | 9 | — |
| [connectors/tally-windows/src/lib/db/tenant-resolver.ts](<../connectors/tally-windows/src/lib/db/tenant-resolver.ts>) | 28, 43, 48 | — |
| [connectors/tally-windows/tally-engine/agent.mjs](<../connectors/tally-windows/tally-engine/agent.mjs>) | — | 28, 29, 162, 218 |
| [connectors/tally-windows/tally-engine/diagnose.mjs](<../connectors/tally-windows/tally-engine/diagnose.mjs>) | — | 88 |
| [connectors/tally-windows/TallyConnector.Core/Services/ApiService.cs](<../connectors/tally-windows/TallyConnector.Core/Services/ApiService.cs>) | — | 33, 44, 108, 139, 178, 212, 302, 342, 375 |
| [connectors/tally-windows/TallyConnector.Core/Services/TallyService.cs](<../connectors/tally-windows/TallyConnector.Core/Services/TallyService.cs>) | — | 360 |
| [test/client-operations.test.js](<../test/client-operations.test.js>) | 11 | — |
| [test/crm-modules.test.js](<../test/crm-modules.test.js>) | 31, 34 | — |
| [test/crm.test.js](<../test/crm.test.js>) | 69, 70, 71 | 45, 55, 74, 124, 168 |
| [test/dashboard-summary.test.js](<../test/dashboard-summary.test.js>) | 23, 24, 25 | 16, 20, 30 |
| [test/database-backup.test.js](<../test/database-backup.test.js>) | 13, 15, 19, 20, 21, 22, 24 | — |
| [test/foundation.test.js](<../test/foundation.test.js>) | 92, 93, 94 | 71, 97 |
| [test/migrations.test.js](<../test/migrations.test.js>) | 9, 12, 13, 28, 29 | — |
| [test/overview.test.js](<../test/overview.test.js>) | 18, 19 | — |
| [test/tally-import.test.js](<../test/tally-import.test.js>) | 25, 26 | — |
| [test/tally-read.test.js](<../test/tally-read.test.js>) | 54, 57 | — |
| [test/tally-sales-documents.test.js](<../test/tally-sales-documents.test.js>) | 25 | — |
| [test/tally-visibility.test.js](<../test/tally-visibility.test.js>) | 19, 20 | — |
| [test/test-isolation.test.js](<../test/test-isolation.test.js>) | 12, 13, 16, 24, 26 | — |
| [test-support/crm-module-fixture.js](<../test-support/crm-module-fixture.js>) | 8, 9 | — |
| [test-support/postgres.js](<../test-support/postgres.js>) | 8, 24, 33, 36, 37, 42, 44, 49, 64 | — |
| [output/tally-sales-review/audit-original.mjs](<../output/tally-sales-review/audit-original.mjs>) | 2 | — |

Additional configuration/dispatch sites without an explicit factory/request expression are `src/controldesk-server.js`, `src/modules/container.js` (mailer injection and existing in-process jobs), root `.env` / `.env.example`, `apps/web/.env.example`, `TallyConnector.Core/Services/ConnectorMetadata.cs`, `TallyConnector.Core/Models/ConnectorConfiguration.cs`, `TallyConnector.Setup/PairingForm.cs`, connector service `appsettings*.json`, and `docs/tally-sales-connector-update.json`. The inherited tenant resolver's missing client is recorded in section 2.

## 10. Policy gaps recorded, not changed

1. Existing tests use schema-per-test and extra listeners. They are blocked, not certified compliant.
2. Core DB constructors accept arbitrary configured URLs and schema options. Static `.env` validation is not a universal runtime database guard.
3. Windows connector source still contains cloud/`:3122` defaults; inherited GI source includes alternate DB routing and servers. Do not activate those paths.
4. Existing `MEHTA_API_URL` and configurable app/connector endpoints allow historical alternate origins. Current rules prohibit using them.
5. Exact-money policy is not uniformly enforced in historical code: `src/postgres.js` parses NUMERIC using Number; legacy reductions in `src/db.js` use number arithmetic. This task did not change it.
6. Existing auth/health/login endpoints and bearer-authenticated connector endpoints do not literally have a browser session and CSRF token. The supplied universal endpoint rule and current connector/bootstrap contracts need an explicit policy reconciliation before future authentication changes; no gate was weakened here.
7. Existing cleanup of sessions/transient records and some maintenance code uses hard deletion; “no hard deletes” is the required policy, not a claim that every legacy path already complies.
8. `src/config.js` contains a static bootstrap-password fallback, and tests contain synthetic credential strings. No actual credentials were copied to documentation; no remediation was attempted in this documentation-only scope.
9. The task did not query the database or inspect installed connector profiles outside the repository. Effective process environment, migration ledger, switch states, cleanup of old test schemas and deployed service destinations were not reverified.
10. Full dependency/source-history secret scanning, live network tracing and behavioral/security acceptance were not performed. Source inventories do not prove those properties.

## 11. Completion record

- **Changed:** added the root rules file and this baseline; appended the implementation log.
- **Files changed by this task:** `AGENTS.md`, `docs/audit-baseline.md`, `docs/client-plan-implementation.md` only.
- **Migrations added/applied:** none. Next slot remains 0034.
- **Commands run:** static source/path/configuration inventory, safe pure unit tests (12/12 PASS), syntax lint PASS, typecheck PASS, token check PASS, documentation/path/secret-value assertions PASS, targeted diff check PASS, and source fingerprints PASS (397 files compared, zero changes). Exploratory searches corrected for PowerShell wildcard handling; no failed search was treated as evidence of a missing path.
- **Not verified:** runtime DB state, live Tally/connector destinations, startup/build/production acceptance, and the blocked full integration suite.
- **Risks/open questions:** test-harness adaptation, code-level single-DB/origin enforcement, legacy money/deletion behavior, and auth/bootstrap/connector exceptions described above. They require separately scoped implementation work; this audit did not modify application code or start/stop services.

