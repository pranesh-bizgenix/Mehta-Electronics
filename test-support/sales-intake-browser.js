import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {createApp} from '../src/app.js';
import {createControlDeskServer} from '../src/controldesk-server.js';
import {tokenDigest} from '../src/security.js';

/** Actual persisted service/API/browser checks, inside the caller's outer
 * authorized rollback. The only listener is the existing 127.0.0.1:3000. */
export async function verifySalesIntakeBrowser(f,check){
 const output=path.resolve('verification-output/sales-intake/persisted-browser');fs.mkdirSync(output,{recursive:true});
 const sessions={},errors=[];let server,browser,app,externalCalls=0,rejectedConnectorRequests=0;
 try{
  for(const role of ['owner','sales','store','lead','manager']){
   const token=randomBytes(24).toString('hex'),csrf=randomBytes(24).toString('hex');sessions[role]={token,csrf};
   await f.db.prepare("INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at,mfa_verified_at) VALUES(?,?,?,clock_timestamp()+interval '3 hours',clock_timestamp()) RETURNING id").get(f.users[role].id,tokenDigest(token),csrf);
  }
  app=createApp({db:f.db,config:{...f.config,localReviewAccess:false},fetchImpl:async()=>{externalCalls++;throw new Error('No external calls in rollback verification');},sendMailImpl:async()=>{throw new Error('No sending in verification');}});
  // A running Windows connector may independently call the usual listener.
  // Refuse those requests before the app can rotate a real credential or
  // ingest a real upload into this rollback. No connector code is changed.
  const focusedApi=(req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname.startsWith('/api/connectors/')||pathname.startsWith('/api/ingest/tally/')){rejectedConnectorRequests++;res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'Focused rollback verification does not accept connector traffic.'}));return;}return app(req,res);};
  server=await createControlDeskServer({api:focusedApi,port:3000});
  await new Promise((resolve,reject)=>{server.server.once('error',reject);server.server.listen(3000,'127.0.0.1',resolve);});
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({baseURL:'http://127.0.0.1:3000',viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  // No principal intake, quotation or availability API is mocked. Exclude
  // unrelated live registers so screenshots cannot include other business data.
  for(const pattern of ['**/api/crm/logistics/orders*','**/api/crm/logistics/pos*','**/api/crm/logistics/tally*','**/api/v1/tally/visibility/freshness*'])await context.route(pattern,route=>route.fulfill({status:503,json:{error:'Ancillary register excluded from focused rollback verification.'}}));
  await context.addInitScript(({company})=>localStorage.setItem('controldesk.scope',JSON.stringify({companyId:company,period:'month'})),{company:f.company});
  const login=async role=>{await context.clearCookies();await context.addCookies([{name:'crm_session',value:sessions[role].token,url:'http://127.0.0.1:3000',httpOnly:true,sameSite:'Strict'}]);};
  const page=await context.newPage();page.setDefaultTimeout(300000);page.on('pageerror',e=>errors.push(e.message));
  const call=async(role,method,url,data,status=200)=>{const r=await context.request.fetch(url,{method,headers:{cookie:`crm_session=${sessions[role].token}`,'x-csrf-token':sessions[role].csrf},data,timeout:600000});const body=await r.json();assert.equal(r.status(),status,JSON.stringify(body));return body.data??body;};
  // This actual machine endpoint must authenticate without a staff cookie and
  // must not weaken the separate session/CSRF mutation boundary.
  let intake,manualIntake;
  for(const [key,basis,messageType]of [['po','PO','CUSTOMER_PO'],['enquiry','ENQUIRY','LEAD_ENQUIRY']])for(const count of [4,5,6])await check('CONFIRMED-'+basis+'-TIER-'+count,'Real distinct '+basis+' counts use the confirmed five-and-above Elite boundary',async()=>{
   const {SalesIntakeService}=await import('../src/modules/sales-intake/service.js?confirmed-tier-verification'),{TransactionRunner}=await import('../src/core/runtime.js');
   const rows=basis==='PO'?await f.db.prepare('SELECT DISTINCT p.id FROM customer_pos p JOIN crm_sales_intakes i ON i.customer_po_id=p.id WHERE p.legacy_customer_id=? AND i.company_id=? ORDER BY p.id').all(f.customer.id,f.company):await f.db.prepare('SELECT DISTINCT e.id FROM enquiries e JOIN crm_sales_intakes i ON i.enquiry_id=e.id WHERE e.customer_id=? AND i.company_id=? ORDER BY e.id').all(f.customer.id,f.company);assert.ok(rows.length>=6);
   const keep=rows.slice(0,count).map(r=>r.id),rollback=new Error('Expected rollback of controlled count fixture'),service=new SalesIntakeService({db:f.db,work:f.modules.services.work}),definition={basis,statuses:basis==='PO'?['ACTIVE']:['NEW','QUALIFIED','QUOTED'],includeCurrent:true,threshold:5,exactlyFive:'ELITE',companyScoped:true};
   await assert.rejects(()=>new TransactionRunner(f.db).run(f.users.owner,f.tag+' isolated tier boundary fixture',async()=>{
    if(basis==='PO')await f.db.prepare("UPDATE customer_pos SET status=CASE WHEN id=ANY(?::uuid[]) THEN 'ACTIVE' ELSE 'ARCHIVED' END WHERE legacy_customer_id=?").run(keep,f.customer.id);else await f.db.prepare("UPDATE enquiries SET status=CASE WHEN id=ANY(?::integer[]) THEN 'NEW' ELSE 'CANCELLED' END WHERE customer_id=?").run(keep,f.customer.id);
    const result=await service.classify({company_id:f.company,customer_po_id:basis==='PO'?keep[0]:null,enquiry_id:basis==='ENQUIRY'?keep[0]:null},f.customer,{messageType},{version:1,value:{tiers:{[key]:definition}}});assert.equal(result.count,count);assert.equal(result.recordIds.length,count);assert.equal(result.tier,count<5?'EARLY_BIRD':'ELITE');assert.equal(result.state,'CLASSIFIED');throw rollback;
   }),error=>error===rollback);
   return {count,expectedTier:count<5?'EARLY_BIRD':'ELITE',fixtureChanges:'ROLLED_BACK'};
  });
  await check('CUSTOMER-HANDLER-BOUNDARY','A differently owned integration retains the request for review without creating another salesperson\'s PO',async()=>{
   const {randomUUID}=await import('node:crypto'),{SalesIntakeService}=await import('../src/modules/sales-intake/service.js?handler-verification');
   const staff=await f.db.prepare("INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(?,?,'EXECUTIVE','not-a-login',0) RETURNING id,role").get(f.tag+'_other_sales',f.tag+'_other_sales@example.test');
   const credential=await f.credentials.create(f.users.owner,{id:randomUUID(),label:f.tag+'_scoped_other_handler',scopes:['automation.write.intake'],companyIds:[f.company],ownerId:staff.id,backupOwnerId:f.users.owner.id,expiresAt:new Date(Date.now()+3600000).toISOString(),ratePerMinute:100,ipAllowlist:[],reason:f.tag+' explicit handler-boundary fixture'});
   const principal=await f.credentials.authenticate({authorization:'Bearer '+credential.token,companyId:f.company,scope:'automation.write.intake',peer:'127.0.0.1'}),service=new SalesIntakeService({db:f.db,work:f.modules.services.work});
   const received=await service.receive(principal,f.payload(910)),row=await f.db.prepare('SELECT * FROM crm_sales_intakes WHERE id=?').get(received.id);assert.equal(row.status,'NEEDS_REVIEW');assert.equal(row.customer_po_id,null);assert.equal(row.quotation_id,null);assert.ok(row.blockers.includes('CUSTOMER_HANDLER_REVIEW_REQUIRED'));
   await assert.rejects(()=>service.detail(staff,row.id,f.company),{status:404});
   const reviewed=await service.resolve(f.users.sales,row.id,f.company,{version:row.version,resolutions:{},reason:f.tag+' proper customer handler review'});assert.ok(reviewed.customer_po_id);assert.ok(reviewed.quotation_id);return {intakeId:row.id,quotationId:reviewed.quotation_id};
  });
  await check('PERSISTED-WRITE-GUARDS','Direct writes and original-source rewrites are refused by the real database',async()=>{
   const row=await f.db.prepare('SELECT id FROM crm_sales_intakes WHERE company_id=? ORDER BY received_at LIMIT 1').get(f.company);
   const setting=await f.db.prepare("SELECT current_setting('mehta.sales_intake_write',true) AS value").get();assert.notEqual(setting.value,'authorized');
   await assert.rejects(()=>f.db.prepare('UPDATE crm_sales_intakes SET version=version+1 WHERE id=?').run(row.id),/Use authorised sales intake services/);
   const {salesWork}=await import('../src/modules/sales-intake/shared.js');
   await assert.rejects(()=>salesWork(f.db,f.users.owner,f.tag+' immutable original check',()=>f.db.prepare("UPDATE crm_sales_intakes SET original_payload='{}'::jsonb WHERE id=?").run(row.id)),/Original extraction is immutable/);
   await assert.rejects(()=>salesWork(f.db,f.users.owner,f.tag+' immutable policy history check',()=>f.db.prepare('UPDATE crm_sales_intake_policy_versions SET reason=? WHERE company_id=?').run(f.tag+' forbidden history update',f.company)),/Intake evidence and events are immutable/);
  });
  await check('PERSISTED-QUEUE-FILTERS','Warehouse paging/search/status and assigned-only reads query the actual records',async()=>{
   const {AvailabilityService}=await import('../src/modules/sales-intake/availability.js?queue-verification');
   const queue=new AvailabilityService({db:f.db}),all=await queue.list(f.users.lead,f.company),page2=await queue.list(f.users.lead,f.company,new URLSearchParams({page:'2'}));assert.ok(all.length>10);assert.equal(page2.length,0);
   const approved=await queue.list(f.users.lead,f.company,new URLSearchParams({status:'AVAILABILITY_APPROVED'}));assert.ok(approved.length>0);assert.ok(approved.every(r=>r.status==='AVAILABILITY_APPROVED'));
   assert.equal((await queue.list(f.users.lead,f.company,new URLSearchParams({search:'NO_MATCH_'+f.tag}))).length,0);assert.ok((await queue.list(f.users.store,f.company)).every(r=>r.assigned_store_id===f.users.store.id));
  });
  await check('BROWSER-INGEST','Scoped machine delivery creates a real linked draft and replay reuses it',async()=>{
   const p=f.payload(800),url='/api/v1/automation/intake?companyId='+f.company;
   const deliver=()=>context.request.post(url,{headers:{authorization:'Bearer '+f.credential.token,'idempotency-key':p.eventId},data:p,timeout:600000});
   let r=await deliver();assert.ok(r.status()===200||r.status()===201,await r.text());const receipt=await r.json();intake=receipt.data??receipt;assert.ok(intake.id);r=await deliver();assert.ok(r.ok());assert.equal(((await r.json()).data??{}).id,intake.id);
   const wrongCompany=await context.request.post('/api/v1/automation/intake?companyId=00000000-0000-4000-8000-000000000999',{headers:{authorization:'Bearer '+f.credential.token},data:p,timeout:600000});assert.equal(wrongCompany.status(),403);
   await call('store','POST','/api/crm/sales-intake/'+intake.id+'/review?companyId='+f.company,{version:1,reason:f.tag+' unauthorized review'},403);
   const noCsrf=await context.request.post('/api/crm/sales-intake/'+intake.id+'/review?companyId='+f.company,{headers:{cookie:`crm_session=${sessions.owner.token}`},data:{version:1,reason:f.tag+' CSRF denial'}});assert.equal(noCsrf.status(),403);
   return {intakeId:intake.id};
  });
  await check('CONCURRENT-HTTP-DELIVERIES','Ten simultaneous HTTP deliveries produce one linked record set (rollback DB harness serializes sessions)',async()=>{
   const p=f.payload(801),url='/api/v1/automation/intake?companyId='+f.company;
   const responses=await Promise.all(Array.from({length:10},()=>context.request.post(url,{headers:{authorization:'Bearer '+f.credential.token},data:p,timeout:1200000})));
   const receipts=[];for(const r of responses){assert.ok(r.status()===200||r.status()===201,await r.text());receipts.push((await r.json()).data);}
   assert.equal(new Set(receipts.map(r=>r.id)).size,1);assert.equal(receipts.filter(r=>!r.duplicate).length,1);
   const count=await f.db.prepare('SELECT count(*)::integer AS n,count(DISTINCT quotation_id)::integer AS quotations,count(DISTINCT customer_po_id)::integer AS pos FROM crm_sales_intakes WHERE company_id=? AND message_id=?').get(f.company,p.source.messageId);assert.deepEqual(count,{n:1,quotations:1,pos:1});return {intakeId:receipts[0].id,requests:10,limitation:'Concurrent HTTP protocol check; independent database contention is evidenced separately by the allocation-lock test, not by this serialized harness.'};
  });
  await login('sales');
  for(let i=0;i<10;i++)await check('PERSISTED-SCREEN-'+(i+1),'Open a distinct saved customer PO in the browser against actual APIs',async()=>{
   const row=await f.db.prepare('SELECT id,quotation_id FROM crm_sales_intakes WHERE company_id=? AND message_id=?').get(f.company,f.tag+'_message_'+i);assert.ok(row?.quotation_id);
   await page.goto('/incoming-requests?requestId='+row.id);const d=page.getByRole('dialog');await d.getByRole('heading',{name:'Request details',exact:true}).waitFor();await d.getByRole('link',{name:'Quotation #'+row.quotation_id,exact:true}).waitFor();assert.ok((await d.innerText()).includes(f.tag+'_PO_'+i));await d.getByRole('button',{name:'Close',exact:true}).click();return {intakeId:row.id,quotationId:row.quotation_id};
  });
  await check('BROWSER-SALES','Sales opens the saved source and canonical linked quotation',async()=>{
   await page.goto('/incoming-requests?requestId='+intake.id);const d=page.getByRole('dialog');await d.getByRole('heading',{name:'Request details',exact:true}).waitFor();await d.getByRole('link',{name:/^Quotation #/}).waitFor();assert.ok((await d.innerText()).includes(f.tag+'_PO_800'));await page.screenshot({path:path.join(output,'saved-intake.png'),fullPage:true});await d.getByRole('button',{name:'Close',exact:true}).click();
   const detail=await call('owner','GET','/api/crm/sales-intake/'+intake.id+'?companyId='+f.company);intake={...intake,...detail};
   await page.goto('/quotations/'+detail.quotation_id);await page.getByRole('heading',{name:'Warehouse availability',exact:true}).waitFor();assert.ok((await page.locator('main').innerText()).includes('Review required'));
   return {intakeId:intake.id,quotationId:detail.quotation_id};
  });
  await check('BROWSER-REVIEW','Sales corrects a missing price through the UI while the original extraction remains unchanged',async()=>{
   const row=await f.db.prepare('SELECT id,original_payload FROM crm_sales_intakes WHERE company_id=? AND message_id=?').get(f.company,f.tag+'_message_300');assert.equal(row.original_payload.items[0].unitPrice,null);
   await page.goto('/incoming-requests?requestId='+row.id);const d=page.getByRole('dialog');await d.getByLabel('Unit price 1',{exact:true}).fill('100');await d.getByLabel('Review reason',{exact:true}).fill(f.tag+' actual browser price confirmation');await d.getByRole('button',{name:'Save review and prepare eligible draft',exact:true}).click();await d.getByRole('link',{name:/^Quotation #/}).waitFor();const saved=await f.db.prepare('SELECT original_payload,resolutions,quotation_id FROM crm_sales_intakes WHERE id=?').get(row.id);assert.equal(saved.original_payload.items[0].unitPrice,null);assert.equal(saved.resolutions.items[0].unitPrice,'100');assert.ok(saved.quotation_id);await d.getByRole('button',{name:'Close',exact:true}).click();return {intakeId:row.id,quotationId:saved.quotation_id};
  });
  await check('MANUAL-ENQUIRY-TRANSITION','Existing quotation creation links an intake enquiry exactly once without a second enquiry',async()=>{
   const p=f.payload(900,'LEAD_ENQUIRY');p.items[0].unitPrice=null;p.items[0].taxableAmount=null;const received=await f.services.intake.receive(f.principal,p);manualIntake=received.id;const source=await f.db.prepare('SELECT enquiry_id,quotation_id FROM crm_sales_intakes WHERE id=?').get(received.id);assert.ok(source.enquiry_id);assert.equal(source.quotation_id,null);
   const draft={companyId:f.company,customerId:f.customer.id,enquiryId:source.enquiry_id,validUntil:new Date(Date.now()+86400000).toISOString().slice(0,10),placeOfSupply:'33',supplyType:'DOMESTIC_STANDARD',reason:f.tag+' manual enquiry conversion',lines:[{itemId:f.items[0].id,sourceLineId:'1',description:f.items[0].description,quantity:'1',unitPrice:'100',discountPercent:'0',taxPercent:'18'}]};
   const quote=await call('sales','POST','/api/crm/quotations',draft,201);const linked=await f.db.prepare('SELECT enquiry_id,quotation_id FROM crm_sales_intakes WHERE id=?').get(received.id);assert.equal(linked.enquiry_id,source.enquiry_id);assert.equal(linked.quotation_id,quote.id);await call('sales','POST','/api/crm/quotations',draft,409);return {intakeId:received.id,enquiryId:source.enquiry_id,quotationId:quote.id};
  });
  await check('BROWSER-NOTIFICATION','Persisted notification opens its actual record and marks only that notification read',async()=>{
   const notifications=await call('sales','GET','/api/v1/notifications'),n=notifications.find(n=>!n.read&&['QUOTATION','ENQUIRY','SALES_INTAKE'].includes(n.entityType));assert.ok(n);
   await page.getByRole('button',{name:/^Notifications/}).click();
   const finished=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/v1/notifications/${n.id}/read`&&r.status()===200);
   await page.getByRole('menu').getByRole('button').filter({hasText:n.title}).first().click();await finished;
   const pathname=n.entityType==='QUOTATION'?'/quotations/'+n.entityId:n.entityType==='ENQUIRY'?'/enquiries':'/incoming-requests';await page.waitForURL(u=>u.pathname===pathname);
   assert.equal((await call('sales','GET','/api/v1/notifications')).find(row=>row.id===n.id)?.read,true);return {notificationId:n.id,entityId:n.entityId};
  });
  let availability=await call('owner','GET','/api/crm/quotations/'+intake.quotation_id+'/availability');
  await login('lead');
  await check('BROWSER-ASSIGN','Logistics assigns the persisted pre-order request to Store staff',async()=>{
   await page.goto('/logistics');await page.getByLabel('Warehouse request company',{exact:true}).selectOption(f.company);await page.getByRole('button',{name:new RegExp(`^Quotation #${intake.quotation_id} · v1$`)}).click();const d=page.getByRole('dialog');await d.getByLabel('Assigned Store staff',{exact:true}).selectOption(String(f.users.store.id));await d.getByLabel('Warehouse action reason',{exact:true}).fill(f.tag+' actual browser assignment');await d.getByRole('button',{name:'Assign warehouse check',exact:true}).click();await d.getByText('CHECKING',{exact:true}).waitFor();
  });
  await login('store');
  await check('BROWSER-STORE','Assigned Store records checks through the existing UI without financial access',async()=>{
   await page.reload();await page.getByRole('button',{name:new RegExp(`^Quotation #${intake.quotation_id} · v1$`)}).click();const d=page.getByRole('dialog');await d.getByLabel('Warehouse 1',{exact:true}).selectOption(f.tag+'_warehouse');await d.getByLabel('Checked quantity 1',{exact:true}).fill('1');await d.getByLabel('Evidence reference 1',{exact:true}).fill(f.tag+' browser source reference');await d.getByLabel('Warehouse action reason',{exact:true}).fill(f.tag+' browser warehouse observation');await d.getByRole('button',{name:'Save warehouse checks',exact:true}).click();await d.getByText('READY FOR REVIEW',{exact:true}).waitFor();assert.equal(await d.getByRole('button',{name:'Approve availability and reserve stock',exact:true}).count(),0);await page.screenshot({path:path.join(output,'store-check.png'),fullPage:true});
  });
  await login('lead');
  await check('BROWSER-LOGISTICS-APPROVAL','Independent Logistics reviewer reserves current verified stock through UI',async()=>{
   await page.reload();await page.getByLabel('Warehouse request company',{exact:true}).selectOption(f.company);await page.getByRole('button',{name:new RegExp(`^Quotation #${intake.quotation_id} · v1$`)}).click();const d=page.getByRole('dialog');await d.getByLabel('Warehouse action reason',{exact:true}).fill(f.tag+' independent browser availability review');await d.getByRole('button',{name:'Approve availability and reserve stock',exact:true}).click();await d.getByText('AVAILABILITY APPROVED',{exact:true}).waitFor();
  });
  await check('BROWSER-COMMERCIAL','Existing independent commercial approval accepts the warehouse-approved version',async()=>{
   const quote=await call('owner','GET','/api/crm/quotations/'+intake.quotation_id);const submitted=await call('owner','POST','/api/crm/quotations/'+quote.id+'/actions',{action:'SUBMIT',version:quote.version,reason:f.tag+' actual API submission'});const approved=await call('manager','POST','/api/crm/quotations/'+quote.id+'/actions',{action:'APPROVE',version:submitted.version,reason:f.tag+' independent API commercial review'});assert.equal(approved.status,'APPROVED');await login('sales');await page.goto('/quotations/'+quote.id);await page.getByText('AVAILABILITY APPROVED',{exact:true}).waitFor();await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(output,'approved-quotation-mobile.png'),fullPage:true});return {quotationId:quote.id};
  });
  await check('ORDER-TRANSFER-CANCEL','Order creation transfers one reservation, rejects duplicate/mismatched demand, and cancellation releases it',async()=>{
   const {saveOrder,orderAction}=await import('../src/sales-orders.js'),q=await call('owner','GET','/api/crm/quotations/'+intake.quotation_id);
   const body={companyId:f.company,customerId:f.customer.id,quotationId:q.id,poNumber:f.tag+'_PO_800',poDate:new Date().toISOString().slice(0,10),poTotal:q.total,placeOfSupply:'33',supplyType:'DOMESTIC_STANDARD',reason:f.tag+' reservation transfer verification',lines:q.lines.map(l=>({...l,stockBasis:'FREE_STOCK',stockReservationKey:null,stockTallyOrderKey:null}))};
   await assert.rejects(()=>saveOrder(f.db,null,{...body,lines:body.lines.map(l=>({...l,quantity:'2'}))},f.users.owner),{status:409});
   const order=await saveOrder(f.db,null,body,f.users.owner);const held=await f.db.prepare("SELECT count(*)::integer AS n,sum(quantity)::text AS quantity FROM crm_quote_reservations WHERE sales_order_id=? AND status='TRANSFERRED'").get(order.id);assert.equal(held.n,1);assert.equal(held.quantity,'1.000000');
   await assert.rejects(()=>saveOrder(f.db,null,body,f.users.owner),{status:409});const linked=await f.db.prepare('SELECT sales_order_id FROM crm_sales_intakes WHERE id=?').get(intake.id);assert.equal(linked.sales_order_id,order.id);
   const {SalesIntakeService}=await import('../src/modules/sales-intake/service.js?cancellation-verification');const current=await f.db.prepare('SELECT version FROM crm_sales_intakes WHERE id=?').get(intake.id);await assert.rejects(()=>new SalesIntakeService({db:f.db,work:f.modules.services.work}).cancel(f.users.owner,intake.id,f.company,{version:current.version,reason:f.tag+' reject bypass of linked order cancellation'}),{status:409});
   await orderAction(f.db,order.id,{action:'CANCEL',version:order.version,reason:f.tag+' reviewed cancellation'},f.users.owner);const pending=await f.db.prepare("SELECT count(*)::integer AS n FROM crm_quote_reservations WHERE sales_order_id=? AND status IN ('ACTIVE','TRANSFERRED')").get(order.id);assert.equal(pending.n,0);return {orderId:order.id,quotationId:q.id};
  });
  await check('INTAKE-CANCELLATION','Cancellation closes its canonical enquiry and draft, freezes the clock, and preserves PO revision history',async()=>{
   const {SalesIntakeService}=await import('../src/modules/sales-intake/service.js?cancellation-verification'),service=new SalesIntakeService({db:f.db,work:f.modules.services.work});
   const before=await service.detail(f.users.owner,manualIntake,f.company),cancelled=await service.cancel(f.users.owner,manualIntake,f.company,{version:before.version,reason:f.tag+' cancel linked enquiry without response'});assert.equal(cancelled.status,'CANCELLED');assert.equal(cancelled.first_response_at,null);assert.equal((await f.db.prepare('SELECT status FROM enquiries WHERE id=?').get(cancelled.enquiry_id)).status,'CANCELLED');
   assert.equal((await call('owner','GET','/api/crm/quotations/'+cancelled.quotation_id)).status,'CANCELLED');const later=new SalesIntakeService({db:f.db,work:f.modules.services.work,clock:{now:()=>new Date(Date.now()+3600000)}});assert.equal((await later.detail(f.users.owner,manualIntake,f.company)).timing.elapsedSeconds,cancelled.timing.elapsedSeconds);await assert.rejects(()=>service.respond(f.users.owner,manualIntake,f.company,{version:cancelled.version,reason:f.tag+' refuse response after cancellation',responseAction:'CUSTOMER_RESPONSE_REFERENCE',evidence:f.tag+'_reference'}),{status:409});
   const po=await f.db.prepare('SELECT id,customer_po_id,version FROM crm_sales_intakes WHERE company_id=? AND message_id=?').get(f.company,f.tag+'_message_304');assert.ok(po.customer_po_id);await service.cancel(f.users.owner,po.id,f.company,{version:po.version,reason:f.tag+' cancel invalid HSN PO'});const archived=await f.db.prepare('SELECT status,version FROM customer_pos WHERE id=?').get(po.customer_po_id);assert.equal(archived.status,'ARCHIVED');assert.ok(await f.db.prepare('SELECT id FROM customer_po_versions WHERE customer_po_id=? AND version=?').get(po.customer_po_id,archived.version));
   await login('sales');await page.goto('/incoming-requests?requestId='+manualIntake);const d=page.getByRole('dialog');await d.getByText('CANCELLED',{exact:true}).waitFor();assert.equal(await d.getByRole('button',{name:'Refresh linked preparation',exact:true}).count(),0);assert.equal(await d.getByRole('button',{name:'Record evidenced response',exact:true}).count(),0);return {intakeId:manualIntake,customerPoId:po.customer_po_id};
  });
  await check('REPLENISHMENT','Refreshed retained stock requires new staff checks and independent review before commercial approval',async()=>{
   const row=await f.db.prepare('SELECT quotation_id FROM crm_sales_intakes WHERE company_id=? AND message_id=?').get(f.company,f.tag+'_message_200'),a=f.services.availability;
   let v=await a.forQuote(f.users.owner,row.quotation_id);assert.equal(v.ready,false);assert.ok(v.lines.some(l=>l.shortageQuantity==='1000.000000'));
   await f.receipt(f.items[1],'3000');v=await a.forQuote(f.users.owner,row.quotation_id);assert.equal(v.ready,false);assert.ok(v.lines.some(l=>l.issues.includes('STAFF_CHECK_SOURCE_CHANGED')));
   v=await a.command(f.users.store,v.id,f.company,{action:'CHECK',version:v.version,reason:f.tag+' retained replenishment recheck',lines:v.lines.map(l=>({id:l.id,warehouse:f.tag+'_warehouse',quantity:l.quantity,evidence:f.tag+' new retained receipt checked'}))});assert.equal(v.ready,true);
   v=await a.command(f.users.lead,v.id,f.company,{action:'APPROVE',version:v.version,reason:f.tag+' independent replenishment review'});assert.equal(v.status,'AVAILABILITY_APPROVED');assert.ok(v.lines.every(l=>l.shortageQuantity==='0.000000'));
   const submitted=await call('owner','POST','/api/crm/quotations/'+row.quotation_id+'/actions',{action:'SUBMIT',version:1,reason:f.tag+' replenished commercial submission'});const approved=await call('manager','POST','/api/crm/quotations/'+row.quotation_id+'/actions',{action:'APPROVE',version:submitted.version,reason:f.tag+' replenished independent approval'});assert.equal(approved.status,'APPROVED');return {quotationId:row.quotation_id,availabilityId:v.id};
  });
  assert.deepEqual(errors,[]);assert.equal(externalCalls,0);
 }finally{await browser?.close();await server?.close();await app?.close();fs.writeFileSync(path.join(output,'runtime.json'),JSON.stringify({errors,externalCalls,rejectedConnectorRequests},null,2));}
}
