import { AsyncLocalStorage } from 'node:async_hooks';
import { getConfig } from '../src/config.js';
import { connectPostgres, parameterize } from '../src/postgres.js';
import { assertCurrentDatabase } from '../src/database-guard.js';

function testDatabaseUrl() {
  const url = getConfig().databaseUrl;
  const target = new URL(url);
  if (decodeURIComponent(target.pathname.slice(1)) !== 'mehta_electronics_local' || !['localhost','127.0.0.1','[::1]'].includes(target.hostname)) {
    throw new Error('Database-backed tests require the local mehta_electronics_local database. RDS fixtures are disabled. Set DATABASE_URL for this test process only; do not overwrite the deployment .env.');
  }
  return url;
}

const quote = name => `"${name.replaceAll('"', '""')}"`;
const sessionKeys = ['mehta.actor_id','mehta.audit_reason','mehta.quotation_write','mehta.order_write','mehta.procurement_write','mehta.purchase_document_write','mehta.automation_credential_id'];
function managed(statement) {
  const text = statement.replace(/'(?:''|[^'])*'/g, '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ');
  if (/\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|CREATE|ALTER|DROP|TRUNCATE|COPY|VACUUM|GRANT|REVOKE|RESET)\b|^\s*(?:END|SET|DO)\b/i.test(text) || text.includes(';')) {
    throw new Error('Test SQL requires the existing schema and managed transaction; DDL and raw transaction control are disabled.');
  }
}
export async function assertNoTestRows(sql) {
  const check = async tx => {
    const tables = await tx`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
    const dirty = [];
    for (const { tablename } of tables) {
      const rows = await tx.unsafe(`SELECT 1 FROM public.${quote(tablename)} t WHERE strpos(to_jsonb(t)::text, 'VERIFY-') > 0 OR strpos(to_jsonb(t)::text, 'ZZTEST_') > 0 LIMIT 1`);
      if (rows.length) dirty.push(tablename);
    }
    if (dirty.length) throw new Error(`Test residue: VERIFY- rows remain in ${dirty.join(', ')}. No rows were deleted.`);
  };
  if (sql) return check(sql);
  const connection = connectPostgres(testDatabaseUrl());
  try { await connection.begin('read only', check); } finally { await connection.end({ timeout: 5 }); }
}

/** One connection and outer transaction; workflow commits become savepoints.
 * Root workflows are serialized. Promise.all is not an independent-session race.
 */
export async function withTestTransaction(run) {
  return withRollbackTransaction(testDatabaseUrl(),run);
}

/** Explicit operational verification only; ordinary test suites remain local-only.
 * User authorized this exact RDS target on 17 Nov. All changes must roll back.
 */
export async function withAuthorizedRdsRollbackVerification(run) {
  if(process.env.VERIFY_AUTHORIZED_RDS_ROLLBACK !== 'true')throw new Error('Explicit RDS rollback verification opt-in is required.');
  const url=getConfig().databaseUrl,target=new URL(url);
  if(target.hostname!=='mehta-controldesk-db01.chs2eymsy2ec.ap-southeast-2.rds.amazonaws.com'||decodeURIComponent(target.pathname.slice(1))!=='postgres'||target.searchParams.get('sslmode')!=='require')throw new Error('RDS rollback verification refused an unexpected target.');
  return withRollbackTransaction(url,run);
}

async function withRollbackTransaction(databaseUrl,run) {
  const pool = connectPostgres(databaseUrl);
  let connection;
  try {
    connection = await pool.reserve();
    await assertCurrentDatabase(connection);
    await connection.unsafe('BEGIN');
    await connection.unsafe("SET LOCAL lock_timeout = '5s'");
    await connection.unsafe("SET LOCAL statement_timeout = '30s'");
    const context = new AsyncLocalStorage();
    let queue = Promise.resolve(), statements = Promise.resolve(), counter = 0, closed = false;
    const serialize = (task, kind) => {
      const result = (kind === 'statement' ? statements : queue).then(task);
      if (kind === 'statement') statements = result.catch(() => {});
      else queue = result.catch(() => {});
      return result;
    };
    const workflow = task => context.getStore() ? task() : serialize(() => context.run({ stack: [] }, task));
    const query = operation => workflow(() => serialize(async () => {
      if (closed) throw new Error('Test transaction is closed.');
      const name = `verify_statement_${++counter}`;
      await connection.unsafe(`SAVEPOINT ${name}`);
      try { const result = await operation(); await connection.unsafe(`RELEASE SAVEPOINT ${name}`); return result; }
      catch (error) {
        await connection.unsafe(`ROLLBACK TO SAVEPOINT ${name}`);
        await connection.unsafe(`RELEASE SAVEPOINT ${name}`); throw error;
      }
    }, 'statement'));
    const exec = statement => workflow(async () => {
      const stack = context.getStore().stack;
      if (/^SET LOCAL statement_timeout = '30s'$/i.test(statement.trim())) {
        // Production payload downloads apply this fixed safety bound inside their
        // read-only transaction. The outer rollback harness already uses the
        // same bound, so exercising the exact statement cannot escape isolation.
        await connection.unsafe("SET LOCAL statement_timeout = '30s'"); return;
      }
      if (/^BEGIN(?: ISOLATION LEVEL REPEATABLE READ READ ONLY)?$/i.test(statement.trim())) {
        const name = `verify_workflow_${++counter}`;
        const settings = (await connection.unsafe('SELECT current_setting(key,true) AS value FROM unnest($1::text[]) WITH ORDINALITY AS settings(key,position) ORDER BY position',[sessionKeys])).map(row=>row.value||'');
        await connection.unsafe(`SAVEPOINT ${name}`); stack.push({ name, settings }); return;
      }
      if (/^(COMMIT|ROLLBACK)$/i.test(statement.trim())) {
        const frame = stack.pop();
        if (!frame) throw new Error('No workflow savepoint; outer transaction cannot be committed.');
        const { name, settings } = frame;
        if (/ROLLBACK/i.test(statement)) await connection.unsafe(`ROLLBACK TO SAVEPOINT ${name}`);
        await connection.unsafe(`RELEASE SAVEPOINT ${name}`);
        // Production COMMIT clears SET LOCAL. Releasing a savepoint does not.
        await connection.unsafe('SELECT set_config(key,value,true) FROM unnest($1::text[],$2::text[]) AS settings(key,value)',[sessionKeys,settings]);
        return;
      }
      managed(statement);
      return query(() => connection.unsafe(statement));
    });
    const sql = (...args) => {
      // postgres.js identifiers and bulk-value helpers build fragments; they do not execute SQL.
      if(!args[0]?.raw)return connection(...args);
      const statement=args[0].join(' ').trim();
      const savepoint=/^(SAVEPOINT|ROLLBACK TO SAVEPOINT|RELEASE SAVEPOINT) (master_batch|master_row)$/i.exec(statement);
      if(savepoint&&args.length===1)return workflow(()=>serialize(()=>{
        const frame=context.getStore().stack.at(-1);
        if(!frame)throw new Error('Importer savepoints require a managed workflow transaction.');
        return connection.unsafe(`${savepoint[1]} verify_import_${frame.name}_${savepoint[2]}`);
      },'statement'));
      managed(statement);return query(() => connection(...args));
    };
    sql.unsafe = (statement, values) => {
      managed(statement);
      return query(() => connection.unsafe(statement, values));
    };
    sql.json = value => connection.json(value);
    sql.begin = (options, callback) => workflow(async () => {
      const fn = typeof options === 'function' ? options : callback;
      await exec('BEGIN');
      try { const result = await fn(sql); await exec('COMMIT'); return result; }
      catch (error) { await exec('ROLLBACK'); throw error; }
    });
    const db = { sql, withConnection: workflow, exec,
      prepare(statement) {
        managed(statement);
        const execute = values => query(() => connection.unsafe(parameterize(statement), values));
        return { get: async (...values) => (await execute(values))[0], all: (...values) => execute(values),
          run: async (...values) => {
            const insert = /^\s*INSERT\s+INTO\s+(?!tally_customers\b|tally_items\b)/i.test(statement);
            const rows = await query(() => connection.unsafe(parameterize(insert ? `${statement} RETURNING id` : statement), values));
            return { insertedId: rows[0]?.id, changes: rows.count };
          }
        };
      }
    };
    try { return await run(db); } finally { await queue; await statements; closed = true; }
  } finally {
    try {
      if (connection) { try { await connection.unsafe('ROLLBACK'); } finally { connection.release(); } }
    } finally {
      await pool.end({ timeout: 5 });
    }
  }
}

/** Hold the same rollback transaction across a suite's before/after hooks. */
export async function openTestTransactionScope(){
 let finish,ready;
 const done=new Promise(resolve=>{finish=resolve;});
 const available=new Promise(resolve=>{ready=resolve;});
 const running=withTestTransaction(async db=>{ready(db);await done;});
 const db=await Promise.race([available,running.then(()=>{throw new Error('Test transaction closed before setup.');})]);
 return {db,async close(){finish();await running;}};
}
