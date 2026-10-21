import crypto from 'node:crypto';
import { getConfig } from '../src/config.js';
import { connectPostgres } from '../src/postgres.js';

export async function temporaryDatabase() {
  const url = new URL(process.env.TEST_DATABASE_URL || getConfig().databaseUrl);
  const admin = connectPostgres(url.toString());
  const name = `mehta_test_${crypto.randomBytes(8).toString('hex')}`;
  try { await admin.unsafe(`CREATE DATABASE "${name}"`); }
  catch (error) { await admin.end(); throw error; }
  url.pathname = `/${name}`;
  return {
    databaseUrl: url.toString(),
    async close() {
      try { await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`); }
      finally { await admin.end(); }
    }
  };
}
