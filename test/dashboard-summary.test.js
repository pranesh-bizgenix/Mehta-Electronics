import {fixturePermissions} from '../test-support/permission-fixture.js';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config.js';
import { hashPassword } from '../src/security.js';
import {openTestTransactionScope} from '../test-support/transaction.js';
import {testFetch} from '../test-support/http-client.js';

let temporary, db, app, base, fetch, baseline;
const PASSWORD = 'Dashboard#Pass1';
const owner = { email: 'owner@dash.test' }, executive = { email: 'exec@dash.test' };

async function login(target) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: target.email, password: PASSWORD }) });
  assert.equal(r.status, 200);
  target.cookie = r.headers.get('set-cookie').split(';')[0];
}
const get = async (path, auth) => { const r = await fetch(`${base}${path}`, { headers: { cookie: auth.cookie } }); return { status: r.status, body: await r.json() }; };

before(async () => {
  temporary = await openTestTransactionScope();db=temporary.db;await fixturePermissions(db);
  const config = getConfig({ localReviewAccess:false,mfaEnabled: false });
  const ownerId=(await db.prepare("INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('VERIFY-Dashboard Owner',?,'OWNER',?,0)").run(owner.email,hashPassword(PASSWORD))).insertedId;
  await db.prepare("INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('VERIFY-Dashboard Exec',?,'EXECUTIVE',?,0)").run(executive.email, hashPassword(PASSWORD));
  app = createApp({ db, config });
  fetch=testFetch(app);base='http://127.0.0.1:3000';
  await login(owner); await login(executive);
  baseline=(await get(`/api/v1/dashboard/summary?from=2000-01-01&to=${new Date().toISOString().slice(0,10)}`,owner)).body.data;
  const customer=(await db.sql`INSERT INTO customers(name,normalized_name,created_by,updated_by) VALUES('VERIFY-Dashboard customer','verify-dashboard customer',${ownerId},${ownerId}) RETURNING id`)[0].id;
  for(let n=0;n<3;n++)await db.sql`INSERT INTO enquiries(enquiry_number,customer_id,subject,created_by,updated_by) VALUES(${`VERIFY-DASH_${n}`},${customer},'VERIFY- dashboard enquiry',${ownerId},${ownerId})`;
});
after(async () => {
  try{await app?.close();}finally{await temporary?.close();}
});

test('owner summary has KPIs, funnel, trend, SLA, margin and activity', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const { status, body } = await get(`/api/v1/dashboard/summary?from=2000-01-01&to=${today}`, owner);
  assert.equal(status, 200, JSON.stringify(body));
  const d = body.data;
  assert.equal(d.kpis.openEnquiries, baseline.kpis.openEnquiries+3);
  assert.equal(typeof d.kpis.pipeline.value, 'string', 'money stays a decimal string');
  assert.match(d.kpis.orderBook.value, /^\d+(\.\d+)?$/);
  assert.equal(d.funnel[0].value, baseline.funnel[0].value+3);
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
