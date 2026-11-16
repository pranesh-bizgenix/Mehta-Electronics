# Live single-database guard

Implemented 3 November 2026 under the root MASTER RULES. The sole allowed database is `mehta_electronics_local`. No migration is added.

## Enforcement

- `src/database-guard.js` first rejects a configured alternate target, alternate schema/search_path, or target/session overrides without opening it. Errors never contain the connection URL or driver secrets.
- The decisive check is **`SELECT current_database() AS name` on the live connection**. A missing row, unexpected name or failed query refuses access with `DATABASE_GUARD_REJECTED`.
- `src/postgres.js` returns a guarded SQL client. Each root query reserves a physical connection, checks its live database, executes on that same connection, then releases it. Reserved request connections are checked once at checkout; PostgreSQL cannot switch databases within that session.
- The driver starts transaction control before its transaction callback; that transaction's connection is checked before the caller may execute SQL. A mismatch rolls back and closes the pool. Migrations additionally check at their entry point before locks, schema ledger or migration SQL.
- `openDatabase()` waits for readiness before bootstrap/backfill/migrations. Startup prints a clear refusal and exits when the guard rejects. The application's default connector store receives the application's existing SQL client. A standalone connector store still uses the guarded factory when no client is supplied.
- Database-using scripts wait for readiness before their work. The central query gate also covers indirect callers and retained scripts. Offline lint/build/format/parser tools do not open a database merely to run.
- The wrapper exposes the SQL operations used by this application: tagged queries/builders, `unsafe`, JSON/array/typed parameters, `ready`, pool `begin`/`reserve`/`end`/`close`, reserved release and transaction savepoints. Unused driver APIs such as separate subscription/listener clients are not exposed as an unguarded escape hatch.

## Disabled paths

- Direct database create/drop/alter and schema create/drop statements are refused. Historical schema-per-test implementation was removed from `test-support/postgres.js`; its retained exports throw `TEST_SCHEMA_DISABLED` before any connection. Do not restore this mechanism or silently skip all its failures.
- `restoreDatabaseBackup()` refuses before opening a database/archive. `runPostgresTool()` only permits a fixed same-target dump or archive listing; alternate targets, create/clean options and inherited service/host/session overrides are rejected/removed. No restore or backup was executed for this change.
- `scripts/verify-migrations-copy.mjs` retains its filename/package command but now verifies the migration ledger/checksums in a read-only transaction, without copying a database/schema or applying migrations.
- The demo-seed entry point refuses. The inherited upstream tenant database resolver refuses rather than selecting organization-specific connection strings.
- First-party source was searched for database create/drop statements and `createdb`/`dropdb` invocations. No executable database-creation/drop path was found outside the disabled administration surface; remaining occurrences are rejection tests, refusal logic or historical documentation. Dependencies and generated artifacts are not alternative approved runtimes. The root production build refreshes the existing `dist/` copy from guarded source.

## Verification

Focused safety and pure regression command:

```powershell
node --test --test-concurrency=1 test/database-guard.test.js test/database-backup.test.js test/test-isolation.test.js apps/web/test/format.test.mjs test/tally-descriptors.test.js test/tally-order-comparison.test.js
```

`database-guard.test.js` uses protocol doubles, not another database, SQLite or an in-memory database. It simulates a live connection returning another name, verifies no application SQL/callback runs, and checks rejection on pool replacement, reserve/tagged/unsafe/transaction/migration access, unavailable identity and administration SQL. No wrong-target real connection is attempted.

Real verification is restricted to the permitted database: readiness, a reserved `BEGIN READ ONLY` / `SELECT current_database()` / `ROLLBACK`, and a guarded read-only pool transaction. `npm.cmd run db:verify` validates existing migration checksums using SELECTs only. No rows or schemas are created for these checks.

Other required checks are `npm.cmd run lint`, `npm.cmd --prefix apps/web run typecheck -- --incremental false` and `npm.cmd run build`. Actual results are recorded in the task completion entry; command documentation alone is not a claim that a check passed.

Results for this change: focused safety/pure regression command **38 passed, 0 failed**; syntax lint **PASS**; TypeScript **PASS**; root production build/token check **PASS**. Real read-only guard/reserved/pool transaction checks, Tally read-service/JSON parameter/connector-health checks **PASS** on the sole permitted database. `npm.cmd run db:verify` **PASS**, 33 checksums matched and 0 pending. No wrong-name database was contacted; negative cases used protocol doubles. Full legacy integration suite, dump/restore, service restart and browser acceptance were not run.

## Files changed

- Runtime: `src/database-guard.js` (new), `src/postgres.js`, `src/db.js`, `src/server.js`, `src/migrations.js`, `src/connector-store.js`, `src/database-backup.js`.
- Script live preflights: `scripts/apply-client-plan.mjs`, `audit-tally-visibility.mjs`, `backfill-tally-visibility.mjs`, `capture-tally-parser-fixtures.mjs`, `finalize-tally-master-coverage.mjs`, `import-tally-master-coverage.mjs`, `import-tally-sales-documents.mjs`, `migrate-postgres.mjs`, `probe-tally-master-coverage.mjs`, `tally-query-benchmark.mjs`, `verify-live-tally-sales.mjs`, `verify-live-tally-visibility.mjs`, `verify-tally-sales-ui.mjs`, `diagnose-tally.mjs` (all beneath `scripts/`).
- Disabled/replaced unsafe utilities: `scripts/verify-migrations-copy.mjs`, `scripts/seed-demo.mjs`, `scripts/lib/demo-data.mjs`, `test-support/postgres.js`, `connectors/tally-windows/src/lib/db/tenant-resolver.ts`.
- Tests: `test/database-guard.test.js` (new), `test/database-backup.test.js`, `test/test-isolation.test.js`.
- Documentation: this file (new), `docs/client-plan-implementation.md`, `docs/audit-baseline.md`, `README.md`. Existing generated production `dist/` was refreshed; unrelated preexisting edits were preserved.

## Limits and rollout

Historical schema-based fixtures now refuse. On 5 November the remaining legacy
test callers were converted to rollback transactions and socket-free real-handler
checks; see `transaction-tests.md` and the dated implementation log for the actual
full-suite results. No extra listener is enabled. MFA/send/approval gates,
communication integrations and persistent automation settings are untouched.

Identity checks add one SELECT per pool checkout. Existing request/transaction reservations reuse their verified physical session; nontransactional bulk callers may incur additional round trips. No performance benchmark or dump/restore acceptance was run.

Running Node processes must undergo the normal restart to load backend changes; the audit does not restart the app or connector services. No connection to another database, test schema, Docker service or cloud service is authorized for verification. No business data or applied migration file was changed.
