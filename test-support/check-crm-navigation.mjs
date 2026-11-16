import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
import {chromium} from 'playwright';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';
import {assertCurrentDatabase} from '../src/database-guard.js';
import {TALLY_ENTITY_DESCRIPTORS} from '../public/tally-entity-descriptors.js';
import {customerEnquiryHref,quotationOrderHref,tallyRecordHref} from '../public/crm-navigation.js';

// No listener is started. Playwright fulfills local requests from build files and browser fixtures.
const sql=connectPostgres(getConfig().databaseUrl);
try{await assertCurrentDatabase(sql);}finally{await sql.end({timeout:5});}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),build=path.join(root,'apps/web/.next');
const browser=await chromium.launch({headless:true});
const companyA='11111111-1111-4111-8111-111111111111',companyB='22222222-2222-4222-8222-222222222222';
let count=0,companiesEnabled=false,monitorFailure=false;
const check=async(name,run)=>{await run();count++;console.log(`PASS: ${name}`);};
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),sourceReads=[],searchCalls=[];
 const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
 const empty={data:[],pagination:{page:1,pageSize:25,pages:0,total:0},freshness:[],counts:[],sync:[],sources:[],legacyCount:0,lastUpdated:null,financial:false,emptyReason:'VERIFY- browser-only empty fixture'};
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;
  if(url.origin!=='http://127.0.0.1:3000')return route.abort();
  const json=(value,status=200)=>route.fulfill({status,json:value});
  if(p.startsWith('/api/')){
   if(!['GET','HEAD'].includes(req.method()))throw new Error(`Unexpected business write blocked: ${p}`);
   if(p==='/api/auth/me')return json({user:{id:987000,name:'VERIFY- browser Owner',role:'OWNER',status:'ACTIVE',mustChangePassword:false},permissions:['*'],csrfToken:'VERIFY-csrf',mfa:{required:false,enrolled:false,verified:false}});
   if(p==='/api/v1/me/preferences')return json({data:{theme:'light',density:'comfortable',sidebarCollapsed:false,savedFilters:{}}});
   if(p==='/api/v1/me/badges')return json({data:{}});
   if(p==='/api/v1/tally/monitor')return monitorFailure?json({error:'VERIFY- field needs review',code:'VALIDATION_FAILED',details:{fields:[{path:'reason',message:'VERIFY- enter a reason'}]}},422):json({company:{id:url.searchParams.get('companyId'),display_name:'VERIFY- selected company'},asOf:'2026-11-05T00:00:00Z',connectors:[],jobs:[],uploads:[],requests:[],queue:{pendingReadRequests:0,failedReadRequests:0,inProgressUploads:0,connectorLocalQueueDepth:null,note:'VERIFY- local queue unknown'},capabilities:{requestRead:true,payloads:false},note:'VERIFY- operational evidence'});
   if(p.startsWith('/api/crm/logistics/tally')){
    const company=url.searchParams.get('companyId'),name=company===companyA?'VERIFY- Company A':'VERIFY- Company B';
    const document={id:'VERIFY-movement',number:'VERIFY-DN_1',type:'Delivery Note',date:'20261104',party:'VERIFY- source party',status:'RECORDED',observedAt:'2026-11-04T00:00:00Z',lines:[{position:1,collection:'ALLINVENTORYENTRIES.LIST',item:'VERIFY- logistics part',actualQuantity:'2.345 Nos',billedQuantity:null,allocations:[{godown:'VERIFY- source store',destinationGodown:null,batch:'VERIFY- batch',actualQuantity:'2.345 Nos',billedQuantity:null,trackingNumber:'VERIFY- tracking',orderNumber:null}]}]};
    return json({...empty,company:{id:company,display_name:name},pagination:{page:1,pages:1,total:1},note:'VERIFY- read-only source',data:p.endsWith('/VERIFY-movement')?document:url.searchParams.get('kind')==='godowns'?[{id:'VERIFY-godown',name:'VERIFY- source store',parent:null}]:[document]});
   }
   if(p.endsWith('/read-companies'))return json({data:companiesEnabled?[{id:companyA,name:'VERIFY- Company A',display_name:'VERIFY- Company A'},{id:companyB,name:'VERIFY- Company B',display_name:'VERIFY- Company B'}]:[]});
   if(/^\/api\/crm\/customers\/(42|43)$/.test(p)){const id=Number(p.split('/').at(-1));return json({data:{id,name:`VERIFY- exact customer ${id}`,gstin:null}});}
   if(p==='/api/crm/owners')return json({data:[{id:987000,name:'VERIFY- browser Owner'}]});
   if(p==='/api/crm/customers'&&url.searchParams.get('search')==='VERIFY- search')return json({...empty,data:[{id:42,name:'VERIFY- search CRM customer',gstin:null}]});
   if(p==='/api/crm/search/tally'){
    searchCalls.push({term:url.searchParams.get('search'),companyId:url.searchParams.get('companyId')});
    return json({data:[{id:'VERIFY- search source customer',kind:'customer',source:'Tally',label:'VERIFY- search Tally customer',hint:'VERIFY- linked',href:tallyRecordHref('customers',companyB,'VERIFY-search_customer'),companyId:companyB,recordKey:'VERIFY-search_customer'},{id:'VERIFY- search source item',kind:'item',source:'Tally',label:'VERIFY- search Tally item',hint:'VERIFY- linked',href:tallyRecordHref('items',companyB,'VERIFY-search_item'),companyId:companyB,recordKey:'VERIFY-search_item'}]});
   }
   if(p==='/api/crm/order-quotes/73'){sourceReads.push(p);return json({data:{id:73,quotation_number:'VERIFY- approved quotation 73',customerId:42,customer_name:'VERIFY- exact customer 42',placeOfSupply:'27',lines:[{itemId:55,partCode:'VERIFY- part 55',description:'VERIFY- source line',uom:'Nos',quantity:'2',unitPrice:'100.123456',discountPercent:'0',taxPercent:'18'}]}});}
   if(p==='/api/crm/order-quotes/74'){sourceReads.push(p);return json({error:'VERIFY- quotation is no longer approved',code:'CONFLICT'},409);}
   if(p==='/api/v1/tally/visibility/freshness')return json({data:[]});
   if(/^\/api\/v1\/tally\/visibility\/(customers|items)\//.test(p)){
    const entity=p.split('/')[5],key=decodeURIComponent(p.split('/').slice(6).join('/')),company=url.searchParams.get('companyId');sourceReads.push({key,company});
    return json({descriptor:TALLY_ENTITY_DESCRIPTORS[entity],data:{id:'VERIFY- snapshot',record_key:key,name:`VERIFY- source ${company===companyA?'A':'B'}`,fields:{'/stored/name':`VERIFY- source ${company===companyA?'A':'B'}`},observed_at:'2026-11-04T00:00:00Z'},freshness:[],history:[],changes:[],links:[],payloads:[],financial:false,source:'VERIFY- retained fixture'});
   }
   if(p==='/api/v1/tally/visibility/customers')return json({...empty,descriptor:TALLY_ENTITY_DESCRIPTORS.customers,columns:['/stored/name']});
   if(p==='/api/v1/tally/visibility/items')return json({...empty,descriptor:TALLY_ENTITY_DESCRIPTORS.items,columns:['/stored/name']});
   return json(empty);
  }
  let file,contentType;
  if(p.startsWith('/_next/static/')){
   file=path.resolve(build,'static',decodeURIComponent(p.slice('/_next/static/'.length)));
   if(!file.startsWith(path.resolve(build,'static')+path.sep))return route.abort();
   contentType=p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.woff2')?'font/woff2':'application/octet-stream';
  }else if(['/enquiries','/orders','/tally','/logistics','/tally/monitor'].includes(p)){
   const rsc=req.headers().rsc==='1';file=path.join(build,'server/app',p.slice(1)+(rsc?'.rsc':'.html'));contentType=rsc?'text/x-component':'text/html';
  }else return route.fulfill({status:404,body:'Offline browser check: route not supplied.'});
  return fs.existsSync(file)?route.fulfill({contentType,body:fs.readFileSync(file)}):route.fulfill({status:404,body:'Build file unavailable.'});
 });
 await check('Customer 360 link preselects its exact customer and opens the CRM enquiry form',async()=>{
  await page.goto(`http://127.0.0.1:3000${customerEnquiryHref(42)}`);
  await page.getByRole('combobox',{name:'Customer',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[role="combobox"]')?.value==='VERIFY- exact customer 42');
  assert.equal(await page.getByRole('tab',{name:'CRM enquiries',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.waitForFunction(()=>!new URL(location.href).searchParams.has('new'));
  await page.evaluate(()=>history.pushState(null,'','/enquiries?new=1&customerId=43'));
  await page.waitForFunction(()=>document.querySelector('[role="combobox"]')?.value==='VERIFY- exact customer 43');
 });
 await check('quotation link opens PO creation with exact quotation, customer and unchanged source decimals beyond lookup pages',async()=>{
  await page.goto(`http://127.0.0.1:3000${quotationOrderHref(73)}`);
  await page.waitForFunction(()=>document.querySelector('select')?.options.length>0);
  await page.getByRole('option',{name:'VERIFY- approved quotation 73',exact:true}).waitFor({state:'attached'});
  assert.equal(await page.getByRole('combobox',{name:'Approved quotation (optional)',exact:true}).inputValue(),'73');
  assert.equal(await page.getByRole('combobox',{name:'Customer',exact:true}).inputValue(),'42');
  assert.equal(await page.getByLabel(/^Unit price · line 1/).inputValue(),'100.123456');
  assert.equal(await page.getByLabel(/^Original PO grand total/).inputValue(),'');
 });
 await check('same-page context changes reject stale approved quotes and block saving without overwriting identity',async()=>{
  await page.evaluate(()=>history.pushState(null,'','/orders?new=1&quotationId=74'));
  await page.getByText(/VERIFY- quotation is no longer approved/).waitFor();
  assert.equal(await page.getByRole('button',{name:'Save PO for verification',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('combobox',{name:'Customer',exact:true}).inputValue(),'');
 });
 await check('Tally source link opens its exact stable key in its specified company',async()=>{
  companiesEnabled=true;const key='VERIFY-guid:a/b?#&';
  await page.goto(`http://127.0.0.1:3000${tallyRecordHref('customers',companyB,key)}`);
  await page.getByRole('heading',{name:'VERIFY- source B',exact:true}).first().waitFor();
  assert.ok(sourceReads.some(row=>typeof row==='object'&&row.company===companyB&&row.key===key));
  assert.ok(!sourceReads.some(row=>typeof row==='object'&&row.company===companyA));
 });
 await check('Ctrl+K debounces source search, keeps CRM first, labels Tally and supports keyboard selection',async()=>{
  await page.keyboard.press('Control+k');
  const palette=page.getByRole('dialog',{name:'Command palette',exact:true}),input=palette.getByRole('combobox',{name:'Search screens, actions and records',exact:true});
  await input.fill('VERIFY- s');await input.fill('VERIFY- search');
  await palette.getByRole('option',{name:/VERIFY- search Tally item/}).waitFor();
  assert.deepEqual(searchCalls,[{term:'VERIFY- search',companyId:companyB}]);
  const options=palette.getByRole('option');assert.match(await options.first().innerText(),/VERIFY- search CRM customer/);
  assert.equal(await palette.getByText('Source: Tally',{exact:true}).count(),2);
  await input.press('End');assert.match(await palette.locator('[role="option"][aria-selected="true"]').innerText(),/Tally item/);
  await input.press('Home');assert.match(await palette.locator('[role="option"][aria-selected="true"]').innerText(),/CRM customer/);
  await input.press('ArrowDown');assert.match(await palette.locator('[role="option"][aria-selected="true"]').innerText(),/Tally customer/);
  await input.press('End');await input.press('Enter');
  await page.waitForFunction(()=>new URL(location.href).searchParams.get('recordKey')==='VERIFY-search_item');
  assert.equal(new URL(page.url()).searchParams.get('companyId'),companyB);
  assert.equal(new URL(page.url()).searchParams.get('entity'),'items');
 });
 await check('Logistics shows source locations and opens movement lines without financial fields',async()=>{
  await page.goto('http://127.0.0.1:3000/logistics');
  await page.getByText('VERIFY- source store',{exact:true}).waitFor();
  await page.getByRole('combobox',{name:'View',exact:true}).selectOption('documents');
  await page.getByText('VERIFY-DN_1',{exact:true}).click();
  await page.getByRole('heading',{name:'VERIFY- logistics part',exact:true}).waitFor();
  await page.getByText(/Godown: VERIFY- source store/).waitFor();
  assert.match(await page.getByRole('dialog').innerText(),/2.345 Nos/);
  assert.ok(!/Rate:|Amount:|Cost:|Margin:/.test(await page.getByRole('dialog').innerText()));
 });
 await check('Sync monitor handles empty evidence, reason validation and narrow screens; shared validation details render',async()=>{
  await page.goto('http://127.0.0.1:3000/tally/monitor');
  await page.getByText(/Source company: VERIFY- selected company/).waitFor();
  assert.equal(await page.getByRole('button',{name:'Request company read',exact:true}).isDisabled(),true);
  await page.getByLabel('Reason for read / retry').fill('VERIFY- manual review');
  assert.equal(await page.getByRole('button',{name:'Request company read',exact:true}).isEnabled(),true);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  monitorFailure=true;await page.getByRole('button',{name:'Refresh evidence',exact:true}).click();
  await page.getByText('Review the information below',{exact:true}).waitFor();await page.getByText('reason: VERIFY- enter a reason',{exact:true}).waitFor();
 });
 assert.deepEqual(pageErrors,[],'No browser runtime errors are expected.');
 await context.close();
 console.log(`${count} passed, 0 failed, 0 skipped. No listener started or fixture business data saved.`);
}finally{await browser.close();}
const listening=await new Promise((resolve,reject)=>{const socket=net.createConnection({host:'127.0.0.1',port:3000});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',error=>error.code==='ECONNREFUSED'?resolve(false):reject(error));socket.setTimeout(3000,()=>{socket.destroy();reject(new Error('Could not inspect listener.'));});});
if(process.argv.includes('--expect-stopped'))assert.equal(listening,false,'CRM listener unexpectedly running.');
console.log(`Listener inspection: port 3000 ${listening?'is already running':'is stopped'}. This check did not start or stop it.`);
