import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
  const url = new URL(databaseUrl);
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password) };
  const settings = { sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', options: 'PGOPTIONS' };
  for (const [key, target] of Object.entries(settings)) if (url.searchParams.has(key)) env[target] = url.searchParams.get(key);
  try {
    return await runFile(postgresBinary(name), args, { env, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`${name} failed: ${error.code === 'ENOENT' ? 'install PostgreSQL client tools or set PG_BIN.' : error.stderr || error.code}`, { cause: error });
  }
}

export async function createDatabaseBackup(databaseUrl, destinationPath) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const destination = path.resolve(destinationPath);
  if (fs.existsSync(destination)) throw new Error(`Backup destination already exists: ${destination}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${crypto.randomBytes(8).toString('hex')}.partial`;
  try {
    await runPostgresTool('pg_dump', databaseUrl, ['--format=custom', '--no-owner', '--no-acl', '--file', temporary]);
    await runPostgresTool('pg_restore', databaseUrl, ['--list', temporary]);
    // A hard link publishes the completed archive without overwriting any existing file.
    fs.linkSync(temporary, destination);
    return destination;
  } finally { fs.rmSync(temporary, { force: true }); }
}

export async function restoreDatabaseBackup(databaseUrl, sourcePath) {
  await runPostgresTool('pg_restore', databaseUrl, ['--dbname', decodeURIComponent(new URL(databaseUrl).pathname.slice(1)), '--exit-on-error', '--no-owner', '--no-acl', path.resolve(sourcePath)]);
}
