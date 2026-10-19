import postgres from 'postgres';
import { AsyncLocalStorage } from 'node:async_hooks';

export function connectPostgres(databaseUrl, options = {}) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required. Configure PostgreSQL before starting the CRM.');
  return postgres(databaseUrl, {
    max: 10, prepare: false,
    connection: { timezone: 'UTC', ...(options.schema ? { search_path: `${options.schema},public` } : {}) },
    types: {
      numeric: { to: 1700, from: [1700], serialize: String, parse: Number },
      count: { to: 20, from: [20], serialize: String, parse(value) {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed)) throw new Error('Database integer exceeds the supported range.');
        return parsed;
      } }
    },
    onnotice: () => {},
    ...options.postgresOptions
  });
}

export function parameterize(query) {
  let index = 0;
  return query.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, token => token === '?' ? `$${++index}` : token);
}

export function createDatabase(config) {
  const sql = connectPostgres(config.databaseUrl, { schema: config.databaseSchema });
  const context = new AsyncLocalStorage();
  const current = () => context.getStore() || sql;
  const db = {
    sql,
    async withConnection(callback) {
      if (context.getStore()) return callback();
      const connection = await sql.reserve();
      try { return await context.run(connection, callback); }
      finally {
        try { await connection.unsafe('ROLLBACK'); } finally { connection.release(); }
      }
    },
    async exec(query) {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(query) && !context.getStore()) throw new Error('Transactions require db.withConnection().');
      return current().unsafe(query);
    },
    prepare(query) {
      const statement = parameterize(query);
      const execute = (values) => current().unsafe(statement, values);
      return {
        async get(...values) { return (await execute(values))[0]; },
        async all(...values) { return execute(values); },
        async run(...values) {
          const returnsId = /^\s*INSERT\s+INTO\s+(?!tally_customers\b|tally_items\b)/i.test(statement);
          const rows = await current().unsafe(returnsId ? `${statement} RETURNING id` : statement, values);
          return { insertedId: rows[0]?.id, changes: rows.count };
        }
      };
    },
    async close() { await sql.end({ timeout: 5 }); }
  };
  return db;
}
