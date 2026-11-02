// End-to-end UI verification of the redesigned Next.js app against the real
// API and a throwaway test_ schema in the single database (never the real
// application schema). Production build in a separate dist dir.
//
//   node scripts/ui-verify.mjs            build + run checks + captures
//   SKIP_BUILD=1 node scripts/ui-verify.mjs   reuse the last capture build
//
// Checks: login + 2FA enrolment, theme toggle (persisted per user), command
// palette, role-aware navigation and unauthorized state, duplicate submit,
// axe (serious/critical) on every screen, no horizontal overflow, no console
// errors. Captures: output/ui-after/<screen>-<width>-<theme>.png
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { hashPassword } from '../src/security.js';
import { temporaryDatabase } from '../test-support/postgres.js';
import { TEST_ENCRYPTION_KEY } from '../test-support/mfa.js';
import { Totp } from '../src/modules/mfa/totp.js';
import { seedDemoData } from './lib/demo-data.mjs';
import { saveQuotePolicy, saveQuoteCost } from '../src/quotation-workflow.js';

const API_PORT = 3999, WEB_PORT = 3105;
const web = `http://127.0.0.1:${WEB_PORT}`;
const webDir = path.resolve('apps/web');
const output = path.resolve('output/ui-after');
await fs.mkdir(output, { recursive: true });
const OWNER = { email: 'owner@ui.test', password: 'Redesign#Check1' };
const EXEC = { email: 'exec@ui.test', password: 'Redesign#Check1' };
const MANAGER = { email: 'manager@ui.test', password: 'Redesign#Check1' };
const SCREENS = [
  ['dashboard', 'Good '], ['customers', 'Customers'], ['customers/1', 'Shree Ganesh'], ['enquiries', 'Enquiries'], ['enquiries?open=1', 'Enquiries'], ['quotations', 'Quotations'], ['quotations/new', 'New quotation'], ['work', 'My work'], ['tasks', 'Tasks'], ['exceptions', 'Exceptions'], ['messages', 'Outbound drafts'],
  ['rules', 'Rules & switches'], ['users', 'Users & roles'], ['audit', 'Audit trail'], ['settings', 'Settings'], ['design-system', 'Design system']
];
const WIDTHS = [1440, 1024, 390];

const env = { ...process.env, MEHTA_API_URL: `http://127.0.0.1:${API_PORT}`, NEXT_DIST_DIR: '.next-capture', NEXT_TELEMETRY_DISABLED: '1' };
const nextBin = path.join(webDir, 'node_modules/next/dist/bin/next');
const run = (args, opts = {}) => spawn(process.execPath, [nextBin, ...args], { cwd: webDir, env, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

const temporary = await temporaryDatabase('uiverify');
const config = getConfig({ databaseUrl: temporary.databaseUrl, seedOwnerEmail: OWNER.email, seedOwnerPassword: OWNER.password, appEncryptionKey: TEST_ENCRYPTION_KEY, mfaEnabled: true });
const db = await openDatabase(config);
let server, app, browser, nextServer;
const report = { checkedAt: new Date().toISOString(), checks: [], axe: [], overflow: [], consoleErrors: [], captures: 0 };
const check = (name) => report.checks.push(name);

try {
  await seedDemoData(db);
  await db.prepare('UPDATE users SET must_change_password=0').run();
  await db.prepare("INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('Sales Executive',?,'EXECUTIVE',?,0)").run(EXEC.email, hashPassword(EXEC.password));
  await db.prepare("INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('Sales Manager',?,'MANAGER',?,0)").run(MANAGER.email, hashPassword(MANAGER.password));
  const ownerRow = await db.prepare("SELECT id FROM users WHERE role='OWNER' LIMIT 1").get();
  const ownerActor = { id: ownerRow.id, role: 'OWNER' };
  await saveQuotePolicy(db, { floorPercent: '10', marginBasis: 'LINE_AND_TOTAL', sellerState: '27', letterhead: { name: 'Mehta Electric Corporation', address: 'Chennai' }, reason: 'UI verification policy' }, ownerActor);
  for (const [itemId, cost] of [[1, '2900'], [2, '1900'], [3, '3800'], [4, '24000']]) await saveQuoteCost(db, itemId, { unitCost: cost, reason: 'UI verification cost' }, ownerActor);
  app = createApp({ db, config });
  server = http.createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(API_PORT, '127.0.0.1', resolve); });

  if (!process.env.SKIP_BUILD || !existsSync(path.join(webDir, '.next-capture'))) {
    const build = run(['build']);
    let log = ''; build.stdout.on('data', (d) => { log += d; }); build.stderr.on('data', (d) => { log += d; });
    const code = await new Promise((resolve) => build.on('close', resolve));
    if (code !== 0) throw new Error(`next build failed:\n${log.slice(-3000)}`);
  }
  nextServer = run(['start', '--hostname', '127.0.0.1', '--port', String(WEB_PORT)]);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${web}/login`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => report.consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[13]/.test(m.text())) report.consoleErrors.push(m.text()); });

  // 1. Login + two-factor enrolment
  await page.goto(`${web}/login`);
  await page.screenshot({ path: path.join(output, 'login-1440-light.png') });
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Show my setup key' }).click();
  const secret = (await page.getByLabel('Authenticator setup key').innerText()).replace(/\s/g, '');
  await page.screenshot({ path: path.join(output, 'login-2fa-1440-light.png') });
  const totp = new Totp();
  await page.getByLabel('6-digit code from the app').fill(totp.codeAt(secret, totp.stepAt(new Date())));
  await page.getByRole('button', { name: 'Turn on two-factor' }).click();
  await page.getByRole('heading', { name: 'Save your recovery codes' }).waitFor();
  assert.equal(await page.locator('.ds-codes li').count(), 10);
  await page.getByRole('button', { name: /saved them/ }).click();
  await page.getByRole('heading', { level: 1, name: /^Good / }).waitFor();
  check('login + two-factor enrolment');

  // 2. Theme toggle persists per user
  await page.getByRole('button', { name: /^Theme:/ }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.waitForTimeout(400);
  await page.evaluate(() => localStorage.removeItem('controldesk.preferences'));
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal((await db.prepare('SELECT theme FROM user_preferences').get()).theme, 'dark');
  await page.getByRole('button', { name: /^Theme:/ }).click();
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  check('theme toggle persisted per user');

  // 3. Command palette
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('combobox', { name: /Search screens/ });
  await palette.waitFor();
  await palette.fill('apex');
  await page.getByRole('option', { name: /Apex Automation Systems/ }).first().waitFor();
  await page.screenshot({ path: path.join(output, 'command-palette-1440-light.png') });
  await palette.fill('rules');
  await page.getByRole('option', { name: /Rules & switches/ }).first().click();
  await page.getByRole('heading', { level: 1, name: 'Rules & switches' }).waitFor();
  check('command palette search + navigation');

  // 3b. Create a customer through the redesigned drawer and land on its 360 page
  await page.goto(`${web}/customers?new=1`);
  const drawer = page.locator('#customer-form');
  await drawer.getByLabel('Registered name').fill('Johnson Lifts Pvt Ltd');
  await drawer.getByLabel('GSTIN').fill('33AAACJ1234F1Z5');
  await drawer.getByLabel('Credit limit (₹)').fill('750000');
  await drawer.getByLabel('Name', { exact: true }).fill('Purchase desk');
  await drawer.getByLabel('Email').fill('buyer@johnsonlifts.test');
  await page.getByRole('button', { name: 'Create customer' }).click();
  await page.getByRole('heading', { level: 1, name: 'Johnson Lifts Pvt Ltd' }).waitFor();
  assert.equal((await db.prepare("SELECT state_code FROM crm_customer_profiles p JOIN customers c ON c.id=p.customer_id WHERE c.name='Johnson Lifts Pvt Ltd'").get())?.state_code, '33', 'state code filled from GSTIN');
  await page.getByRole('tab', { name: /Contacts/ }).click();
  await page.getByRole('tabpanel').getByText('buyer@johnsonlifts.test').waitFor();
  check('create customer + 360');

  // 3c. Create an enquiry (customer + item from server search) and open it in the split view
  await page.goto(`${web}/enquiries?new=1`);
  const enquiryForm = page.locator('#enquiry-form');
  await enquiryForm.getByLabel('Customer').fill('Apex');
  await page.getByRole('option', { name: /Apex Automation Systems/ }).click();
  await enquiryForm.getByLabel('Subject').fill('Conveyor spares for line 2');
  await enquiryForm.getByLabel('Item 1').fill('3RT');
  await page.getByRole('option', { name: /3RT2026/ }).click();
  await enquiryForm.getByLabel('Qty').fill('5');
  await page.getByRole('button', { name: 'Create enquiry' }).click();
  await page.getByRole('heading', { level: 2, name: 'Conveyor spares for line 2' }).waitFor();
  assert.equal(Number((await db.prepare("SELECT count(*) AS n FROM enquiries WHERE subject='Conveyor spares for line 2'").get()).n), 1);
  check('create enquiry + split view');

  // 3d. Quote from the enquiry → submit → independent approval → mark sent
  const newEnquiry = (await db.prepare("SELECT id FROM enquiries WHERE subject='Conveyor spares for line 2'").get()).id;
  await page.goto(`${web}/enquiries?open=${newEnquiry}`);
  await page.getByRole('link', { name: 'Create quotation' }).click();
  await page.getByRole('heading', { level: 1, name: 'New quotation' }).waitFor();
  await page.waitForFunction(() => document.querySelector('input[role="combobox"][id]') && [...document.querySelectorAll('.ds-line-row input[role="combobox"]')].some((i) => i.value.includes('3RT2026')));
  assert.equal(await page.locator('.ds-line-row:not(.ds-line-head)').count(), 1, 'lines pre-filled from the enquiry');
  await page.getByLabel('Rate').fill('3650');
  await page.screenshot({ path: path.join(output, 'quotation-editor-new-1440-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save draft' }).click();
  await page.waitForURL(/\/quotations\/\d+$/);
  const quoteUrl = page.url();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await page.getByLabel('Reason').fill('Ready for review');
  await page.getByRole('dialog').getByRole('button', { name: 'Submit for approval' }).click();
  await page.locator('.ds-record .ds-badge', { hasText: 'Pending approval' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Approve' }).count(), 0, 'the author cannot approve');
  const managerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const manager = await managerContext.newPage();
  await manager.goto(`${web}/login`);
  await manager.getByLabel('Email').fill(MANAGER.email);
  await manager.getByLabel('Password').fill(MANAGER.password);
  await manager.getByRole('button', { name: 'Sign in' }).click();
  await manager.getByRole('heading', { level: 1, name: /^Good / }).waitFor();
  await manager.goto(quoteUrl);
  await manager.getByRole('button', { name: 'Approve' }).click();
  await manager.getByLabel('Reason').fill('Prices and margin checked');
  await manager.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await manager.locator('.ds-record .ds-badge', { hasText: 'Approved' }).waitFor();
  await manager.getByRole('button', { name: 'Mark as sent' }).click();
  await manager.getByLabel('Reason').fill('Sent to the buyer by email');
  await manager.getByRole('dialog').getByRole('button', { name: 'Mark as sent' }).click();
  await manager.locator('.ds-record .ds-badge', { hasText: 'Sent' }).waitFor();
  await manager.screenshot({ path: path.join(output, 'quotation-editor-sent-1440-light.png'), fullPage: true });
  assert.equal((await db.prepare('SELECT status FROM enquiries WHERE id=?').get(newEnquiry)).status, 'QUOTED');
  await managerContext.close();
  check('enquiry → quote → independent approval → sent');

  // 4. Duplicate-submit protection: double-click creates one task
  await page.goto(`${web}/tasks?new=1`);
  await page.getByLabel('Title').fill('Chase Connectwell acceptance for PO 204');
  await page.getByRole('button', { name: 'Create task' }).dblclick();
  await page.getByText('Task created.').waitFor();
  assert.equal(Number((await db.prepare('SELECT count(*) AS n FROM tasks').get()).n), 1);
  check('duplicate submit creates one record');

  // 5. Captures + axe + overflow for every screen, width and theme
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => localStorage.setItem('controldesk.preferences', JSON.stringify({ theme: t })), theme);
    await db.prepare('UPDATE user_preferences SET theme=?').run(theme);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      for (const [slug, heading] of SCREENS) {
        await page.goto(`${web}/${slug}`);
        await page.getByRole('heading', { level: 1, name: new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}`) }).waitFor();
        await page.waitForFunction(() => !document.querySelector('.ds-skeleton, .ds-spinner'), null, { timeout: 15000 }).catch(() => undefined);
        await page.waitForTimeout(250);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) report.overflow.push(`${slug} @${width} ${theme}: ${overflow}px`);
        if (width === 1440 || width === 390) {
          const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
          for (const v of result.violations.filter((x) => ['serious', 'critical'].includes(x.impact))) report.axe.push({ screen: slug, width, theme, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) });
        }
        await page.screenshot({ path: path.join(output, `${slug.replace(/[?=/]/g, '-')}-${width}-${theme}.png`), fullPage: true });
        report.captures++;
      }
    }
  }
  check('captures + axe + overflow');

  // 6. Role-aware UI: executive sees no admin navigation and gets the unauthorized state
  const execContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const exec = await execContext.newPage();
  await exec.goto(`${web}/login`);
  await exec.getByLabel('Email').fill(EXEC.email);
  await exec.getByLabel('Password').fill(EXEC.password);
  await exec.getByRole('button', { name: 'Sign in' }).click();
  await exec.getByRole('heading', { level: 1, name: /^Good / }).waitFor();
  await exec.goto(`${web}/rules`);
  await exec.getByText('You don’t have access').waitFor();
  await exec.screenshot({ path: path.join(output, 'unauthorized-390-light.png') });
  assert.equal(await exec.locator('a.ds-nav-link', { hasText: 'Rules & switches' }).count(), 0);
  check('role-aware navigation + unauthorized state');

  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(`UI verified: ${report.checks.length} flows, ${report.captures} captures. axe serious/critical: ${report.axe.length}. overflow: ${report.overflow.length}. console errors: ${report.consoleErrors.length}.`);
  for (const a of report.axe.slice(0, 20)) console.log(' axe', a.screen, a.width, a.theme, a.id, a.help, a.nodes.join(' | '));
  for (const o of report.overflow) console.log(' overflow', o);
  for (const e of report.consoleErrors.slice(0, 10)) console.log(' console', e);
  if (report.axe.length || report.overflow.length || report.consoleErrors.length) process.exitCode = 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  nextServer?.kill();
  if (server) await new Promise((resolve) => server.close(resolve));
  await app?.close();
  await db.close();
  await temporary.close();
}
