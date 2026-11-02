// Read-only preview: real imported data/service, isolated browser session; no production auth or writes.
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {getConfig} from '../src/config.js';
import {createDatabase} from '../src/postgres.js';
import {TallyVisibilityService} from '../src/tally-visibility-service.js';
const db=createDatabase(getConfig()),service=new TallyVisibilityService(db),owner={id:1,role:'OWNER'};
const output='output/tally-sales-review';await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({headless:true});const context=await browser.newContext();const errors=[],requests=[];
try{
 const companies=await db.prepare('SELECT id,name,name AS display_name FROM tally_companies ORDER BY name,id').all();
 await context.route('**/api/**',async route=>{
  const u=new URL(route.request().url()),p=u.pathname;let data={data:[]};
  try{
   if(route.request().method()!=='GET')return route.fulfill({status:405,contentType:'application/json',body:'{"error":"Read-only preview"}'});
   if(p==='/api/auth/me')data={user:{id:1,name:'Source data preview',role:'OWNER',status:'ACTIVE'},permissions:['*'],csrfToken:'preview-only',mfa:{required:false,verified:true}};
   else if(p.includes('read-companies'))data={data:companies};
   else if(p.includes('/preferences'))data={data:{theme:'light',density:'comfortable',sidebarCollapsed:false,savedFilters:{}}};
   else if(p.includes('/badges'))data={data:{}};
   else if(p.match(/\/inspection\/(quotations|enquiries)\/sync/))data=await service.salesSummary(p.split('/')[5],u,owner);
   else if(p.includes('/visibility/')){const parts=p.split('/'),kind=parts[5];data=parts[6]?await service.detail(kind,decodeURIComponent(parts[6]),u,owner):await service.list(kind,u,owner);requests.push({path:p,total:data.pagination?.total});}
   else if(p.includes('/quotations'))data={data:[],pagination:{page:1,pageSize:25,total:0,pages:0},legacyCount:0};
   else if(p.includes('/enquiries'))data={data:[],pagination:{page:1,pageSize:25,total:0,pages:0}};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  }catch(e){errors.push(e.message);await route.fulfill({status:e.status||500,contentType:'application/json',body:JSON.stringify({error:e.message})});}
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
 for(const kind of ['quotations','enquiries']){
  await page.setViewportSize({width:1440,height:1000});await page.goto('http://localhost:3198/'+kind);await page.getByRole('heading',{level:1,name:kind==='quotations'?'Quotations':'Enquiries',exact:true}).waitFor();
  if(kind==='quotations')await page.getByRole('cell',{name:'Sales Quotation',exact:true}).first().waitFor();else await page.getByRole('heading',{name:'No Tally enquiries imported',exact:true}).waitFor();
  for(const theme of ['light','dark'])for(const width of [1440,390]){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.setViewportSize({width,height:width===390?844:1000});await page.screenshot({path:`${output}/${kind}-${width}-${theme}.png`,fullPage:true,animations:'disabled'});if(!await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1))throw Error('Page overflow: '+kind);}
  if(kind==='quotations'){
   await page.setViewportSize({width:1440,height:1000});await page.getByRole('cell',{name:'Sales Quotation',exact:true}).first().click();await page.getByRole('heading',{name:'Items and delivered pricing',exact:true}).waitFor();await page.screenshot({path:`${output}/quotation-detail.png`,fullPage:true,animations:'disabled'});await page.getByRole('button',{name:'Close',exact:true}).click();
   const nonOptional=page.waitForResponse(r=>r.url().includes('/visibility/quotations')&&new URL(r.url()).searchParams.get('optional')==='No');await page.getByLabel('Optional vouchers',{exact:true}).selectOption('No');const filtered=await (await nonOptional).json();const expected=await db.prepare("SELECT count(*) AS n FROM tally_visibility_current_cache WHERE entity='quotations' AND summary_fields->>'/stored/voucher_type'='Sales Quotation' AND summary_fields->>'/stored/is_optional'='No'").get();assert.equal(filtered.pagination.total,expected.n);
   await page.getByLabel('Optional vouchers',{exact:true}).selectOption('Yes');await page.getByLabel('Voucher status',{exact:true}).selectOption('CANCELLED');await page.getByRole('cell',{name:'CANCELLED',exact:true}).first().waitFor();
   await page.getByRole('tab',{name:'CRM quotations',exact:true}).click();await page.getByRole('heading',{name:'No quotations yet',exact:true}).waitFor();
  }
 }
 await fs.writeFile(`${output}/verification.json`,JSON.stringify({readOnlyRealImportedData:true,productionAuthSessionCreated:false,checks:['source tabs','real source records','original item breakdown','non-optional count reconciled against database','cancelled filter','empty enquiries','separate CRM records','desktop/mobile','light/dark','no overflow'],requests,errors},null,2));
 if(errors.length)throw Error(errors.join('\n'));console.log('Passed: real imported quotation UI, detail, cancelled filter, empty enquiries, CRM separation, 8 responsive screenshots.');
}finally{await browser.close();await db.close();}
