export const REQUIRED_DATABASE = 'mehta_electronics_local';

function refused(detail) {
  return Object.assign(new Error(`Database access refused: ${detail} Only ${REQUIRED_DATABASE} is permitted.`), { code: 'DATABASE_GUARD_REJECTED' });
}

/** Configuration preflight prevents knowingly contacting another database.
 * It supplements, and never replaces, the live current_database() check. */
export function assertDatabaseTarget(databaseUrl, options = {}) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required. Configure PostgreSQL before starting the CRM.');
  let url;
  try { url = new URL(databaseUrl); } catch { throw refused('Invalid PostgreSQL configuration.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw refused('A PostgreSQL URL is required.');
  if (decodeURIComponent(url.pathname.slice(1)) !== REQUIRED_DATABASE) throw refused('The configured database name is not allowed.');
  if (options.database && options.database !== REQUIRED_DATABASE || options.db && options.db !== REQUIRED_DATABASE) throw refused('A database override is not allowed.');
  if (options.schema && options.schema !== 'public') throw refused('Alternate schemas and schema-per-test are disabled.');
  for (const searchPath of [url.searchParams.get('search_path'), options.connection?.search_path]) {
    if (searchPath && searchPath !== 'public') throw refused('Alternate search_path is disabled.');
  }
  // These startup parameters could redirect database/session configuration.
  for (const key of ['database', 'db', 'dbname', 'options']) if (url.searchParams.has(key)) throw refused('Database/session URL overrides are disabled.');
  if (options.connection?.database || options.connection?.options) throw refused('Database/session connection overrides are disabled.');
}

/** Query the actual connected server; never trust the URL alone. */
export async function assertCurrentDatabase(sql) {
  let rows;
  try { rows = await sql.unsafe('SELECT current_database() AS name'); }
  catch { throw refused('The connected database identity could not be verified.'); }
  if (rows?.length !== 1 || rows[0]?.name !== REQUIRED_DATABASE) throw refused('The connected database name does not match the required database.');
  return REQUIRED_DATABASE;
}

function assertAllowedStatement(statement) {
  const text = String(statement).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ');
  if (/\b(?:create|drop|alter)\s+database\b|\b(?:create|drop)\s+schema\b/i.test(text)) throw refused('Database administration and schema-per-test statements are disabled.');
}

/** Gate every root query on the SAME reserved physical connection that runs it.
 * A PostgreSQL session cannot switch databases. Re-check on every checkout so
 * pool growth/reconnections cannot bypass the live check. */
export function guardDatabaseClient(raw) { return guardedClient(raw, false); }

function guardedClient(raw, verified) {
  const local = verified;
  const checkout = async () => {
    let connection;
    try { connection = await raw.reserve(); }
    catch { await raw.end({ timeout: 5 }); throw refused('The required PostgreSQL connection could not be verified.'); }
    try { await assertCurrentDatabase(connection); return connection; }
    catch (error) {
      connection.release();
      await raw.end({ timeout: 5 });
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
    ready: () => local ? Promise.resolve(REQUIRED_DATABASE) : run(() => REQUIRED_DATABASE),
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
      return raw.savepoint(...args, tx => callback(guardedClient(tx, true)));
    };
  } else {
    sql.reserve = async () => {
      return guardedClient(await checkout(), true);
    };
    sql.begin = (options, callback) => {
      if (typeof options === 'function') { callback = options; options = ''; }
      let identified = false;
      // The driver's BEGIN/ROLLBACK is transaction control only. Identity is
      // checked on this transaction's connection before the caller can run SQL.
      return raw.begin(options, async tx => {
        await assertCurrentDatabase(tx);
        identified = true;
        const result = await callback(guardedClient(tx, true));
        return Array.isArray(result) ? Promise.all(result) : result;
      }).catch(async error => {
        if (!identified || error.code === 'DATABASE_GUARD_REJECTED') await raw.end({ timeout: 5 });
        if (!identified && error.code !== 'DATABASE_GUARD_REJECTED') throw refused('The required transaction connection could not be verified.');
        throw error;
      });
    };
    sql.end = (...args) => raw.end(...args);
    sql.close = (...args) => raw.close(...args);
  }
  return sql;
}
