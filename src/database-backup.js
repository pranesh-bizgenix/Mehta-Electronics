import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connectPostgres } from './postgres.js';

const runFile = promisify(execFile);

function postgresBinary(name) {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, executable);
  if (process.platform === 'win32') {
    const root = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL');
    if (fs.existsSync(root)) {
      for (const version of fs.readdirSync(root).sort((a,b) => Number(b)-Number(a))) {
        const file = path.join(root, version, 'bin', executable);
        if (fs.existsSync(file)) return file;
      }
    }
  }
  return executable;
}

export async function runPostgresTool(name, databaseUrl, args) {
  if (name !== 'pg_dump' && !(name === 'pg_restore' && args.length === 2 && args[0] === '--list')) throw new Error('Database tool refused: only a guarded dump or offline archive listing is permitted. Restore/create/drop operations are disabled.');
  if (args.some(arg => /^(?:--(?:create|clean|dbname|database|host|port|username)(?:=|$)|-[CcduhpU])/.test(arg))) throw new Error('Database tool refused: target overrides and create/drop options are disabled.');
  if (name === 'pg_dump') {
    const file = args.indexOf('--file');
    // A fixed lower compression level reduces archive CPU time for the large
    // retained XML dataset; it cannot change the target or omit database data.
    if (file !== args.length - 2 || file < 0 || !path.isAbsolute(args.at(-1)) || args.slice(0, file).some(arg => !['--format=custom', '--compress=1', '--no-owner', '--no-acl'].includes(arg))) throw new Error('Database tool refused: only the fixed same-database backup argument list is permitted.');
  }
  const sql = connectPostgres(databaseUrl);
  try { await sql.ready(); } finally { await sql.end({ timeout: 5 }); }
  const url = new URL(databaseUrl);
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password) };
  for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGHOSTADDR', 'PGOPTIONS']) delete env[key];
  const settings = { sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', options: 'PGOPTIONS' };
  for (const [key, target] of Object.entries(settings)) if (url.searchParams.has(key)) env[target] = url.searchParams.get(key);
  try {
    return await runFile(postgresBinary(name), args, { env, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`${name} failed: ${error.code === 'ENOENT' ? 'install PostgreSQL client tools or set PG_BIN.' : error.stderr || error.code}`, { cause: error });
  }
}

/** Back up the whole guarded database; schema-per-test archives are disabled. */
export async function createDatabaseBackup(databaseUrl, destinationPath, { schema } = {}) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  if (schema) throw new Error('Schema backups for schema-per-test are disabled by MASTER RULES.');
  const sql = connectPostgres(databaseUrl);
  try { await sql.ready(); } finally { await sql.end({ timeout: 5 }); }
  const destination = path.resolve(destinationPath);
  if (fs.existsSync(destination)) throw new Error(`Backup destination already exists: ${destination}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${crypto.randomBytes(8).toString('hex')}.partial`;
  try {
    await runPostgresTool('pg_dump', databaseUrl, ['--format=custom', '--no-owner', '--no-acl', ...(schema ? [`--schema=${schema}`] : []), '--file', temporary]);
    if (!fs.statSync(temporary).isFile() || fs.statSync(temporary).size === 0) throw new Error('pg_dump produced an empty or invalid backup file.');
    await runPostgresTool('pg_restore', databaseUrl, ['--list', temporary]);
    // A hard link publishes the completed archive without overwriting any existing file.
    fs.linkSync(temporary, destination);
    return destination;
  } finally { fs.rmSync(temporary, { force: true }); }
}

export async function restoreDatabaseBackup(databaseUrl, sourcePath) {
  throw new Error('Database restore is disabled by MASTER RULES: archives may create/drop databases or schemas. No database or archive was opened.');
}
