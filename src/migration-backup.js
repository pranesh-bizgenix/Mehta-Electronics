import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_DATABASE } from './database-guard.js';
import { createDatabaseBackup } from './database-backup.js';
import { connectPostgres } from './postgres.js';

export const backupsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backups');
export const backupMaxAgeMs = 10 * 60 * 1000;

async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function createMigrationBackup(databaseUrl) {
  // Age starts before pg_dump takes its snapshot, not when a long dump finishes.
  const createdAt = new Date().toISOString();
  const name = `${REQUIRED_DATABASE}-${createdAt.replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}.dump`;
  const file = await createDatabaseBackup(databaseUrl, path.join(backupsDirectory, name));
  const receipt = { database: REQUIRED_DATABASE, file: name, createdAt,
    size: fs.statSync(file).size, sha256: await digest(file) };
  fs.writeFileSync(`${file}.json`, `${JSON.stringify(receipt)}\n`, { flag: 'wx', mode: 0o600 });
  const sql=connectPostgres(databaseUrl);
  try { await recordBackupReceipt(sql,receipt); } finally { await sql.end({timeout:5}); }
  return file;
}

// Record verified completion only; readiness reads this metadata, never secrets or archive contents.
export async function recordBackupReceipt(sql,receipt) {
  if(receipt.database!==REQUIRED_DATABASE||!Number.isFinite(Date.parse(receipt.createdAt))||!Number.isSafeInteger(receipt.size)||receipt.size<=0||!/^[a-f0-9]{64}$/.test(receipt.sha256)||path.basename(receipt.file)!==receipt.file)throw new Error('Invalid verified backup receipt.');
  await sql`INSERT INTO audit_logs(entity,record_id,action,new_value,reason) VALUES('DATABASE_BACKUP',${receipt.file},'VERIFIED',${JSON.stringify(receipt)},'Verified local PostgreSQL backup completed')`;
}

export async function requireRecentBackup({ directory = backupsDirectory, now = Date.now() } = {}) {
  const started = Date.now();
  let names = [];
  try { names = fs.readdirSync(directory); } catch { /* Missing/unreadable backup folders fail closed below. */ }
  for (const name of names.sort().reverse()) {
    if (!name.startsWith(`${REQUIRED_DATABASE}-`) || !name.endsWith('.dump')) continue;
    const file = path.join(directory, name);
    try {
      const stat = fs.lstatSync(file);
      const receiptPath = `${file}.json`;
      if (!stat.isFile() || stat.size === 0 || !fs.lstatSync(receiptPath).isFile()) continue;
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      const created = Date.parse(receipt.createdAt);
      if (receipt.database !== REQUIRED_DATABASE || receipt.file !== name || receipt.size !== stat.size ||
          !Number.isFinite(created) || now - created < 0 || now - created > backupMaxAgeMs) continue;
      if (receipt.sha256 !== await digest(file)) continue;
      // Hashing a large archive must not extend the ten-minute window.
      if (now + Date.now() - started - created > backupMaxAgeMs) continue;
      return file;
    } catch { /* An incomplete, unreadable or changed archive cannot authorize migrations. */ }
  }
  const error = new Error('Pending migrations blocked: run npm.cmd run db:backup to create a verified backup of mehta_electronics_local in ./backups within the last 10 minutes. Development only: NODE_ENV=development with --allow-migrations-without-backup.');
  error.code = 'MIGRATION_BACKUP_REQUIRED';
  throw error;
}
