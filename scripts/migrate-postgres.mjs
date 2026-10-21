import { getConfig } from '../src/config.js';
import { connectPostgres } from '../src/postgres.js';
import { applyMigrations } from '../src/migrations.js';

const sql = connectPostgres(getConfig().databaseUrl);
try {
  const result = await applyMigrations(sql);
  console.log(`PostgreSQL migrations are current (${result.applied} applied, ${result.total} total).`);
} finally { await sql.end(); }
