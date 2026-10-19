import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, test } from 'node:test';
import { createDatabaseBackup } from '../src/database-backup.js';

describe('SQLite backup and restore verification', () => {
  test('creates a consistent backup that can be reopened with its records intact', async () => {
    const tempRoot = path.resolve(os.tmpdir());
    const workDir = fs.mkdtempSync(path.join(tempRoot, 'mehta-backup-test-'));
    assert.ok(path.resolve(workDir).startsWith(`${tempRoot}${path.sep}`));
    const sourcePath = path.join(workDir, 'source.db');
    const backupPath = path.join(workDir, 'backup.db');
    const source = new DatabaseSync(sourcePath);
    source.exec('CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO sample(value) VALUES(\'preserved\');');
    source.close();
    try {
      await createDatabaseBackup(sourcePath, backupPath);
      const restored = new DatabaseSync(backupPath, { readOnly: true });
      try {
        assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
        assert.equal(restored.prepare('SELECT value FROM sample WHERE id=1').get().value, 'preserved');
      } finally { restored.close(); }
      await assert.rejects(createDatabaseBackup(sourcePath, backupPath), /already exists/);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});
