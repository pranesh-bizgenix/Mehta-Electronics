// Real browser check of the F1 Next.js screens against the real API and a
// throwaway PostgreSQL database. Owner signs in with TOTP enrolment; every
// screen is captured on desktop and phone widths and checked for console
// errors, horizontal overflow and the unauthorized state.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { hashPassword } from '../src/security.js';
import { temporaryDatabase } from '../test-support/postgres.js';
import { TEST_ENCRYPTION_KEY } from '../test-support/mfa.js';
import { Totp } from '../src/modules/mfa/totp.js';

const output = path.resolve('output/foundation');
await fs.mkdir(output, { recursive: true });
const OWNER = { email: 'owner@ui.test', password: 'Foundation#Ui1' };
const EXEC = { email: 'exec@ui.test', password: 'Foundation#Ui1' };
const temporary = await temporaryDatabase();
const config = getConfig({ databaseUrl: temporary.databaseUrl, seedOwnerEmail: OWNER.email, seedOwnerPassword: OWNER.password, appEncryptionKey: TEST_ENCRYPTION_KEY, mfaEnabled: true });
const db = await openDatabase(config);
await db.prepare('UPDATE users SET must_change_password=0').run();
await db.prepare("INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('Sales Executive',?,'EXECUTIVE',?,0)").run(EXEC.email, hashPassword(EXEC.password));
const app = createApp({ db, config });
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const api = `http://127.0.0.1:${server.address().port}`;
const webPort = 3105;
const web = `http://127.0.0.1:${webPort}`;
const next = spawn(process.execPath, [path.resolve('apps/web/node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(webPort)], {
  cwd: path.resolve('apps/web'), env: { ...process.env, MEHTA_API_URL: api, NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe']
});
let nextLog = '';
next.stdout.on('data', (d) => { nextLog += d; });
next.stderr.on('data', (d) => { nextLog += d; });

const errors = [];
const results = [];
let browser;
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${web}/login`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Download the React DevTools|\[HMR\]|status of 401/.test(m.text())) errors.push(`console: ${m.text()}`); });

  // Sign in + MFA enrolment
  await page.goto(`${web}/login`);
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Generate my key' }).click();
  const secret = (await page.getByLabel('Authenticator key').innerText()).replace(/\s/g, '');
  await page.screenshot({ path: path.join(output, 'mfa-enrol.png') });
  const totp = new Totp();
  await page.getByLabel('6-digit code from the app').fill(totp.codeAt(secret, totp.stepAt(new Date())));
  await page.getByRole('button', { name: 'Turn on two-factor' }).click();
  await page.getByRole('heading', { name: 'Save your recovery codes' }).waitFor();
  assert.equal(await page.locator('.codes li').count(), 10);
  await page.getByRole('button', { name: 'I have saved them' }).click();
  await page.getByRole('heading', { name: 'My work' }).waitFor();

  // Create a task through the UI (double-click on submit must create one task)
  await page.goto(`${web}/tasks`);
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Title').fill('Chase Connectwell acceptance for PO 204 — a deliberately long title to check wrapping on narrow screens');
  await page.getByRole('button', { name: 'Create task' }).dblclick();
  await page.getByText('Task created.').waitFor();
  assert.equal(Number((await db.prepare('SELECT count(*) AS n FROM tasks').get()).n), 1, 'duplicate submit created one task');

  const screens = [
    ['work', 'My work'], ['tasks', 'Task board'], ['exceptions', 'Exception queue'], ['messages', 'Outbound drafts'],
    ['rules', 'Rules'], ['automation', 'Automation switches'], ['users', 'Users & roles'], ['audit', 'Audit trail']
  ];
  for (const [slug, heading] of screens) {
    for (const [label, viewport] of [['desktop', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await page.goto(`${web}/${slug}`);
      await page.getByRole('heading', { name: heading, level: 1 }).waitFor();
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: path.join(output, `${slug}-${label}.png`), fullPage: true });
      results.push({ screen: slug, viewport: label, horizontalOverflowPx: overflow });
      assert.ok(overflow <= 1, `${slug} ${label} overflows by ${overflow}px`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${web}/users`);
  await page.getByRole('tab', { name: 'Role permissions' }).click();
  await page.getByRole('heading', { name: 'quotations' }).waitFor();
  await page.screenshot({ path: path.join(output, 'roles-matrix.png'), fullPage: true });

  // Rules: setting a value requires a reason and creates version 1
  await page.goto(`${web}/rules`);
  await page.locator('article', { hasText: 'Task reminder interval' }).getByRole('button', { name: 'Set' }).click();
  await page.getByLabel('Value (JSON)').fill('180');
  await page.getByRole('button', { name: 'Review and save' }).click();
  await page.getByRole('button', { name: 'Save new version' }).click();
  await page.getByText('Give a reason of at least 3 characters.').waitFor();
  await page.getByLabel('Reason').fill('Client confirmed 3-hour reminders');
  await page.getByRole('button', { name: 'Save new version' }).click();
  await page.getByText('set · v1').waitFor();

  // Unauthorized state for a role without access
  const execContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const exec = await execContext.newPage();
  exec.on('pageerror', (e) => errors.push(`exec pageerror: ${e.message}`));
  await exec.goto(`${web}/login`);
  await exec.getByLabel('Email').fill(EXEC.email);
  await exec.getByLabel('Password').fill(EXEC.password);
  await exec.getByRole('button', { name: 'Sign in' }).click();
  await exec.getByRole('heading', { name: 'My work' }).waitFor();
  await exec.goto(`${web}/rules`);
  await exec.getByText('No access').waitFor();
  await exec.screenshot({ path: path.join(output, 'unauthorized-phone.png') });
  assert.equal(await exec.getByRole('link', { name: 'Rules' }).count(), 0, 'navigation hides screens the role cannot use');

  // Existing CRM UI (served by the API) asks the enrolled owner for a code before opening.
  const legacyContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const legacy = await legacyContext.newPage();
  legacy.on('pageerror', (e) => errors.push(`legacy pageerror: ${e.message}`));
  await legacy.goto(api);
  await legacy.locator('#login-form [name=email]').fill(OWNER.email);
  await legacy.locator('#login-form [name=password]').fill(OWNER.password);
  await legacy.locator('#login-form button[type=submit]').click();
  await legacy.locator('#mfa-form').waitFor();
  await legacy.screenshot({ path: path.join(output, 'legacy-mfa.png') });
  await legacy.locator('#mfa-form [name=code]').fill(totp.codeAt(secret, totp.stepAt(new Date()) + 1));
  await legacy.locator('#mfa-form button[type=submit]').click();
  await legacy.locator('#app:not(.hidden)').waitFor();
  await legacy.locator('#open-workspace').waitFor();

  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ checkedAt: new Date().toISOString(), results, consoleErrors: errors, duplicateSubmitTasks: 1 }, null, 2));
  console.log(`Foundation UI verified: ${results.length} screen captures, no console errors, no horizontal overflow.`);
} catch (error) {
  console.error(error);
  console.error(nextLog.split('\n').slice(-30).join('\n'));
  console.error(errors);
  process.exitCode = 1;
} finally {
  await browser?.close();
  next.kill();
  await new Promise((resolve) => server.close(resolve));
  await app.close();
  await db.close();
  await temporary.close();
}
