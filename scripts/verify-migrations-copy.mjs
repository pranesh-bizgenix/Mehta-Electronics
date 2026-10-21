import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getConfig } from '../src/config.js';
import { connectPostgres } from '../src/postgres.js';
import { createDatabaseBackup, restoreDatabaseBackup } from '../src/database-backup.js';
import { applyMigrations } from '../src/migrations.js';

const config = getConfig();
const admin = connectPostgres(config.databaseUrl);
const name = `mehta_verify_${crypto.randomBytes(8).toString('hex')}`;
const url = new URL(config.databaseUrl);
url.pathname = `/${name}`;
const archive = path.join(os.tmpdir(), `${name}.dump`);
let copy;
let created = false;

async function counts(sql) {
  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'mehta_schema_migrations' ORDER BY tablename`;
  const result = {};
  for (const { tablename } of tables) result[tablename] = (await sql`SELECT COUNT(*) AS n FROM ${sql(tablename)}`)[0].n;
  return result;
}

try {
  await createDatabaseBackup(config.databaseUrl, archive);
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  created = true;
  await restoreDatabaseBackup(url.toString(), archive);
  copy = connectPostgres(url.toString());
  const before = await counts(copy);
  const result = await applyMigrations(copy);
  const after = await counts(copy);
  for (const table of Object.keys(before)) if (before[table] !== after[table]) throw new Error(`Migration changed row counts in ${table}.`);
  console.log(`PostgreSQL restore verified: ${Object.keys(before).length} business tables, row counts unchanged, ${result.total} migrations current.`);
} finally {
  if (copy) await copy.end();
  try { if (created) await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`); }
  finally { await admin.end(); fs.rmSync(archive, { force: true }); }
}
