import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const id='11111111-1111-4111-8111-111111111111',out='verification-output/invoice-source-lines-ui';await fs.mkdir(out,{recursive:true});
const report={scope:'In-memory browser contract fixtures only; no listener, database, network provider or business mutation.',checks:[],errors:[]},browser=await chromium.launch({headless:true});
try{for(const width of [1440,390]){
 let row={id,source:'TALLY',customer_id:1,customer_name:'SAMPLE customer',number:'SAMPLE-COPY',status:'DRAFT',version:1,created_by:2,invoice_date:'2026-11-27',payload:{customer:{id:1,name:'SAMPLE customer'},date:'2026-11-27',totals:{total:'100'},sourceEvidence:'SAMPLE evidence'},original:{filename:'SAMPLE.pdf',sha256:'SAMPLE',uploaded_by:2,verified_by:null}};
 const context=await browser.newContext({baseURL:'http://127.0.0.1:3000',viewport:{width,height:950}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 await context.route('**/billing',r=>r.fulfill({contentType:'text/html',path:'apps/web/.next/server/app/billing.html'}));
 await context.route('**/_next/static/**',async r=>{const root=path.resolve('apps/web/.next/static'),file=path.resolve(root,'.'+new URL(r.request().url()).pathname.replace('/_next/static',''));assert.ok(file.startsWith(root+path.sep));await r.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream',body:await fs.readFile(file)});});
 await context.route('**/api/**',async r=>{const req=r.request(),url=new URL(req.url());let body={data:[]};
  if(req.method()!=='GET'){
   assert.equal(req.method(),'PATCH');assert.equal(url.pathname,'/api/crm/billing/'+id+'/source-lines');const b=req.postDataJSON();assert.equal(b.version,1);assert.equal(b.reason,'SAMPLE source review');assert.deepEqual(b.lines,[{code:'SAMPLE-CODE',description:'SAMPLE item',quantity:'2.000001',uom:'NOS'}]);row={...row,version:2,payload:{...row.payload,sourceLines:b.lines,sourceLinesEnteredBy:1,sourceLinesVerified:false}};body={data:row};
  }else if(url.pathname==='/api/auth/me')body={user:{id:1,name:'SAMPLE reviewer',email:'sample@example.test',role:'OWNER',status:'ACTIVE',mustChangePassword:false},permissions:['*'],csrfToken:'sample-ui-only',mfa:{required:false,enrolled:false,verified:false}};
  else if(url.pathname==='/api/v1/me/preferences')body={data:{theme:'light',density:'comfortable',sidebarCollapsed:false,savedFilters:{}}};
  else if(url.pathname==='/api/crm/billing')body={data:[row],pagination:{page:1,pageSize:25,total:1,pages:1}};
  else if(url.pathname==='/api/crm/billing/'+id)body={data:row};
  else if(url.pathname==='/api/crm/billing/settings')body={data:{version:1,value:{}}};
  await r.fulfill({contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('/billing');await page.getByText('SAMPLE-COPY',{exact:true}).click();await page.getByRole('button',{name:'Capture or correct original product facts',exact:true}).click();
 for(const [label,value] of [['Product code','SAMPLE-CODE'],['Quantity','2.000001'],['Unit','NOS'],['Description','SAMPLE item']]){console.log('Filling',label);await page.getByLabel(label+', original line 1',{exact:false}).fill(value);}
 await page.getByLabel('Invoice action reason',{exact:false}).fill('SAMPLE source review');await page.getByRole('button',{name:'Save product facts with history',exact:true}).click();await page.getByText('Awaiting independent product review',{exact:true}).waitFor();report.checks.push('Product capture submits exact fields and version at '+width+'px');
 const verify=page.getByRole('button',{name:'Verify invoice copy',exact:true});await page.getByLabel('I checked customer, invoice number, date and total against the original PDF and Tally evidence',{exact:true}).check();assert.equal(await verify.isDisabled(),true);await page.getByLabel('I checked the product codes, units and quantities against the original PDF',{exact:true}).check();assert.equal(await verify.isDisabled(),true);report.checks.push('Fact capturer cannot verify their own changes at '+width+'px');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:out+'/copy-'+width+'.png',fullPage:true});report.checks.push('Source-fact workspace fits '+width+'px');await context.close();
 }assert.deepEqual(report.errors,[]);report.passed=true;
}catch(e){report.error=String(e.message);process.exitCode=1;}finally{await browser.close();await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed||false,checks:report.checks.length,error:report.error}));}
