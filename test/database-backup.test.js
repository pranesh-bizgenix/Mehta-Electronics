import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { connectPostgres } from '../src/postgres.js';
import { createDatabaseBackup, restoreDatabaseBackup } from '../src/database-backup.js';
import { temporaryDatabase } from '../test-support/postgres.js';

test('PostgreSQL dump restores into an isolated database with records intact', async () => {
  const source = await temporaryDatabase();
  const target = await temporaryDatabase();
  const sql = connectPostgres(source.databaseUrl);
  const restored = connectPostgres(target.databaseUrl);
  const archive = path.join(os.tmpdir(), `mehta-backup-${Date.now()}.dump`);
  try {
    await sql`CREATE TABLE sample(id integer PRIMARY KEY, value text NOT NULL)`;
    await sql`INSERT INTO sample VALUES(1,'preserved')`;
    await createDatabaseBackup(source.databaseUrl, archive);
    await restoreDatabaseBackup(target.databaseUrl, archive);
    assert.equal((await restored`SELECT value FROM sample WHERE id=1`)[0].value, 'preserved');
    await assert.rejects(createDatabaseBackup(source.databaseUrl, archive), /already exists/);
  } finally {
    fs.rmSync(archive, { force: true });
    await sql.end(); await restored.end(); await source.close(); await target.close();
  }
});
