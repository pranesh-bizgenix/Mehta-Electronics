# PostgreSQL schema and recovery

All application persistence uses `DATABASE_URL`. Run `npm.cmd run db:migrate:postgres` to apply migrations explicitly; server startup also applies pending migrations before listening. There is no fallback database.

Migrations live in `database/postgres/migrations/`. Files must have contiguous four-digit prefixes. The runner holds a PostgreSQL advisory lock and applies pending files and their ledger records in one transaction. Failures roll back the batch. `mehta_schema_migrations` stores names, SHA-256 checksums, and application times. Unknown migrations and checksum changes stop startup. Add new files for schema changes.

Migrations 0001–0003 support remote connectors. Migration 0004 adds CRM users, sessions, masters, documents, revisions, direct Tally jobs, and audits. Migrations 0017–0020 add customer-PO normalization, target-domain persistence structures, integrity guards, and human-approval checks for automation email sends. Direct sync jobs use `crm_tally_sync_jobs` to preserve the separate UUID-based connector job contract. The database role needs schema-creation permissions and access to the `citext` extension.

## Local conversion on 2026-10-19

The existing local records were copied into PostgreSQL in one transaction with primary keys, password hashes, session tokens, relationships, audit entries, and timestamps preserved. All 17 CRM table row counts were checked at that conversion. Identity sequences were advanced after explicit ID insertion. The application no longer reads SQLite. The SQLite database and sidecars were subsequently removed at the user's request; PostgreSQL recovery archives remain in `data/backups/`.

## Backup and restore

Run `npm.cmd run db:backup -- ./data/backups/crm.dump`. The script uses `pg_dump --format=custom`, checks the archive table of contents, and refuses to overwrite existing files. Passwords are passed to PostgreSQL tools through environment variables. Set `PG_BIN` to a directory containing matching PostgreSQL client tools if necessary; Windows Program Files installations are detected.

Restore an archive into a separate empty PostgreSQL database using `pg_restore --exit-on-error --no-owner --no-acl --dbname=<target> <archive>`. Keep the current database available, verify the restored records and application behavior, then switch `DATABASE_URL` and restart the server. Do not restore over a running CRM database.

`node scripts/verify-migrations-copy.mjs` (`db:verify`) checks, read-only, that the checksums recorded in the database match the migration files and lists pending migrations, then applies every migration into a throwaway `test_` schema in the same database and drops it. No second database is created.

`npm.cmd test` verifies backup/restore of an isolated test schema, migration idempotence and checksum drift, failed-migration rollback, concurrent transaction isolation, immutable revisions, permissions, and CRM workflows. Tests use `TEST_DATABASE_URL` or the configured `DATABASE_URL` only to provision disposable databases; the connecting role needs `CREATEDB` permission.

Numeric database columns use `NUMERIC(20,6)`; API arithmetic still uses JavaScript numbers. Changing financial rounding semantics remains separate work.
