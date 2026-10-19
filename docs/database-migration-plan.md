# SQLite schema and financial migration plan

## Current baseline

The application uses Node's built-in `node:sqlite`. The existing schema is embedded in `src/db.js`; 17 tables were identified in Phase 0. Foreign keys, indexes, WAL mode, and audit/revision immutability triggers exist. No versioned migration system was identified. Monetary columns currently include customer `credit_limit` and quotation/order unit prices as SQLite `REAL`. This document proposes a safe future migration; it does not modify data or code.

## Implemented migration foundation

`src/migrations.js` now validates four-digit ordered SQL migration filenames, verifies the legacy table set before initializing a ledger, records version/name/SHA-256 checksum/applied time in `schema_migrations`, applies each migration in its own `BEGIN IMMEDIATE` transaction, skips matching applied versions, and rejects checksum drift, gaps, missing/unknown versions, or invalid migration SQL. `0001_legacy-schema-baseline.sql` records the schema already created by `src/db.js`; it has no business-table effect. Existing inline schema initialization remains in place for compatibility. Future schema changes must be additive versioned SQL migrations; never edit an applied migration.

`openDatabase` runs the migration runner after the existing schema bootstrap and before owner seed/backfill behavior. This adds migration metadata on next application startup but does not convert or rewrite business records. Migration tests use an in-memory disposable schema. `scripts/verify-migrations-copy.mjs` makes a SQLite online backup of the configured database into an OS temporary directory, applies the runner only to that copy, verifies table row counts, `integrity_check`, and `foreign_key_check`, then removes only that generated temporary directory.

Create a durable backup with `node scripts/backup-database.mjs <new-backup-path>`. The command refuses to overwrite an existing destination and verifies the backup integrity. To restore, stop the app, preserve the current database files, place a verified backup at the configured path, and run integrity and application checks before reopening writes. A restore drill against a disposable file is covered by `test/database-backup.test.js`; production restore timing/retention and RPO/RTO remain unapproved.

## Proposed migration framework

- Store ordered SQL migrations under `database/migrations/`, each with a stable sequence/name and checksum.
- Maintain a migration ledger in SQLite with migration ID, checksum, applied timestamp, and tool version.
- Apply each migration transactionally when SQLite supports the operation; define explicit behavior for operations requiring table rebuilds.
- Refuse unknown checksums, missing predecessor migrations, or schema drift. Never automatically drop/recreate a live database.
- Verify `PRAGMA foreign_keys`, `PRAGMA integrity_check`, expected indexes/triggers, and application schema version at startup/deployment.
- Keep deterministic development/test seeds outside production migrations.

## Exact-money target (pending policy approval)

Candidate representation: signed 64-bit integer minor units for each explicitly supported currency, with the currency code recorded where multi-currency values are possible. Confirm currency, scale, permitted precision, quantity precision, calculation order, discount/tax application, line/document rounding, and display rules before selecting this representation. Do not use JS `Number` for financial arithmetic where exact decimal behavior is required; use safe integer/rational or decimal-string operations with tested bounds.

The current REAL values are approximate binary numbers. Their original entered decimal text may not be recoverable. Do not multiply a JS float by 100 and silently round. Migration needs a reviewed decimal-safe extraction strategy, row-level conversion report, and explicit handling for values that do not map uniquely under the approved policy.

## Data-preserving migration sequence

1. **Scope and baseline:** identify active database path, app version, file size, SQLite version, table definitions, row counts, relationships, monetary ranges, and current operational window. Do not inspect or print secrets.
2. **Backup:** take a consistent SQLite backup using a SQLite-aware mechanism; store encrypted/restricted copies according to approved retention. Restore it into an isolated location and verify integrity and representative records before proceeding.
3. **Dry run:** migrate only a restored copy. Report every monetary source row, candidate target value, unrepresentable/ambiguous case, total before/after, and row checksum. No live writes.
4. **Preserve source:** retain an immutable export or legacy-value column/table in the migration output until signed reconciliation and retention approval. Never leave the only source representation overwritten.
5. **Reconcile:** compare row counts, keys, references, amounts, totals, and sample PDFs/order snapshots. Apply only the approved tolerance/rounding policy. Any unexplained difference is a stop condition.
6. **Exercise failure modes:** test fresh install, upgrade from a copy of the existing schema, rerun/idempotency behavior, interrupted migration, lock/busy behavior, failed constraint, rollback, process restart, and restore.
7. **Cutover:** schedule approved downtime or a tested write-freeze/dual-write plan; back up immediately before cutover; apply the migration; verify integrity and application smoke paths before reopening writes.
8. **Recovery:** before new writes, restore the matched backup on failed validation. After writes resume, use an approved forward repair or reconcile captured new writes before restoring; never discard them silently. Retain the prior app binary and schema as a matched recoverable point.

## Acceptance gates

- Currency and precision policy approved with worked examples.
- A versioned migration runner works against a disposable copy of the exact legacy schema.
- Zero unexplained missing, duplicated, or changed records; all conversion exceptions accounted for and approved.
- Backup restore succeeds and is measured; RPO/RTO meet approved targets.
- Foreign-key and integrity checks pass; rollback/recovery drill evidence is recorded.
- Application tests verify migrated records and exact quotation/order outputs.

## Open decisions

Currency/scale; treatment of historical approximate amounts; whether original values must be auditable indefinitely; retention/encryption of backups; downtime; RPO/RTO; migration operator and sign-off authority; and whether deployment is single-host or shared-file/networked (SQLite topology constraint).
