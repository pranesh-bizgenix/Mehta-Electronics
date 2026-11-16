import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';
import {assertCurrentDatabase} from '../src/database-guard.js';
import {DecisionCatalog} from '../src/modules/decisions/catalog.js';

// Serve only built files through Playwright interception. No listener, external
// network, real document, retained fixture or application write is required.
const db=connectPostgres(getConfig().databaseUrl);
try{await assertCurrentDatabase(db);}finally{await db.end({timeout:5});}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const build=path.join(root,'apps/web/.next');
const catalog=new DecisionCatalog();
const rows=catalog.all().map(definition=>({...catalog.metadata(definition),value:null,status:'EMPTY',version:0,evidenceSource:null,confirmedBy:null,confirmedAt:null}));
const summary={total:rows.length,confirmed:0,blocked:rows.length,confirmedPercent:0,onlyOneOwner:true};
const browser=await chromium.launch({headless:true});
let checks=0,role='OWNER',decisionReads=0;
const errors=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  assert.equal(url.origin,'http://127.0.0.1:3000','Browser review must not contact another origin.');
  if(url.pathname.startsWith('/api/')){
   assert.equal(request.method(),'GET','This browser review must not write.');
   const reply=body=>route.fulfill({json:body});
   if(url.pathname==='/api/auth/me')return reply({user:{id:987000,name:'VERIFY- browser Owner',email:'VERIFY-review@example.test',role,status:'ACTIVE',mustChangePassword:false},permissions:['*'],csrfToken:'VERIFY- browser csrf',mfa:{required:false,enrolled:false,verified:false}});
   if(url.pathname==='/api/v1/decisions'){decisionReads++;return reply({data:rows,summary});}
   if(url.pathname.endsWith('/history'))return reply({data:[]});
   if(url.pathname==='/api/v1/me/preferences')return reply({data:{theme:'light',sidebarCollapsed:false}});
   if(url.pathname==='/api/v1/me/badges')return reply({data:{}});
   return reply({data:[]});
  }
  const relative=decodeURIComponent(url.pathname);
  let file;
  if(relative.startsWith('/_next/static/'))file=path.resolve(build,'static',relative.slice('/_next/static/'.length));
  else file=path.resolve(build,'server/app',`${relative.slice(1)||'index'}.${request.headers().rsc?'rsc':'html'}`);
  if(!file.startsWith(build+path.sep))throw new Error('Unsafe built-file path.');
  try{
   const body=await fs.readFile(file),ext=path.extname(file),contentType={'.html':'text/html; charset=utf-8','.rsc':'text/x-component','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2'}[ext]??'application/octet-stream';
   return route.fulfill({body,contentType});
  }catch(error){if(error.code!=='ENOENT')throw error;return route.fulfill({status:404,body:'No built review file'});}
 });
 const check=async(name,run)=>{await run();checks++;console.log(`PASS: ${name}`);};
 await check('Owner register renders current questions, blocked state, source suggestions and exact fix links',async()=>{
  await page.goto('http://127.0.0.1:3000/decisions');
  await page.getByRole('heading',{name:'Business decisions',exact:true}).waitFor();
  await page.getByRole('button',{name:'Enter answer'}).first().waitFor();
  assert.ok(decisionReads>0);
  assert.equal(await page.getByRole('link',{name:'Export decision sheet'}).getAttribute('href'),'/api/v1/decisions/sheet');
  assert.ok(await page.getByText('Not set — blocks:',{exact:false}).count()>0);
  for(const href of await page.getByRole('link',{name:'Open affected screen'}).evaluateAll(links=>links.map(link=>link.getAttribute('href'))))assert.ok(href.startsWith('/')&&!href.startsWith('//'));
 });
 await check('direct setting editor starts empty, requires a reason and does not confirm automatically',async()=>{
  await page.getByPlaceholder('Find a question, setting or workflow').fill('margin.floor_percent');
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].filter(button=>button.textContent==='Enter answer').length===1);
  await page.getByRole('button',{name:'Enter answer',exact:true}).click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert.equal(await dialog.getByRole('textbox',{name:/^Owner.*answer$/}).inputValue(),'');
  assert.equal(await dialog.getByRole('checkbox').isChecked(),false);
  assert.equal(await dialog.getByRole('button',{name:'Save as Entered',exact:true}).isDisabled(),true);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 });
 await check('sensitive view shows staff/time watermark and conceals page and drawer when focus is lost',async()=>{
  await page.waitForSelector('.ds-sensitive-watermark');
  assert.match(await page.locator('.ds-sensitive-stamps').innerText(),/VERIFY- browser Owner.*ID 987000/);
  await page.evaluate(()=>{Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});window.dispatchEvent(new Event('blur'));});
  assert.equal(await page.locator('html').getAttribute('data-sensitive-screen'),'concealed');
  assert.notEqual(await page.locator('.ds-content').evaluate(element=>getComputedStyle(element).filter),'none');
  await page.evaluate(()=>{Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});window.dispatchEvent(new Event('focus'));});
  assert.equal(await page.locator('html').getAttribute('data-sensitive-screen'),'visible');
 });
 await check('mobile layout fits and print contains the decision sheet',async()=>{
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.emulateMedia({media:'print'});
  assert.equal(await page.getByRole('region',{name:'Printable business decision sheet'}).isVisible(),true);
  assert.equal(await page.locator('.decisions-interactive').isVisible(),false);
  await page.emulateMedia({media:'screen'});
 });
 await check('a non-Owner with broad grants cannot load or edit the register',async()=>{
  const reads=decisionReads;role='MANAGER';await page.goto('http://127.0.0.1:3000/decisions');
  await page.getByText('Only Owner with business-rule management access can review or confirm decisions.',{exact:true}).waitFor();
  assert.equal(decisionReads,reads);assert.equal(await page.getByRole('button',{name:'Enter answer'}).count(),0);
 });
 assert.deepEqual(errors,[],'Built review must have no uncaught browser errors.');
 await context.close();console.log(`${checks} passed, 0 failed, 0 skipped. Intercepted fixtures only; no listener or real API write.`);
}finally{await browser.close();}
