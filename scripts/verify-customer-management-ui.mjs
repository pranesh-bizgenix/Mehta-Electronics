import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Browser presentation checks. Every API request is intercepted; fictional
// fixtures live only in this process. Persistence is verified separately.
if(!process.argv.includes('--existing-server'))throw new Error('Use --existing-server for the existing 127.0.0.1:3000 listener.');
const output=path.resolve('verification-output/customer-management/ui');fs.mkdirSync(output,{recursive:true});
const report={mode:'Fictional browser adapter; no database calls',checks:[],unexpected:[],errors:[]};
const company='00000000-0000-4000-8000-000000000065',uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),now=new Date().toISOString();
let userId=201,grants=['*'],addresses=[],activities=[],opportunities=[],merges=[],merged=false;
const customer={id:101,name:'SAMPLE customer management',status:'ACTIVE',customer_code:'SAMPLE-101',gstin:null,pan:null,credit_limit:'0',credit_days:0,payment_terms:null,billing_address:null,shipping_address:null,city:null,state:null,pincode:null,notes:'Fictional browser fixture',owner_id:201,owner_name:'Sample owner',created_at:now,updated_at:now,profile:{},contacts:[],partMappings:[],onboarding:null,tally:{linked:false,matchCount:0,companyId:null,name:null},dues:{available:false,financialAccess:true,note:'Not connected'}};
const identity=()=>({requestedId:101,canonicalId:merged?102:101,merged,customerIds:merged?[102,101]:[101],relatedCustomers:[{id:101,name:customer.name,status:merged?'INACTIVE':'ACTIVE'}],note:'SAMPLE only; original records retained.'});
let controls={classification:'EXISTING',pricing_class:'MEDIUM_DISCOUNT',credit_exempt:false,version:1};
const policy={company_id:company,version:1,value:{classes:{MEDIUM_DISCOUNT:{strategy:'MANUAL_REVIEW'}},classification:{basis:'PO',statuses:['ACTIVE'],periodDays:null,existingMinimum:1,potentialBelow:null}}};
let browser,page;
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS',name);};
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({baseURL:'http://127.0.0.1:3000',viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await context.route('**/api/**',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname,method=req.method(),body=method==='GET'?null:req.postDataJSON(),reply=(data,status=200)=>route.fulfill({status,json:data});
  if(p==='/api/auth/me')return reply({user:{id:userId,name:'SAMPLE owner',email:'sample@example.test',role:grants.includes('*')?'OWNER':'EXECUTIVE',status:'ACTIVE',mustChangePassword:false},permissions:grants,csrfToken:'SAMPLE-NOT-REAL',mfa:{required:false,verified:true,enrolled:false}});
  if(p==='/api/v1/me/preferences')return reply({data:{theme:'light',density:'comfortable',sidebarCollapsed:false,savedFilters:{}}});
  if(p==='/api/v1/me/badges')return reply({data:{}});
  if(p==='/api/v1/notifications')return reply({data:[]});
  if(['/api/tally/read-companies','/api/tally/companies'].includes(p))return reply({data:[{id:company,name:'SAMPLE company',display_name:'SAMPLE company'}]});
  if(p==='/api/tally-write/banner')return reply({data:{live:false}});
  if(p==='/api/v1/tally/visibility/freshness')return reply({data:[]});
  if(p==='/api/crm/customers/101')return reply({data:{...customer,status:merged?'INACTIVE':'ACTIVE',identity:identity()}});
  if(p==='/api/crm/owners')return reply({data:[{id:201,name:'Sample owner'},{id:202,name:'Sample reviewer'}]});
  if(p==='/api/v1/customer-controls/101'){if(method==='PUT')controls={...controls,classification:body.classification,pricing_class:body.pricingClass,version:controls.version+1};return reply({data:controls});}
  const base='/api/v1/customers/101/';
  if(p===base+'identity')return reply({data:identity()});
  if(p===base+'addresses'){
   if(method==='POST'){assert.ok(req.headers()['idempotency-key']);addresses.push({id:uuid(1),customer_id:101,label:body.value.label,kind:body.value.kind,line1:body.value.line1,line2:'',city:body.value.city,state_code:body.value.stateCode,postal_code:'',country_code:body.value.countryCode,contact_name:'',phone:'',is_default:body.value.isDefault,status:'ACTIVE',version:1});return reply({data:addresses.at(-1)});}
   return reply({data:{identity:identity(),data:addresses}});
  }
  if(p===base+'activities'){
   if(method==='POST'){activities.push({id:uuid(2),customer_id:101,kind:body.value.kind,title:body.value.title,notes:body.value.notes,occurred_at:body.value.occurredAt,follow_up_at:body.value.followUpAt,owner_id:201,owner_name:'Sample owner',status:'ACTIVE',version:1});return reply({data:activities.at(-1)});}
   return reply({data:{data:activities}});
  }
  if(p===base+'opportunities'){
   if(method==='POST'){opportunities.push({id:uuid(3),customer_id:101,title:body.value.title,stage:body.value.stage,expected_value:body.value.expectedValue,expected_close:null,notes:body.value.notes,owner_id:201,owner_name:'Sample owner',version:1});return reply({data:opportunities.at(-1)});}
   return reply({data:{data:opportunities}});
  }
  if(p===base+'commercial-policy')return reply({data:{policy,context:{pricingClass:controls.pricing_class,companyId:company,policyVersion:1,strategy:{strategy:'MANUAL_REVIEW'}}}});
  if(p===base+'classification')return reply({data:{state:'EVALUATED',classification:'EXISTING',tier:'ELITE',count:5,unscopedRecords:0,restriction:controls.classification,policyVersion:1}});
  if(p===base+'timeline')return reply({data:{identity:identity(),data:[{kind:'RETURN',id:uuid(4),reference:'SAMPLE-RETURN',title:'Sample replacement history',status:'RESOLVED',customer_id:101,created_at:now,href:'/operations?kind=RETURN&open='+uuid(4),amount:null}],pagination:{page:1,pageSize:25,total:1,pages:1}}});
  if(p===base+'merge-preview')return reply({data:{source:{id:101,name:customer.name},target:{id:102,name:'SAMPLE survivor'},blockers:[],openWork:{},fingerprint:'a'.repeat(64),note:'Fictional review'}});
  if(p===base+'merges'){
   if(method==='POST'){merges.push({id:uuid(5),source_id:101,target_id:102,source_name:customer.name,target_name:'SAMPLE survivor',reason:body.reason,status:'PENDING_APPROVAL',created_by:201,version:1});return reply({data:merges.at(-1)});}
   return reply({data:merges});
  }
  report.unexpected.push(method+' '+p);return reply({error:'Outside customer UI verification'},404);
 });
 page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('/customers/101');await page.getByRole('heading',{name:customer.name,exact:true}).waitFor();
 await check('Address book form saves a separate delivery location',async()=>{
  await page.getByRole('tab',{name:'Address book',exact:true}).click();await page.getByRole('button',{name:'Add address',exact:true}).click();const d=page.getByRole('dialog');
  for(const [label,value]of [['Location label','SAMPLE Warehouse'],['Address line 1','Fictional location'],['City','Test city'],['State code','33'],['Country code (IN for India)','IN'],['Reason','Sample UI verification']])await d.getByLabel(label).fill(value);
  await d.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('SAMPLE Warehouse',{exact:true}).waitFor();
 });
 await check('Calls and visits form records outcome and responsible person',async()=>{
  await page.getByRole('tab',{name:'Calls & visits',exact:true}).click();await page.getByRole('button',{name:'Log activity',exact:true}).click();const d=page.getByRole('dialog');
  await d.getByLabel('Title').fill('SAMPLE customer call');await d.getByLabel('Notes and outcome').fill('Sample discussion only');await d.getByLabel('Activity time').fill('2026-11-20T10:00');await d.getByLabel('Reason').fill('Sample UI verification');await d.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('SAMPLE customer call',{exact:true}).waitFor();
 });
 await check('Opportunity form captures stage and expected value',async()=>{
  await page.getByRole('tab',{name:'Opportunities',exact:true}).click();await page.getByRole('button',{name:'Add opportunity',exact:true}).click();const d=page.getByRole('dialog');await d.getByLabel('Opportunity title').fill('SAMPLE proposal');await d.getByLabel('Expected value (INR)').fill('100.25');await d.getByLabel('Reason').fill('Sample UI verification');await d.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('SAMPLE proposal',{exact:true}).waitFor();
 });
 await check('Business history links the original return/replacement record',async()=>{await page.getByRole('tab',{name:'Business history',exact:true}).click();await page.getByRole('link',{name:'SAMPLE-RETURN',exact:true}).waitFor();assert.ok((await page.getByRole('link',{name:'SAMPLE-RETURN',exact:true}).getAttribute('href')).includes('kind=RETURN'));});
 await check('Pricing and history rules show the exact-five Elite result',async()=>{await page.getByRole('tab',{name:'Pricing & classification',exact:true}).click();await page.getByLabel('Company for customer rules').selectOption(company);await page.getByText(/Tier: Elite/).waitFor();assert.equal(await page.getByRole('button',{name:'Apply evaluated classification',exact:true}).isDisabled(),true);});
 await check('Duplicate review requests an independent approval and hides self approval',async()=>{await page.getByRole('tab',{name:'Duplicate review',exact:true}).click();await page.getByLabel('Surviving customer ID').fill('102');await page.getByRole('button',{name:'Preview duplicate merge',exact:true}).click();await page.getByLabel('Merge request reason').fill('Sample UI independent review');await page.getByRole('button',{name:'Request independent merge approval',exact:true}).click();await page.getByText('Pending approval',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Approve merge',exact:true}).count(),0);});
 await page.screenshot({path:path.join(output,'duplicate-review-desktop.png'),fullPage:true});
 await check('A different reviewer sees approve and reject controls',async()=>{userId=202;await page.reload();await page.getByRole('tab',{name:'Duplicate review',exact:true}).click();await page.getByRole('button',{name:'Approve merge',exact:true}).waitFor();await page.getByRole('button',{name:'Reject merge',exact:true}).waitFor();});
 await check('Customer address book fits a mobile screen',async()=>{await page.setViewportSize({width:390,height:844});await page.getByRole('tab',{name:'Address book',exact:true}).click();await page.getByText('SAMPLE Warehouse',{exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,'address-book-mobile.png'),fullPage:true});});
 await check('Merge permission is hidden for a sales user',async()=>{grants=['customers.read','customers.update','enquiries.read','enquiries.update'];await page.reload();await page.getByRole('heading',{name:customer.name,exact:true}).waitFor();assert.equal(await page.getByRole('tab',{name:'Duplicate review',exact:true}).count(),0);});
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.unexpected,[]);report.passed=report.checks.length;
}catch(e){report.failure=e.message;if(page){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});fs.writeFileSync(path.join(output,'failure-dom.txt'),await page.locator('body').innerText());}throw e;}finally{await browser?.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));}
