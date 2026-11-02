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
import {seedDemoData} from './lib/demo-data.mjs';
import {saveQuotePolicy,saveQuoteCost,saveQuote} from '../src/quotation-workflow.js';
import {replayVisibilityPayload} from '../src/tally-visibility-replay.js';
import {TALLY_ENTITY_DESCRIPTORS} from '../public/tally-entity-descriptors.js';

// Only synthetic/anonymised acceptance fixtures in test_<random>. No main app server.
const temporary=await temporaryDatabase('visualreview');
const password=crypto.randomBytes(24).toString('base64url');
const config=getConfig({databaseUrl:temporary.databaseUrl,seedOwnerEmail:'owner@visual.invalid',seedOwnerPassword:password,mfaEnabled:false,schedulerEnabled:false});
const output=path.resolve('output/ui-redesign');
const report={checkedAt:new Date().toISOString(),fixture:'isolated test schema; no production records',screenshots:[],checks:[],pageErrors:[],overflow:[],accessibility:[]};
let db,api,combined,browser;
try{
 db=await openDatabase(config);await fs.mkdir(output,{recursive:true});
 await db.sql`UPDATE users SET must_change_password=0,name='Review Owner'`;
 await seedDemoData(db);
 const owner={id:(await db.sql`SELECT id FROM users WHERE role='OWNER' ORDER BY id LIMIT 1`)[0].id,role:'OWNER'};
 await saveQuotePolicy(db,{floorPercent:'15',marginBasis:'LINE_AND_TOTAL',sellerState:'27',letterhead:{name:'Review company',address:'Synthetic review address',gstin:'',email:'review@example.invalid',phone:''},reason:'Synthetic visual acceptance policy only'},owner);
 const products=await db.sql`SELECT id FROM items ORDER BY id`;
 for(const item of products)await saveQuoteCost(db,item.id,{unitCost:'100',reason:'Synthetic visual acceptance cost only'},owner);
 for(const customer of await db.sql`SELECT id FROM customers ORDER BY id`)await saveQuote(db,null,{customerId:customer.id,validUntil:'2099-12-31',placeOfSupply:'27',supplyType:'DOMESTIC_STANDARD',terms:'Payment within 30 days',reason:'Synthetic visual acceptance quotation',lines:[{itemId:products[0].id,quantity:'12',unitPrice:'3450',discountPercent:'0',taxPercent:'18'}]},owner);
 const company=crypto.randomUUID(),connector=crypto.randomUUID(),session=crypto.randomUUID();
 await db.sql`INSERT INTO tally_connectors(id,profile_name,expected_company_name,token_hash,machine_name,last_seen_at,last_sync_at) VALUES(${connector},'Main office · Tally PC','Review company','unused-fixture','OFFICE-PC',now(),now())`;
 await db.sql`INSERT INTO tally_companies(id,name) VALUES(${company},'Review company')`;
 await db.sql`INSERT INTO tally_connector_heartbeats(connector_id,tally_available,selected_company) VALUES(${connector},true,'Review company')`;
 await db.sql`INSERT INTO tally_upload_sessions(id,connector_id,company_name,sync_from,sync_to,status) VALUES(${session},${connector},'Review company','2026-04-01','2026-11-02','stored')`;
 for(const entity of ['groups','ledgers','items','units','godowns']){
  const content=await fs.readFile(`test/fixtures/tally-real-anonymized/${entity}.xml`,'utf8'),id=crypto.randomUUID(),dataset=TALLY_ENTITY_DESCRIPTORS[entity].dataset;
  await db.sql`INSERT INTO tally_raw_payloads(id,company_id,session_id,dataset,content_hash,content) VALUES(${id},${company},${session},${dataset},${crypto.createHash('sha256').update(content).digest('hex')},${content})`;
  await replayVisibilityPayload(db.sql,{id,company_id:company,session_id:session,dataset,content,received_at:new Date().toISOString()});
 }
 api=createApp({db,config});combined=await createControlDeskServer({api,port:0});
 await new Promise((resolve,reject)=>{combined.server.once('error',reject);combined.server.listen(0,'127.0.0.1',resolve);});
 const origin=`http://127.0.0.1:${combined.server.address().port}`;
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Kolkata',reducedMotion:'reduce'});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.goto(origin+'/login');await page.getByRole('textbox',{name:/Email/}).waitFor();
 await page.screenshot({path:path.join(output,'login-1440-light.png'),fullPage:true});
 assert.equal((await context.request.post(origin+'/api/auth/login',{data:{email:'owner@visual.invalid',password}})).status(),200);
 const routes=['dashboard','customers','customers/1','enquiries','quotations','quotations/new','orders','items','purchasing','operations','contracts?customerId=1','tally','tally/connector','rules','users','tasks','exceptions','work','messages','settings','audit'];
 for(const route of (process.env.UI_REVIEW_ROUTES?.split(',')||routes)){
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/'+route);await page.getByRole('heading',{level:1}).first().waitFor();await page.waitForLoadState('networkidle');
  if(route==='customers')await page.getByText('Apex Automation Systems',{exact:true}).waitFor();
  const key=route.replaceAll('/','-').replace(/[?=&]/g,'-');
  for(const theme of ['light','dark'])for(const width of [1440,390]){
   await page.emulateMedia({colorScheme:theme});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.setViewportSize({width,height:width===390?844:1000});
   if(!await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1))report.overflow.push({route,width,elements:await page.evaluate(()=>[...document.querySelectorAll('main *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(el=>({tag:el.tagName,class:el.className,right:el.getBoundingClientRect().right})))});
   const filename=`${key}-${width}-${theme}.png`;await page.screenshot({path:path.join(output,filename),fullPage:true});report.screenshots.push(filename);
  }
  await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({colorScheme:'light'});await page.evaluate(()=>document.documentElement.dataset.theme='light');await page.waitForTimeout(200);
  const audit=await new AxeBuilder({page}).analyze();const serious=audit.violations.filter(v=>['serious','critical'].includes(v.impact));
  report.accessibility.push({route,findings:serious.map(v=>({id:v.id,targets:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))});
  report.checks.push(`${route}: desktop/mobile light/dark captured`);
 }
 await page.goto(origin+'/customers');await page.getByRole('button',{name:'New customer',exact:true}).click();
 const modal=page.locator('.ds-dialog[open]');await modal.getByRole('textbox').first().waitFor();
 for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});await page.screenshot({path:path.join(output,`customer-form-${width}-light.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));}
 await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('navigation',{name:'Main',exact:true}).getByRole('link',{name:'Dashboard',exact:true}).waitFor();
 await page.getByRole('navigation',{name:'Main',exact:true}).getByRole('link',{name:'Dashboard',exact:true}).click();await page.getByRole('heading',{level:1}).waitFor();
 report.checks.push('Customer form, keyboard dismissal, mobile navigation and drawer close verified');
 assert.deepEqual(report.pageErrors,[]);
 await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2));
 assert.deepEqual(report.overflow,[],'No screen may overflow the viewport');
 assert.deepEqual(report.accessibility.flatMap(result=>result.findings),[],'No serious or critical accessibility findings');
 console.log(JSON.stringify({checks:report.checks,screenshots:report.screenshots.length,pageErrors:report.pageErrors,overflow:report.overflow,accessibility:report.accessibility}));
}catch(error){console.error('UI review failed:',error.name,String(error.message).split('\n')[0]);process.exitCode=1;}finally{await browser?.close();const closing=combined?.close();await api?.close();await db?.close();await temporary.close();await closing;}
