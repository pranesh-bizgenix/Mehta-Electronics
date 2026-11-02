// Real HTTP + native UI against synthetic records in test_<random>, same DATABASE_URL.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { temporaryDatabase } from '../test-support/postgres.js';
import { getConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/security.js';
import { replayVisibilityPayload } from '../src/tally-visibility-replay.js';
import { TALLY_ENTITY_DESCRIPTORS } from '../public/tally-entity-descriptors.js';

const temporary=await temporaryDatabase('tallybrowser');
const password=crypto.randomBytes(18).toString('base64url');
const config=getConfig({databaseUrl:temporary.databaseUrl,seedOwnerEmail:'owner@tally-browser.invalid',seedOwnerPassword:password,mfaEnabled:false});
const db=await openDatabase(config),output=path.resolve('output/tally-visibility-review'),webDir=path.resolve('apps/web');
let server,app,nextServer,browser;
const report={checkedAt:new Date().toISOString(),schema:temporary.schema,checks:[],consoleErrors:[],axe:[]};
try {
  await fs.mkdir(output,{recursive:true});
  await db.sql`UPDATE users SET must_change_password=0`;
  await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('Manager','manager@tally-browser.invalid','MANAGER',${hashPassword(password)},0)`;
  const company=crypto.randomUUID(),connector=crypto.randomUUID(),session=crypto.randomUUID();
  await db.sql`INSERT INTO tally_connectors(id,profile_name,expected_company_name,token_hash) VALUES(${connector},'Browser fixture','Browser fixture','unused')`;
  await db.sql`INSERT INTO tally_upload_sessions(id,connector_id,company_name,sync_from,sync_to,status) VALUES(${session},${connector},'Browser fixture','2026-04-01','2026-10-30','stored')`;
  await db.sql`INSERT INTO tally_companies(id,name) VALUES(${company},'Browser fixture')`;
  await db.sql`INSERT INTO tally_groups(id,company_id,source_key,name,parent_name,raw_record,session_id) VALUES('debtors',${company},'debtors','Sundry Debtors','Primary','{}',${session})`;
  for(let i=0;i<31;i++)await db.sql`INSERT INTO tally_ledgers(id,company_id,source_key,name,parent_name,email,closing_balance,raw_record,session_id)
    VALUES(${`ledger-${i}`},${company},${`ledger-${i}`},${`Customer ${String(i).padStart(2,'0')}`},'Sundry Debtors',${`person-${i}@example.invalid`},123.45,
      ${db.sql.json({'@_NAME':`Customer ${i}`,'LANGUAGENAME.LIST':{'NAME.LIST':{NAME:{'#text':`Deep alias ${i}`}}},CUSTOMFIELD:{'#text':`Custom ${i}`},...(i===30?{HISTORYONLY:{'#text':'history-only needle'}}:{}),CLOSINGBALANCE:{'#text':'secret-finance-98765'}})},${session})`;
  await db.sql`UPDATE tally_ledgers SET raw_record=raw_record-'HISTORYONLY',fetched_at=now() WHERE id='ledger-30'`;
  await db.sql`INSERT INTO tally_stock_items(id,company_id,source_key,name,normalized_part_number,base_unit,closing_quantity_text,closing_rate_text,closing_value,raw_record,session_id)
    VALUES('stock1',${company},'stock1','Switch','SWITCH','NOS','-2 NOS','100.25',200.50,'{"HSNCODE":{"#text":"1234"}}',${session})`;
  for(const entity of ['companies','stock_groups','categories','units','godowns']) {
    const descriptor=TALLY_ENTITY_DESCRIPTORS[entity],content=await fs.readFile(`test/fixtures/tally-real-anonymized/${entity}.xml`,'utf8'),id=crypto.randomUUID();
    await db.sql`INSERT INTO tally_raw_payloads(id,company_id,session_id,dataset,content_hash,content) VALUES(${id},${company},${session},${descriptor.dataset},${crypto.createHash('sha256').update(content).digest('hex')},${content})`;
    await replayVisibilityPayload(db.sql,{id,company_id:company,session_id:session,dataset:descriptor.dataset,content,received_at:new Date().toISOString()});
  }
  for(const [id,parent] of [['vendor','Sundry Creditors'],['bank','Bank Accounts'],['expense','Indirect Expenses'],['other',null]]) {
    if(parent)await db.sql`INSERT INTO tally_groups(id,company_id,source_key,name,parent_name,raw_record,session_id) VALUES(${id+'-group'},${company},${id+'-group'},${parent},'Primary','{}',${session})`;
    await db.sql`INSERT INTO tally_ledgers(id,company_id,source_key,name,parent_name,raw_record,session_id) VALUES(${id},${company},${id},${'Fixture '+id},${parent},'{}',${session})`;
  }
  app=createApp({db,config});server=http.createServer(app);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3996,'127.0.0.1',resolve);});
  const apiPort=server.address().port;
  const webPort=3196;
  const web=`http://127.0.0.1:${webPort}`,env={...process.env,MEHTA_API_URL:`http://127.0.0.1:${apiPort}`,NEXT_DIST_DIR:'.next-tally-visibility',NEXT_TELEMETRY_DISABLED:'1'};
  const nextBin=path.join(webDir,'node_modules/next/dist/bin/next');
  const run=args=>spawn(process.execPath,[nextBin,...args],{cwd:webDir,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  if(!process.env.SKIP_TALLY_BUILD){
    const build=run(['build']);let log='';build.stdout.on('data',d=>{log+=d;});build.stderr.on('data',d=>{log+=d;});
    if(await new Promise(resolve=>build.on('close',resolve))!==0)throw new Error('Native Tally build failed: '+log.slice(-2000));
  }
  nextServer=run(['start','--hostname','127.0.0.1','--port',String(webPort)]);
  nextServer.stdout.on('data',()=>{});nextServer.stderr.on('data',()=>{});
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(`${web}/login`)).ok){ready=true;break;}}catch{/* starting */}await new Promise(resolve=>setTimeout(resolve,250));}
  assert.ok(ready,'Native UI started');
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const role of ['owner','manager']) {
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const login=await context.request.post(`${web}/api/auth/login`,{data:{email:`${role}@tally-browser.invalid`,password}});assert.equal(login.status(),200);
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.consoleErrors.push(e.message));
    await page.goto(`${web}/tally`);await page.getByRole('heading',{level:1,name:'Tally data',exact:true}).waitFor();
    await page.getByText('Awaiting voucher data',{exact:true}).waitFor();
    assert.match(await page.locator('main').innerText(),/Ledger|ledger/);
    if(role==='owner')for(const theme of ['light','dark'])for(const width of [1440,390]){
      await page.emulateMedia({colorScheme:theme});await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);await page.setViewportSize({width,height:width===390?844:1000});
      await page.screenshot({path:path.join(output,`overview-${width}-${theme}.png`),fullPage:true});
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.getByLabel('Screen',{exact:true}).selectOption('browser');
    await page.getByRole('cell',{name:'Customer 00',exact:true}).waitFor();
    assert.match(await page.locator('.ds-table-footer').innerText(),/31 records/);
    await page.getByRole('button',{name:'Next page'}).click();await page.getByRole('cell',{name:'Customer 25',exact:true}).waitFor();
    report.checks.push(`${role}: real pagination, 31 imported records`);
    const input=page.getByLabel('Search all permitted field values');await input.fill('Deep alias 30');
    await page.getByText('1 record',{exact:true}).waitFor();
    await page.getByRole('cell',{name:'Customer 30',exact:true}).waitFor();
    report.checks.push(`${role}: search nested XML alias outside default columns`);
    await page.getByRole('cell',{name:'Customer 30',exact:true}).click();await page.getByRole('heading',{name:'Every parsed XML field',exact:true}).waitFor();
    const drawer=page.locator('.ds-drawer-dialog[open]');
    assert.equal((await drawer.innerText()).includes('secret-finance-98765'),role==='owner');
    if(role==='owner')assert.ok((await drawer.innerText()).includes('Custom 30'));
    await page.screenshot({path:path.join(output,`${role}-detail-1440.png`),fullPage:true});
    await drawer.getByRole('button',{name:'Close',exact:true}).click();
    if(role==='owner') {
      await page.getByRole('button',{name:'Choose columns'}).click();
      await page.getByLabel('XML / CUSTOMFIELD').check();await page.keyboard.press('Escape');
      const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();const download=await downloadPromise;
      await download.saveAs(path.join(output,'filtered.csv'));const csv=await fs.readFile(path.join(output,'filtered.csv'),'utf8');assert.ok(csv.includes('Custom 30'));assert.equal(csv.includes('Customer 00'),false);
      report.checks.push('Owner: selectable custom field + filtered server export');
      await input.fill('history-only needle');await page.getByText('No matching records',{exact:true}).waitFor();
      await page.getByLabel('Snapshots',{exact:true}).selectOption('all');
      await page.getByRole('cell',{name:'Customer 30',exact:true}).waitFor();
      await page.getByRole('cell',{name:'Customer 30',exact:true}).click();
      await page.locator('.ds-drawer-dialog[open]').getByText('history-only needle',{exact:true}).waitFor();
      await page.locator('.ds-drawer-dialog[open]').getByRole('button',{name:'Close',exact:true}).click();
      await page.getByLabel('Snapshots',{exact:true}).selectOption('current');
      report.checks.push('Owner: historical fields remain searchable and open the exact stored snapshot');
    } else {
      await input.fill('secret-finance-98765');await page.getByText('No matching records',{exact:true}).waitFor();
      const forbidden=await context.request.get(`${web}/api/tally/visibility/items?companyId=${company}&sort=/stored/closing_value`);assert.equal(forbidden.status(),422);
      const rawDenied=await context.request.get(`${web}/api/tally/retained/payloads?companyId=${company}`);assert.equal(rawDenied.status(),403);
      report.checks.push('Manager: financial search, sorting, raw payload and detail denied server-side');
    }
    await input.fill('');await page.getByText('31 records',{exact:false}).waitFor();await page.getByRole('cell',{name:'Customer 00',exact:true}).waitFor();
    const axe=await new AxeBuilder({page}).analyze();const serious=axe.violations.filter(v=>['serious','critical'].includes(v.impact));report.axe.push({role,violations:serious.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))});
    if(serious.length)console.log(JSON.stringify(report.axe));
    assert.deepEqual(serious.map(v=>v.id),[]);
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:path.join(output,`${role}-browser-390.png`),fullPage:true});
    if(role==='owner') {
      for(const entity of Object.keys(TALLY_ENTITY_DESCRIPTORS)) {
        await page.setViewportSize({width:1440,height:1000});
        await page.getByLabel('Entity',{exact:true}).selectOption(entity);
        const api=await context.request.get(`${web}/api/v1/tally/visibility/${entity}?companyId=${company}&pageSize=25`);assert.equal(api.status(),200);
        const result=await api.json();
        if(result.data.length) {
          const record=result.data[0];
          try{await page.getByRole('cell',{name:record.display_name,exact:true}).first().waitFor();}catch(error){await page.screenshot({path:path.join(output,`failure-${entity}.png`),fullPage:true});await fs.writeFile(path.join(output,`failure-${entity}.txt`),await page.locator('main').innerText());throw error;}
          await page.getByRole('cell',{name:record.display_name,exact:true}).first().click();
          await page.getByRole('heading',{name:'Every parsed XML field',exact:true}).waitFor();
          const detail=await context.request.get(`${web}/api/v1/tally/visibility/${entity}/${encodeURIComponent(record.record_key)}?companyId=${company}`),body=await detail.json();
          assert.deepEqual(new Set(body.descriptor.fields.map(f=>f.key)),new Set(Object.keys(body.data.fields)));
          assert.equal(await page.locator('.ds-drawer-dialog[open] dl dt').count(),body.descriptor.fields.length,'Every field renders a detail row');
          for(const theme of ['light','dark'])for(const width of [1440,390]) {
            await page.emulateMedia({colorScheme:theme});await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);await page.setViewportSize({width,height:width===390?844:1000});
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
            await page.screenshot({path:path.join(output,`${entity}-detail-${width}-${theme}.png`),fullPage:true});
          }
          await page.locator('.ds-drawer-dialog[open]').getByRole('button',{name:'Close',exact:true}).click();
          report.checks.push(`${entity}: browser, detail and every descriptor field rendered`);
        }else{
          await page.getByText(entity==='vouchers'?'Awaiting voucher data':'No imported records',{exact:true}).waitFor();
          report.checks.push(`${entity}: honest unavailable collection state (no fixture invented)`);
        }
        for(const theme of ['light','dark'])for(const width of [1440,390]) {
          await page.emulateMedia({colorScheme:theme});await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);await page.setViewportSize({width,height:width===390?844:1000});
          await page.screenshot({path:path.join(output,`${entity}-browser-${width}-${theme}.png`),fullPage:true});
        }
      }
    }
    await context.close();
  }
  assert.deepEqual(report.consoleErrors,[]);
  report.checks.push('Desktop/mobile, no page errors, no serious/critical accessibility findings');
  await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({checks:report.checks,output,consoleErrors:report.consoleErrors,axe:report.axe}));
} finally {
  await browser?.close();
  if(nextServer){nextServer.kill();await new Promise(resolve=>{if(nextServer.exitCode!==null)resolve();else nextServer.once('close',resolve);});}
  if(server)await new Promise(resolve=>server.close(resolve));
  await app?.close?.();await db.close();await temporary.close();
}
