import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const migrationsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../database/postgres/migrations');

export async function applyMigrations(sql, { directory = migrationsDirectory, migrations } = {}) {
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
    await tx`CREATE TABLE IF NOT EXISTS mehta_schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now(), checksum text
    )`;
    await tx`ALTER TABLE mehta_schema_migrations ADD COLUMN IF NOT EXISTS checksum text`;
    const applied = new Map((await tx`SELECT name,checksum FROM mehta_schema_migrations`).map(row => [row.name, row.checksum]));
    if ([...applied.keys()].some(name => !entries.some(entry => entry.name === name))) throw new Error('Database contains unknown migrations.');
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
