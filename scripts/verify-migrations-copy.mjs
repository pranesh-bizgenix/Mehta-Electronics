import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getConfig } from '../src/config.js';
import { createDatabaseBackup } from '../src/database-backup.js';
import { applyMigrations } from '../src/migrations.js';

const sourcePath = path.resolve(getConfig().databasePath);
const tempRoot = path.resolve(os.tmpdir());
const workDir = fs.mkdtempSync(path.join(tempRoot, 'mehta-migration-check-'));
if (!path.resolve(workDir).startsWith(`${tempRoot}${path.sep}`)) throw new Error('Temporary work directory escaped the OS temp directory.');
const copyPath = path.join(workDir, 'crm-copy.db');

function businessTableCounts(db) {
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name")
    .all().map(({ name }) => [name, db.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).get().count]));
}

try {
  await createDatabaseBackup(sourcePath, copyPath);
  const db = new DatabaseSync(copyPath);
  try {
    const before = businessTableCounts(db);
    const migrationResult = applyMigrations(db);
    const after = businessTableCounts(db);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Migration changed business table row counts in the disposable copy.');
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integrity !== 'ok') throw new Error(`Post-migration integrity check failed: ${integrity}`);
    const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyErrors.length) throw new Error(`Foreign-key check found ${foreignKeyErrors.length} issue(s).`);
    console.log(`Disposable copy verified: ${Object.keys(before).length} business tables, ${migrationResult.applied} migration(s), row counts unchanged, integrity ok.`);
  } finally {
    db.close();
  }
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
