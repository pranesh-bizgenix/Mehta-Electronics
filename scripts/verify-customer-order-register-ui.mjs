import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {chromium} from 'playwright';
import {priceWorkbookFixture} from '../test-support/xlsx-fixture.js';import {mappedWorkbook,workbookColumns,manualSourceRows} from '../src/modules/order-imports/entry-domain.js';
const out='verification-output/customer-order-register-ui';await fs.mkdir(out,{recursive:true});
const id='11111111-1111-4111-8111-111111111111',rowId='22222222-2222-4222-8222-222222222222',company='33333333-3333-4333-8333-333333333333';
const facts={poNumber:'SAMPLE-PO-001',poLine:'00010',externalCode:'SAMPLE-CODE',description:'SAMPLE UI only',orderedQuantity:'10.000000',openQuantity:'5.000000',scheduleKind:'IMMEDIATE',requiredDate:null};
const source={id:'source:'+rowId,row_id:rowId,batch_id:id,batch_version:1,row_version:1,customer_id:null,customer_name:null,source:'EXCEL',status:'DRAFT',facts,item_id:null,uom:null,source_date:null,source_name:'SAMPLE.xlsx',href:'/operations/order-imports?batch='+id,quotation_href:null,order_href:null,fulfilled:null,editable:true,issues:[]};
const email={...source,id:'email:sample',batch_id:null,source:'AUTOMATION',status:'PREPARED',facts:{...facts,poNumber:'SAMPLE-EMAIL-PO',openQuantity:null},href:'/incoming-requests?requestId='+id,quotation_href:'/quotations/1',editable:false};
const bytes=priceWorkbookFixture([['Client order','Line','Code','Description','Qty','Balance','When'],...Array.from({length:10},(_,i)=>['SAMPLE-IMPORT',String(i+1),'SAMPLE-CODE','Sample item','10','3','Immediate'])]);
const report={mode:'IN_MEMORY_UI_ONLY_NO_DATABASE_WRITES',checks:[],errors:[],calls:[]},browser=await chromium.launch({headless:true});
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3000',viewport:{width,height:950}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  for(const href of ['/sales/customer-pos','/operations/open-orders'])await context.route('**'+href,route=>route.fulfill({status:200,contentType:'text/html',path:'apps/web/.next/server/app'+href+'.html'}));
  await context.route('**/_next/static/**',async route=>{const root=path.resolve('apps/web/.next/static'),file=path.resolve(root,'.'+new URL(route.request().url()).pathname.replace('/_next/static',''));assert.ok(file.startsWith(root+path.sep));await route.fulfill({status:200,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream',body:await fs.readFile(file)});});
  await context.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());let body={data:[]};
   if(request.method()!=='GET'){
    const b=request.postDataJSON();report.calls.push({method:request.method(),path:url.pathname});
    if(url.pathname.endsWith('/columns'))body={data:workbookColumns(Buffer.from(b.base64,'base64'))};
    else if(url.pathname.endsWith('/preview'))body={data:mappedWorkbook(Buffer.from(b.base64,'base64'),b.columnMapping)};
    else if(url.pathname==='/api/crm/order-imports'){assert.equal(b.columnMapping.columns.poNumber,0);assert.equal(mappedWorkbook(Buffer.from(b.base64,'base64'),b.columnMapping).rows.length,10);body={data:{batch:{id},replayed:false}};}
    else if(url.pathname.endsWith('/manual')){assert.equal(manualSourceRows(b.rows,b.requestKey).length,1);body={data:{batch:{id}}};}
    else if(url.pathname.endsWith('/rows')){assert.equal(manualSourceRows(b.rows,b.requestKey).length,2);assert.equal(b.version,1);body={data:{batch:{id}}};}
    else if(url.pathname.endsWith('/rows/'+rowId)){assert.equal(b.values.openQuantity,'4');assert.equal(b.batchVersion,1);assert.equal(b.rowVersion,1);assert.equal(b.reason,'SAMPLE UI row correction');body={data:{id}};}
    else throw Error('Unexpected UI mutation '+url.pathname);
   }else if(url.pathname==='/api/auth/me')body={user:{id:1,name:'SAMPLE reviewer',email:'sample@example.test',role:'OWNER',status:'ACTIVE',mustChangePassword:false},permissions:['*'],csrfToken:'sample-ui-only',mfa:{required:false,enrolled:false,verified:false}};
   else if(url.pathname==='/api/v1/me/preferences')body={data:{theme:'light',density:'comfortable',sidebarCollapsed:false,savedFilters:{}}};
   else if(url.pathname==='/api/tally/read-companies')body={data:[{id:company,name:'SAMPLE company',display_name:'SAMPLE company'}]};
   else if(url.pathname==='/api/crm/customer-order-register')body={data:{rows:url.searchParams.get('view')==='CUSTOMER_PO'?[source,email]:[source],pagination:{page:1,pageSize:100,total:2,pages:1},note:'SAMPLE UI fixture; not real stock or dispatch.'}};
   else if(url.pathname==='/api/crm/order-imports/'+id)body={data:{id,version:1}};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  for(const [href,title] of [['/sales/customer-pos','Customer POs'],['/operations/open-orders','Open orders']]){await page.goto(href);await page.getByRole('heading',{name:title,exact:true}).waitFor();await page.getByText('SAMPLE-PO-001',{exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));report.checks.push(title+' row table at '+width+'px');await page.screenshot({path:`${out}/${title.replaceAll(' ','-')}-${width}.png`,fullPage:true});}
  await page.getByRole('button',{name:'Edit row',exact:true}).click();await page.getByLabel('Reported open, row 1',{exact:true}).fill('4');await page.getByLabel('Row editing reason',{exact:true}).fill('SAMPLE UI row correction');await page.getByRole('button',{name:'Save row changes',exact:true}).click();await page.getByRole('heading',{name:'Edit PO row',exact:true}).waitFor({state:'hidden'});report.checks.push('Editable PO cell saves expected values at '+width+'px');
  await page.getByRole('button',{name:'Add rows',exact:true}).click();await page.getByRole('button',{name:'Add another row',exact:true}).click();await page.getByLabel('Reason for manual entry',{exact:true}).fill('SAMPLE UI append two rows');await page.getByRole('button',{name:'Save draft rows',exact:true}).click();await page.getByRole('heading',{name:'Add rows to this draft',exact:true}).waitFor({state:'hidden'});report.checks.push('Manual row addition at '+width+'px');
  await page.getByRole('button',{name:'Add customer PO',exact:true}).click();await page.getByLabel('PO entry title',{exact:true}).fill('SAMPLE manual PO');await page.getByLabel('PO number, row 1',{exact:true}).fill('SAMPLE-MANUAL');await page.getByLabel('Reason for manual entry',{exact:true}).fill('SAMPLE UI manual entry');await page.getByRole('button',{name:'Save draft rows',exact:true}).click();await page.getByRole('heading',{name:'Enter customer PO rows',exact:true}).waitFor({state:'hidden'});report.checks.push('Manual PO creation at '+width+'px');
  await page.getByRole('button',{name:'Import Excel rows',exact:true}).click();await page.locator('input[type=file]').setInputFiles({name:'SAMPLE.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes});await page.getByLabel('Column mapping mode',{exact:true}).selectOption('MAPPED');
  for(const [label,value] of [['PO number column','0'],['PO line column','1'],['Material code column','2'],['Description column','3'],['PO quantity column','4'],['Reported open column','5'],['Required date column','6']])await page.getByLabel(label,{exact:true}).selectOption(value);
  await page.getByLabel('Excel import reason',{exact:true}).fill('SAMPLE UI explicit mapping');await page.getByRole('button',{name:'Preview mapped rows',exact:true}).click();await page.getByRole('button',{name:'Import into CRM rows',exact:true}).click();await page.getByRole('heading',{name:'Map Excel data into CRM rows',exact:true}).waitFor({state:'hidden'});report.checks.push('Excel column mapping previews and imports ten parsed rows at '+width+'px');
  await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}finally{await browser.close();await fs.writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
