import crypto from 'node:crypto';
import { getConfig } from '../src/config.js';
import { connectPostgres } from '../src/postgres.js';

// Tests never create databases. Each test gets a temporary schema inside the
// one configured database (TEST_DATABASE_URL, else DATABASE_URL), selected
// through search_path in the connection URL, and the schema is dropped on
// close. `public` stays on the path only so shared extension types (citext)
// resolve; every table a test uses is created inside its own schema.

function baseUrl() {
  const url = new URL(process.env.TEST_DATABASE_URL || getConfig().databaseUrl);
  url.search = '';
  return url;
}

export async function temporarySchema(label = 'test') {
  const url = baseUrl();
  const schema = `zz_${label}_${crypto.randomBytes(6).toString('hex')}`;
  const admin = connectPostgres(url.toString());
  try { await admin.unsafe(`CREATE SCHEMA "${schema}"`); }
  catch (error) { await admin.end(); throw error; }
  url.searchParams.set('search_path', `${schema},public`);
  return {
    schema,
    databaseUrl: url.toString(),
    async close() {
      try { await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
      finally { await admin.end(); }
    }
  };
}

/** Kept for existing callers: returns a temporary schema, not a new database. */
export const temporaryDatabase = (label) => temporarySchema(label);

/**
 * For synthetic fixtures that create only part of the schema: adds empty
 * placeholder tables/sequences for every public relation the fixture did not
 * create, so a query that reaches outside the fixture fails loudly instead of
 * reading or writing real data in `public`.
 */
export async function shadowPublicRelations(sql, schema) {
  const missing = await sql.unsafe(`SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','v','m','p','S','f')
      AND NOT EXISTS (SELECT 1 FROM pg_class c2 JOIN pg_namespace n2 ON n2.oid=c2.relnamespace WHERE n2.nspname=$1 AND c2.relname=c.relname)`, [schema]);
  for (const { relname, relkind } of missing) {
    void relkind; await sql.unsafe(`CREATE TABLE "${schema}"."${relname}" ()`);
  }
  return missing.length;
}
