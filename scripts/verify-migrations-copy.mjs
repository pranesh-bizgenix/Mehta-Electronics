// Single-database migration check (no second database is ever created):
// 1. Read-only: the real database's recorded checksums match the files, and
//    pending migrations are listed (nothing is applied to the real schema).
// 2. Every migration applies cleanly into a throwaway test_ schema, which is
//    dropped afterwards.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../src/config.js';
import { connectPostgres } from '../src/postgres.js';
import { migrationsDirectory } from '../src/migrations.js';
import { temporarySchema } from '../test-support/postgres.js';

const files = fs.readdirSync(migrationsDirectory).filter((f) => f.endsWith('.sql')).sort();
const checksums = new Map(files.map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(migrationsDirectory, f), 'utf8')).digest('hex')]));

const sql = connectPostgres(getConfig().databaseUrl);
let temporary;
try {
  const ledger = await sql`SELECT name,checksum FROM public.mehta_schema_migrations ORDER BY name`.catch(() => []);
  const mismatched = ledger.filter((r) => r.checksum && checksums.get(r.name) !== r.checksum).map((r) => r.name);
  const unknown = ledger.filter((r) => !checksums.has(r.name)).map((r) => r.name);
  const pending = files.filter((f) => !ledger.some((r) => r.name === f));
  if (mismatched.length || unknown.length) throw new Error(`Recorded migrations differ from files. Changed: ${mismatched.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}.`);
  temporary = await temporarySchema('migrations', { migrate: true });
  console.log(`Migrations verified: ${ledger.length} recorded with matching checksums, ${pending.length} pending${pending.length ? ` (${pending.join(', ')})` : ''}; all ${files.length} apply cleanly in an isolated test schema.`);
} finally {
  await sql.end();
  if (temporary) await temporary.close();
}
