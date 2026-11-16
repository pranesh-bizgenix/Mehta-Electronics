import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';
import {assertCurrentDatabase} from '../src/database-guard.js';

// The existing app/listener is required. Browser-only fixtures never enter PostgreSQL.
const sql=connectPostgres(getConfig().databaseUrl);
try {await assertCurrentDatabase(sql);} finally {await sql.end({timeout:5});}
const browser=await chromium.launch({headless:true});
let passed=0;
const check=async(name,run)=>{await run();passed++;console.log(`PASS: ${name}`);};
const customer={id:987001,name:'ZZTEST_browser_customer',gstin:'27ABCDE1234F1Z5',profile:{state_code:'27'},contacts:[]};
const item={id:987002,part_code:'ZZTEST_BROWSER_ITEM',description:'ZZTEST browser-only item',uom:'Nos',hsn:'8536'};
const policy={revision:1,seller_state:'27',floor_percent:'20',margin_basis:'TOTAL',letterhead:{name:'ZZTEST browser-only seller'}};
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 let configured=false,submitted=null,role='OWNER';
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  const reply=data=>route.fulfill({json:data});
  if(path==='/api/auth/me')return reply({user:{id:987000,name:'ZZTEST browser Owner',email:'ZZTEST_browser@example.test',role,status:'ACTIVE',mustChangePassword:false},permissions:role==='OWNER'?['*']:['items.read'],csrfToken:'ZZTEST_browser_csrf',mfa:{required:false,enrolled:false,verified:false}});
  if(path==='/api/crm/quotation-policy')return reply({data:configured?policy:null});
  if(path==='/api/crm/customers/987001')return reply({data:customer});
  if(path==='/api/crm/customers')return reply({data:[customer],pagination:{page:1,pageSize:20,total:1,pages:1}});
  if(path==='/api/crm/items')return reply({data:[item],pagination:{page:1,pageSize:20,total:1,pages:1}});
  if(path==='/api/crm/quotation-costs/987002')return reply({data:{item_id:item.id,unit_cost:null}});
  if(path==='/api/crm/quotations'&&req.method()==='POST'){
   submitted=req.postDataJSON();return reply({data:{id:987003,quotation_number:'ZZTEST_BROWSER_QUOTE'}});
  }
  if(path==='/api/crm/quotations/987003')return reply({data:{id:987003,quotation_number:'ZZTEST_BROWSER_QUOTE',customerId:customer.id,customer_name:customer.name,customerGstin:customer.gstin,placeOfSupply:'27',validUntil:'2026-12-31',status:'DRAFT',version:1,created_by:987000,terms:'',notes:'',lines:[{itemId:item.id,partCode:item.part_code,description:item.description,uom:item.uom,hsn:item.hsn,quantity:'2',unitPrice:'100',discountPercent:'0',taxPercent:'18',total:'236.00'}]}});
  if(path==='/api/crm/quotations/987003/history')return reply({data:{events:[],versions:[]}});
  // Keep this UI check independent of real business rows and prevent any write.
  if(!['GET','HEAD'].includes(req.method()))throw new Error(`Unexpected browser write blocked: ${path}`);
  if(path==='/api/v1/me/preferences')return reply({data:{theme:'light',sidebarCollapsed:false}});
  if(path.includes('companies'))return reply({data:[]});
  return reply({data:[],pagination:{page:1,pageSize:20,total:0,pages:0}});
 });
 await check('missing policy keeps the complete form visible and blocks saving',async()=>{
  await page.goto('http://127.0.0.1:3000/quotations/new');
  await page.getByRole('heading',{name:'New quotation',exact:true}).waitFor();
  assert.equal(await page.getByRole('combobox',{name:'Customer',exact:true}).isVisible(),true);
  assert.equal(await page.getByRole('heading',{name:'Quotation items (1)'}).isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);
  assert.equal(await page.getByLabel(/^Valid until/).inputValue(),'');
  assert.equal(await page.getByLabel('GST %',{exact:true}).inputValue(),'');
  assert.equal(await page.getByLabel('Disc. %',{exact:true}).inputValue(),'');
  assert.equal(await page.getByRole('button',{name:'Set policy and letterhead'}).count(),1);
 });
 await check('customer context, item lookup, explicit values, exact totals and missing costs permit a draft only',async()=>{
  configured=true;
  await page.goto('http://127.0.0.1:3000/quotations/new?customerId=987001');
  await page.getByText('GSTIN: 27ABCDE1234F1Z5',{exact:true}).waitFor();
  assert.ok(await page.locator('.quote-customer-strip').evaluate(el=>el.getBoundingClientRect().height)<150);
  assert.equal(await page.getByRole('combobox',{name:'Customer',exact:true}).inputValue(),customer.name);
  await page.getByLabel(/^Valid until/).fill('2026-12-31');
  await page.getByRole('combobox',{name:'Item 1',exact:true}).fill('ZZTEST');
  await page.getByRole('option',{name:/ZZTEST_BROWSER_ITEM/}).click();
  await page.getByLabel('Qty (Nos)',{exact:true}).fill('2');
  await page.getByLabel('Rate',{exact:true}).fill('100');
  await page.getByLabel('Disc. %',{exact:true}).fill('0');
  await page.getByLabel('GST %',{exact:true}).fill('18');
  await page.getByLabel('Customer RFQ / reference',{exact:true}).fill('ZZTEST browser RFQ');
  await page.getByLabel('Customer quantity instructions',{exact:true}).fill('ZZTEST confirm 3 sets and colour quantities');
  await page.getByText('Line 1: customer references, specifications & delivery',{exact:true}).click();
  await page.getByLabel('Source line / customer part reference 1',{exact:true}).fill('7');
  await page.getByLabel('Tag / equipment reference 1',{exact:true}).fill('ZZTEST_TAG');
  await page.getByLabel('Quoted make 1',{exact:true}).fill('ZZTEST make');
  await page.getByLabel('Requested specification 1',{exact:true}).fill('ZZTEST 1100V FRLSH, requested compliance');
  await page.getByLabel('Stock / availability statement 1',{exact:true}).fill('ZZTEST manually checked availability');
  assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);
  await page.getByLabel(/^Availability checked on 1/).fill('2026-01-01');
  await page.getByLabel(/^Availability source 1/).fill('ZZTEST source reference');
  await page.getByLabel('Delivery lead time from PO date 1',{exact:true}).fill('ZZTEST 7 days from PO');
  await page.getByText('Submission blocked: cost missing',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isEnabled(),true);
  assert.equal(await page.locator('.ds-line-total strong').innerText(),'₹236.00');
  await page.getByRole('button',{name:'Add line',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Remove line 2',exact:true}).click();
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await page.waitForURL('**/quotations/987003');
  assert.equal(submitted.customerId,987001);assert.equal(submitted.lines[0].unitPrice,'100');
  assert.equal(submitted.lines[0].discountPercent,'0');assert.equal(submitted.lines[0].taxPercent,'18');
  assert.equal(submitted.request.reference,'ZZTEST browser RFQ');assert.equal(submitted.request.quantityConfirmed,false);
  assert.equal(submitted.lines[0].requestDetails.tag,'ZZTEST_TAG');assert.equal(submitted.lines[0].requestDetails.availabilityAsOf,'2026-01-01');assert.equal(submitted.lines[0].requestDetails.leadTime,'ZZTEST 7 days from PO');
 });
 await check('mobile form has no page-level horizontal overflow',async()=>{
  await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:3000/quotations/new');
  await page.getByRole('heading',{name:'New quotation',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  assert.equal(await page.getByLabel('GST %',{exact:true}).isVisible(),true);
  await page.getByText('Line 1: customer references, specifications & delivery',{exact:true}).click();
  assert.equal(await page.getByLabel('Requested specification 1',{exact:true}).isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 });
 await check('a role without quotation creation sees an explicit permission state',async()=>{
  role='STORE_STAFF';await page.goto('http://127.0.0.1:3000/quotations/new');
  await page.getByText(/Your role cannot open this quotation editor\./).waitFor();
  assert.equal(await page.getByRole('button',{name:'Save draft',exact:true}).count(),0);
 });
 await context.close();
 console.log(`${passed} passed, 0 failed, 0 skipped. Browser fixtures were not saved to the database.`);
} finally {await browser.close();}
