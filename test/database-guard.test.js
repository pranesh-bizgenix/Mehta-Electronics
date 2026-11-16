import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REQUIRED_DATABASE, assertCurrentDatabase, assertDatabaseTarget, guardDatabaseClient } from '../src/database-guard.js';
import { connectPostgres, createDatabase } from '../src/postgres.js';
import { applyMigrations } from '../src/migrations.js';

// Protocol doubles only: no database, schemas, data, listener or sockets.
function pool(names = [REQUIRED_DATABASE]) {
  const events = [];
  let next = 0;
  function connection(name) {
    const client = (strings, ...values) => client.unsafe(strings.join('?'), values);
    client.unsafe = async (statement, values = []) => {
      events.push({ statement, values });
      if (statement === 'SELECT current_database() AS name') {
        if (name instanceof Error) throw name;
        return name === null ? [] : [{ name }];
      }
      return [{ value: 'ok' }];
    };
    client.release = () => events.push({ release: true });
    client.json = value => ({ json: value });
    client.array = value => ({ array: value });
    return client;
  }
  const raw = () => { throw new Error('Unexpected unguarded root query'); };
  raw.reserve = async () => connection(names[next++] ?? names.at(-1));
  raw.begin = async (options, callback) => {
    events.push({ begin: options });
    try { const result = await callback(await raw.reserve()); events.push({ commit: true }); return result; }
    catch (error) { events.push({ rollback: true }); throw error; }
  };
  raw.end = async () => events.push({ closed: true });
  raw.close = raw.end;
  return { client: guardDatabaseClient(raw), raw, events };
}

test('configuration rejects another database before a real connection can open', () => {
  const other = 'postgres://localhost/not_the_permitted_database';
  assert.throws(() => connectPostgres(other), { code: 'DATABASE_GUARD_REJECTED' });
  assert.throws(() => createDatabase({ databaseUrl: other }), /Only mehta_electronics_local/);
  const allowed = 'postgres://localhost/' + REQUIRED_DATABASE;
  assert.doesNotThrow(() => assertDatabaseTarget(allowed));
  for (const options of [{ database: 'other' }, { db: 'other' }, { schema: 'test_example' }, { connection: { search_path: 'test_example,public' } }]) assert.throws(() => assertDatabaseTarget(allowed, options), { code: 'DATABASE_GUARD_REJECTED' });
  assert.throws(() => assertDatabaseTarget(allowed + '?options=unsafe'), /overrides/);
  assert.throws(() => assertDatabaseTarget(allowed + '?search_path=public', { connection: { search_path: 'test_example' } }), /search_path/);
});

test('live identity rejects another name even when the configured URL could be correct', async () => {
  const { client, events } = pool(['unexpected_live_database']);
  await assert.rejects(client.unsafe('SELECT confidential_data'), { code: 'DATABASE_GUARD_REJECTED' });
  assert.deepEqual(events.filter(e => e.statement).map(e => e.statement), ['SELECT current_database() AS name']);
  assert.ok(events.some(e => e.release));
  assert.ok(events.some(e => e.closed));
});

test('tagged queries, readiness and reserved connections all enforce live identity', async () => {
  for (const invoke of [client => client`SELECT 1`, client => client.ready(), client => client.reserve()]) {
    const { client, events } = pool(['other']);
    await assert.rejects(invoke(client), /connected database name/);
    assert.equal(events.filter(e => e.statement).length, 1);
  }
});

test('identity failures and missing rows fail closed without leaking driver errors', async () => {
  for (const value of [null, new Error('sensitive connection detail')]) {
    const { client, events } = pool([value]);
    await assert.rejects(client.ready(), error => error.code === 'DATABASE_GUARD_REJECTED' && !error.message.includes('sensitive'));
    assert.ok(events.some(e => e.closed));
  }
});

test('connection failures before reserve or transaction identity checks are redacted and close the pool', async () => {
  for (const method of ['reserve', 'begin']) {
    const { raw, events } = pool();
    raw[method] = async () => { throw new Error('sensitive startup failure'); };
    const client = guardDatabaseClient(raw);
    await assert.rejects(method === 'reserve' ? client.ready() : client.begin(() => {}), error => error.code === 'DATABASE_GUARD_REJECTED' && !error.message.includes('sensitive'));
    assert.ok(events.some(e => e.closed));
  }
});

test('each pool checkout is checked, so an earlier success cannot approve a replacement connection', async () => {
  const { client, events } = pool([REQUIRED_DATABASE, 'other']);
  assert.deepEqual(await client.unsafe('SELECT first_allowed_query', ['exact-value']), [{ value: 'ok' }]);
  await assert.rejects(client.unsafe('SELECT must_not_run'), { code: 'DATABASE_GUARD_REJECTED' });
  assert.equal(events.filter(e => e.statement === 'SELECT current_database() AS name').length, 2);
  assert.ok(!events.some(e => e.statement === 'SELECT must_not_run'));
  assert.deepEqual(events.find(e => e.statement === 'SELECT first_allowed_query').values, ['exact-value']);
});

test('transactions verify their own live connection before the callback', async () => {
  const bad = pool(['other']); let called = false;
  await assert.rejects(bad.client.begin('read only', async () => { called = true; }), /connected database name/);
  assert.equal(called, false); assert.ok(bad.events.some(e => e.rollback));
  const good = pool();
  await good.client.begin('read only', tx => tx`SELECT transactional_query`);
  assert.ok(good.events.some(e => e.commit));
  assert.deepEqual(good.events.filter(e => e.statement).map(e => e.statement), ['SELECT current_database() AS name', 'SELECT transactional_query']);
});

test('migration entry point checks identity before any transaction, lock or DDL', async () => {
  let began = false;
  const sql = { unsafe: async () => [{ name: 'other' }], begin: async () => { began = true; } };
  await assert.rejects(applyMigrations(sql, { migrations: [] }), /connected database name/);
  assert.equal(began, false);
});

test('database and schema administration statements are disabled before execution', () => {
  const { client, events } = pool();
  for (const statement of ['CREATE DATABASE forbidden', 'DROP DATABASE forbidden', 'ALTER DATABASE forbidden RENAME TO other', 'CREATE /* comment */ SCHEMA forbidden', 'DROP SCHEMA forbidden CASCADE']) assert.throws(() => client.unsafe(statement), /administration/);
  assert.throws(() => client`CREATE DATABASE forbidden`, /administration/);
  assert.equal(events.length, 0);
});

test('public guard verifies the live query response rather than accepting a name supplied by the caller', async () => {
  let query;
  assert.equal(await assertCurrentDatabase({ unsafe: async statement => { query = statement; return [{ name: REQUIRED_DATABASE }]; } }), REQUIRED_DATABASE);
  assert.equal(query, 'SELECT current_database() AS name');
});
