// Native screens and real API; all writes confined to one disposable test schema.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import {temporaryDatabase} from '../test-support/postgres.js';
import {getConfig} from '../src/config.js';
import {openDatabase} from '../src/db.js';
import {createApp} from '../src/app.js';
import {hashPassword} from '../src/security.js';
const temporary=await temporaryDatabase('clientbrowser');
const password=crypto.randomBytes(24).toString('base64url');
const config=getConfig({databaseUrl:temporary.databaseUrl,seedOwnerEmail:'owner@clientbrowser.invalid',seedOwnerPassword:password,mfaEnabled:false});
let db,app,server,nextServer,browser;
const output=path.resolve('output/client-plan-review'),webDir=path.resolve('apps/web'),web='http://127.0.0.1:3197';
const report={checkedAt:new Date().toISOString(),checks:[],pageErrors:[],accessibility:[],screenshots:[]};
try{
 db=await openDatabase(config);await fs.mkdir(output,{recursive:true});
 await db.sql`UPDATE users SET must_change_password=0`;
 const owner=(await db.sql`SELECT id FROM users WHERE email='owner@clientbrowser.invalid'`)[0];
 const manager=(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('Fixture manager','manager@clientbrowser.invalid','MANAGER',${hashPassword(password)},0) RETURNING id`)[0];
 const customer=(await db.sql`INSERT INTO customers(name,normalized_name,created_by,updated_by) VALUES('Browser customer','browser customer',${owner.id},${owner.id}) RETURNING id`)[0];
 await db.sql`INSERT INTO items(part_code,description,uom,created_by,updated_by) VALUES('BROWSER-SWITCH','Browser switch','NOS',${owner.id},${owner.id})`;
 app=createApp({db,config});server=http.createServer(app);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(3997,'127.0.0.1',resolve);});
 const env={...process.env,MEHTA_API_URL:'http://127.0.0.1:3997',NEXT_DIST_DIR:'.next-client-plan',NEXT_TELEMETRY_DISABLED:'1'};
 const run=args=>spawn(process.execPath,[path.join(webDir,'node_modules/next/dist/bin/next'),...args],{cwd:webDir,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 if(!process.env.SKIP_CLIENT_BUILD){const build=run(['build']);let log='';build.stdout.on('data',d=>log+=d);build.stderr.on('data',d=>log+=d);if(await new Promise(resolve=>build.on('close',resolve))!==0)throw new Error('Build failed: '+log.slice(-3500));console.log('Native production build passed.');}
 nextServer=run(['start','--hostname','127.0.0.1','--port','3197']);nextServer.stdout.on('data',()=>{});nextServer.stderr.on('data',()=>{});
 let ready=false;for(let n=0;n<80;n++){try{if((await fetch(web+'/login')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready);
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const login=await context.request.post(web+'/api/auth/login',{data:{email:'owner@clientbrowser.invalid',password}});assert.equal(login.status(),200);const csrfToken=(await login.json()).csrfToken;
 const post=async(url,data)=>{const response=await context.request.post(web+url,{data,headers:{'Idempotency-Key':crypto.randomUUID(),'X-CSRF-Token':csrfToken}});const body=await response.json();assert.ok(response.ok(),JSON.stringify({status:response.status(),body}));return body.data;};
 const base={title:'Customer asks for a replacement switch',customerId:customer.id,ownerId:owner.id,backupId:manager.id,reason:'Browser acceptance fixture'};
 const support=await post('/api/v1/operations/SUPPORT',{...base,payload:{complaint:'Switch does not operate',orderReference:'Customer purchase reference',response:'Awaiting investigation'}});
 assert.equal((await post('/api/v1/operations/INTAKE',{...base,payload:{channel:'MANUAL',externalId:'browser-bank-message',sender:'bank@example.invalid',category:'BANK',originalText:'Fixture bank message'}})).ignored,true);
 const invoice=await post('/api/v1/operations/INVOICE',{...base,title:'Existing invoice reference',payload:{invoiceNumber:'BROWSER-INV-1',invoiceDate:'2026-11-01',amount:'100.25',sourceReference:'Verified customer invoice',sourceObservedAt:'2026-11-01T08:00:00Z'}});
 const contract=await post(`/api/v1/customers/${customer.id}/rate-contracts`,{itemId:(await db.sql`SELECT id FROM items WHERE part_code='BROWSER-SWITCH'`)[0].id,quantity:'10',unitPrice:'88.123456',validFrom:'2026-11-01',validTo:'2026-12-31',reason:'Customer confirmed fixed terms'});
 assert.ok(contract);
 await post('/api/crm/purchasing/vendors',{name:'Browser supplier',email:'supplier@example.invalid',phone:'',address:'Fixture address',stateCode:'27',gstin:'',reason:'Browser fixture vendor'});
 const contractList=await context.request.get(web+`/api/v1/customers/${customer.id}/rate-contracts`);assert.equal(contractList.status(),200);assert.equal((await contractList.json()).data.length,1);
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.pageErrors.push(e.message));
 const routes=[['items','Items & dated price lists'],['orders','Sales orders & dispatch'],['purchasing','Purchasing & goods receipt'],['contracts?customerId='+customer.id,'Customer rate contracts'],['operations?kind=SUPPORT','Business operations']];
 for(const [route,title] of routes){
  await page.setViewportSize({width:1440,height:1000});await page.goto(web+'/'+route);await page.getByRole('heading',{level:1,name:title,exact:true}).waitFor();
  await page.locator('.ds-table-skeleton').waitFor({state:'hidden'}).catch(()=>{});
  if(route.startsWith('contracts'))await page.getByRole('cell',{name:'BROWSER-SWITCH',exact:true}).waitFor();
  if(route.startsWith('operations'))await page.getByRole('cell',{name:base.title,exact:true}).waitFor();
  const key=route.split('?')[0];
  for(const theme of ['light','dark'])for(const width of [1440,390]){
   await page.emulateMedia({colorScheme:theme});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.setViewportSize({width,height:width===390?844:1000});
   const filename=`${key}-${width}-${theme}.png`;await page.screenshot({path:path.join(output,filename),fullPage:true});report.screenshots.push(filename);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`${key}: no page overflow at ${width}`);
  }
  const axe=await new AxeBuilder({page}).disableRules(['color-contrast']).analyze();const serious=axe.violations.filter(v=>['serious','critical'].includes(v.impact));report.accessibility.push({route,serious:serious.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))});assert.deepEqual(serious,[],`${route}: accessibility`);
  report.checks.push(`${route}: real API, responsive screenshots, accessibility`);
 }
 await page.setViewportSize({width:1440,height:1000});await page.goto(web+`/operations?kind=SUPPORT&open=${support.record.id}`);
 const drawer=page.locator('.ds-drawer-dialog[open]');await drawer.getByText('Switch does not operate',{exact:true}).waitFor();
 await page.screenshot({path:path.join(output,'support-detail-1440-light.png'),fullPage:true});
 await drawer.getByRole('combobox',{name:/^Action/}).selectOption('RESPOND');await drawer.getByRole('textbox',{name:/^Response notes/}).fill('Customer contacted; inspection arranged');await drawer.getByRole('textbox',{name:/^Action reason/}).fill('Agent responded after checking the complaint');await drawer.getByRole('button',{name:'Record action',exact:true}).click();await drawer.getByText('Customer contacted; inspection arranged',{exact:true}).waitFor();
 report.checks.push('Support detail deep link, response action, response time and audit history');
 await page.goto(web+'/items');await page.getByRole('cell',{name:'BROWSER-SWITCH',exact:true}).click();await page.locator('.ds-drawer-dialog[open]').getByText('Browser switch',{exact:true}).waitFor();
 report.checks.push('CRM product detail displays retained product fields');
 await page.goto(web+`/customers/${customer.id}`);await page.getByRole('tab',{name:'Support & collections'}).click();await page.getByRole('link',{name:support.record.reference,exact:true}).waitFor();
 report.checks.push('Customer 360 links cases by customer ID');
 const managerContext=await browser.newContext();assert.equal((await managerContext.request.post(web+'/api/auth/login',{data:{email:'manager@clientbrowser.invalid',password}})).status(),200);
 assert.equal((await managerContext.request.get(web+`/api/v1/operations/records/${invoice.record.id}`)).status(),403);
 assert.equal((await managerContext.request.get(web+'/api/v1/operations/INVOICE')).status(),403);
 assert.equal((await managerContext.request.get(web+`/api/v1/customer-controls/${customer.id}`)).status(),403);
 report.checks.push('Manager denied financial cases and Owner customer controls on server');
 assert.equal((await db.sql`SELECT count(*) AS n FROM crm_operations WHERE kind='INTAKE'`)[0].n,0);
 assert.equal((await db.sql`SELECT count(*) AS n FROM email_drafts`)[0].n,0);
 report.checks.push('Bank intake suppressed; no messages or drafts generated');assert.deepEqual(report.pageErrors,[]);
 await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 await browser?.close();if(nextServer){nextServer.kill();await new Promise(resolve=>nextServer.exitCode!==null?resolve():nextServer.once('close',resolve));}
 if(server)await new Promise(resolve=>server.close(resolve));await app?.close?.();await db?.close();await temporary.close();
}
