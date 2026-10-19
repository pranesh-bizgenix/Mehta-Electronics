import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { applyMigrations } from '../src/migrations.js';

function preparedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE sessions(id INTEGER PRIMARY KEY);
    CREATE TABLE customers(id INTEGER PRIMARY KEY);
    CREATE TABLE customer_contacts(id INTEGER PRIMARY KEY);
    CREATE TABLE items(id INTEGER PRIMARY KEY);
    CREATE TABLE enquiries(id INTEGER PRIMARY KEY);
    CREATE TABLE enquiry_lines(id INTEGER PRIMARY KEY);
    CREATE TABLE quotations(id INTEGER PRIMARY KEY);
    CREATE TABLE quotation_lines(id INTEGER PRIMARY KEY);
    CREATE TABLE enquiry_revisions(id INTEGER PRIMARY KEY);
    CREATE TABLE quotation_revisions(id INTEGER PRIMARY KEY);
    CREATE TABLE sales_orders(id INTEGER PRIMARY KEY);
    CREATE TABLE sales_order_lines(id INTEGER PRIMARY KEY);
    CREATE TABLE tally_sync_jobs(id INTEGER PRIMARY KEY);
    CREATE TABLE tally_customers(id INTEGER PRIMARY KEY);
    CREATE TABLE tally_items(id INTEGER PRIMARY KEY);
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY);
    INSERT INTO customers(id) VALUES(42);`);
  return db;
}

describe('versioned SQLite migrations', () => {
  test('applies in order exactly once and preserves existing business rows', () => {
    const db = preparedDatabase();
    try {
      const migrations = [
        { version: 1, name: 'legacy-schema-baseline', sql: '-- existing schema baseline' },
        { version: 2, name: 'connectivity-marker', sql: 'CREATE TABLE connectivity_marker(id INTEGER PRIMARY KEY);' }
      ];
      assert.deepEqual(applyMigrations(db, { migrations }), { applied: 2, latestVersion: 2 });
      assert.deepEqual(applyMigrations(db, { migrations }), { applied: 2, latestVersion: 2 });
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM customers').get().count, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 2);
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='connectivity_marker'").get());
    } finally { db.close(); }
  });

  test('rolls back a failed migration and does not record its version', () => {
    const db = preparedDatabase();
    try {
      assert.throws(() => applyMigrations(db, { migrations: [
        { version: 1, name: 'legacy-schema-baseline', sql: '-- existing schema baseline' },
        { version: 2, name: 'broken-change', sql: 'CREATE TABLE rollback_probe(id INTEGER); INVALID SQL;' }
      ] }), /failed; no version was recorded/);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='rollback_probe'").get().count, 0);
    } finally { db.close(); }
  });

  test('rejects edited contents of an already applied migration', () => {
    const db = preparedDatabase();
    try {
      const original = [{ version: 1, name: 'legacy-schema-baseline', sql: '-- approved baseline' }];
      applyMigrations(db, { migrations: original });
      assert.throws(() => applyMigrations(db, { migrations: [{ ...original[0], sql: '-- silently edited baseline' }] }), /does not match its recorded name\/checksum/);
    } finally { db.close(); }
  });

  test('refuses to initialize against an unknown or incomplete schema', () => {
    const db = new DatabaseSync(':memory:');
    try {
      assert.throws(() => applyMigrations(db, { migrations: [{ version: 1, name: 'legacy-schema-baseline', sql: '' }] }), /incomplete schema/);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get().count, 0);
    } finally { db.close(); }
  });
});
