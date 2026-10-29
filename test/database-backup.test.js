import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { connectPostgres } from '../src/postgres.js';
import { createDatabaseBackup, restoreDatabaseBackup } from '../src/database-backup.js';
import { temporarySchema } from '../test-support/postgres.js';

// Backs up and restores one temporary schema inside the configured database:
// the schema is dropped after the dump and recreated from the archive.
test('PostgreSQL dump restores a dropped schema with records intact', async () => {
  const source = await temporarySchema('backup');
  const archive = path.join(os.tmpdir(), `mehta-backup-${Date.now()}.dump`);
  let sql = connectPostgres(source.databaseUrl);
  try {
    await sql`CREATE TABLE sample(id integer PRIMARY KEY, value text NOT NULL)`;
    await sql`INSERT INTO sample VALUES(1,'preserved')`;
    await createDatabaseBackup(source.databaseUrl, archive, { schema: source.schema });
    await assert.rejects(createDatabaseBackup(source.databaseUrl, archive, { schema: source.schema }), /already exists/);
    await sql.unsafe(`DROP SCHEMA "${source.schema}" CASCADE`);
    await restoreDatabaseBackup(source.databaseUrl, archive);
    await sql.end();
    sql = connectPostgres(source.databaseUrl);
    assert.equal((await sql`SELECT value FROM sample WHERE id=1`)[0].value, 'preserved');
  } finally {
    fs.rmSync(archive, { force: true });
    await sql.end();
    await source.close();
  }
});
