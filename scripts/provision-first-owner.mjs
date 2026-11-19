import fs from 'node:fs';
import crypto from 'node:crypto';
import { getConfig } from '../src/config.js';
import { connectPostgres } from '../src/postgres.js';
import { provisionFirstOwner } from '../src/first-owner.js';
import { migrationsDirectory } from '../src/migrations.js';

function hiddenPrompt(label) {
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(label); process.stdin.setRawMode(true); process.stdin.resume();
    const finish = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData); process.stdout.write('\n'); };
    const onData = chunk => { for (const char of chunk.toString('utf8')) {
      if (char === '\u0003') { finish(); reject(new Error('Cancelled.')); return; }
      if (char === '\r' || char === '\n') { finish(); resolve(value); return; }
      if (char === '\u0008' || char === '\u007f') value = value.slice(0, -1);
      else value += char;
    } };
    process.stdin.on('data', onData);
  });
}

let sql;
try {
  const [name, email, reason, confirmation] = process.argv.slice(2);
  if (!name || !email || !reason || confirmation !== '--confirm-first-owner' || process.argv.length !== 6) throw new Error('Usage: npm run provision:first-owner -- "Full name" "email@example.com" "Provisioning reason" --confirm-first-owner');
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') throw new Error('Run in an interactive terminal. Passwords are entered privately, never as arguments.');
  sql = connectPostgres(getConfig().databaseUrl);
  await sql.ready();
  const files = fs.readdirSync(migrationsDirectory).filter(name => name.endsWith('.sql')).sort();
  const ledger = await sql`SELECT name,checksum FROM mehta_schema_migrations ORDER BY name`;
  if (ledger.length !== files.length || ledger.some((row, i) => row.name !== files[i] || row.checksum !== crypto.createHash('sha256').update(fs.readFileSync(new URL('../database/postgres/migrations/' + row.name, import.meta.url))).digest('hex'))) throw new Error('Migration history must match the repository before first-Owner setup.');
  const password = await hiddenPrompt('Temporary Owner password: ');
  if (password !== await hiddenPrompt('Confirm password: ')) throw new Error('Passwords do not match.');
  const user = await provisionFirstOwner(sql, { name, email, reason, password });
  console.log(`Owner account ${user.id} created. Sign in and change the temporary password. MFA requirements remain unchanged.`);
} catch (error) {
  console.error(error.status ? error.message : error.code ? 'Owner provisioning failed (' + error.code + '). No credentials were logged.' : error.message);
  process.exitCode = 1;
} finally { if (sql) await sql.end({ timeout: 5 }); }
