// Isolated retained PostgreSQL fixture. No connector calls and no business deletes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {chromium} from 'playwright';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {createApp} from '../src/app.js';
import {tokenDigest} from '../src/security.js';
import {saveEnquiry} from '../src/crm-modules.js';
const f=await quotationFixture(),{db,config,owner,manager,executive,accounts,customer,item}=f;
const output=path.resolve('output/quotations');await fs.mkdir(output,{recursive:true});
let browser,server,app,externalCalls=0;const errors=[];
try{
 const sessions={};for(const [key,user]of Object.entries({owner,manager,executive,accounts})){
 const token=crypto.randomBytes(24).toString('hex'),csrf=crypto.randomBytes(24).toString('hex');sessions[key]={token,csrf};
 await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${user.id},${tokenDigest(token)},${csrf},now()+interval '1 hour')`;
 }
 app=createApp({db,config,fetchImpl:async()=>{externalCalls++;throw new Error('External Tally access forbidden');}});server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const login=async role=>{await context.clearCookies();await context.addCookies([{name:'crm_session',value:sessions[role].token,url:base,httpOnly:true,sameSite:'Strict'}]);};await login('owner');
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',err=>errors.push(err.message));
 await page.route('**/api/dashboard?*',route=>route.fulfill({status:503,json:{error:'Focused quotation review'}}));
 const req=async(role,method,url,data,expected=200)=>{const res=await context.request.fetch(base+url,{method,headers:{cookie:`crm_session=${sessions[role].token}`,'x-csrf-token':sessions[role].csrf},data});const body=await res.json();assert.equal(res.status(),expected,JSON.stringify(body));return body.data??body;};
 const raw=await db.sql`SELECT (SELECT jsonb_agg(t) FROM tally_ledgers t) AS ledgers,(SELECT jsonb_agg(t) FROM tally_stock_items t) AS stock`;
 await page.goto(base);await page.locator('#app:not(.hidden)').waitFor();await page.locator('#nav [data-view=quotations]').click();
 await page.getByRole('button',{name:'Policy & letterhead',exact:true}).click();
 for(const [key,v]of Object.entries({floorPercent:'20',sellerState:'27',companyName:'Mehta Electronics',gstin:'27ABCDE1234F1Z5',email:'sales@example.test',phone:'9876543210',address:'Mumbai, Maharashtra',reason:'Owner initial quotation policy'}))await page.locator(`#modal [name=${key}]`).fill(v);
 await page.locator('#modal-save').click();await page.locator('#q-cost').waitFor();
 await page.locator('#q-cost').click();await page.locator('[name=costSearch]').fill('QUOTE');await page.locator('#cost-find').click();await page.locator('#cost-item option').nth(1).waitFor({state:'attached'});await page.locator('#cost-item').selectOption(String(item.id));await page.locator('[name=unitCost]').fill('85');await page.locator('[name=reason]').fill('Reviewed CRM purchase cost');await page.locator('#modal-save').click();await page.locator('#modal').waitFor({state:'hidden'});
 await page.locator('#q-new').click();await page.locator('[name=customerSearch]').fill('Quotation Customer');await page.locator('#q-customer-find').click();await page.locator('#q-customer option').nth(1).waitFor({state:'attached'});await page.locator('#q-customer').selectOption(String(customer.id));
 await page.locator('[name=placeOfSupply]').fill('27');await page.locator('[name=standardSupply]').check();await page.locator('[name=itemSearch]').fill('QUOTE');await page.locator('#q-item-find').click();await page.locator('#q-item option').nth(1).waitFor({state:'attached'});await page.locator('#q-item').selectOption(String(item.id));await page.locator('#q-add').click();await page.locator('[data-field=quantity]').fill('2');await page.locator('[data-field=unitPrice]').fill('100');await page.locator('[data-field=discountPercent]').fill('10');await page.locator('[data-field=taxPercent]').fill('18');await page.locator('[name=terms]').fill('Net 30. Delivery subject to availability.');await page.locator('[name=reason]').fill('Customer requested quotation');
 await page.getByText('Total INR 212.40',{exact:true}).waitFor();await page.screenshot({path:path.join(output,'editor-desktop.png'),fullPage:true});
 await page.locator('#modal-save').click();await page.locator('#q-edit').waitFor();const qid=(await db.sql`SELECT quotation_id FROM crm_quotation_workflows`)[0].quotation_id;
 await page.getByRole('button',{name:'Submit for approval',exact:true}).click();await page.locator('[name=reason]').fill('Request independent manager review');await page.locator('#modal-save').click();await page.getByRole('button',{name:'Approve',exact:true}).waitFor();
 await req('manager','PATCH',`/api/quotations/${qid}/status`,{status:'SENT',reason:'Attempt to bypass pending approval'},422);
 await page.getByRole('button',{name:'Approve',exact:true}).click();await page.locator('[name=overrideFloor]').check();await page.locator('[name=reason]').fill('Self approval should fail');await page.locator('#modal-save').click();await page.getByText('A different manager or owner must approve this quotation.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();await login('manager');await page.reload();await page.locator('#app:not(.hidden)').waitFor();await page.locator('#nav [data-view=quotations]').click();await page.locator('.q-open').first().click();await page.screenshot({path:path.join(output,'manager-review.png'),fullPage:true});
 await page.getByRole('button',{name:'Approve',exact:true}).click();await page.locator('[name=overrideFloor]').check();await page.locator('[name=reason]').fill('Approve strategic customer exception');await page.locator('#modal-save').click();await page.getByRole('button',{name:'Mark sent',exact:true}).waitFor();
 const pdf=await context.request.get(base+`/api/crm/quotations/${qid}/pdf`);assert.equal(pdf.status(),200);const bytes=await pdf.body();assert.equal(bytes.subarray(0,4).toString(),'%PDF');await fs.writeFile(path.join(output,'sample-quotation.pdf'),bytes);
 const print=await context.newPage();await print.goto(base+`/api/crm/quotations/${qid}/print`);await print.getByRole('heading',{name:'Mehta Electronics',exact:true}).waitFor();assert.equal((await print.locator('body').innerText()).includes('Internal cost'),false);await print.screenshot({path:path.join(output,'print-view.png'),fullPage:true});await print.close();
 await page.getByRole('button',{name:'Mark sent',exact:true}).click();await page.locator('[name=reason]').fill('Delivered approved PDF to customer');await page.locator('#modal-save').click();await page.getByRole('button',{name:'Mark won',exact:true}).waitFor();
 await page.getByRole('button',{name:'Mark won',exact:true}).click();await page.locator('[name=reason]').fill('Customer accepted quotation');await page.locator('#modal-save').click();await page.getByRole('button',{name:'Create sales order',exact:true}).waitFor();
 await page.getByRole('button',{name:'Version history & audit',exact:true}).click();await page.getByRole('heading',{name:'Audit trail',exact:true}).waitFor();await page.screenshot({path:path.join(output,'history.png'),fullPage:true});
 await req('executive','GET',`/api/crm/quotation-costs/${item.id}`,undefined,403);const publicQuote=await req('accounts','GET',`/api/crm/quotations/${qid}`);assert.equal(publicQuote.pricing,undefined);const history=await req('accounts','GET',`/api/crm/quotations/${qid}/history`);assert.equal(JSON.stringify(history).includes('unitCost'),false);
 await req('manager','PATCH',`/api/quotations/${qid}/status`,{status:'SENT',reason:'Legacy bypass'},422);
 const enquiry=await saveEnquiry(db,null,{customerId:customer.id,subject:'Repeat enquiry',source:'Email',ownerId:owner.id,lines:[{itemId:item.id,quantity:4,targetPrice:110}]},owner);
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();await login('executive');await page.reload();await page.locator('#app:not(.hidden)').waitFor();await page.locator('#nav [data-view=enquiries]').click();await page.locator('.crm-detail').first().click();await page.getByRole('button',{name:'Create quotation',exact:true}).click();await page.locator('[data-field=quantity]').waitFor();assert.equal(await page.locator('[data-field=quantity]').inputValue(),'4.000000');assert.equal(await page.locator('#q-totals').innerText().then(t=>t.includes('Internal')),false);
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,'enquiry-quotation-mobile.png'),fullPage:true});
 await page.locator('[name=standardSupply]').check();await page.locator('[name=reason]').fill('Created from linked enquiry');await page.locator('#modal-save').click();await page.locator('#q-edit').waitFor();const fromEnquiry=(await db.sql`SELECT quotation_id FROM crm_quotation_workflows WHERE public_snapshot->>'enquiryId'=${String(enquiry.id)}`)[0];assert.ok(fromEnquiry);
 const noCsrf=await context.request.post(base+'/api/crm/quotations',{data:{}});assert.equal(noCsrf.status(),403);
 await req('executive','POST',`/api/crm/quotations/${qid}/duplicate`,{reason:'Repeat requirement',validUntil:'2099-12-31'},201);
 await req('manager','POST','/api/quotations',{customerId:customer.id,validUntil:'2099-12-31',reason:'Legacy compatibility',lines:[{itemId:item.id,quantity:1,unitPrice:100,taxPercent:18}]},201);
 assert.deepEqual(await db.sql`SELECT (SELECT jsonb_agg(t) FROM tally_ledgers t) AS ledgers,(SELECT jsonb_agg(t) FROM tally_stock_items t) AS stock`,raw);assert.equal(externalCalls,0);assert.deepEqual(errors,[]);
 const evidence={fixtureDatabase:f.name,checks:['Editor live totals','Owner policy and cost entry','Independent manager approval','Below-floor exception','Legacy bypass blocked','PDF and print without costs','Enquiry conversion','Duplicate draft','History and audits','Role and CSRF enforcement','390px layout','Raw imports unchanged'],externalTallyCalls:externalCalls,quotationId:qid,events:(await db.sql`SELECT count(*) AS n FROM crm_quotation_events`)[0].n,pageErrors:errors};await fs.writeFile(path.join(output,'verification.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{if(browser)await browser.close();app?.close?.();if(server)await new Promise(r=>server.close(r));await f.close();}
