import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// UI-only verification: every API request is intercepted. No database is opened,
// no credentials are read and no mutation can reach the running CRM listener.
const out='verification-output/crm-completion/internal-ui';
await fs.mkdir(out,{recursive:true});
const invoiceId='11111111-1111-4111-8111-111111111111';
const companyId='22222222-2222-4222-8222-222222222222';
const arrangementId='33333333-3333-4333-8333-333333333333';
const sampleInvoice={id:invoiceId,customerId:1,customerName:'SAMPLE Customer — UI only',number:'SAMPLE-INV-001',invoiceDate:'2026-11-26',referenceStatus:'OPEN',dueDate:null,paid:'0.00',outstanding:'1180.00',bucket:'DUE_DATE_NOT_CONFIRMED'};
const screens=[
 ['/accounts/bank-reconciliation','Bank reconciliation'],
 ['/accounts/gst','GST preparation'],
 ['/operations/warehouse','Warehouse custody'],
 ['/operations/delivery-schedules','Delivery schedules'],
 ['/accounts/collections','Collections & receipts'],
 ['/accounts/payables','Supplier dues & payments']
];
const report={mode:'IN_MEMORY_SAMPLE_UI_ONLY_NO_DATABASE_WRITES',checks:[],pageErrors:[],mutations:[]};
const browser=await chromium.launch({headless:true});
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3000',viewport:{width,height:950}});
  const page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));
  for(const [href] of screens)await context.route(`**${href}`,async route=>{
   const file=path.join('apps/web/.next/server/app',href.slice(1)+'.html');
   await route.fulfill({status:200,contentType:'text/html',body:await fs.readFile(file)});
  });
  await context.route('**/_next/static/**',async route=>{
   const root=path.resolve('apps/web/.next/static'),file=path.resolve(root,'.'+new URL(route.request().url()).pathname.replace('/_next/static',''));
   assert.ok(file.startsWith(root+path.sep));
   await route.fulfill({status:200,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream',body:await fs.readFile(file)});
  });
  await context.route('**/api/**',async route=>{
   const request=route.request(),href=new URL(request.url()).pathname;
   let body={data:[]};
   if(request.method()!=='GET'){
    const input=request.postDataJSON();report.mutations.push({path:href,body:input});
    assert.equal(href,`/api/crm/accounts/collections/arrangements/${arrangementId}/review`);
    assert.equal(input.version,1);assert.equal(input.decision,'APPROVE');
    assert.equal(input.reason,'SAMPLE independent UI verification');
    body={data:{id:arrangementId,status:'ACTIVE'}};
   }
   else if(href==='/api/auth/me')body={user:{id:1,name:'SAMPLE UI Reviewer',email:'sample@example.test',role:'OWNER',status:'ACTIVE',mustChangePassword:false},permissions:['*'],csrfToken:'sample-ui-csrf',mfa:{required:false,enrolled:false,verified:false}};
   else if(href==='/api/v1/me/preferences')body={data:{theme:'light',density:'comfortable',sidebarCollapsed:false,savedFilters:{}}};
   else if(href==='/api/v1/me/badges')body={data:{}};
   else if(href==='/api/tally/read-companies')body={data:[{id:companyId,name:'SAMPLE Company — UI only'}]};
   else if(href==='/api/crm/owners')body={data:[{id:1,name:'SAMPLE Reviewer'},{id:2,name:'SAMPLE Maker'}]};
   else if(href==='/api/crm/accounts/collections/ageing')body={data:{rows:[sampleInvoice],page:1,asOf:'2026-11-26',basis:'Sample data for UI verification only; no saved business balances.'}};
   else if(href===`/api/crm/accounts/collections/invoices/${invoiceId}`)body={data:{invoice:{id:invoiceId,customer_id:1,reference:'SAMPLE-REF',payload:{invoiceNumber:'SAMPLE-INV-001',amount:'1180.00'},status:'OPEN'},balance:{original:'1180.00',creditNotes:'0.00',debitNotes:'0.00',paid:'0.00',outstanding:'1180.00'},companyId,scopes:[],documents:[],receipts:[],adjustments:[],arrangements:[{id:arrangementId,version:1,created_by:2,kind:'DUE_DATE',status:'PENDING_REVIEW',payload:{date:'2026-12-10'},evidence:'SAMPLE customer-confirmed terms',reason:'SAMPLE verification'}]}};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  for(const [href,title] of screens){
   await page.goto(href);await page.getByRole('heading',{name:title,exact:true}).waitFor();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),href+' overflows at '+width);
   await page.screenshot({path:`${out}/${href.slice(1).replaceAll('/','-')}-${width}.png`,fullPage:true});
   report.checks.push(`${title}: renders without page overflow at ${width}px`);
  }
  await page.goto('/accounts/collections');await page.getByRole('button',{name:'SAMPLE-INV-001',exact:true}).click();
  await page.getByRole('heading',{name:'Invoice balance & follow-ups',exact:true}).waitFor();
  await page.getByLabel('Action or independent review reason',{exact:true}).fill('SAMPLE independent UI verification');
  await page.getByRole('button',{name:'Approve',exact:true}).click();
  await page.getByLabel('Follow-up type',{exact:true}).selectOption('PDC');
  await page.getByLabel('Cheque number',{exact:false}).fill('SAMPLE-001');
  await page.getByLabel('Bank name',{exact:false}).fill('SAMPLE Bank');
  await page.screenshot({path:`${out}/collections-drawer-${width}.png`,fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  report.checks.push(`Collections drawer: versioned review and cheque form at ${width}px`);
  await context.close();
 }
 assert.deepEqual(report.pageErrors,[]);assert.equal(report.mutations.length,2);report.status='PASS';
}finally{await browser.close();await fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
