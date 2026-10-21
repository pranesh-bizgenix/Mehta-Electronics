// Isolated browser review. Serves public assets and intercepts every API request.
// No backend startup, database, credentials, Tally calls, or connector source inspection.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const root = path.resolve('public');
const output = path.resolve('output/design-review');
await fs.mkdir(output, { recursive: true });
const baseline = execFileSync('git', ['show', 'f521ce7^:public/index.html'], { encoding: 'utf8' });
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/before') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(baseline); }
    const target = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!target.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(target)] + '; charset=utf-8');
    res.end(await fs.readFile(target));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const at = '2026-10-21T04:30:00Z';
const company = { id: 'fixture-company', name: 'Mehta Electronics · Preview' };
const period = { id: 'fixture-period', date_from: '2026-04-01', date_to: '2026-10-21', received_at: at };
const pagination = { page: 1, pageSize: 25, total: 3, pages: 1 };
const customers = ['Apex Automation', 'Bharat Industrial Systems', 'Crown Engineering'].map((name, i) => ({ id: i + 1, name, customer_code: `ME-00${i+1}`, gstin: `27ABCDE123${i}F1Z5`, owner_name: 'Aarav Mehta', credit_limit: 150000 + i * 50000, credit_days: 30, status: ['ACTIVE','ON_HOLD','ACTIVE'][i] }));
const items = ['Contactor · 3RT2016', 'Circuit breaker · 5SL6316', 'Relay · 3RH2122'].map((description, i) => ({ id: i + 1, name: description, part_code: description.split(' · ')[1], description, brand: 'Siemens', hsn: '8536', uom: 'NOS', status: 'ACTIVE', base_unit: 'NOS', parent_name: 'Switchgear', normalized_part_number: description.split(' · ')[1], closing_quantity_text: `${24+i*12} NOS`, closing_rate_text: '1,250 / NOS', closing_value: '45000.00' }));
const documents = customers.map((c, i) => ({ ...c, customer_name: c.name, enquiry_number: `ENQ-2026-00${i+1}`, subject: ['Panel upgrade · Pune plant', 'Quarterly maintenance parts', 'New assembly line'][i], line_count: 3+i, expected_by: '2026-10-28', quotation_number: `QT-2026-00${i+1}`, enquiry_id: i+1, valid_until: '2026-11-05', total: 124500+i*22000, order_number: `SO-2026-00${i+1}`, customer_po_number: `PO-847${i}`, promised_date: '2026-10-30', status: ['NEW','QUALIFIED','QUOTED'][i] }));
const user = { id: 1, name: 'Aarav Mehta', email: 'preview@example.test', phone: '9876543210', role: 'OWNER', status: 'ACTIVE', mustChangePassword: false, createdAt: at };
const tally = { available: true, asOf: at, period, counts: { ledgers: 342, items: 1248, groups: 28, customers: 186, suppliers: 94 }, stock: { signedValue: '2845620.00', missingValue: 12, valuedItems: 1236, totalItems: 1248, negativeQuantity: 3, zeroQuantity: 46, unclassifiedQuantity: 0, signConvention: 'Original delivered signs retained.' }, banks: [{ name: 'HDFC Current Account', balance: '425600.00' }, { name: 'Cash', balance: '18400.00' }], stockGroups: [{ name: 'Switchgear', count: 480 }, { name: 'Automation', count: 365 }, { name: 'Control components', count: 248 }], quality: { warnings: 2, quarantined: 0 }, coverage: ['ledgersXml','stockXml','groupsXml'].map(dataset => ({ dataset, state: 'imported', count: 342 })) };
const dashboard = { company, companies: [company], period, periods: [period], access: { financial: true }, sync: { state: 'Connector online', company: company.name, receivedDatasets: 8, expectedDatasets: 8, lastSuccess: at, lastSeen: at }, workflow: { customers: 186, items: 1248, enquiries: 24, quotations: 18, orders: 12, recentActivity: [], counts: { customers: 186, items: 1248, enquiries: 24, quotations: 18, orders: 12 } } };
dashboard.workflow = { stats: { enquiries: 24, quotations: 18, orders: 12, order_value: '845200.00' }, asOf: at, unavailable: ['Purchasing', 'Dispatch queues'] };
const reconciliation = { data: { summary: { customerMatches: 184, itemMatches: 1240, customerConflicts: 2, itemConflicts: 8, customersMissingInCrm: 2, customersMissingInTally: 0, itemsMissingInCrm: 8, itemsMissingInTally: 0 }, customers: { matches: [], missingInCrm: [] }, items: { matches: [], missingInCrm: [] } } };
const pages = ['dashboard','customers','items','enquiries','quotations','orders','users','tally','tally-connector','audit'];
let browser;
const errors = [], requests = {}, screenRequests = {}, checks = [];
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const variant of ['before', 'after', 'mobile']) {
    const context = await browser.newContext({ viewport: variant === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' });
    const page = await context.newPage();
    if (variant === 'mobile') {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 120, downloadThroughput: 200000, uploadThroughput: 90000, connectionType: 'cellular4g' });
    }
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(`${variant}: ${error.message}`));
    let current = 'dashboard', failUsers = false, emptyEnquiries = false, delayUsers = false;
    await page.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      (requests[`${variant}/${current}`] ||= []).push(`${request.method()} ${pathname}`);
      assert.equal(request.method(), 'GET', `Preview must never mutate: ${pathname}`);
      if (pathname === '/api/users' && delayUsers) await new Promise(resolve => setTimeout(resolve, 500));
      if (pathname === '/api/users' && failUsers) return route.fulfill({ status: 503, json: { error: 'Preview service unavailable' } });
      let result;
      if (pathname === '/api/auth/me') result = { user, permissions: ['*'], csrfToken: 'preview-only' };
      else if (pathname === '/api/dashboard') result = dashboard;
      else if (pathname === '/api/dashboard/tally') result = tally;
      else if (pathname === '/api/tally/companies') result = { data: [company] };
      else if (pathname.startsWith('/api/tally/masters/')) result = { data: pathname.endsWith('items') ? items : customers.map(c => ({ ...c, parent_name: 'Sundry Debtors', phone: '9876543210', email: 'buyer@example.test', closing_balance: '125000.00' })), pagination, company, financial: true };
      else if (pathname === '/api/users') result = { data: [user, { ...user, id: 2, name: 'Priya Shah', role: 'MANAGER', email: 'priya@example.test' }, { ...user, id: 3, name: 'Rohan Desai', role: 'EXECUTIVE', status: 'INACTIVE', email: 'rohan@example.test' }] };
      else if (pathname === '/api/enquiries') result = { data: emptyEnquiries ? [] : documents, pagination };
      else if (pathname === '/api/quotations') result = { data: documents.map((d,i) => ({ ...d, status: ['DRAFT','SENT','ACCEPTED'][i] })), pagination };
      else if (pathname === '/api/orders') result = { data: documents.map((d,i) => ({ ...d, status: ['CONFIRMED','PROCESSING','DISPATCHED'][i] })), pagination };
      else if (pathname === '/api/customers') result = { data: customers, pagination };
      else if (pathname === '/api/items') result = { data: items, pagination };
      else if (pathname === '/api/tally/status') result = { lastJob: { status: 'SUCCEEDED' } };
      else if (pathname === '/api/reconciliation') result = reconciliation;
      else if (pathname === '/api/tally-connector/status') result = { connector: null, connectors: [], jobs: [], recentJobs: [], connection: 'offline', status: 'offline', profiles: [], heartbeats: [] };
      else if (pathname === '/api/audit-logs') result = { data: documents.map((d,i) => ({ id: i+1, created_at: at, user_name: user.name, entity: ['QUOTATION','CUSTOMER','ENQUIRY'][i], record_id: String(i+1), action: ['CREATE','UPDATE','REVISE'][i], reason: ['New customer requirement','Contact updated','Quantity revised'][i] })), pagination };
      else if (pathname === '/api/dashboard/quality') result = { warnings: [], quarantine: [], parity: 'Fixture only' };
      else throw new Error(`Missing preview fixture: ${pathname}`);
      await route.fulfill({ json: result });
    });
    await page.goto(`${base}${variant === 'before' ? '/before' : '/'}`);
    await page.locator('#app:not(.hidden)').waitFor();
    for (const name of pages) {
      current = name;
      if (variant === 'mobile') await page.locator('#menu-toggle').click();
      await page.locator(`#nav button[data-view="${name}"]`).click();
      await page.waitForTimeout(180);
      if (variant !== 'before') await page.locator('#view:not([aria-busy])').waitFor();
      await page.screenshot({ path: path.join(output, `${name}-${variant}.png`), fullPage: true });
      screenRequests[`${variant}/${name}`] = [...new Set(requests[`${variant}/${name}`] || [])].filter(item => !item.includes('/api/auth/me')).sort();
      if (variant !== 'before') {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}/${variant} page overflow`);
        assert.equal(await page.locator('#toast.bad.show').count(), 0, `${name}/${variant} load error`);
        assert.equal(await page.locator('.ov-error').count(), 0, `${name}/${variant} overview error`);
        if (variant === 'after') {
          await page.setViewportSize({ width: 820, height: 1180 });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}/tablet page overflow`);
          await page.setViewportSize({ width: 1440, height: 1000 });
        }
      }
    }
    if (variant === 'after') {
      current = 'users';
      await page.locator('#nav [data-view=users]').click();
      await page.locator('.data-tools').waitFor();
      const filter = page.getByRole('searchbox', { name: /Filter loaded/ });
      await filter.fill('Priya');
      assert.equal(await page.locator('#view tbody tr:visible').count(), 1);
      await filter.fill('not-a-match'); await page.locator('.data-empty:not([hidden])').waitFor();
      await filter.fill('');
      await page.getByRole('button', { name: 'Sort loaded rows by Name', exact: true }).click();
      assert.match(await page.locator('#view tbody tr').first().innerText(), /Aarav/);
      await page.getByText('Columns', { exact: true }).click();
      await page.locator('.column-menu label').filter({ hasText: 'Contact' }).locator('input').uncheck();
      assert.equal(await page.locator('#view thead th').nth(1).isVisible(), false);
      await page.getByText('Columns', { exact: true }).click();
      await page.locator('#user-new').click(); await page.locator('#modal[open]').waitFor();
      await page.screenshot({ path: path.join(output, 'form-after.png'), fullPage: true });
      await page.keyboard.press('Escape'); assert.equal(await page.locator('#modal[open]').count(), 0);
      await page.locator('#theme-toggle').click();
      await page.screenshot({ path: path.join(output, 'users-dark.png'), fullPage: true });
      await page.locator('#nav [data-view=dashboard]').click();
      await page.locator('.ov-hero').waitFor();
      await page.screenshot({ path: path.join(output, 'dashboard-dark.png'), fullPage: true });
      await page.reload(); await page.locator('#app:not(.hidden)').waitFor();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      await page.locator('#theme-toggle').click();
      failUsers = true; await page.locator('#nav [data-view=users]').click();
      await page.locator('.feedback-error').waitFor();
      await page.screenshot({ path: path.join(output, 'error-after.png'), fullPage: true });
      failUsers = false; delayUsers = true;
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await page.locator('.loading-grid').waitFor();
      await page.screenshot({ path: path.join(output, 'loading-after.png'), fullPage: true });
      await page.locator('#view:not([aria-busy]) .data-tools').waitFor();
      delayUsers = false; emptyEnquiries = true;
      await page.locator('#nav [data-view=enquiries]').click();
      await page.locator('#view .empty').waitFor();
      await page.screenshot({ path: path.join(output, 'empty-after.png'), fullPage: true });
      // Exercise reusable primitives without introducing a new business action.
      assert.equal(await page.evaluate(async () => {
        const { ConfirmDialog } = await import('/ui-components.js?v=1');
        const result = ConfirmDialog({ title: 'Preview confirmation', message: 'No business action will run.' });
        document.querySelector('dialog:last-of-type button').click();
        return result;
      }), false);
      await page.evaluate(async () => {
        const { DataTable, Tabs } = await import('/ui-components.js?v=1');
        const fixture = document.createElement('section');
        fixture.id = 'component-review';
        fixture.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Reference</th><th>Value</th></tr></thead><tbody>${Array.from({ length: 45 }, (_, i) => `<tr><td>Item ${i + 1}</td><td>${i + 1}</td></tr>`).join('')}</tbody></table></div><div id="review-tabs"><button role="tab" id="tab-one" aria-controls="panel-one">One</button><button role="tab" id="tab-two" aria-controls="panel-two">Two</button></div><div id="panel-one" aria-labelledby="tab-one">First panel</div><div id="panel-two" aria-labelledby="tab-two">Second panel</div>`;
        document.body.append(fixture); new DataTable(fixture.querySelector('table')); new Tabs(fixture.querySelector('#review-tabs'));
      });
      assert.equal(await page.locator('#component-review tbody tr:visible').count(), 20);
      await page.locator('#component-review').getByRole('button', { name: 'Next rows' }).click();
      assert.match(await page.locator('#component-review tbody tr:visible').first().innerText(), /Item 21/);
      await page.locator('#tab-one').focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('#tab-two').getAttribute('aria-selected'), 'true');
      assert.equal(await page.locator('#panel-one').isVisible(), false);
      await page.locator('#component-review').evaluate(el => el.remove());
      checks.push('loaded-row filter / no matches / sorting / column picker / dialog Escape / persisted dark mode / error retry / skeleton / empty state / confirmation cancel');
      checks.push('45-row local pagination / keyboard tab selection / desktop and tablet overflow checks / simulated 4G mobile');
    }
    await context.close();
  }
  assert.deepEqual(errors, [], 'Browser runtime errors');
  for (const name of pages) {
    assert.deepEqual(screenRequests[`after/${name}`], screenRequests[`before/${name}`], `${name} API contract changed`);
  }
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ fixtureData: true, browserErrors: errors, checks, pages, screenRequests, requests }, null, 2));
  const titles = ['Overview','Customers','Items','Enquiries','Quotations','Sales orders','Users','Tally & reconciliation','Tally Connector','Audit log'];
  await fs.writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mehta frontend design review</title><style>body{font:15px/1.6 system-ui;margin:32px;background:#f4f6f5;color:#183b2b}h1{letter-spacing:-.04em}section{margin:40px 0}a{color:#185c40}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}figure{margin:0}figcaption{padding:12px 0;font-weight:600}img{max-width:100%;height:auto;border:1px solid #dce3de;border-radius:12px}nav{display:flex;flex-wrap:wrap;gap:16px}@media(max-width:700px){body{margin:16px}.pair{grid-template-columns:1fr}}</style><h1>Mehta Electronics · Design review</h1><p>All ten existing screens. Before and after use the same isolated fixture data, never live business records. Mobile screenshots use simulated 4G. Connector controls were never activated.</p><nav>${pages.map((name,i) => `<a href="#${name}">${titles[i]}</a>`).join('')}</nav>${pages.map((name,i) => `<section id="${name}"><h2>${titles[i]}</h2><div class="pair">${['before','after'].map(variant => `<figure><figcaption>${variant === 'before' ? 'Before' : 'After'}</figcaption><a href="${name}-${variant}.png"><img loading="lazy" src="${name}-${variant}.png" alt="${titles[i]}, ${variant} redesign"></a></figure>`).join('')}</div><p><a href="${name}-mobile.png">View mobile capture</a></p></section>`).join('')}<h2>Shared component states</h2><nav>${['form-after','users-dark','dashboard-dark','loading-after','error-after','empty-after'].map(name => `<a href="${name}.png">${name.replaceAll('-', ' ')}</a>`).join('')}</nav></html>`);
  console.log(`Reviewed ${pages.length} pages before/after and on mobile. Screenshots: ${output}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
