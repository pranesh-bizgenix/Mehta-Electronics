import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCurrentDatabase } from './database-guard.js';
import { requireRecentBackup } from './migration-backup.js';

export const migrationsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../database/postgres/migrations');

export async function applyMigrations(sql, { directory = migrationsDirectory, migrations,
  environment = process.env.NODE_ENV || 'production',
  allowWithoutBackup = process.argv.includes('--allow-migrations-without-backup'), backupDirectory } = {}) {
  await assertCurrentDatabase(sql);
  if (allowWithoutBackup && environment !== 'development') {
    const error = new Error('--allow-migrations-without-backup is permitted only with NODE_ENV=development; production migrations require a fresh backup.');
    error.code = 'MIGRATION_BACKUP_REQUIRED';
    throw error;
  }
  const entries = migrations || fs.readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
    .map(name => ({ name, sql: fs.readFileSync(path.join(directory, name), 'utf8') }));
  if (new Set(entries.map(entry => entry.name)).size !== entries.length) throw new Error('Duplicate migration names.');
  for (const [index, entry] of entries.entries()) {
    if (!/^\d{4}_[a-z0-9_-]+\.sql$/.test(entry.name) || Number(entry.name.slice(0,4)) !== index + 1 || typeof entry.sql !== 'string') {
      throw new Error('Migrations must have contiguous numbered SQL filenames starting at 0001.');
    }
  }
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(73429921)`;
    const [ledger] = await tx`SELECT to_regclass('mehta_schema_migrations') AS relation`;
    const applied = new Map((ledger?.relation
      ? await tx`SELECT name,to_jsonb(m)->>'checksum' AS checksum FROM mehta_schema_migrations m`
      : []).map(row => [row.name, row.checksum]));
    if ([...applied.keys()].some(name => !entries.some(entry => entry.name === name))) throw new Error('Database contains unknown migrations.');
    for (const entry of entries) {
      if (applied.get(entry.name) && applied.get(entry.name) !== crypto.createHash('sha256').update(entry.sql).digest('hex')) {
        throw new Error(`Applied migration ${entry.name} does not match its recorded checksum.`);
      }
    }
    if (entries.some(entry => !applied.has(entry.name)) && !allowWithoutBackup) {
      await requireRecentBackup({ directory: backupDirectory });
    }
    await tx`CREATE TABLE IF NOT EXISTS mehta_schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), checksum text
    )`;
    await tx`ALTER TABLE mehta_schema_migrations ADD COLUMN IF NOT EXISTS checksum text`;
    let count = 0;
    for (const entry of entries) {
      const checksum = crypto.createHash('sha256').update(entry.sql).digest('hex');
      if (applied.has(entry.name)) {
        if (applied.get(entry.name) && applied.get(entry.name) !== checksum) throw new Error(`Applied migration ${entry.name} does not match its recorded checksum.`);
        if (!applied.get(entry.name)) await tx`UPDATE mehta_schema_migrations SET checksum=${checksum} WHERE name=${entry.name}`;
        continue;
      }
      await tx.unsafe(entry.sql);
      await tx`INSERT INTO mehta_schema_migrations(name,checksum) VALUES(${entry.name},${checksum})`;
      count++;
    }
    return { applied: count, total: entries.length };
  });
}
