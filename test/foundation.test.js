import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { temporaryDatabase } from '../test-support/postgres.js';
import { mfaHelper, TEST_ENCRYPTION_KEY } from '../test-support/mfa.js';
import { Totp, base32Encode } from '../src/modules/mfa/totp.js';
import { addBusinessMinutes } from '../src/modules/work/sla-calculator.js';
import { s, validate, compareDecimal } from '../src/core/schema.js';
import { errorBody, AppError } from '../src/core/errors.js';

// ---------------------------------------------------------------------------
// Unit tests (no database)
// ---------------------------------------------------------------------------
describe('F1 units', () => {
  test('TOTP matches the RFC 6238 SHA-1 vectors and rejects replays', () => {
    const totp = new Totp();
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    assert.equal(totp.codeAt(secret, totp.stepAt(new Date(59_000))), '287082');
    assert.equal(totp.codeAt(secret, totp.stepAt(new Date(1111111109_000))), '081804');
    const at = new Date(1111111109_000);
    const step = totp.verify(secret, '081804', at);
    assert.equal(step, totp.stepAt(at));
    assert.equal(totp.verify(secret, '081804', at, step), null, 'same step cannot be reused');
    assert.equal(totp.verify(secret, '000000', at), null);
  });

  const policy = { timezone: 'Asia/Kolkata', businessDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], businessHours: { start: '09:30', end: '18:30' }, holidays: ['2026-11-09'] };
  test('SLA due time counts only business minutes in the policy timezone', () => {
    // Fri 2026-11-06 17:30 IST = 12:00 UTC. 120 business minutes: 60 on Fri, then Sat 09:30-10:30 IST.
    assert.equal(addBusinessMinutes(new Date('2026-11-06T12:00:00Z'), 120, policy).toISOString(), '2026-11-07T05:00:00.000Z');
    // Sat 18:00 IST, 60 minutes: 30 on Sat, Sunday closed, Monday 9 Nov is a holiday, Tue 09:30 + 30 = 10:00 IST.
    assert.equal(addBusinessMinutes(new Date('2026-11-07T12:30:00Z'), 60, policy).toISOString(), '2026-11-10T04:30:00.000Z');
    // Before opening time starts at opening.
    assert.equal(addBusinessMinutes(new Date('2026-11-10T02:00:00Z'), 15, policy).toISOString(), '2026-11-10T04:15:00.000Z');
  });

  test('schema validation reports every failing field and keeps decimals exact', () => {
    const schema = s.object({ name: s.string({ min: 1 }), amount: s.decimal({ min: 0 }), when: s.date() });
    assert.deepEqual(validate(schema, { name: ' A  B ', amount: '0010.500', when: '2026-02-28' }), { name: 'A B', amount: '10.5', when: '2026-02-28' });
    assert.throws(() => validate(schema, { name: '', amount: '1.1234567', when: '2026-02-30', extra: 1 }), (e) => e.status === 422 && e.details.fields.length === 4);
    assert.equal(compareDecimal('0.1', '0.10'), 0);
    assert.equal(compareDecimal('-1', '0'), -1);
  });

  test('error bodies never expose unexpected internal messages', () => {
    const hidden = errorBody(new Error('relation "secret_table" does not exist'), 'cid');
    assert.deepEqual(hidden, { status: 500, body: { error: 'Internal server error.', code: 'INTERNAL', correlationId: 'cid' } });
    assert.deepEqual(errorBody(new AppError(409, 'RULE_NOT_CONFIGURED', 'Rule not configured', { rule: 'x' })).body, { error: 'Rule not configured', code: 'RULE_NOT_CONFIGURED', details: { rule: 'x' } });
  });
});

// ---------------------------------------------------------------------------
// Integration tests (HTTP + throwaway PostgreSQL)
// ---------------------------------------------------------------------------
let temporary, db, app, server, base;
const mfa = mfaHelper();
const sent = [];
const fakeMailer = { name: 'fake', async send(message) { sent.push(message); return { messageId: `fake-${sent.length}` }; } };
const owner = { email: 'owner@f1.test' }, manager = { email: 'manager@f1.test' }, executive = { email: 'exec@f1.test' }, accounts = { email: 'accounts@f1.test' }, executive2 = { email: 'exec2@f1.test' };
const PASSWORD = 'Foundation#Pass1';

async function request(path, { method = 'GET', body, auth, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (auth?.cookie) h.cookie = auth.cookie;
  if (auth?.csrf && method !== 'GET') h['x-csrf-token'] = auth.csrf;
  const response = await fetch(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { response, status: response.status, data: text ? JSON.parse(text) : null };
}
async function login(target, password = PASSWORD) {
  const r = await request('/api/auth/login', { method: 'POST', body: { email: target.email, password } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  target.cookie = r.response.headers.get('set-cookie').split(';')[0];
  target.csrf = r.data.csrfToken;
  target.id = r.data.user.id;
  target.loginData = r.data;
  return r.data;
}
async function createUser(target, role, name) {
  const r = await request('/api/users', { method: 'POST', auth: owner, body: { name, email: target.email, phone: '9876500000', role, status: 'ACTIVE', password: PASSWORD } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await login(target);
}
const step = () => mfa.clock.advance(31_000);

before(async () => {
  temporary = await temporaryDatabase();
  const config = getConfig({ databaseUrl: temporary.databaseUrl, seedOwnerEmail: owner.email, seedOwnerPassword: PASSWORD, appEncryptionKey: TEST_ENCRYPTION_KEY });
  db = await openDatabase(config);
  app = createApp({ db, config, clock: mfa.clock, outboundMailer: fakeMailer });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (app) await app.close();
  if (db) await db.close();
  if (temporary) await temporary.close();
});

describe('F1 MFA', () => {
  test('owner must enrol before using the API, then verifies with TOTP and one-time recovery codes', async () => {
    const data = await login(owner);
    assert.deepEqual(data.mfa, { required: true, enrolled: false, verified: false });
    const blocked = await request('/api/v1/rules', { auth: owner });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.code, 'MFA_REQUIRED');
    assert.equal((await request('/api/customers', { auth: owner })).data.code, 'MFA_REQUIRED', 'legacy routes are protected too');
    assert.equal((await request('/api/auth/me', { auth: owner })).status, 200, 'me stays reachable');

    const enrol = await request('/api/v1/auth/mfa/enroll', { method: 'POST', auth: owner, body: {} });
    assert.equal(enrol.status, 200);
    assert.match(enrol.data.data.otpauthUri, /^otpauth:\/\/totp\//);
    mfa.secrets.set(owner.email, enrol.data.data.secret);
    step();
    assert.equal((await request('/api/v1/auth/mfa/confirm', { method: 'POST', auth: owner, body: { code: '000000' } })).status, 422);
    const confirmed = await request('/api/v1/auth/mfa/confirm', { method: 'POST', auth: owner, body: { code: mfa.code(owner.email) } });
    assert.equal(confirmed.status, 200);
    const recovery = confirmed.data.data.recoveryCodes;
    assert.equal(recovery.length, 10);
    assert.equal((await request('/api/v1/rules', { auth: owner })).status, 200);
    const stored = await db.prepare('SELECT secret_ciphertext FROM user_mfa WHERE user_id=?').get(owner.id);
    assert.ok(!stored.secret_ciphertext.includes(enrol.data.data.secret), 'secret is encrypted at rest');

    await login(owner);
    const code = mfa.code(owner.email);
    assert.equal((await request('/api/v1/auth/verify-otp', { method: 'POST', auth: owner, body: { code } })).status, 422, 'enrolment code cannot be replayed in the same step');
    assert.equal((await request('/api/v1/auth/verify-otp', { method: 'POST', auth: owner, body: { recoveryCode: recovery[0].toLowerCase() } })).status, 200);
    await login(owner);
    assert.equal((await request('/api/v1/auth/verify-otp', { method: 'POST', auth: owner, body: { recoveryCode: recovery[0] } })).status, 422, 'recovery codes are single use');
    step();
    assert.equal((await request('/api/v1/auth/verify-otp', { method: 'POST', auth: owner, body: { code: mfa.code(owner.email) } })).status, 200);
    const audit = await db.prepare("SELECT action FROM audit_logs WHERE entity='MFA' ORDER BY id").all();
    assert.deepEqual([...new Set(audit.map((a) => a.action))].sort(), ['ENABLED', 'ENROLMENT_STARTED', 'VERIFIED', 'VERIFIED_WITH_RECOVERY_CODE', 'VERIFY_FAILED'].sort());
  });

  test('other roles are not forced into MFA but the owner can reset an enrolled user', async () => {
    await createUser(manager, 'MANAGER', 'F1 Manager');
    await createUser(executive, 'EXECUTIVE', 'F1 Executive');
    await createUser(executive2, 'EXECUTIVE', 'F1 Executive Two');
    await createUser(accounts, 'ACCOUNTS', 'F1 Accounts');
    assert.equal(manager.loginData.mfa.required, false);
    assert.equal((await request('/api/v1/me/work', { auth: manager })).status, 200);
    await request('/api/v1/auth/mfa/enroll', { method: 'POST', auth: executive2, body: {} }).then((r) => mfa.secrets.set(executive2.email, r.data.data.secret));
    step();
    assert.equal((await request('/api/v1/auth/mfa/confirm', { method: 'POST', auth: executive2, body: { code: mfa.code(executive2.email) } })).status, 200);
    await login(executive2);
    assert.equal(executive2.loginData.mfa.required, true, 'an enrolled user must always verify');
    assert.equal((await request('/api/v1/users/' + executive2.id + '/mfa/reset', { method: 'POST', auth: manager, body: { reason: 'Lost phone' } })).status, 403);
    assert.equal((await request('/api/v1/users/' + executive2.id + '/mfa/reset', { method: 'POST', auth: owner, body: { reason: 'Lost phone' } })).status, 200);
    await login(executive2);
    assert.equal(executive2.loginData.mfa.required, false);
  });
});

describe('F1 permission matrix', () => {
  test('every v1 endpoint enforces the matrix per role on the server', async () => {
    const cases = [
      ['GET', '/api/v1/roles', { OWNER: 200, MANAGER: 403, EXECUTIVE: 403, ACCOUNTS: 403 }],
      ['GET', '/api/v1/rules', { OWNER: 200, MANAGER: 403, EXECUTIVE: 403, ACCOUNTS: 403 }],
      ['GET', '/api/v1/automation', { OWNER: 200, MANAGER: 403, EXECUTIVE: 403, ACCOUNTS: 403 }],
      ['GET', '/api/v1/exceptions', { OWNER: 200, MANAGER: 403, EXECUTIVE: 403, ACCOUNTS: 403 }],
      ['GET', '/api/v1/audit-logs', { OWNER: 200, MANAGER: 403, EXECUTIVE: 403, ACCOUNTS: 403 }],
      ['GET', '/api/audit-logs', { OWNER: 200, MANAGER: 403, EXECUTIVE: 403, ACCOUNTS: 403 }],
      ['GET', '/api/v1/users', { OWNER: 200, MANAGER: 200, EXECUTIVE: 403, ACCOUNTS: 403 }],
      ['GET', '/api/v1/me/work', { OWNER: 200, MANAGER: 200, EXECUTIVE: 200, ACCOUNTS: 200 }],
      ['GET', '/api/v1/tasks', { OWNER: 200, MANAGER: 200, EXECUTIVE: 200, ACCOUNTS: 200 }],
      ['GET', '/api/v1/tasks?scope=all', { OWNER: 200, MANAGER: 403, EXECUTIVE: 403, ACCOUNTS: 403 }],
      ['GET', '/api/v1/messages/drafts', { OWNER: 200, MANAGER: 403, EXECUTIVE: 403, ACCOUNTS: 403 }],
      ['PUT', '/api/v1/rules/tasks.reminder_interval_minutes', { OWNER: 200, MANAGER: 403, EXECUTIVE: 403, ACCOUNTS: 403 }, { value: 120, reason: 'Matrix check' }],
      ['PATCH', '/api/v1/automation/task_reminders', { OWNER: 200, MANAGER: 403, EXECUTIVE: 403, ACCOUNTS: 403 }, { enabled: false, reason: 'Matrix check' }],
      ['POST', '/api/v1/exceptions', { OWNER: 201, MANAGER: 201, EXECUTIVE: 201, ACCOUNTS: 201 }, (role) => ({ type: 'FAILED_CHECK', entityType: 'MATRIX', entityId: role, summary: 'Matrix check' })]
    ];
    const users = { OWNER: owner, MANAGER: manager, EXECUTIVE: executive, ACCOUNTS: accounts };
    for (const [method, path, expected, body] of cases) {
      for (const [role, status] of Object.entries(expected)) {
        const r = await request(path, { method, auth: users[role], body: typeof body === 'function' ? body(role) : body });
        assert.equal(r.status, status, `${role} ${method} ${path}: ${JSON.stringify(r.data)}`);
      }
    }
    assert.equal((await request('/api/v1/rules', {})).status, 401);
  });

  test('matrix edits apply immediately, are audited, and protect owner-only permissions', async () => {
    const view = await request('/api/v1/roles', { auth: owner });
    assert.ok(view.data.data.permissions.find((p) => p.key === 'quotations.cost.read').grantedTo.includes('MANAGER'));
    assert.equal((await request('/api/v1/exceptions', { auth: manager })).status, 403);
    const grant = await request('/api/v1/roles/MANAGER/permissions/exceptions.read', { method: 'PUT', auth: owner, body: { granted: true, reason: 'Managers review the queue' } });
    assert.equal(grant.status, 200);
    assert.equal((await request('/api/v1/exceptions', { auth: manager })).status, 200);
    const ownerOnly = await request('/api/v1/roles/MANAGER/permissions/automation.enable', { method: 'PUT', auth: owner, body: { granted: true, reason: 'Try owner-only' } });
    assert.equal(ownerOnly.status, 409);
    assert.equal(ownerOnly.data.code, 'OWNER_ONLY_PERMISSION');
    assert.equal((await request('/api/v1/roles/OWNER/permissions/rules.read', { method: 'PUT', auth: owner, body: { granted: false, reason: 'Lock check' } })).data.code, 'ROLE_LOCKED');
    await assert.rejects(db.prepare("INSERT INTO role_permissions(role_key,permission_key) VALUES('EXECUTIVE','rules.manage')").all(), /reserved for the owner/);
    await assert.rejects(db.prepare("UPDATE access_matrix_events SET reason='x'").run(), /append-only/);
    const created = await request('/api/v1/roles', { method: 'POST', auth: owner, body: { key: 'STORE_STAFF', name: 'Store staff', requiresMfa: false, reason: 'Client confirmed role' } });
    assert.equal(created.status, 201);
    assert.ok((await request('/api/v1/users', { auth: owner })).status === 200);
    const audit = await db.prepare("SELECT action FROM audit_logs WHERE entity IN ('ACCESS_MATRIX','ROLE') ORDER BY id").all();
    assert.ok(audit.some((a) => a.action === 'GRANT') && audit.some((a) => a.action === 'CREATE'));
  });
});

describe('F1 rules, switches and SLA', () => {
  test('rules start empty, block their workflows, and keep versioned history', async () => {
    const list = await request('/api/v1/rules', { auth: owner });
    const sla = list.data.data.find((r) => r.key === 'sla.policy');
    assert.equal(sla.configured, false);
    assert.equal(list.data.data.find((r) => r.key === 'discount.levels').configured, false);
    assert.equal(list.data.data.find((r) => r.key === 'margin.floor_percent').external, true);
    const task = await request('/api/v1/tasks', { method: 'POST', auth: executive, body: { title: 'Call Johnson Lifts' } });
    assert.equal(task.status, 201);
    const work = await request('/api/v1/me/work', { auth: executive });
    assert.equal(work.data.data.find((w) => w.entityId === task.data.data.id).slaState, 'NOT_CONFIGURED');
    const bad = await request('/api/v1/rules/sla.policy', { method: 'PUT', auth: owner, body: { value: { timezone: 'Asia/Kolkata', businessDays: ['MON'], businessHours: { start: '18:00', end: '09:00' }, turnaroundMinutes: { ENQUIRY: 120 } }, reason: 'Invalid hours' } });
    assert.equal(bad.status, 422);
    const policy = { timezone: 'Asia/Kolkata', businessDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], businessHours: { start: '00:00', end: '23:59' }, holidays: [], turnaroundMinutes: { ENQUIRY: 60, TEST_RECORD: 30 } };
    assert.equal((await request('/api/v1/rules/sla.policy', { method: 'PUT', auth: owner, body: { value: policy, reason: 'Client SLA v1' } })).status, 200);
    policy.turnaroundMinutes.TEST_RECORD = 45;
    assert.equal((await request('/api/v1/rules/sla.policy', { method: 'PUT', auth: owner, body: { value: policy, reason: 'Client SLA v2' } })).data.data.version, 2);
    const history = await request('/api/v1/rules/sla.policy/history', { auth: owner });
    assert.deepEqual(history.data.data.map((h) => h.version), [2, 1]);
    await assert.rejects(db.prepare("UPDATE business_rule_values SET reason='x'").run(), /append-only/);
    assert.equal((await request('/api/v1/rules/escalation.policy/clear', { method: 'POST', auth: owner, body: { reason: 'Never set' } })).data.data.configured, false);
  });

  test('only the owner turns automation ON; every change logs who, when, old and new', async () => {
    assert.ok((await request('/api/v1/automation', { auth: owner })).data.data.switches.every((s) => s.enabled === false), 'all switches ship OFF');
    await request('/api/v1/roles/MANAGER/permissions/automation.read', { method: 'PUT', auth: owner, body: { granted: true, reason: 'Visibility' } });
    await request('/api/v1/roles/MANAGER/permissions/automation.disable', { method: 'PUT', auth: owner, body: { granted: true, reason: 'Managers can stop automation' } });
    const denied = await request('/api/v1/automation/sla_escalation', { method: 'PATCH', auth: manager, body: { enabled: true, reason: 'Try' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.data.code, 'OWNER_ONLY');
    assert.equal((await request('/api/v1/automation/sla_escalation', { method: 'PATCH', auth: owner, body: { enabled: true, reason: 'Prem approved escalation' } })).status, 200);
    assert.equal((await request('/api/v1/automation/sla_escalation', { method: 'PATCH', auth: manager, body: { rolloutStage: 'SELECTIVE', reason: 'Try' } })).status, 403);
    const events = await db.prepare("SELECT field,old_value,new_value,changed_by FROM automation_switch_events WHERE workflow_key='sla_escalation'").all();
    assert.deepEqual(events.map((e) => [e.field, e.old_value, e.new_value, e.changed_by]), [['enabled', 'false', 'true', owner.id]]);
  });

  test('overdue records escalate owner -> backup -> manager and the blocked case is visible', async () => {
    await request(`/api/v1/users/${executive.id}`, { method: 'PATCH', auth: owner, body: { backupUserId: executive2.id, managerUserId: manager.id, department: 'SALES', reason: 'Set cover' } });
    const services = app.modules.services;
    const actor = { id: owner.id, role: 'OWNER' };
    const item = await services.work.open(actor, { entityType: 'TEST_RECORD', entityId: 'esc-1', title: 'Escalation test', ownerUserId: executive.id, assignmentReason: 'Test' });
    assert.equal(item.backup_user_id, executive2.id, 'backup defaults from the owner profile');
    assert.equal(item.sla_state, 'RUNNING');
    const lonely = await services.work.open(actor, { entityType: 'TEST_RECORD', entityId: 'esc-2', title: 'No backup', ownerUserId: accounts.id, assignmentReason: 'Test' });
    await request('/api/v1/rules/escalation.policy', { method: 'PUT', auth: owner, body: { value: { toBackupAfterMinutes: 10, toManagerAfterMinutes: 30 }, reason: 'Client timing' } });
    mfa.clock.advance(60 * 60_000);
    let run = await services.work.escalateOverdue();
    assert.equal(run.escalated, 1);
    assert.equal(run.blocked, 1);
    assert.equal((await db.prepare('SELECT escalation_blocked_reason FROM work_items WHERE id=?').get(lonely.id)).escalation_blocked_reason, 'No backup owner is set for this record.');
    mfa.clock.advance(30 * 60_000);
    run = await services.work.escalateOverdue();
    const escalated = await db.prepare('SELECT escalation_level,escalated_to_user_id,sla_state FROM work_items WHERE id=?').get(item.id);
    assert.deepEqual([escalated.escalation_level, escalated.escalated_to_user_id, escalated.sla_state], [2, manager.id, 'BREACHED']);
    const notes = await request('/api/v1/notifications', { auth: manager });
    assert.ok(notes.data.data.some((n) => n.type === 'ESCALATION'));
    assert.ok((await request('/api/v1/me/work', { auth: manager })).data.data.some((w) => w.id === item.id && w.escalatedToMe));
    const again = await services.work.escalateOverdue();
    assert.equal(again.escalated, 0, 'escalation is not repeated');
  });

  test('reassign all open work and tasks to the backup in one audited action', async () => {
    const task = await request('/api/v1/tasks', { method: 'POST', auth: executive, body: { title: 'Follow up HCE' } });
    const r = await request(`/api/v1/users/${executive.id}/reassign`, { method: 'POST', auth: owner, body: { reason: 'On leave this week' } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.data.workItems.moved >= 2);
    assert.equal((await db.prepare('SELECT owner_user_id FROM tasks WHERE id=?').get(task.data.data.id)).owner_user_id, executive2.id);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM work_items WHERE owner_user_id=? AND status IN ('OPEN','IN_PROGRESS','WAITING')").get(executive.id)).n, 0);
    assert.ok(await db.prepare("SELECT 1 FROM audit_logs WHERE entity='USER' AND action='REASSIGN_ALL_TO_BACKUP' AND record_id=?").get(String(executive.id)));
    assert.equal((await request(`/api/v1/users/${executive.id}/reassign`, { method: 'POST', auth: manager, body: { reason: 'Not allowed' } })).status, 403);
  });
});

describe('F1 exception queue', () => {
  test('raising is idempotent, maker-checker is enforced, and approved backdating is applied', async () => {
    const actor = { id: owner.id, role: 'OWNER' };
    const item = await app.modules.services.work.open(actor, { entityType: 'TEST_RECORD', entityId: 'backdate-1', title: 'Phone enquiry taken yesterday', ownerUserId: executive2.id, assignmentReason: 'Test' });
    const body = { type: 'BACKDATE', entityType: 'WORK_ITEM', entityId: item.id, summary: 'Enquiry received by phone yesterday', backdateTo: '2026-01-05T05:00:00.000Z' };
    const first = await request('/api/v1/exceptions', { method: 'POST', auth: executive2, body });
    const second = await request('/api/v1/exceptions', { method: 'POST', auth: executive2, body });
    assert.equal(first.data.data.id, second.data.data.id);
    await request('/api/v1/roles/EXECUTIVE/permissions/exceptions.decide', { method: 'PUT', auth: owner, body: { granted: true, reason: 'Temporary for maker-checker test' } });
    const self = await request(`/api/v1/approvals/${first.data.data.id}/decide`, { method: 'POST', auth: executive2, body: { decision: 'APPROVE', reason: 'Self approval' } });
    assert.equal(self.status, 403);
    assert.equal(self.data.code, 'MAKER_CHECKER');
    assert.equal((await request(`/api/v1/approvals/${first.data.data.id}/decide`, { method: 'POST', auth: owner, body: { decision: 'APPROVE' } })).status, 422, 'reason is mandatory');
    const approved = await request(`/api/v1/approvals/${first.data.data.id}/decide`, { method: 'POST', auth: owner, body: { decision: 'APPROVE', reason: 'Call log confirms' } });
    assert.equal(approved.data.data.status, 'APPROVED');
    assert.equal(new Date((await db.prepare('SELECT started_at FROM work_items WHERE id=?').get(item.id)).started_at).toISOString(), '2026-01-05T05:00:00.000Z');
    assert.equal((await request(`/api/v1/approvals/${first.data.data.id}/decide`, { method: 'POST', auth: owner, body: { decision: 'REJECT', reason: 'Twice' } })).data.code, 'ALREADY_DECIDED');
    const decision = await db.prepare('SELECT d.decision,d.decided_by FROM approval_decisions d JOIN exception_cases c ON c.approval_request_id=d.approval_request_id WHERE c.id=?').get(first.data.data.id);
    assert.deepEqual([decision.decision, decision.decided_by], ['APPROVED', owner.id]);
    await request('/api/v1/roles/EXECUTIVE/permissions/exceptions.decide', { method: 'PUT', auth: owner, body: { granted: false, reason: 'Revert test grant' } });
    await assert.rejects(db.prepare('DELETE FROM exception_cases').run(), /cannot be deleted/);
  });
});

describe('F1 task board', () => {
  test('forwarding creates a linked sub-task, versions prevent lost updates, reminders follow switch and rule', async () => {
    const created = await request('/api/v1/tasks', { method: 'POST', auth: manager, body: { title: 'Collect Connectwell acceptance', dueAt: '2099-01-01T00:00:00.000Z' } });
    const task = created.data.data;
    assert.equal(task.status, 'OPEN');
    assert.equal((await request('/api/v1/tasks', { method: 'POST', auth: manager, body: { title: 'Assign to someone else', ownerUserId: executive2.id } })).status, 403);
    const progress = await request(`/api/v1/tasks/${task.id}/status`, { method: 'POST', auth: manager, body: { status: 'IN_PROGRESS', version: task.version, reason: 'Started' } });
    assert.equal(progress.status, 200);
    assert.equal((await request(`/api/v1/tasks/${task.id}/status`, { method: 'POST', auth: manager, body: { status: 'DONE', version: task.version, reason: 'Stale' } })).data.code, 'STALE_VERSION');
    const forward = await request(`/api/v1/tasks/${task.id}/forward`, { method: 'POST', auth: manager, body: { toUserId: executive2.id, note: 'Please chase the AO', version: progress.data.data.version, reason: 'Executive owns Connectwell' } });
    assert.equal(forward.status, 200, JSON.stringify(forward.data));
    assert.equal(forward.data.data.parent.status, 'FORWARDED');
    assert.equal(forward.data.data.child.parentTaskId, task.id);
    assert.equal(forward.data.data.child.ownerId, executive2.id);
    const detail = await request(`/api/v1/tasks/${task.id}`, { auth: manager });
    assert.ok(detail.data.data.events.some((e) => e.event === 'FORWARDED' && e.new_value.forwardedBy === manager.id));
    const board = await request('/api/v1/tasks', { auth: executive2 });
    assert.ok(board.data.data.columns.OPEN.some((t) => t.id === forward.data.data.child.id));

    let job = await app.modules.services.tasks.sendReminders();
    assert.equal(job.skipped, true, 'switch is OFF');
    await request('/api/v1/automation/task_reminders', { method: 'PATCH', auth: owner, body: { enabled: true, reason: 'Prem approved reminders' } });
    mfa.clock.advance(121 * 60_000);
    job = await app.modules.services.tasks.sendReminders();
    assert.equal(job.skipped, undefined);
    mfa.clock.advance(121 * 60_000);
    job = await app.modules.services.tasks.sendReminders();
    assert.ok(job.sent >= 1);
    assert.ok((await request('/api/v1/notifications', { auth: executive2 })).data.data.some((n) => n.type === 'TASK_REMINDER'));
    await assert.rejects(db.prepare('DELETE FROM tasks').run(), /cannot be deleted/);
  });

  test('idempotency keys replay creates and reject reuse with a different body', async () => {
    const key = crypto.randomUUID();
    const a = await request('/api/v1/tasks', { method: 'POST', auth: executive2, headers: { 'idempotency-key': key }, body: { title: 'Idempotent task' } });
    const b = await request('/api/v1/tasks', { method: 'POST', auth: executive2, headers: { 'idempotency-key': key }, body: { title: 'Idempotent task' } });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(b.response.headers.get('idempotent-replay'), 'true');
    assert.equal(a.data.data.id, b.data.data.id);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM tasks WHERE title='Idempotent task'").get()).n, 1);
    const reuse = await request('/api/v1/tasks', { method: 'POST', auth: executive2, headers: { 'idempotency-key': key }, body: { title: 'Different' } });
    assert.equal(reuse.status, 409);
    assert.equal(reuse.data.code, 'IDEMPOTENCY_KEY_REUSED');
    const invalid = await request('/api/v1/tasks', { method: 'POST', auth: executive2, body: { title: '', surprise: true } });
    assert.equal(invalid.status, 422);
    assert.equal(invalid.data.details.fields.length, 2);
  });
});

describe('F1 draft-first outbound gate', () => {
  test('every gate must pass: verified record, registered email, switch ON, checklist, employee approval', async () => {
    const customer = await request('/api/customers', { method: 'POST', auth: owner, body: { name: 'Johnson Lifts', gstin: '33AAACJ1234F1Z5', creditLimit: 0, creditDays: 0, status: 'ACTIVE', contacts: [{ name: 'Buyer', email: 'buyer@johnsonlifts.test', isPrimary: true }] } });
    assert.equal(customer.status, 201, JSON.stringify(customer.data));
    const customerId = Number(customer.data.data.id);
    const draft = await app.modules.services.outbound.createDraft(null, { workflowKey: 'quotation_email', category: 'quotation', customerId, recipients: ['buyer@johnsonlifts.test'], subject: 'Quotation Q-1', body: 'Please find the quotation.' });
    const send = (key = crypto.randomUUID()) => request('/api/v1/messages/send', { method: 'POST', auth: owner, headers: { 'idempotency-key': key }, body: { draftId: draft.id } });

    let r = await send();
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'GATE_BLOCKED');
    const failed = r.data.details.gates.filter((g) => !g.passed).map((g) => g.gate);
    assert.deepEqual(failed, ['WORKFLOW_SWITCH', 'CUSTOMER_CHECKLIST', 'DRAFT_APPROVED']);
    await request('/api/v1/automation/quotation_email', { method: 'PATCH', auth: owner, body: { enabled: true, reason: 'Prem approved quotation drafts' } });
    assert.equal((await request(`/api/v1/customers/${customerId}/message-checklist/quotation`, { method: 'PUT', auth: manager, body: { ticked: true, reason: 'Try' } })).status, 403);
    await request(`/api/v1/customers/${customerId}/message-checklist/quotation`, { method: 'PUT', auth: owner, body: { ticked: true, reason: 'Customer agreed to email quotes' } });
    r = await send();
    assert.deepEqual(r.data.details.gates.filter((g) => !g.passed).map((g) => g.gate), ['DRAFT_APPROVED']);

    assert.equal((await request(`/api/v1/messages/drafts/${draft.id}/approve`, { method: 'POST', auth: owner, body: { reason: 'Checked prices' } })).status, 200);
    const edit = await request(`/api/v1/messages/drafts/${draft.id}`, { method: 'PUT', auth: owner, body: { recipients: ['someone@else.test'], subject: 'Quotation Q-1', body: 'Changed', reason: 'Wrong address test' } });
    assert.equal(edit.data.data.approved, false, 'editing clears the approval');
    r = await send();
    assert.deepEqual(r.data.details.gates.filter((g) => !g.passed).map((g) => g.gate), ['REGISTERED_EMAIL', 'DRAFT_APPROVED']);
    await request(`/api/v1/messages/drafts/${draft.id}`, { method: 'PUT', auth: owner, body: { recipients: ['buyer@johnsonlifts.test'], subject: 'Quotation Q-1', body: 'Please find the quotation.', reason: 'Restore address' } });
    await request(`/api/v1/messages/drafts/${draft.id}/approve`, { method: 'POST', auth: owner, body: { reason: 'Checked again' } });
    const key = crypto.randomUUID();
    r = await send(key);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(sent.length, 1);
    const replay = await send(key);
    assert.equal(replay.data.data.replay, true);
    assert.equal(sent.length, 1, 'retries never send twice');
    assert.equal((await send()).data.code, 'ALREADY_SENT');
    const unapproved = await app.modules.services.outbound.createDraft(null, { category: 'quotation', customerId, recipients: ['buyer@johnsonlifts.test'], subject: 'Unapproved', body: 'x' });
    await assert.rejects(db.prepare("INSERT INTO email_send_attempts(email_draft_id,approval_decision_id,attempt_number,idempotency_key,status) VALUES(?,(SELECT id FROM approval_decisions LIMIT 1),1,'k','SENT')").run(unapproved.id), /cannot send|requires approval/, 'the database refuses unapproved sends');
  });
});

describe('F1 audit trail', () => {
  test('owner searches by user, date, module and record', async () => {
    const all = await request('/api/v1/audit-logs?module=TASK', { auth: owner });
    assert.ok(all.data.data.length > 0);
    assert.ok(all.data.modules.includes('AUTOMATION_SWITCH'));
    const byUser = await request(`/api/v1/audit-logs?userId=${manager.id}&module=TASK`, { auth: owner });
    assert.ok(byUser.data.data.every((r) => r.userId === manager.id));
    const record = byUser.data.data[0].recordId;
    assert.ok((await request(`/api/v1/audit-logs?recordId=${record}`, { auth: owner })).data.data.every((r) => r.recordId === record));
    assert.equal((await request('/api/v1/audit-logs?from=2099-01-01', { auth: owner })).data.data.length, 0);
    assert.equal((await request('/api/v1/audit-logs?from=not-a-date', { auth: owner })).status, 422);
  });
});
