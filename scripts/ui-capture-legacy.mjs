// Captures every screen of the existing vanilla SPA (public/) for the UI audit.
// Runs against a throwaway test_ schema in the single database, seeded with the
// demo dataset. Output: output/ui-before/<view>-<width>.png
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { tokenDigest } from '../src/security.js';
import { temporaryDatabase } from '../test-support/postgres.js';
import { seedDemoData } from './lib/demo-data.mjs';

const output = path.resolve(process.argv[2] || 'output/ui-before');
await fs.mkdir(output, { recursive: true });
const VIEWS = ['dashboard', 'customers', 'items', 'enquiries', 'quotations', 'orders', 'purchasing', 'users', 'tally', 'tally-connector', 'audit'];
const temporary = await temporaryDatabase('uibefore');
const config = getConfig({ databaseUrl: temporary.databaseUrl, seedOwnerEmail: 'owner@ui.test', seedOwnerPassword: 'Capture#Pass1' });
const db = await openDatabase(config);
let browser, server, app;
const issues = [];
try {
  await seedDemoData(db);
  const owner = await db.prepare("SELECT id FROM users WHERE role='OWNER' LIMIT 1").get();
  await db.prepare('UPDATE users SET must_change_password=0').run();
  const token = crypto.randomBytes(24).toString('hex');
  await db.prepare("INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at,mfa_verified_at) VALUES(?,?,?,now()+interval '1 hour',now())").run(owner.id, tokenDigest(token), crypto.randomBytes(24).toString('hex'));
  app = createApp({ db, config, fetchImpl: async () => { throw new Error('No live Tally calls during capture.'); } });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width > 600 ? 1000 : 844 }, reducedMotion: 'reduce' });
    const anon = await context.newPage();
    await anon.goto(base);
    await anon.locator('#login-form').waitFor();
    await anon.screenshot({ path: path.join(output, `login-${width}.png`) });
    await context.addCookies([{ name: 'crm_session', value: token, url: base, httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage();
    page.on('pageerror', (e) => issues.push(`${width} pageerror: ${e.message}`));
    await page.goto(base);
    await page.locator('#app:not(.hidden)').waitFor();
    for (const view of VIEWS) {
      if (width < 600) { const toggle = page.locator('#menu-toggle'); if (await toggle.isVisible()) await toggle.click(); }
      await page.locator(`#nav [data-view="${view}"]`).click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) issues.push(`${view} @${width}: horizontal overflow ${overflow}px`);
      await page.screenshot({ path: path.join(output, `${view}-${width}.png`), fullPage: true });
    }
    if (width === 1440) {
      await page.locator('#nav [data-view="dashboard"]').click();
      await page.locator('#theme-toggle').click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(output, 'dashboard-1440-dark.png'), fullPage: true });
    }
    await context.close();
  }
  await fs.writeFile(path.join(output, 'capture.json'), JSON.stringify({ capturedAt: new Date().toISOString(), views: VIEWS, widths: [1440, 390], issues }, null, 2));
  console.log(`Captured ${VIEWS.length + 1} screens at 1440 and 390 px into ${output}. Issues: ${issues.length}`);
  for (const issue of issues) console.log(' -', issue);
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await app?.close();
  await db.close();
  await temporary.close();
}
