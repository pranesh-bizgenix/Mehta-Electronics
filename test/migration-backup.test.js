import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { backupsDirectory, backupMaxAgeMs, requireRecentBackup } from '../src/migration-backup.js';
import { REQUIRED_DATABASE } from '../src/database-guard.js';
import { applyMigrations } from '../src/migrations.js';

// Files only: SQL below is a protocol spy, never a database or connection.
function fixtures(t) {
  fs.mkdirSync(backupsDirectory, { recursive: true });
  const directory = fs.mkdtempSync(path.join(backupsDirectory, 'VERIFY-backup_'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function archive(directory, { age = 0, content = 'unit archive fixture', database = REQUIRED_DATABASE } = {}) {
  const file = `${REQUIRED_DATABASE}-fixture.dump`;
  const target = path.join(directory, file);
  fs.writeFileSync(target, content);
  const receipt = { file, database, createdAt: new Date(Date.now() - age).toISOString(),
    size: Buffer.byteLength(content), sha256: crypto.createHash('sha256').update(content).digest('hex') };
  fs.writeFileSync(`${target}.json`, JSON.stringify(receipt));
  return target;
}

const migration = { name: '0001_fixture.sql', sql: 'SELECT fixture_migration' };
function migrationSpy({ applied = false, exists = true, checksum } = {}) {
  const events = [];
  const tx = async (parts) => {
    const statement = parts.join('?'); events.push(statement);
    if (statement.includes('to_regclass')) return [{ relation: exists ? 'mehta_schema_migrations' : null }];
    if (statement.includes('SELECT name,')) return applied ? [{ name: migration.name,
      checksum: checksum ?? crypto.createHash('sha256').update(migration.sql).digest('hex') }] : [];
    return [];
  };
  tx.unsafe = async statement => { events.push(statement); return []; };
  const sql = { unsafe: async () => [{ name: REQUIRED_DATABASE }], begin: async fn => fn(tx) };
  return { sql, events };
}

test('recent backup requires an intact, non-empty archive and matching database receipt', async t => {
  const directory = fixtures(t);
  await assert.rejects(requireRecentBackup({ directory }), { code: 'MIGRATION_BACKUP_REQUIRED' });
  const file = archive(directory);
  assert.equal(await requireRecentBackup({ directory }), file);
  fs.appendFileSync(file, 'changed');
  await assert.rejects(requireRecentBackup({ directory }), /Pending migrations blocked/);
  for (const options of [{ age: backupMaxAgeMs + 1000 }, { age: -60_000 }, { content: '' }, { database: 'wrong_name' }]) {
    archive(directory, options);
    await assert.rejects(requireRecentBackup({ directory }), { code: 'MIGRATION_BACKUP_REQUIRED' });
  }
  archive(directory);
  fs.writeFileSync(file, 'same length changed!');
  await assert.rejects(requireRecentBackup({ directory }), /Pending migrations blocked/);
  archive(directory);
  fs.rmSync(`${file}.json`);
  await assert.rejects(requireRecentBackup({ directory }), /Pending migrations blocked/);
  fs.writeFileSync(`${file}.json`, '{broken');
  await assert.rejects(requireRecentBackup({ directory }), /Pending migrations blocked/);
});

test('production blocks missing, empty and expired backups before all migration DDL, including first install', async t => {
  const directory = fixtures(t);
  for (const exists of [true, false]) {
    for (const options of [null, { content: '' }, { age: backupMaxAgeMs + 1000 }]) {
      if (options) archive(directory, options);
      const { sql, events } = migrationSpy({ exists });
      await assert.rejects(applyMigrations(sql, { migrations: [migration], environment: 'production',
        allowWithoutBackup: false, backupDirectory: directory }), { code: 'MIGRATION_BACKUP_REQUIRED' });
      assert.ok(events.every(statement => statement.startsWith('SELECT')));
      assert.ok(!events.includes(migration.sql));
    }
  }
});

test('production applies a pending migration only after a fresh verified backup', async t => {
  const directory = fixtures(t); archive(directory);
  const { sql, events } = migrationSpy();
  assert.deepEqual(await applyMigrations(sql, { migrations: [migration], environment: 'production',
    allowWithoutBackup: false, backupDirectory: directory }), { applied: 1, total: 1 });
  assert.ok(events.includes(migration.sql));
});

test('current migrations do not require a backup; changed checksums still fail', async t => {
  const directory = fixtures(t);
  const { sql } = migrationSpy({ applied: true });
  assert.deepEqual(await applyMigrations(sql, { migrations: [migration], environment: 'production',
    allowWithoutBackup: false, backupDirectory: directory }), { applied: 0, total: 1 });
  const changed = migrationSpy({ applied: true, checksum: 'changed' });
  await assert.rejects(applyMigrations(changed.sql, { migrations: [migration], backupDirectory: directory }), /checksum/);
});

test('override requires an explicit flag and development mode; production and test cannot bypass', async t => {
  const directory = fixtures(t);
  for (const environment of ['production', 'test', 'development']) {
    await assert.rejects(applyMigrations(migrationSpy().sql, { migrations: [migration], environment,
      allowWithoutBackup: false, backupDirectory: directory }), /Pending migrations blocked/);
    const spy = migrationSpy();
    const options = { migrations: [migration], environment, allowWithoutBackup: true, backupDirectory: directory };
    if (environment === 'development') assert.equal((await applyMigrations(spy.sql, options)).applied, 1);
    else {
      await assert.rejects(applyMigrations(spy.sql, options), /permitted only/);
      assert.equal(spy.events.length, 0);
    }
  }
});
