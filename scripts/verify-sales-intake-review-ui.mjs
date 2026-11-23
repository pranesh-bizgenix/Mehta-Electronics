import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createControlDeskServer} from '../src/controldesk-server.js';

// Every API request is intercepted. This exercises the actual UI with fictional
// fixtures; it cannot connect to RDS or certify the database workflow.
const company='00000000-0000-4000-8000-000000000063',id='00000000-0000-4000-8000-000000000903',now=new Date().toISOString();
const header=Object.fromEntries(['supplyType','poNumber','poDate','buyerName','supplierName','billingAddress','deliveryAddress','gstin','contactPerson','email','phone','totalPoValue','deliveryDate','paymentTerms','otherTerms','placeOfSupply','validUntil','quotationId','customerId'].map(k=>[k,null]));
header.buyerName='Sample review customer';
let detail={id,company_id:company,message_type:'CUSTOMER_PO',source_received_at:now,received_at:now,status:'NEEDS_REVIEW',classification:'EXISTING',relationship:'EXISTING',tier:{tier:null,state:'TIER_POLICY_REQUIRED',count:null},blockers:['MISSING:header.poDate','MISSING:items'],assigned_to:201,assigned_name:'Sample reviewer',first_assigned_at:null,first_response_at:null,enquiry_id:null,quotation_id:null,sales_order_id:null,customer_id:1,customer_po_id:null,version:1,buyer_name:'Sample review customer',po_number:null,mailbox:'sample@example.test',message_id:'sample-message',source_system:'Fictional fixture',original_payload:{sample:true},normalized:{reviewIssues:['Sample verify extraction warning'],header,items:[],source:{originalText:'Fictional document for UI verification only.'},provenance:{extractor:'Sample fixture',version:'1',reference:'sample-review'}},resolutions:{},events:[],documents:[],timing:{elapsedSeconds:null,firstAssignedAt:null,firstResponseAt:null,sla:'NOT_CONFIGURED',kpi:'NOT_CONFIGURED',timezone:'Asia/Kolkata'}};
let app,browser,grants=['*'],stale=false;
const report={checks:[],errors:[],unexpectedApi:[],mode:'Intercepted browser fixtures; no database'},posts=[];
const check=async(name,fn)=>{await fn();report.checks.push({name,status:'PASS'});console.log('PASS',name);};
try{
 if(!process.argv.includes('--existing-server')){app=await createControlDeskServer({port:3000,api:(req,res)=>{report.unexpectedApi.push(req.url);res.writeHead(503);res.end();}});await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(3000,'127.0.0.1',resolve);});}
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({baseURL:'http://127.0.0.1:3000',viewport:{width:1440,height:1000}});
 await context.route('**/api/**',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname,reply=(body,status=200)=>route.fulfill({json:body,status});
  if(req.method()==='POST'&&p===`/api/crm/sales-intake/${id}/review`){const body=req.postDataJSON();posts.push(body);if(stale)return reply({error:'Request changed. Reload the current version.',code:'CONFLICT'},409);detail={...detail,version:detail.version+1,resolutions:body.resolutions,blockers:['QUOTATION_POLICY_REQUIRED']};return reply({data:detail});}
  if(req.method()!=='GET'){report.unexpectedApi.push(req.method()+' '+p);return reply({error:'Not allowed in UI verification'},405);}
  if(p==='/api/auth/me')return reply({user:{id:201,name:'Sample reviewer',email:'sample@example.test',role:grants.includes('*')?'OWNER':'EXECUTIVE',status:'ACTIVE',mustChangePassword:false},permissions:grants,csrfToken:'SAMPLE-TOKEN',mfa:{required:false,verified:true,enrolled:false}});
  if(p==='/api/v1/me/preferences')return reply({data:{theme:'light',density:'comfortable',sidebarCollapsed:false,savedFilters:{}}});
  if(p==='/api/v1/me/badges')return reply({data:{}});
  if(p==='/api/tally/read-companies')return reply({data:[{id:company,name:'Sample company',display_name:'Sample company'}]});
  if(p==='/api/tally-write/banner')return reply({data:{live:false}});
  if(p==='/api/v1/tally/visibility/freshness'||p==='/api/v1/notifications'||p==='/api/crm/quotation-price-levels')return reply({data:[]});
  if(p==='/api/crm/owners')return reply({data:[{id:201,name:'Sample reviewer'}]});
  if(p==='/api/crm/sales-intake/metrics')return reply({data:{state:'NOT_CONFIGURED',score:null}});
  if(p==='/api/crm/sales-intake')return reply({data:u.searchParams.get('status')&&u.searchParams.get('status')!==detail.status?[]:[detail],ingestionEnabled:false,pagination:{page:1,pageSize:25,total:1,pages:1}});
  if(p===`/api/crm/sales-intake/${id}`)return reply({data:detail});
  return reply({error:'Outside focused test'},404);
 });
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.setDefaultTimeout(20000);
 await page.goto('/incoming-requests');await page.getByRole('heading',{name:'Incoming requests',exact:true}).waitFor();
 await check('Needs review opens the saved review queue',async()=>{const pending=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/crm/sales-intake'&&new URL(r.url()).searchParams.get('status')==='NEEDS_REVIEW');await page.getByRole('button',{name:'Needs review',exact:true}).click();await pending;await page.getByRole('table',{name:'Saved incoming requests'}).getByRole('button',{name:'Sample review customer',exact:true}).click();await page.getByText('Information needs review',{exact:true}).waitFor();});
 const dialog=page.getByRole('dialog');
 await check('Original extraction remains available and a missing line can be added',async()=>{await dialog.getByText('Compare with original fields and item lines',{exact:true}).click();await dialog.getByText('No item lines extracted',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Add missing item line',exact:true}).click();assert.equal(await dialog.getByRole('heading',{name:'All item lines (1)',exact:true}).count(),1);});
 await check('Reviewer can correct header, addresses, terms and missing item fields',async()=>{
  await dialog.getByRole('checkbox',{name:'Sample verify extraction warning',exact:true}).check();await dialog.getByLabel('Customer PO number',{exact:true}).fill('SAMPLE-REVIEW-PO');await dialog.getByLabel('Customer PO date',{exact:true}).fill('2026-11-23');await dialog.getByLabel('Contact person',{exact:true}).fill('Sample confirmed contact');await dialog.getByLabel('Customer email',{exact:true}).fill('customer@example.test');await dialog.getByLabel('Billing address line 1',{exact:true}).fill('Sample billing address');await dialog.getByLabel('Delivery address text',{exact:true}).fill('Sample delivery address');await dialog.getByLabel('Requested payment terms',{exact:true}).fill('Sample customer-supplied terms');
  await dialog.getByLabel(/^Quantity /).fill('2');await dialog.getByLabel(/^Unit price /).fill('123.456789');await dialog.getByLabel(/^UOM /).fill('NOS');
  const save=dialog.getByRole('button',{name:'Save review and prepare eligible draft',exact:true});assert.equal(await save.isDisabled(),true);await dialog.getByLabel('Review reason',{exact:true}).fill('Sample verification against original source');await save.click();await dialog.getByText('Review saved',{exact:true}).waitFor();
  const body=posts.at(-1);assert.equal(body.version,1);assert.deepEqual(body.resolutions.reviewedSourceIssues,[0]);assert.equal(body.resolutions.header.contactPerson,'Sample confirmed contact');assert.equal(body.resolutions.header.billingAddress.line1,'Sample billing address');assert.equal(body.resolutions.header.deliveryAddress.text,'Sample delivery address');assert.equal(body.resolutions.items[0].quantity,'2');assert.equal(body.resolutions.items[0].unitPrice,'123.456789');assert.equal(detail.normalized.header.poDate,null);await dialog.getByText('Ask the Owner to configure the quotation rules in Rules.',{exact:false}).waitFor();
 });
 await check('Stale save displays an actionable conflict and keeps entered corrections',async()=>{stale=true;await dialog.getByLabel('Customer phone',{exact:true}).fill('12345');await dialog.getByLabel('Review reason',{exact:true}).fill('Sample stale correction');await dialog.getByRole('button',{name:'Save review and prepare eligible draft',exact:true}).click();await dialog.getByText('Request changed. Reload the current version.',{exact:true}).waitFor();assert.equal(await dialog.getByLabel('Customer phone',{exact:true}).inputValue(),'12345');stale=false;});
 await check('Review drawer fits a mobile viewport',async()=>{await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));});
 await check('Existing quotation refresh sends no customer or header rewrite',async()=>{await dialog.getByRole('button',{name:'Close',exact:true}).click();detail={...detail,quotation_id:44,status:'PREPARED',blockers:[]};await page.goto('/incoming-requests?requestId='+id);await dialog.getByLabel('Review reason',{exact:true}).fill('Sample refresh');await dialog.getByRole('button',{name:'Refresh linked preparation',exact:true}).click();await dialog.getByText('Review saved',{exact:true}).waitFor();assert.deepEqual(posts.at(-1).resolutions,{});});
 await check('Read-only salesperson cannot edit or prepare requests',async()=>{grants=['sales_intake.read'];await page.reload();await dialog.getByText('Read-only request',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Refresh linked preparation',exact:true}).count(),0);assert.equal(await dialog.getByRole('button',{name:'Add missing item line',exact:true}).count(),0);});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.unexpectedApi,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{await browser?.close();await app?.close();fs.mkdirSync('verification-output/sales-intake/review',{recursive:true});fs.writeFileSync('verification-output/sales-intake/review/ui.json',JSON.stringify(report,null,2));}
