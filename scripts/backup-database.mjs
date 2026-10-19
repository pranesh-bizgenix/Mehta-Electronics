import path from 'node:path';
import { getConfig } from '../src/config.js';
import { createDatabaseBackup } from '../src/database-backup.js';

const destination = process.argv[2];
if (!destination) {
  console.error('Usage: node scripts/backup-database.mjs <new-backup-path>');
  process.exitCode = 2;
} else {
  const result = await createDatabaseBackup(getConfig().databaseUrl, path.resolve(destination));
  console.log(`PostgreSQL backup archive created at ${result}`);
}
