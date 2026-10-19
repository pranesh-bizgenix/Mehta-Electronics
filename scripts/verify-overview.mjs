import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { getConfig } from '../src/config.js';
import { openDatabase,writeAudit } from '../src/db.js';
import { createApp } from '../src/app.js';
import { randomToken,tokenDigest } from '../src/security.js';

const config=getConfig(),db=await openDatabase(config),token=randomToken();
let browser,app,server;
try{
  const owner=await db.prepare("SELECT id FROM users WHERE role='OWNER' AND status='ACTIVE' ORDER BY id LIMIT 1").get();
  if(!owner)throw new Error('An active owner is required for local browser verification.');
  await db.prepare("INSERT INTO sessions(user_id,token_hash,csrf_token,user_agent,expires_at) VALUES(?,?,?,?,now()+interval '10 minutes')").run(owner.id,tokenDigest(token),randomToken(24),'Local Overview browser verification');
  await writeAudit(db,{userId:owner.id,entity:'TALLY_VERIFICATION',recordId:'overview',action:'BROWSER_CHECK_STARTED'});
  app=createApp({db,config});server=http.createServer(app);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:'chrome',headless:true});
  const root=path.resolve('output/overview');fs.mkdirSync(root,{recursive:true});
  const errors=[];
  let verified;
  for(const [size,viewport]of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844}]]){
    const context=await browser.newContext({viewport});
    await context.addCookies([{name:'crm_session',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage();page.setDefaultTimeout(12000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
    await page.goto(base);await page.locator('.ov-hero').waitFor();
    await page.locator('dialog[open]').evaluateAll(dialogs=>dialogs.forEach(dialog=>dialog.close()));
    const meta=await(await context.request.get(`${base}/api/dashboard`)).json();
    const result=await(await context.request.get(`${base}/api/dashboard/tally`)).json();
    const expected=(await db.sql`SELECT COUNT(*) AS items,COUNT(closing_value) AS valued,SUM(closing_value)::text AS value FROM tally_stock_items WHERE company_id=${meta.company.id} AND session_id=${meta.period.id}`)[0];
    assert.equal(result.stock.signedValue,expected.value);assert.equal(result.counts.items,expected.items);assert.equal(result.stock.valuedItems,expected.valued);
    assert.ok(await page.locator('.ov-stat-featured').innerText().then(text=>text.includes('PARTIAL VALUE')));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${size} horizontal page overflow`);
    await page.screenshot({path:path.join(root,`overview-${size}.png`),fullPage:true});
    await page.locator('#overview-company').selectOption(meta.company.id);await page.locator('.ov-hero').waitFor();
    await page.locator('#overview-period').selectOption(meta.period.id);await page.locator('.ov-hero').waitFor();
    await page.locator('.ov-quality-details').click();await page.locator('#modal[open] .detail').waitFor();
    assert.match(await page.locator('#modal-body').innerText(),/LG:507613/);
    await page.screenshot({path:path.join(root,`quality-${size}.png`),fullPage:true});
    await page.locator('#modal').evaluate(dialog=>dialog.close());
    await page.locator('#overview-groups').click();await page.locator('#modal[open] table').waitFor();
    assert.equal(await page.locator('#modal tbody tr').count(),result.counts.groups);
    await page.locator('#modal').evaluate(dialog=>dialog.close());
    await page.locator('.ov-nav[data-view="items"]').first().click();await page.locator('#tally-master-company').waitFor();
    await page.locator('#nav button[data-view="dashboard"]').click();await page.locator('.ov-hero').waitFor();
    verified={company:meta.company.name,counts:result.counts,stock:result.stock};
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({screenshots:root,consoleErrors:errors.length,...verified}));
}finally{
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
  if(app)await app.close();
  await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenDigest(token));
  await db.close();
}
