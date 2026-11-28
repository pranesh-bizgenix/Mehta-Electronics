import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const baseURL=process.env.CRM_RELEASE_URL?.replace(/\/$/,''),host=baseURL&&new URL(baseURL).hostname;
if(!host||!['mehta-controldesk.vercel.app',process.env.CRM_CANDIDATE_HOST].filter(Boolean).includes(host)||!/^mehta-controldesk(?:-[a-z0-9]+-umang-ratanis-projects)?\.vercel\.app$/.test(host))throw Error('Unexpected deployment origin.');
const owner=JSON.parse(fs.readFileSync('.vercel/acceptance/operating-test-accounts.private.json','utf8')).find(a=>a.role==='OWNER'&&a.verified);assert.ok(owner);
let bypass='';if(host!=='mehta-controldesk.vercel.app'){const b=fs.readFileSync('.vercel/acceptance/project-before-git-push.private.json'),meta=JSON.parse((b[0]===255&&b[1]===254?b.toString('utf16le'):b.toString('utf8')).replace(/^\uFEFF/,''));bypass=Object.keys(meta.protectionBypass??{})[0]||'';assert.ok(bypass);}
const out='verification-output/partner-portals/'+host;fs.mkdirSync(out,{recursive:true});const report={checks:[],errors:[],serverErrors:[],scope:'Actual deployed Owner sign-in and read-only staff pages. Optional MOCKED_UI customer/supplier fixtures exercise browser forms only; no partner records, approvals or offers are saved to RDS. Real services/HTTP/SQL are verified separately in rollback transactions.'};
const browser=await chromium.launch({channel:'chrome',headless:true});
const safeHeaders=request=>{const headers={...request.headers()};if(new URL(request.url()).origin===baseURL&&bypass)headers['x-vercel-protection-bypass']=bypass;else delete headers['x-vercel-protection-bypass'];return headers;};
const observe=page=>{page.setDefaultTimeout(60000);page.on('pageerror',e=>report.errors.push(e.message));page.on('response',r=>{if(r.status()>=500&&new URL(r.url()).origin===baseURL)report.serverErrors.push({path:new URL(r.url()).pathname,status:r.status()});});};
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS',name);};
try{
 const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000}}),page=await context.newPage();observe(page);
 await context.route('**/*',route=>{const req=route.request(),u=new URL(req.url());if(u.origin===baseURL&&!['GET','HEAD','OPTIONS'].includes(req.method())&&!['/api/auth/login','/api/auth/logout'].includes(u.pathname))return route.abort();return route.continue({headers:safeHeaders(req)});});
 await page.goto('/login');await page.locator('input[name=email]').fill(owner.email);await page.locator('input[name=password]').fill(owner.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/dashboard',{timeout:120000});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  for(const [path,title,apiPrefix]of [['/settings/portal-access','Partner account access','/api/crm/portal-admin/memberships'],['/support/portal-requests','Customer portal requests','/api/crm/partner-review/requests?kind=COMPLAINT'],['/purchasing/portal-replies','Supplier portal replies','/api/crm/partner-review/requests?kind=RFQ_REPLY'],['/sales/portal-responses','Customer portal responses','/api/crm/partner-review/acknowledgements']])await check(`Actual Owner read: ${path} at ${width}px`,async()=>{const [response]=await Promise.all([page.waitForResponse(r=>{const u=new URL(r.url());return (u.pathname+u.search).startsWith(apiPrefix);},{timeout:120000}),page.goto(path)]);assert.equal(response.status(),200);await page.getByRole('heading',{name:title,exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:`${out}/${path.replaceAll('/','-')}-${width}.png`,fullPage:true});});
 }
 await check('Actual Owner cannot impersonate a partner workspace',async()=>{await page.goto('/portal');await page.getByText('This workspace is reserved for independently reviewed customer and supplier accounts.').waitFor();});await context.close();
 if(process.env.CRM_PORTAL_UI_FIXTURES==='true')for(const kind of ['CUSTOMER','VENDOR'])for(const width of [1440,390]){
  const role=kind==='CUSTOMER'?'CUSTOMER_PORTAL':'VENDOR_PORTAL',context=await browser.newContext({baseURL,viewport:{width,height:1000}}),page=await context.newPage();observe(page);const now=new Date().toISOString(),rows=[],acks=[];let submitted=false,acknowledged=false;const pagination={page:1,pageSize:25,total:0,pages:0};
  const quote={id:900001,version:1,reference:'SAMPLE-PORTAL-QUOTE',status:'SENT',validUntil:'2035-12-31',total:'254.94',sourceHash:'a'.repeat(64),canAcknowledge:true,terms:'SAMPLE published terms',lines:[{itemId:900010,code:'SAMPLE-COMPONENT',description:'SAMPLE component',quantity:'2',uom:'Nos',unitPrice:'108.02',taxPercent:'18',netAmount:'216.05'}]},rfq={id:900002,version:1,reference:'SAMPLE-PORTAL-RFQ',status:'OPEN',replyBy:'2035-12-31',replyVersion:null,canReply:true,lines:[{itemId:900010,code:'SAMPLE-COMPONENT',description:'SAMPLE component',quantity:'2',uom:'Nos'}]};
  await context.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url()),path=u.pathname,json=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
   if(u.origin!==baseURL)return route.continue({headers:safeHeaders(req)});
   if(path==='/api/auth/me')return json({user:{id:900000,name:'SAMPLE partner',email:'sample-partner@example.test',role,status:'ACTIVE',mustChangePassword:false},permissions:[`portal.${kind.toLowerCase()==='customer'?'customer':'vendor'}.read`,`portal.${kind==='CUSTOMER'?'customer':'vendor'}.submit`],csrfToken:'sample-ui-only',mfa:{required:false,enrolled:false,verified:false}});
   if(path==='/api/v1/me/preferences')return json({data:{theme:'light',density:'comfortable',sidebarCollapsed:false,savedFilters:{}}});
   if(path==='/api/crm/portal/me')return json({kind,party:{id:900000,name:`SAMPLE ${kind.toLowerCase()} · browser fixture only`},company:{id:'00000000-0000-4000-8000-000000000001',name:'SAMPLE company'},note:'SAMPLE UI data only. No RDS business record is created.'});
   if(path==='/api/crm/portal/records'){const r=kind==='CUSTOMER'?quote:rfq;return json({data:[{...r,created_at:now}],pagination:{...pagination,total:1,pages:1}});}
   if(path.startsWith('/api/crm/portal/records/'))return json({data:kind==='CUSTOMER'?quote:rfq});
   if(path==='/api/crm/portal/requests'&&req.method()==='GET')return json({data:rows,pagination:{...pagination,total:rows.length,pages:rows.length?1:0}});
   if(path==='/api/crm/portal/acknowledgements'&&req.method()==='GET')return json({data:acks,pagination:{...pagination,total:acks.length,pages:acks.length?1:0}});
   if(path==='/api/crm/portal/requests'&&req.method()==='POST'){
    const b=req.postDataJSON();assert.equal(req.headers()['x-csrf-token'],'sample-ui-only');assert.equal(b.kind,kind==='CUSTOMER'?'COMPLAINT':'RFQ_REPLY');assert.match(b.requestKey,/^[0-9a-f-]{36}$/);assert.equal(b.customerId,undefined);assert.equal(b.vendorId,undefined);
    if(kind==='VENDOR'){assert.equal(b.rfqId,rfq.id);assert.equal(b.payload.lines[0].unitPrice,'100');assert.equal(b.payload.lines[0].discountPercent,'0');assert.equal(b.payload.chargesConfirmed,true);assert.equal(b.payload.approved,undefined);}
    submitted=true;const r={id:'00000000-0000-4000-8000-000000000002',kind:b.kind,status:'PENDING_REVIEW',submitted:b.payload,publicMessage:null,createdAt:now};rows.push(r);return json({data:r});
   }
   if(path==='/api/crm/portal/acknowledgements'&&req.method()==='POST'){const b=req.postDataJSON();assert.equal(b.entityKind,'QUOTATION');assert.equal(b.entityId,quote.id);assert.equal(b.version,1);assert.equal(b.sourceHash,quote.sourceHash);acknowledged=true;acks.push({id:'00000000-0000-4000-8000-000000000003',entity_kind:b.entityKind,entity_id:b.entityId,entity_version:1,decision:b.decision,message:b.message,created_at:now});return json({data:{id:acks[0].id}});}
   if(path.startsWith('/api/'))throw Error('Unexpected MOCKED_UI API request: '+req.method()+' '+path);
   return route.continue({headers:safeHeaders(req)});
  });
  await check(`MOCKED_UI ${kind.toLowerCase()} portal forms at ${width}px`,async()=>{
   await page.goto('/portal');await page.getByRole('heading',{name:`Welcome, SAMPLE ${kind.toLowerCase()} · browser fixture only`}).waitFor();
   if(kind==='CUSTOMER'){
    await page.getByLabel(/What do you need help with/).fill('SAMPLE product concern');await page.getByLabel(/Describe the issue/).fill('SAMPLE request requiring staff review.');await page.getByRole('button',{name:'Send to Support review'}).click();await page.getByText('Your request is saved for Support review.',{exact:false}).waitFor();assert.ok(submitted);
    await page.getByRole('button',{name:quote.reference,exact:true}).click();const drawer=page.getByRole('dialog');await drawer.getByText('108.02',{exact:true}).waitFor();assert.equal(await drawer.getByText('Discount %',{exact:true}).count(),0);await drawer.getByRole('button',{name:'Save my response'}).click();await page.getByText('Your acknowledgement is saved in the history.').waitFor();assert.ok(acknowledged);
   }else{
    await page.getByRole('button',{name:rfq.reference,exact:true}).click();const drawer=page.getByRole('dialog');await drawer.getByLabel('Unit price INR',{exact:false}).fill('100');await drawer.getByLabel('Discount %',{exact:false}).fill('0');await drawer.getByLabel(/^GST %/).fill('18');await drawer.getByLabel('Offer valid until',{exact:false}).fill('2035-12-31');await drawer.getByLabel('Offer reference or supporting evidence',{exact:false}).fill('SAMPLE supplier offer reference');await drawer.getByLabel('I have confirmed all applicable charges; omitted charge types are not payable.').check();await drawer.getByRole('button',{name:'Send offer for review'}).click();await page.getByText('Your offer is saved for Purchasing review.',{exact:false}).waitFor();assert.ok(submitted);
   }
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));await page.screenshot({path:`${out}/MOCKED_UI-${kind.toLowerCase()}-${width}.png`,fullPage:true});
  });await context.close();
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.serverErrors,[]);report.passed=true;
}catch(e){report.error=[owner.password,bypass].filter(Boolean).reduce((s,v)=>s.replaceAll(v,'[private]'),String(e.message).split(/\r?\n/)[0]);process.exitCode=1;}
finally{await browser.close();fs.writeFileSync(`${out}/browser-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed||false,checks:report.checks.length,error:report.error}));}
