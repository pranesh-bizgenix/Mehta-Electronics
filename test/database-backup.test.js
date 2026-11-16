import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPostgresTool, restoreDatabaseBackup } from '../src/database-backup.js';
test('restore and database administration tools refuse before opening a connection or archive', async () => {
  await assert.rejects(restoreDatabaseBackup('unused', 'unused'), /restore is disabled/);
  for (const name of ['createdb', 'dropdb', 'psql']) await assert.rejects(runPostgresTool(name, 'unused', []), /tool refused/);
  await assert.rejects(runPostgresTool('pg_restore', 'unused', ['--create', 'unused']), /tool refused/);
  await assert.rejects(runPostgresTool('pg_dump', 'unused', ['--create']), /create\/drop options/);
  await assert.rejects(runPostgresTool('pg_dump', 'unused', ['other_database']), /fixed same-database/);
});
