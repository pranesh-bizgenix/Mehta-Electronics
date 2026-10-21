import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { connectPostgres, createDatabase } from '../src/postgres.js';
import { applyMigrations } from '../src/migrations.js';
import { temporaryDatabase } from '../test-support/postgres.js';

describe('PostgreSQL migrations', () => {
  test('requires PostgreSQL configuration without a storage fallback', () => {
    assert.throws(() => createDatabase({ databaseUrl: '' }), /DATABASE_URL is required/);
  });
  test('applies once, detects edits, rolls back failures, and preserves rows', async () => {
    const temporary = await temporaryDatabase();
    const sql = connectPostgres(temporary.databaseUrl);
    const baseline = [{ name: '0001_probe.sql', sql: 'CREATE TABLE probe(id integer PRIMARY KEY, value text); INSERT INTO probe VALUES(1,\'preserved\');' }];
    try {
      assert.deepEqual(await applyMigrations(sql, { migrations: baseline }), { applied: 1, total: 1 });
      assert.deepEqual(await applyMigrations(sql, { migrations: baseline }), { applied: 0, total: 1 });
      await assert.rejects(applyMigrations(sql, { migrations: [{ ...baseline[0], sql: '-- edited' }] }), /checksum/);
      await assert.rejects(applyMigrations(sql, { migrations: [...baseline, { name: '0002_broken.sql', sql: 'CREATE TABLE rollback_probe(id integer); INVALID SQL;' }] }));
      assert.equal((await sql`SELECT COUNT(*) AS count FROM mehta_schema_migrations`)[0].count, 1);
      assert.equal((await sql`SELECT to_regclass('rollback_probe') AS name`)[0].name, null);
      assert.equal((await sql`SELECT value FROM probe`)[0].value, 'preserved');
      await assert.rejects(applyMigrations(sql, { migrations: [] }), /unknown migrations/);
    } finally { await sql.end(); await temporary.close(); }
  });

  test('keeps concurrent request transactions isolated and rolls back on connection release', async () => {
    const temporary = await temporaryDatabase();
    const db = createDatabase(temporary);
    try {
      await db.exec('CREATE TABLE probe(id integer PRIMARY KEY)');
      await Promise.all([
        db.withConnection(async () => {
          await db.exec('BEGIN');
          await db.prepare('INSERT INTO probe(id) VALUES(?)').all(1);
          await db.exec('ROLLBACK');
        }),
        db.withConnection(async () => {
          await db.exec('BEGIN');
          await db.prepare('INSERT INTO probe(id) VALUES(?)').all(2);
          await db.exec('COMMIT');
        })
      ]);
      await assert.rejects(db.withConnection(async () => {
        await db.exec('BEGIN');
        await db.prepare('INSERT INTO probe(id) VALUES(?)').all(3);
        throw new Error('interrupted');
      }), /interrupted/);
      assert.deepEqual((await db.prepare('SELECT id FROM probe ORDER BY id').all()).map(row => row.id), [2]);
    } finally { await db.close(); await temporary.close(); }
  });
});
