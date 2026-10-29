import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectPostgres } from '../src/postgres.js';
import { assertTestSchema, temporaryDatabase } from '../test-support/postgres.js';

test('refuses any schema that is not test_<random>', () => {
  for (const bad of ['public', 'zz_test_abc123', 'test_', 'TEST_abc123', 'test_abc;drop', '']) assert.throws(() => assertTestSchema(bad), /Refusing/);
  assert.equal(assertTestSchema('test_app_0a1b2c3d4e5f'), 'test_app_0a1b2c3d4e5f');
});

test('a test run lives in its own schema, cannot see real tables, and is dropped afterwards', async () => {
  const temporary = await temporaryDatabase('isolation');
  const sql = connectPostgres(temporary.databaseUrl);
  try {
    assert.match(temporary.schema, /^test_isolation_[0-9a-f]{12}$/);
    assert.equal(new URL(temporary.databaseUrl).pathname.slice(1), new URL(process.env.DATABASE_URL || (await import('../src/config.js')).getConfig().databaseUrl).pathname.slice(1), 'same single database');
    assert.equal((await sql`SELECT current_schema() AS s`)[0].s, temporary.schema);
    const resolved = await sql`SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.oid='users'::regclass`;
    assert.equal(resolved[0].nspname, temporary.schema, 'unqualified tables resolve inside the test schema');
  } finally {
    await sql.end();
    await temporary.close();
  }
  const plain = new URL(temporary.databaseUrl);
  plain.search = '';
  const admin = connectPostgres(plain.toString());
  try {
    assert.equal((await admin`SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=${temporary.schema}`)[0].n, 0, 'schema dropped');
  } finally { await admin.end(); }
});
