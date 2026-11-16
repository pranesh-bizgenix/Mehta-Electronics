import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { withTestTransaction, assertNoTestRows } from '../test-support/transaction.js';
import { getConfig } from '../src/config.js';
import { connectPostgres } from '../src/postgres.js';

async function absent(email) {
  const sql = connectPostgres(getConfig().databaseUrl);
  try {
    const [row] = await sql`SELECT count(*) AS n FROM users WHERE email=${email}`;
    assert.equal(row.n, 0, 'outer transaction must leave no fixture rows');
  } finally { await sql.end({ timeout: 5 }); }
}

test('shared transaction rolls back workflow commits and recovers expected SQL errors on the same connection', async () => {
  const email = `VERIFY-${crypto.randomUUID()}@example.test`;
  await withTestTransaction(async db => {
    const [before] = await db.sql`SELECT pg_backend_pid() AS pid`;
    await db.withConnection(async () => {
      await db.exec('BEGIN');
      await db.prepare("INSERT INTO users(name,email,role,password_hash) VALUES('VERIFY-helper',?,'OWNER','not-a-login')").run(email);
      await db.prepare("SELECT set_config('mehta.quotation_write','authorized',true)").get();
      assert.equal((await db.prepare('SELECT pg_backend_pid() AS pid').get()).pid, before.pid);
      await db.exec('COMMIT');
    });
    assert.notEqual((await db.prepare("SELECT current_setting('mehta.quotation_write',true) AS flag").get()).flag, 'authorized');
    await assert.rejects(db.sql`SELECT 1/0`, { code: '22012' });
    assert.equal((await db.sql`SELECT count(*) AS n FROM users WHERE email=${email}`)[0].n, 1);
    await db.sql.begin(async tx => assert.equal((await tx`SELECT pg_backend_pid() AS pid`)[0].pid, before.pid));
    for (const query of ['COMMIT', '/* comment */ COMMIT', 'CREATE TABLE forbidden(id int)', 'SELECT 1; COMMIT']) {
      assert.throws(() => db.sql.unsafe(query), /managed transaction/);
      assert.throws(() => db.prepare(query), /managed transaction/);
    }
    await assert.rejects(db.exec('/* comment */ COMMIT'), /managed transaction/);
  });
  await absent(email);
});

test('shared transaction rolls back when the test callback throws', async () => {
  const email = `VERIFY-${crypto.randomUUID()}@example.test`;
  const failure = new Error('VERIFY-deliberate callback failure');
  await assert.rejects(withTestTransaction(async db => {
    await db.sql`INSERT INTO users(name,email,role,password_hash) VALUES('VERIFY-failure',${email},'OWNER','not-a-login')`;
    throw failure;
  }), error => error === failure);
  await absent(email);
});

test('importer savepoints and bulk fragments stay inside the rollback transaction', async () => {
  const email=`VERIFY-${crypto.randomUUID()}@example.test`;
  await withTestTransaction(async db=>{
    await db.sql.begin(async tx=>{
      await tx`SAVEPOINT master_batch`;
      await tx`INSERT INTO users ${tx([{name:'VERIFY-bulk',email,role:'OWNER',password_hash:'not-a-login'}], 'name','email','role','password_hash')}`;
      await tx`SAVEPOINT master_row`;
      await tx`UPDATE users SET name='VERIFY-changed' WHERE email=${email}`;
      await tx`ROLLBACK TO SAVEPOINT master_row`;
      await tx`RELEASE SAVEPOINT master_row`;
      assert.equal((await tx`SELECT name FROM users WHERE email=${email}`)[0].name,'VERIFY-bulk');
      await tx`RELEASE SAVEPOINT master_batch`;
    });
    assert.equal((await db.sql`SELECT count(*) AS n FROM users WHERE email=${email}`)[0].n,1);
    assert.throws(()=>db.sql`SAVEPOINT arbitrary`,/managed transaction/);
  });
  await absent(email);
});

test('residue detector fails on marked rows and never deletes them (SQL protocol spy)', async () => {
  const statements = [];
  const sql = async () => [{ tablename: 'fixture_table' }];
  sql.unsafe = async statement => { statements.push(statement); return [{ '?column?': 1 }]; };
  await assert.rejects(assertNoTestRows(sql), /VERIFY- rows remain in fixture_table/);
  assert.equal(statements.length, 1);
  assert.ok(statements.every(statement => statement.startsWith('SELECT')));
  sql.unsafe = async () => [];
  await assertNoTestRows(sql);
});
