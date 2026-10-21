import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { getConfig } from '../src/config.js';
import { openDatabase,writeAudit } from '../src/db.js';
import { randomToken,tokenDigest } from '../src/security.js';

const config=getConfig(), db=await openDatabase(config), token=randomToken();
let browser;
try {
  const owner=await db.prepare("SELECT id FROM users WHERE role='OWNER' AND status='ACTIVE' ORDER BY id LIMIT 1").get();
  if(!owner)throw new Error('An active owner is required for browser verification.');
  await db.prepare("INSERT INTO sessions(user_id,token_hash,csrf_token,user_agent,expires_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP + INTERVAL '10 minutes')").run(owner.id,tokenDigest(token),randomToken(24),'Checkpoint A local browser verification');
  await writeAudit(db,{userId:owner.id,entity:'TALLY_VERIFICATION',recordId:'checkpoint-a',action:'BROWSER_CHECK_STARTED'});
  browser=await chromium.launch({channel:'chrome',headless:true});
  const root=path.resolve('output/checkpoint-a');fs.mkdirSync(root,{recursive:true});
  const errors=[];
  const base=`http://${config.host}:${config.port}`;
  const counts=(await db.sql`SELECT (SELECT COUNT(*) FROM tally_ledgers) AS ledgers,(SELECT COUNT(*) FROM tally_stock_items) AS items`)[0];
  for(const [size,viewport]of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844}]]){
    const context=await browser.newContext({viewport});
    await context.addCookies([{name:'crm_session',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('favicon'))errors.push(message.text())});
    await page.goto(base);await page.locator('#app').waitFor({state:'visible'});
    // Preserve the owner's password. Dismiss the existing first-login reminder only in this test tab.
    await page.locator('dialog[open]').evaluateAll(dialogs=>dialogs.forEach(dialog=>dialog.close()));
    for(const [view,kind,count]of [['customers','ledgers',counts.ledgers],['items','items',counts.items]]){
      await page.locator(`#nav button[data-view="${view}"]`).click();
      await page.locator('#tally-master-company').waitFor();
      await page.getByText(`${count.toLocaleString('en-IN')} imported records`,{exact:true}).waitFor();
      assert.ok(await page.locator('#view tbody tr').count()>0);
      await page.screenshot({path:path.join(root,`${view}-${size}.png`),fullPage:true});
      await page.locator('.tally-master-fields').first().click();
      await page.locator('#modal[open] pre').waitFor();
      await page.screenshot({path:path.join(root,`${view}-fields-${size}.png`),fullPage:true});
      await page.locator('#modal').evaluate(dialog=>dialog.close());
      const response=await context.request.get(`${base}/api/tally/masters/${kind}?pageSize=1`);
      const result=await response.json();assert.equal(result.pagination.total,count);assert.equal(result.data.length,1);
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({screenshots:root,counts,consoleErrors:errors.length}));
} finally {
  if(browser)await browser.close();
  await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenDigest(token));
  await db.close();
}
