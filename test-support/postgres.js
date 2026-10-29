import crypto from 'node:crypto';
import { getConfig } from '../src/config.js';
import { connectPostgres } from '../src/postgres.js';
import { applyMigrations } from '../src/migrations.js';

// Tests never create databases and never use a second connection string.
// Every run gets a uniquely named `test_<random>` schema inside the single
// database in DATABASE_URL, selected through search_path in the connection
// URL, and the schema is dropped on close (callers close in `finally`).
//
// `public` stays on the search_path only so the shared citext extension type
// resolves. Every relation in `public` that the test schema does not create is
// shadowed by an empty placeholder table, so a test can never read or write the
// real application tables.

const TEST_SCHEMA = /^test_[a-z0-9_]{6,60}$/;

export function assertTestSchema(schema) {
  if (typeof schema !== 'string' || !TEST_SCHEMA.test(schema)) throw new Error(`Refusing to use schema "${schema}": test schemas must be named test_<random>.`);
  return schema;
}

function baseUrl() {
  const url = new URL(getConfig().databaseUrl);
  url.search = '';
  return url;
}

/**
 * Creates test_<label>_<random>. With { migrate: true } all migrations are
 * applied into it and remaining public relations are shadowed.
 */
export async function temporarySchema(label = 'run', { migrate = false } = {}) {
  const url = baseUrl();
  const schema = assertTestSchema(`test_${String(label).toLowerCase().replace(/[^a-z0-9]/g, '')}_${crypto.randomBytes(6).toString('hex')}`);
  const admin = connectPostgres(url.toString());
  try { await admin.unsafe(`CREATE SCHEMA "${schema}"`); }
  catch (error) { await admin.end(); throw error; }
  url.searchParams.set('search_path', `${schema},public`);
  const handle = {
    schema,
    databaseUrl: url.toString(),
    async close() {
      try { await admin.unsafe(`DROP SCHEMA IF EXISTS "${assertTestSchema(schema)}" CASCADE`); }
      finally { await admin.end(); }
    }
  };
  if (migrate) {
    const sql = connectPostgres(handle.databaseUrl);
    try {
      await applyMigrations(sql);
      await shadowPublicRelations(sql, schema);
    } catch (error) {
      await sql.end();
      await handle.close();
      throw error;
    }
    await sql.end();
  }
  return handle;
}

/** A migrated, shadowed test schema (the usual choice for application tests). */
export const temporaryDatabase = (label = 'app') => temporarySchema(label, { migrate: true });

/**
 * Adds empty placeholder tables for every public relation the test schema does
 * not define, so a stray query fails loudly instead of touching real data.
 */
export async function shadowPublicRelations(sql, schema) {
  assertTestSchema(schema);
  const missing = await sql.unsafe(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','v','m','p','S','f')
      AND NOT EXISTS (SELECT 1 FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid=c2.relnamespace WHERE n2.nspname=$1 AND c2.relname=c.relname)`, [schema]);
  for (const { relname } of missing) await sql.unsafe(`CREATE TABLE "${schema}"."${relname}" ()`);
  return missing.length;
}
