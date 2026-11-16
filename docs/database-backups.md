# Database backups and migration gate

Run from the existing `Mehta-Electronics` project folder:

```powershell
npm.cmd run db:backup
# Equivalent on Windows:
node scripts/backup-db
```

The command uses the existing `DATABASE_URL` and live `SELECT current_database()` guard. Only `mehta_electronics_local` is permitted. PostgreSQL client tools must be installed; `PG_BIN` can point to their existing bin folder. No database is created, copied, restored or dropped.

`pg_dump --format=custom --no-owner --no-acl` produces a timestamped archive under this application's `./backups`. The command verifies a non-empty regular file and checks its table of contents with offline `pg_restore --list`, then publishes the archive without overwriting an existing file. A companion JSON receipt records the database, filename, snapshot start time, byte size and SHA-256. No credentials are included in the receipt. Partial files are removed on failure. Backups contain business data; the folder is git-ignored and must be protected using the machine's access controls. Existing archives are retained; no automatic deletion policy is introduced.

## Production

Before starting an application version with pending migrations:

```powershell
npm.cmd run build
npm.cmd run db:backup
npm.cmd start
```

The existing startup runner and other callers of `applyMigrations` enforce the same gate. After taking the migration advisory lock, the runner checks the migration ledger using read-only queries. If migrations are pending, it requires an intact, non-empty archive with a matching receipt made within the last **10 minutes**, measured from before `pg_dump` began. Missing, stale, future-dated, changed, empty or incomplete archives cannot authorize a migration. Hashing time counts toward the ten-minute window. If dumping took longer than ten minutes, the resulting archive is retained but cannot satisfy this gate.

The check happens before ledger creation/alteration, checksum backfills or pending migration SQL. Failure rolls back the transaction and startup exits before listening, with a command to make a new backup. When all migrations are already current, a backup is not required. Existing checksum and unknown-migration checks remain enforced. Unset `NODE_ENV` defaults to production safety in the migration runner.

Only archives made by the new command in this application's backup folder qualify. The legacy `backup-database.mjs <path>` helper remains available but does not issue migration receipts. When running a packaged `dist` application, run its own `scripts/backup-db` so the archive is in that application's `dist/backups` folder; do not rebuild/delete `dist` after making that backup.

## Explicit development bypass

For a local development migration without a backup:

```powershell
$env:NODE_ENV = 'development'
npm.cmd run dev -- --allow-migrations-without-backup
```

The flag also works for the existing migration script in development mode. Development requires a backup unless the flag is explicitly supplied. The flag is rejected in production and test modes, even if no migrations are pending. It never bypasses the live database identity guard. Do not use it for production upgrades.

## Focused verification

```powershell
node --check scripts/backup-db
node --test --test-concurrency=1 test/migration-backup.test.js test/database-backup.test.js test/database-guard.test.js
npm.cmd run lint
npm.cmd run db:verify
```

Unit checks use SQL protocol spies and self-cleaning `ZZTEST_` filesystem fixtures under `backups`; they do not create databases, schemas or business rows. `db:verify` only reads existing migration checksums. Archive listing and hashing do not establish restore readiness; restore execution remains disabled by MASTER RULES. The legacy full integration suite still requires conversion away from prohibited schema fixtures.
