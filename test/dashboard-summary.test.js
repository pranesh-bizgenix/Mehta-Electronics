import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { hashPassword } from '../src/security.js';
import { temporaryDatabase } from '../test-support/postgres.js';
import { seedDemoData } from '../scripts/lib/demo-data.mjs';

let temporary, db, app, server, base;
const PASSWORD = 'Dashboard#Pass1';
const owner = { email: 'owner@dash.test' }, executive = { email: 'exec@dash.test' };

async function login(target) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: target.email, password: PASSWORD }) });
  assert.equal(r.status, 200);
  target.cookie = r.headers.get('set-cookie').split(';')[0];
}
const get = async (path, auth) => { const r = await fetch(`${base}${path}`, { headers: { cookie: auth.cookie } }); return { status: r.status, body: await r.json() }; };

before(async () => {
  temporary = await temporaryDatabase('dashboard');
  const config = getConfig({ databaseUrl: temporary.databaseUrl, seedOwnerEmail: owner.email, seedOwnerPassword: PASSWORD, mfaEnabled: false });
  db = await openDatabase(config);
  await seedDemoData(db);
  await db.prepare("INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('Exec',?,'EXECUTIVE',?,0)").run(executive.email, hashPassword(PASSWORD));
  app = createApp({ db, config });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await login(owner); await login(executive);
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await app?.close(); await db?.close(); await temporary?.close();
});

test('owner summary has KPIs, funnel, trend, SLA, margin and activity', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { status, body } = await get(`/api/v1/dashboard/summary?from=2000-01-01&to=${today}`, owner);
  assert.equal(status, 200, JSON.stringify(body));
  const d = body.data;
  assert.equal(d.kpis.openEnquiries, 3);
  assert.equal(typeof d.kpis.pipeline.value, 'string', 'money stays a decimal string');
  assert.match(d.kpis.orderBook.value, /^\d+(\.\d+)?$/);
  assert.equal(d.funnel[0].value, 3);
  assert.equal(d.quoteTrend.length, 6);
  assert.ok(d.margin && d.sla && Array.isArray(d.activity));
});

test('roles only receive the sections they may see; bad periods are rejected', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { body } = await get(`/api/v1/dashboard/summary?from=2000-01-01&to=${today}`, executive);
  assert.equal(body.data.margin, undefined, 'no margin without cost access');
  assert.equal(body.data.activity, undefined, 'no audit feed without audit access');
  assert.equal(body.data.kpis.openExceptions, undefined);
  assert.equal((await get('/api/v1/dashboard/summary?from=2026-12-01&to=2026-01-01', owner)).status, 422);
  assert.equal((await get('/api/v1/dashboard/summary?from=x&to=y', owner)).status, 422);
});
