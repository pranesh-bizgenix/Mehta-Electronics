import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {temporaryDatabase} from '../test-support/postgres.js';
import {getConfig} from '../src/config.js';
import {openDatabase} from '../src/db.js';
import {createApp} from '../src/app.js';
import {createControlDeskServer} from '../src/controldesk-server.js';
import {hashPassword} from '../src/security.js';

const temporary=await temporaryDatabase('combined');
const dev=process.argv.includes('--dev');
if(dev){process.env.NEXT_DIST_DIR='.next-dev';process.env.NODE_ENV='development';}
const password=crypto.randomBytes(24).toString('base64url');
const config=getConfig({databaseUrl:temporary.databaseUrl,seedOwnerEmail:'owner@combined.invalid',seedOwnerPassword:password,mfaEnabled:false,schedulerEnabled:false});
let db,api,combined,browser;
const output=path.resolve('output/combined-controldesk');
const report={mode:dev?'development':'production',checkedAt:new Date().toISOString(),checks:[],pageErrors:[],screenshots:[]};
try{
 db=await openDatabase(config);await fs.mkdir(output,{recursive:true});
 await db.sql`UPDATE users SET must_change_password=0`;
 const owner=(await db.sql`SELECT id FROM users WHERE email='owner@combined.invalid'`)[0];
 await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('Manager','manager@combined.invalid','MANAGER',${hashPassword(password)},0)`;
 await db.sql`INSERT INTO customers(name,normalized_name,created_by,updated_by) VALUES('Combined customer','combined customer',${owner.id},${owner.id})`;
 api=createApp({db,config});combined=await createControlDeskServer({api,port:0,dev});
 await new Promise((resolve,reject)=>{combined.server.once('error',reject);combined.server.listen(0,'127.0.0.1',resolve);});
 const origin=`http://127.0.0.1:${combined.server.address().port}`;
 assert.equal((await fetch(origin+'/api/health')).status,200);
 assert.equal((await fetch(origin+'/quotation-print.css')).status,200);
 assert.equal((await fetch(origin+'/api/auth/me')).status,401);
 assert.equal((await fetch(origin+'/api/connectors/company-config')).status,401);
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const login=await context.request.post(origin+'/api/auth/login',{data:{email:'owner@combined.invalid',password}});assert.equal(login.status(),200);
 const csrf=(await login.json()).csrfToken;
 const page=await context.newPage();page.setDefaultTimeout(dev?90000:15000);page.on('pageerror',error=>report.pageErrors.push(error.message));
 await page.goto(origin+'/customers');await page.getByText('Combined customer',{exact:true}).waitFor();
 assert.equal(new URL(page.url()).origin,origin);report.checks.push('CRM customers and authenticated API share one origin and session');
 await page.getByRole('link',{name:'Tally & reconciliation',exact:true}).click();await page.getByRole('heading',{level:1,name:'Tally data',exact:true}).waitFor();
 assert.equal(new URL(page.url()).origin,origin);report.checks.push('Native Tally browser opens within the same application');
 await page.getByRole('link',{name:'Tally connector',exact:true}).click();await page.getByRole('heading',{level:1,name:'Tally connection',exact:true}).waitFor();
 await page.getByText('No connector configured',{exact:true}).waitFor();
 assert.equal(new URL(page.url()).origin,origin);assert.equal(await page.getByRole('link',{name:'Open existing screens',exact:true}).count(),0);
 await page.getByRole('button',{name:'Configure connector',exact:true}).click();
 const dialog=page.locator('.ds-dialog[open]');
 await dialog.getByRole('textbox',{name:/^Profile name/}).fill('Combined fixture PC');
 await dialog.getByRole('textbox',{name:/^Exact company name/}).fill('Combined fixture company');
 const issuedResponse=page.waitForResponse(r=>r.url().endsWith('/api/tally-connector/pairing')&&r.request().method()==='POST');
 await dialog.getByRole('button',{name:'Generate pairing code',exact:true}).click();
 const issued=await issuedResponse;assert.equal(issued.status(),201);const pairing=(await issued.json()).pairing;
 assert.equal(pairing.apiBaseUrl,origin);
 // Credentials are held only in memory and never logged, persisted, or screenshotted.
 const pair=await context.request.post(origin+'/api/connectors/pair',{data:{pairingCode:pairing.pairingCode,installationId:crypto.randomUUID(),machineName:'Fixture Tally PC',agentVersion:'test-only'}});
 assert.equal(pair.status(),200);const access=(await pair.json()).accessToken;
 assert.equal((await context.request.post(origin+'/api/connectors/heartbeat',{headers:{authorization:`Bearer ${access}`},data:{machineName:'Fixture Tally PC',agentVersion:'test-only',tallyAvailable:true,selectedCompany:'Combined fixture company',openCompanies:['Combined fixture company']}})).status(),200);
 await page.locator('.ds-dialog[open]').getByRole('button',{name:'Done — check connection',exact:true}).click();
 await page.getByRole('heading',{name:'Awaiting first sync',exact:true}).waitFor();
 const state=await context.request.get(origin+'/api/tally-connector/status');assert.equal(state.status(),200);const status=await state.json();
 assert.equal(status.connectors[0].machine_name,'Fixture Tally PC');assert.equal(status.connectors[0].connection_state,'awaiting_first_sync');assert.equal(JSON.stringify(status).includes(access),false);assert.equal(JSON.stringify(status).includes(pairing.pairingCode),false);
 const audits=await db.sql`SELECT action FROM audit_logs WHERE entity='TALLY_CONNECTOR'`;
 assert.ok(audits.some(a=>a.action==='PAIRING_CODE_ISSUED'));
 report.checks.push('Native connector setup, pairing, authenticated heartbeat, exact company binding and audited issuance work on the same listener');
 assert.equal((await context.request.post(origin+'/api/connectors/heartbeat',{headers:{authorization:`Bearer ${access}`},data:{machineName:'Fixture Tally PC',tallyAvailable:true,selectedCompany:'Wrong company'}})).status(),403);
 await page.getByRole('button',{name:'Configure connector',exact:true}).click();
 const engineDialog=page.locator('.ds-dialog[open]');
 await engineDialog.getByRole('combobox',{name:'Software installed on the Tally PC',exact:true}).selectOption('engine');
 await engineDialog.getByRole('textbox',{name:/^Profile name/}).fill('Existing Engine fixture');
 await engineDialog.getByRole('textbox',{name:/^Exact company name/}).fill('Combined fixture company');
 const setupResponse=page.waitForResponse(r=>r.url().endsWith('/api/tally-connector/setup')&&r.request().method()==='POST');
 await engineDialog.getByRole('button',{name:'Generate Engine setup',exact:true}).click();
 const setupResult=await setupResponse;assert.equal(setupResult.status(),201);const setup=(await setupResult.json()).setup;assert.ok(setup.token);assert.ok(setup.orgId);
 await page.locator('.ds-dialog[open]').getByRole('textbox',{name:'ControlDesk address',exact:true}).waitFor();
 assert.equal(await page.locator('.ds-dialog[open]').getByRole('textbox',{name:'ControlDesk address',exact:true}).inputValue(),origin);
 await page.locator('.ds-dialog[open]').getByRole('button',{name:/^Done/}).click();
 await page.getByRole('combobox',{name:'Connector profile',exact:true}).selectOption(pairing.id);
 await page.getByRole('heading',{name:'Awaiting first sync',exact:true}).waitFor();
 report.checks.push('Existing Node.js Engine setup works in the same configuration screen; private setup token is only shown at issuance');

 for(const theme of ['light','dark'])for(const width of [1440,390]){
  await page.emulateMedia({colorScheme:theme});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.setViewportSize({width,height:width===390?844:1000});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  const filename=`connector-${width}-${theme}.png`;await page.screenshot({path:path.join(output,filename),fullPage:true});report.screenshots.push(filename);
 }
 const accessibility=await new AxeBuilder({page}).disableRules(['color-contrast']).analyze();assert.deepEqual(accessibility.violations.filter(v=>['serious','critical'].includes(v.impact)),[]);
 report.checks.push('Connector screen has desktop/mobile light/dark captures and no serious structural accessibility issues');
 const manager=await browser.newContext();assert.equal((await manager.request.post(origin+'/api/auth/login',{data:{email:'manager@combined.invalid',password}})).status(),200);
 assert.equal((await manager.request.get(origin+'/api/tally-connector/status')).status(),403);
 assert.equal((await manager.request.post(origin+'/api/tally-connector/pairing',{headers:{'X-CSRF-Token':csrf},data:{profileName:'Disallowed',companyName:'Disallowed',apiBaseUrl:origin}})).status(),403);
 const managerPage=await manager.newPage();await managerPage.goto(origin+'/tally/connector');await managerPage.getByText('Connector configuration is restricted',{exact:true}).waitFor();
 report.checks.push('Manager denied connector administration on API and screen');
 assert.deepEqual(report.pageErrors,[]);
 await fs.writeFile(path.join(output,dev?'verification-dev.json':'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){console.error('Combined verification failed:',error.name,String(error.message).split('\n')[0]);process.exitCode=1;}finally{
 await browser?.close();
 const closing=combined?.close();
 await api?.close();await db?.close();await temporary.close();
 if(dev){await Promise.race([closing,new Promise(resolve=>setTimeout(resolve,5000))]);}
 else await closing;
}
// The Next development watcher can retain handles after its public close API.
// All database connections and the isolated schema are already cleaned above.
if(dev)process.exit(process.exitCode||0);
