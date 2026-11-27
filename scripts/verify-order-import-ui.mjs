import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const out='verification-output/order-import-ui';await fs.mkdir(out,{recursive:true});
const id='11111111-1111-4111-8111-111111111111',rowId='22222222-2222-4222-8222-222222222222';
const facts={kind:'PO_LINE',externalCode:'SAMPLE-MATERIAL',description:'SAMPLE UI only',poNumber:'SAMPLE-PO-01',poLine:'00001',orderedQuantity:'10.000000',openQuantity:'5.000000',requiredDate:null,documentDate:null,scheduleKind:'IMMEDIATE',unitPrice:null,sourceValue:null};
const batch={id,filename:'SAMPLE-UI-only.xlsx',status:'DRAFT',version:1,customer_id:null,customer_name:null,company_id:null,company_name:null,as_of_date:null,currency:null,created_by:1,editors:[1],created_at:'2026-11-27T00:00:00Z',source_summary:{physicalRows:10,poRows:10,summaryRows:0,rowsNeedingReview:0},layouts:[]};
const row={id:rowId,sheet:'Open PO',source_row:2,source_key:'Open PO:2',layout:'OPEN_PO',version:1,effective:facts,source_facts:facts,itemId:null,uom:null,item:null,excluded:false,issues:['ITEM_AND_UNIT_NEED_REVIEW'],raw_row:{headers:['PO Number'],cells:[{text:'SAMPLE-PO-01',formula:false}]}};
const report={mode:'IN_MEMORY_UI_ONLY_NO_DATABASE_WRITES',checks:[],errors:[]};const browser=await chromium.launch({headless:true});
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3000',viewport:{width,height:950}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await context.route('**/operations/order-imports',route=>route.fulfill({status:200,contentType:'text/html',path:'apps/web/.next/server/app/operations/order-imports.html'}));
  await context.route('**/_next/static/**',async route=>{const root=path.resolve('apps/web/.next/static'),file=path.resolve(root,'.'+new URL(route.request().url()).pathname.replace('/_next/static',''));assert.ok(file.startsWith(root+path.sep));await route.fulfill({status:200,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream',body:await fs.readFile(file)});});
  await context.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());assert.equal(request.method(),'GET','This UI verification must not write to any API.');let body={data:[]};
   if(url.pathname==='/api/auth/me')body={user:{id:1,name:'SAMPLE UI reviewer',email:'sample@example.test',role:'OWNER',status:'ACTIVE',mustChangePassword:false},permissions:['*'],csrfToken:'sample-ui-only',mfa:{required:false,enrolled:false,verified:false}};
   else if(url.pathname==='/api/v1/me/preferences')body={data:{theme:'light',density:'comfortable',sidebarCollapsed:false,savedFilters:{}}};
   else if(url.pathname==='/api/crm/order-imports')body={data:[batch]};
   else if(url.pathname===`/api/crm/order-imports/${id}/rows`)body={data:{batch,rows:[row],pagination:{page:1,pageSize:100,total:1,pages:1}}};
   else if(url.pathname==='/api/tally/read-companies')body={data:[{id:'33333333-3333-4333-8333-333333333333',name:'SAMPLE company'}]};
   else if(url.pathname===`/api/crm/order-imports/${id}/review`)body={data:{batch,blockers:['Confirm customer, company and source date.'],fingerprint:'a'.repeat(64),cancelRows:0,counts:{rows:1,eligible:1,blocked:1,add:1,replace:0,retire:0,unchanged:0},comparison:{status:'NOT_PRESENT',count:0,differences:[]},changes:[]}};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('/operations/order-imports');await page.getByRole('heading',{name:'PO & open order imports',exact:true}).waitFor();
  await page.getByText('SAMPLE-UI-only.xlsx',{exact:true}).click();await page.getByText('SAMPLE-PO-01',{exact:false}).first().waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));report.checks.push('Original workbook and PO rows render without page overflow at '+width+'px');
  await page.screenshot({path:`${out}/workbook-${width}.png`,fullPage:true});
  await page.getByText('SAMPLE-PO-01',{exact:false}).first().click();await page.getByText('Original spreadsheet cell values',{exact:true}).waitFor();report.checks.push('Original-cell review drawer opens at '+width+'px');
  await context.close();
 }
 assert.deepEqual(report.errors,[]);report.status='PASS';
}finally{await browser.close();await fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
