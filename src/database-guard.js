export const REQUIRED_DATABASE = 'mehta_electronics_local';
export const ALLOWED_DATABASES = Object.freeze([REQUIRED_DATABASE, 'mehta_controldesk', 'postgres']);

function refused(detail) {
  return Object.assign(new Error(`Database access refused: ${detail} Only ${REQUIRED_DATABASE} or the authorized RDS database is permitted.`), { code: 'DATABASE_GUARD_REJECTED' });
}
const unavailable = () => Object.assign(new Error('PostgreSQL is temporarily unavailable; database identity could not be verified. No operation was permitted.'), {code:'DATABASE_UNAVAILABLE',status:503});

/** Configuration preflight prevents knowingly contacting another database.
 * It supplements, and never replaces, the live current_database() check. */
export function assertDatabaseTarget(databaseUrl, options = {}) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required. Configure PostgreSQL before starting the CRM.');
  let url;
  try { url = new URL(databaseUrl); } catch { throw refused('Invalid PostgreSQL configuration.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw refused('A PostgreSQL URL is required.');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!ALLOWED_DATABASES.includes(database)) throw refused('The configured database name is not allowed.');
  if (options.database && options.database !== database || options.db && options.db !== database) throw refused('A database override is not allowed.');
  if (options.schema && options.schema !== 'public') throw refused('Alternate schemas and schema-per-test are disabled.');
  for (const searchPath of [url.searchParams.get('search_path'), options.connection?.search_path]) {
    if (searchPath && searchPath !== 'public') throw refused('Alternate search_path is disabled.');
  }
  // These startup parameters could redirect database/session configuration.
  for (const key of ['database', 'db', 'dbname', 'options']) if (url.searchParams.has(key)) throw refused('Database/session URL overrides are disabled.');
  if (options.connection?.database || options.connection?.options) throw refused('Database/session connection overrides are disabled.');
  if (database === 'postgres' && (url.hostname !== 'mehta-controldesk-db01.chs2eymsy2ec.ap-southeast-2.rds.amazonaws.com' || options.host || options.port)) throw refused('The postgres database is permitted only on the authorized RDS endpoint without host overrides.');
  if (database !== REQUIRED_DATABASE && (url.searchParams.get('sslmode') !== 'require' || options.ssl === false)) throw refused('RDS requires sslmode=require.');
  return database;
}

/** Query the actual connected server; never trust the URL alone. */
export async function assertCurrentDatabase(sql, expectedDatabase) {
  let rows;
  try { rows = await sql.unsafe('SELECT current_database() AS name'); }
  catch { throw unavailable(); }
  if (rows?.length !== 1 || !ALLOWED_DATABASES.includes(rows[0]?.name) || expectedDatabase && rows[0]?.name !== expectedDatabase) throw refused('The connected database name does not match the required database.');
  return rows[0].name;
}

function assertAllowedStatement(statement) {
  const text = String(statement).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ');
  if (/\b(?:create|drop|alter)\s+database\b|\b(?:create|drop)\s+schema\b/i.test(text)) throw refused('Database administration and schema-per-test statements are disabled.');
}

/** Gate every root query on the SAME reserved physical connection that runs it.
 * A PostgreSQL session cannot switch databases. Re-check on every checkout so
 * pool growth/reconnections cannot bypass the live check. */
export function guardDatabaseClient(raw, database = REQUIRED_DATABASE) { return guardedClient(raw, false, database); }

function guardedClient(raw, verified, database) {
  const local = verified;
  const checkout = async () => {
    let connection;
    try { connection = await raw.reserve(); }
    catch { throw unavailable(); }
    try { await assertCurrentDatabase(connection, database); return connection; }
    catch (error) {
      connection.release();
      if(error.code==='DATABASE_GUARD_REJECTED')await raw.end({ timeout: 5 });
      throw error;
    }
  };
  const run = async operation => {
    if (local) return operation(raw);
    const connection = await checkout();
    try { return await operation(connection); }
    finally { connection.release(); }
  };
  function sql(...args) {
    // Identifier, array/object builders are data, not executable queries.
    if (!Array.isArray(args[0]?.raw)) return raw(...args);
    assertAllowedStatement(args[0].join(' '));
    return run(connection => connection(...args));
  }
  Object.assign(sql, {
    unsafe: (...args) => { assertAllowedStatement(args[0]); return run(connection => connection.unsafe(...args)); },
    ready: () => local ? Promise.resolve(database) : run(() => database),
    json: (...args) => raw.json(...args),
    array: (...args) => raw.array(...args),
    typed: raw.typed,
    types: raw.types
  });
  if (local) {
    // Keep only transaction operations actually used by the application.
    if (raw.release) sql.release = () => raw.release();
    if (raw.savepoint) sql.savepoint = (...args) => {
      const callback = args.pop();
      return raw.savepoint(...args, tx => callback(guardedClient(tx, true, database)));
    };
  } else {
    sql.reserve = async () => {
      return guardedClient(await checkout(), true, database);
    };
    sql.begin = (options, callback) => {
      if (typeof options === 'function') { callback = options; options = ''; }
      let identified = false;
      // The driver's BEGIN/ROLLBACK is transaction control only. Identity is
      // checked on this transaction's connection before the caller can run SQL.
      return raw.begin(options, async tx => {
        await assertCurrentDatabase(tx, database);
        identified = true;
        const result = await callback(guardedClient(tx, true, database));
        return Array.isArray(result) ? Promise.all(result) : result;
      }).catch(async error => {
        if (error.code === 'DATABASE_GUARD_REJECTED') await raw.end({ timeout: 5 });
        if (!identified && error.code !== 'DATABASE_GUARD_REJECTED') throw unavailable();
        throw error;
      });
    };
    sql.end = (...args) => raw.end(...args);
    sql.close = (...args) => raw.close(...args);
  }
  return sql;
}
