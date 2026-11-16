// Historical command name retained: read-only checksum verification only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { getConfig } from '../src/config.js';
import { connectPostgres } from '../src/postgres.js';
import { migrationsDirectory } from '../src/migrations.js';
const files = fs.readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort();
const checksums = new Map(files.map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(new URL('../database/postgres/migrations/' + name, import.meta.url))).digest('hex')]));
const sql = connectPostgres(getConfig().databaseUrl);
try {
  await sql.ready();
  await sql.begin('read only', async tx => {
    const ledger = await tx`SELECT name,checksum FROM public.mehta_schema_migrations ORDER BY name`;
    if (ledger.some(row => !checksums.has(row.name) || checksums.get(row.name) !== row.checksum)) throw new Error('Recorded migration names/checksums do not match the repository.');
    const pending = files.filter(name => !ledger.some(row => row.name === name));
    console.log('PASS: ' + ledger.length + ' migration checksums verified in mehta_electronics_local; ' + pending.length + ' pending. Read-only; no schema copy or migration application performed.');
  });
} finally { await sql.end(); }
