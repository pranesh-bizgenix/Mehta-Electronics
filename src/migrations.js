import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../database/migrations');
const requiredLegacyTables = [
  'users', 'sessions', 'customers', 'customer_contacts', 'items', 'enquiries', 'enquiry_lines',
  'quotations', 'quotation_lines', 'enquiry_revisions', 'quotation_revisions', 'sales_orders',
  'sales_order_lines', 'tally_sync_jobs', 'tally_customers', 'tally_items', 'audit_logs'
];

function readMigrations(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => {
      const match = entry.name.match(/^(\d{4})_([a-z0-9-]+)\.sql$/);
      if (!match) throw new Error(`Invalid migration filename: ${entry.name}`);
      return {
        version: Number(match[1]),
        name: match[2],
        sql: fs.readFileSync(path.join(directory, entry.name), 'utf8')
      };
    })
    .sort((a, b) => a.version - b.version);
}

function validateMigrations(migrations) {
  const seen = new Set();
  for (const [index, migration] of migrations.entries()) {
    if (!Number.isSafeInteger(migration.version) || migration.version !== index + 1) {
      throw new Error('Migration versions must be unique, ordered, and contiguous starting at 0001.');
    }
    if (!/^[a-z0-9-]+$/.test(migration.name) || seen.has(migration.version) || typeof migration.sql !== 'string') {
      throw new Error(`Invalid migration definition at version ${migration.version}.`);
    }
    seen.add(migration.version);
  }
  if (!migrations.length || migrations[0].name !== 'legacy-schema-baseline') {
    throw new Error('Migration 0001 must record the existing legacy schema baseline.');
  }
}

function checksum(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

export function applyMigrations(db, { directory = migrationsDirectory, migrations = readMigrations(directory) } = {}) {
  validateMigrations(migrations);
  const existingTables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  const missingTables = requiredLegacyTables.filter((table) => !existingTables.has(table));
  if (missingTables.length) throw new Error(`Refusing to migrate an unknown or incomplete schema; missing tables: ${missingTables.join(', ')}.`);

  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY CHECK(version > 0),
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const applied = new Map(db.prepare('SELECT version,name,checksum FROM schema_migrations ORDER BY version').all().map((row) => [row.version, row]));
  if ([...applied.keys()].some((version) => version > migrations.at(-1).version)) {
    throw new Error('Database migration history contains a version that is not present in this application.');
  }
  for (const [index, migration] of migrations.entries()) {
    const expectedChecksum = checksum(migration.sql);
    const prior = applied.get(migration.version);
    if (prior) {
      if (prior.name !== migration.name || prior.checksum !== expectedChecksum) {
        throw new Error(`Applied migration ${String(migration.version).padStart(4, '0')} does not match its recorded name/checksum.`);
      }
      continue;
    }
    if (index !== applied.size) throw new Error(`Migration history has a gap before version ${migration.version}.`);

    db.exec('BEGIN IMMEDIATE');
    try {
      if (migration.sql.trim()) db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations(version,name,checksum) VALUES(?,?,?)')
        .run(migration.version, migration.name, expectedChecksum);
      db.exec('COMMIT');
      applied.set(migration.version, { name: migration.name, checksum: expectedChecksum });
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* preserve the migration error */ }
      throw new Error(`Migration ${String(migration.version).padStart(4, '0')}_${migration.name} failed; no version was recorded.`, { cause: error });
    }
  }

  return { applied: migrations.length, latestVersion: migrations.at(-1).version };
}

export { migrationsDirectory };
