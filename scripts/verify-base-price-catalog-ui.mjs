import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {createControlDeskServer} from '../src/controldesk-server.js';
import {baseCatalogPage} from '../src/modules/pricing/base-catalog.js';
const output='verification-output/base-price-catalog';fs.mkdirSync(output,{recursive:true});
let app,browser;const report={mode:'Intercepted read-only browser APIs; no database',checks:[],errors:[]};
try{
 if(!process.argv.includes('--existing-server')){app=await createControlDeskServer({port:3000,api:(req,res)=>{res.writeHead(503);res.end();}});await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(3000,'127.0.0.1',resolve);});}
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});let permissions=['items.read','items.list_price.read'];
 await page.route('**/api/**',async route=>{const p=new URL(route.request().url()),path=p.pathname;let body={data:[]};
  assert.equal(route.request().method(),'GET');
  if(path==='/api/auth/me')body={user:{id:201,name:'Sample reader',email:'sample@example.test',role:'EXECUTIVE',status:'ACTIVE',mustChangePassword:false},permissions,csrfToken:'SAMPLE',mfa:{required:false,verified:true,enrolled:false}};
  else if(path==='/api/v1/me/preferences')body={data:{theme:'light',density:'comfortable',sidebarCollapsed:false,savedFilters:{}}};
  else if(path==='/api/v1/me/badges')body={data:{}};
  else if(path==='/api/tally-write/banner')body={data:{live:false}};
  else if(path==='/api/crm/base-price-catalog')body=baseCatalogPage(p.searchParams);
  else if(path==='/api/crm/items')body={data:[],pagination:{page:1,pageSize:25,total:0,pages:0}};
  await route.fulfill({json:body});
 });
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:3000/items',{waitUntil:'networkidle'});
 const table=page.getByRole('table',{name:'Master base price list',exact:true});await table.waitFor();assert.equal(await table.locator('tbody tr').count(),25);report.checks.push('Master base list opens with 25 source rows');
 await page.getByPlaceholder('Search Excel article code or description').fill('3KA81512TE00');await page.waitForFunction(()=>Array.from(document.querySelectorAll('table')).some(t=>t.querySelector('caption')?.textContent==='Master base price list'&&t.querySelectorAll('tbody tr').length===1));
 assert.match(await table.innerText(),/6,590/);report.checks.push('Exact article search shows master INR 6590, without level discount');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:output+'/mobile.png',fullPage:true});report.checks.push('Mobile view captured');
 permissions=['items.read'];await page.reload({waitUntil:'networkidle'});assert.equal(await page.getByRole('heading',{name:'Master base price list',exact:true}).count(),0);report.checks.push('Internal pricing hidden without list-price permission');
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{fs.writeFileSync(output+'/report.json',JSON.stringify(report,null,2));await browser?.close();if(app)await new Promise(resolve=>app.server.close(resolve));}
console.log(JSON.stringify(report));
