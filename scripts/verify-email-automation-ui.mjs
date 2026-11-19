import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
import {emailAutomationRoutes} from '../src/modules/email-automation/routes.js';

// Browser API interception only. No accounts, grants or mailbox fixtures are persisted.
const base='http://127.0.0.1:3000',out='verification-output/email-automation/2026-11-19';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const errors=[],checks=[];
const routes=emailAutomationRoutes({config:{emailAutomationEnabled:true},db:{prepare:()=>({run:async()=>{},get:async()=>{throw Error('No real browser-fixture health check');}})},route:(method,pattern,permission,handler)=>({method,pattern,permission,handler}),json(res,status,body){res.status=status;res.body=body;}});
let permissions=['*'],fail=false;
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/api/**',async intercepted=>{
  const url=new URL(intercepted.request().url()),path=url.pathname;
  let body={data:{}},status=200;
  if(path==='/api/auth/me')body={user:{id:1,name:'Sample UI tester',role:'OWNER',status:'ACTIVE',mustChangePassword:false},permissions,csrfToken:'sample-ui-only',mfa:{required:false,enrolled:false,verified:false}};
  else if(path==='/api/v1/me/preferences')body={data:{theme:'dark',density:'comfortable',sidebarCollapsed:false,savedFilters:{}}};
  else if(path==='/api/tally/read-companies')body={data:[]};
  else if(path.startsWith('/api/v1/email-automation/')){
   if(fail){await intercepted.fulfill({status:503,json:{error:{code:'UNAVAILABLE',message:'Sample unavailable response'}}});return;}
   const route=routes.find(r=>r.pattern===path)||routes.find(r=>r.pattern.endsWith('/:id')&&path.startsWith(r.pattern.slice(0,-3)));
   if(!route)status=404;
   else{const res={};await route.handler({res,url,params:{id:decodeURIComponent(path.split('/').at(-1))},user:{id:1,role:'OWNER'}});body=res.body;status=res.status;}
  }
  await intercepted.fulfill({status,json:body});
 });
 for(const [path,title] of [['inbox','Unified email inbox'],['attachments','Attachment manager'],['processing','Processing monitor'],['dashboard','Automation dashboard'],['integrations','Integration monitor'],['errors','Error center']]){
  await page.goto(base+'/email-automation/'+path);await page.getByRole('heading',{name:title,exact:true}).waitFor();
  if(path!=='integrations')await page.getByText('Sample data — fictional demonstration',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/^(send|retry|replay|approve|edit)$/i}).count(),0);
  await page.screenshot({path:`${out}/${path}-desktop.png`,fullPage:true});checks.push(path+' desktop renders');
 }
 await page.goto(base+'/email-automation/inbox');await page.getByRole('link',{name:'Sample: terminal block enquiry',exact:true}).click();await page.getByRole('heading',{name:'Email details',exact:true}).waitFor();await page.getByText('sample-requirements.pdf',{exact:true}).waitFor();checks.push('Email details shares attachment metadata');
 await page.goto(base+'/email-automation/inbox');const search=page.getByPlaceholder('Search these records');await search.fill('not-present');await page.getByRole('heading',{name:'No matching records',exact:true}).waitFor();checks.push('Empty search state');
 await page.goto(base+'/email-automation/inbox');await page.getByRole('button',{name:'Administration',exact:false}).click();await page.getByRole('link',{name:'Users & roles',exact:true}).waitFor();checks.push('Administration still expands');
 await page.getByRole('button',{name:'EMAIL AUTOMATION',exact:false}).click();assert.equal(await page.getByRole('link',{name:'Unified email inbox',exact:true}).count(),0);checks.push('Email automation collapses independently');
 await page.setViewportSize({width:390,height:844});await page.goto(base+'/email-automation/attachments');await page.getByRole('heading',{name:'Attachment manager',exact:true}).waitFor();await page.getByText('sample-requirements.pdf',{exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'No document-level mobile overflow');await page.screenshot({path:`${out}/attachments-mobile.png` ,fullPage:true});checks.push('390px mobile layout');
 fail=true;await page.goto(base+'/email-automation/inbox');await page.getByRole('button',{name:/try again/i}).waitFor();checks.push('API failure shows recovery state');fail=false;
 permissions=[];await page.goto(base+'/email-automation/inbox');await page.getByText('Your role does not have access to this screen.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'EMAIL AUTOMATION',exact:false}).count(),0);checks.push('Ungranted role has no navigation or screen access');
 assert.deepEqual(errors,[]);await fs.writeFile(out+'/ui-results.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
} finally {await browser.close();}
