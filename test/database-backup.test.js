import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { runPostgresTool, restoreDatabaseBackup } from '../src/database-backup.js';
test('restore and database administration tools refuse before opening a connection or archive', async () => {
  await assert.rejects(restoreDatabaseBackup('unused', 'unused'), /restore is disabled/);
  for (const name of ['createdb', 'dropdb', 'psql']) await assert.rejects(runPostgresTool(name, 'unused', []), /tool refused/);
  await assert.rejects(runPostgresTool('pg_restore', 'unused', ['--create', 'unused']), /tool refused/);
  await assert.rejects(runPostgresTool('pg_dump', 'unused', ['--create']), /create\/drop options/);
  await assert.rejects(runPostgresTool('pg_dump', 'unused', ['other_database']), /fixed same-database/);
});
test('fixed fast compression is allowed without allowing target overrides or filtered backups',async()=>{
 const args=['--format=custom','--compress=1','--no-owner','--no-acl','--file',path.resolve('VERIFY-backup.dump')];
 await assert.rejects(runPostgresTool('pg_dump','unused',args),{code:'DATABASE_GUARD_REJECTED'});
 for(const option of ['--compress=9','--schema=public','--exclude-table=users'])await assert.rejects(runPostgresTool('pg_dump','unused',[option,...args]),/fixed same-database/);
 await assert.rejects(runPostgresTool('pg_dump','unused',['--dbname=elsewhere',...args]),/target overrides/);
});
