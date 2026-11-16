import assert from 'node:assert/strict';
import {test} from 'node:test';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {salesOrderFixture,sampleOriginal} from '../test-support/sales-order-fixture.js';
import {procurementFixture} from '../test-support/procurement-fixture.js';
import {fixtureRuleService,confirmFixturePricing} from '../test-support/business-rule-fixture.js';
import {BUSINESS_RULES} from '../src/modules/rules/business-rule-definitions.js';
import {validate} from '../src/core/schema.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';
import {saveQuotePolicy,saveQuoteCost,saveQuote,quoteAction} from '../src/quotation-workflow.js';
import {saveOrder,uploadOriginal,orderAction,orderDetail} from '../src/sales-orders.js';
import {saveVendor,saveSupplierPo,supplierPoCheck,supplierPoAction} from '../src/procurement.js';

const needed=['quotation.approval_levels','discount.role_limits','credit.tiers','credit.grace_days','warranty.policy','complaints.bands','procurement.principal_ordering','reminders.limits','kpi.weights','audit.retention_days'];
test('new rule shapes require explicit values, unique names and exact decimal weights',()=>{
 for(const d of BUSINESS_RULES)assert.throws(()=>validate(d.schema,null),{status:422});
 const weights=BUSINESS_RULES.find(d=>d.key==='kpi.weights');
 assert.equal(weights.validate(validate(weights.schema,[{metric:'ZZTEST_a',definition:'ZZTEST confirmed measure',weightPercent:'33.333333'},{metric:'ZZTEST_b',definition:'ZZTEST confirmed measure',weightPercent:'66.666667'}])),null);
 assert.ok(weights.validate([{metric:'a',weightPercent:'99.999999'}]));
 assert.throws(()=>validate(weights.schema,[{metric:'a',definition:'ZZTEST metric',weightPercent:100}]),{status:422});
});
test('live rules API lists all missing decisions without defaults; Owner-only reasons, history, audit and clear are enforced',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),rules=fixtureRuleService(db);
 for(const key of needed)await rules.clear(f.owner,key,'ZZTEST unconfirmed rule for test');
 const app=createApp({db,config:getConfig({mfaEnabled:false})}),tokens=new Map();
 for(const actor of [f.owner,f.manager,f.executive]){const token=crypto.randomUUID();tokens.set(actor.id,token);await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${actor.id},${tokenDigest(token)},'ZZTEST_csrf',now()+interval '1 hour')`;}
 async function request(method,path,actor,body={},csrf=true){const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,url:path,headers:{host:'localhost','content-type':'application/json',...(actor?{cookie:`crm_session=${tokens.get(actor.id)}`} :{}),...(csrf?{'x-csrf-token':'ZZTEST_csrf'}:{})},socket:{remoteAddress:'test'}});const res={status:0,headersSent:false,setHeader(){},writeHead(n){this.status=n;this.headersSent=true;},end(value){this.body=value?JSON.parse(String(value)):null;}};await app(req,res);return res;}
 try{
  const before=(await db.sql`SELECT count(*) AS n FROM business_rule_values`)[0].n;
  assert.equal((await request('GET','/api/v1/rules',null)).status,401);
  const list=await request('GET','/api/v1/rules',f.owner);assert.equal(list.status,200);
  for(const key of needed){const row=list.body.data.find(r=>r.key===key);assert.ok(row,key);assert.equal(row.configured,false,key);assert.equal(row.value,null,key);assert.ok(row.dependents.length,key);}
  assert.equal((await db.sql`SELECT count(*) AS n FROM business_rule_values`)[0].n,before);
  const path='/api/v1/rules/credit.grace_days',body={value:0,reason:'ZZTEST owner explicitly confirms zero grace'};
  assert.equal((await request('PUT',path,f.manager,body)).status,403);assert.equal((await request('PUT',path,f.executive,body)).status,403);assert.equal((await request('PUT',path,f.owner,body,false)).status,403);
  assert.equal((await request('PUT',path,f.owner,{...body,reason:''})).status,422);
  assert.equal((await request('PUT',path,f.owner,body)).status,200);assert.equal((await rules.require('credit.grace_days')).value,0);
  assert.equal((await request('POST',path+'/clear',f.owner,{reason:'ZZTEST client decision withdrawn'})).status,200);
  await assert.rejects(rules.require('credit.grace_days'),{code:'RULE_NOT_CONFIGURED'});
  const history=await request('GET',path+'/history',f.owner);assert.equal(history.body.data[0].cleared,true);assert.equal(history.body.data[1].value,0);
  assert.ok((await db.prepare("SELECT count(*) AS n FROM audit_logs WHERE entity='RULE' AND record_id='credit.grace_days' AND user_id=?").get(f.owner.id)).n>=3);
  // Service guard remains Owner-only even if a caller mistakenly grants rules.manage.
  const oldAccess=rules.access;rules.access={require(){}};await assert.rejects(rules.set(f.manager,'credit.grace_days',1,'ZZTEST invalid grant'),{status:403});rules.access=oldAccess;
  for(const key of ['reminders.limits','kpi.weights','audit.retention_days'])await assert.rejects(rules.require(key),{code:'RULE_NOT_CONFIGURED'});
 }finally{await app.close();installPermissionProvider(null);}
}));
test('quotation submission blocks missing rules, changed policy versions and excessive role discounts',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),rules=fixtureRuleService(db);
 for(const key of ['discount.levels','discount.role_limits','quotation.approval_levels'])await rules.clear(f.owner,key,'ZZTEST unset pricing decision');
 await saveQuotePolicy(db,{floorPercent:'0',marginBasis:'TOTAL',sellerState:'27',letterhead:{name:'ZZTEST Seller'},reason:'ZZTEST quotation policy'},f.owner);
 await saveQuoteCost(db,f.item.id,{unitCost:'50',reason:'ZZTEST explicit cost'},f.owner);
 const body={customerId:f.customer.id,validUntil:'2099-12-31',placeOfSupply:'27',supplyType:'DOMESTIC_STANDARD',reason:'ZZTEST pricing gates',lines:[{itemId:f.item.id,quantity:'1',unitPrice:'100',discountPercent:'20',taxPercent:'18'}]};
 let q=await saveQuote(db,null,body,f.executive);
 await assert.rejects(quoteAction(db,q.id,{action:'SUBMIT',version:q.version,reason:'ZZTEST try unconfigured pricing'},f.executive),{code:'RULE_NOT_CONFIGURED'});
 await confirmFixturePricing(db,f.owner);
 await assert.rejects(quoteAction(db,q.id,{action:'SUBMIT',version:q.version,reason:'ZZTEST old snapshot'},f.executive),/Pricing rules changed/);
 q=await saveQuote(db,q.id,{...body,version:q.version},f.executive);
 q=await quoteAction(db,q.id,{action:'SUBMIT',version:q.version,reason:'ZZTEST configured pricing'},f.executive);
 await rules.set(f.owner,'discount.role_limits',[{role:'EXECUTIVE',maximumPercent:'5'}],'ZZTEST confirmed lower discount limit');
 await assert.rejects(quoteAction(db,q.id,{action:'APPROVE',version:q.version,reason:'ZZTEST stale pricing approval'},f.manager),/Pricing rules changed/);
 q=await saveQuote(db,q.id,{...body,version:q.version},f.executive);
 await assert.rejects(quoteAction(db,q.id,{action:'SUBMIT',version:q.version,reason:'ZZTEST excessive discount'},f.executive),/exceeds the confirmed limit/);
}));
test('missing credit tiers and grace days block non-exempt order approval and appear in live verification',()=>withTestTransaction(async db=>{
 const f=await salesOrderFixture(db),rules=fixtureRuleService(db);
 let order=await saveOrder(db,null,f.body,f.executive);await uploadOriginal(db,order.id,{name:'ZZTEST_po.pdf',base64:sampleOriginal.toString('base64'),version:order.version,reason:'ZZTEST original'},f.executive);
 order=await orderAction(db,order.id,{action:'VERIFY',version:2,reason:'ZZTEST verify'},f.executive);
 await rules.clear(f.owner,'credit.tiers','ZZTEST unconfirmed tiers');
 assert.ok((await orderDetail(db,order.id,f.owner)).verification.flags.includes('CREDIT_TIERS_NOT_CONFIGURED'));
 await assert.rejects(orderAction(db,order.id,{action:'APPROVE',version:2,reason:'ZZTEST missing tiers'},f.manager),{code:'RULE_NOT_CONFIGURED'});
 await rules.set(f.owner,'credit.tiers',[{name:'ZZTEST tier',criteria:'ZZTEST explicit customer limit',limit:'100000'}],'ZZTEST confirm tiers');
 await rules.clear(f.owner,'credit.grace_days','ZZTEST missing grace');
 await assert.rejects(orderAction(db,order.id,{action:'APPROVE',version:2,reason:'ZZTEST missing grace'},f.manager),{code:'RULE_NOT_CONFIGURED'});
}));
test('principal-ordering policy blocks supplier PO submission and changes invalidate its fingerprint',()=>withTestTransaction(async db=>{
 const f=await procurementFixture(db),rules=fixtureRuleService(db),vendor=await saveVendor(db,null,{name:'ZZTEST vendor',stateCode:'27',reason:'ZZTEST supplier'},f.manager);
 const po=await saveSupplierPo(db,null,{salesOrderId:f.order.id,vendorId:vendor.id,deliveryBy:'2099-12-31',lines:[{itemId:f.item.id,quantity:'10',unitPrice:'70',taxPercent:'18'}],reason:'ZZTEST supplier draft'},f.manager);
 await rules.clear(f.owner,'procurement.principal_ordering','ZZTEST missing ordering decision');
 assert.ok((await supplierPoCheck(db,po.id,f.manager)).flags.includes('PRINCIPAL_ORDERING_NOT_CONFIGURED'));
 await assert.rejects(supplierPoAction(db,po.id,{action:'SUBMIT',version:po.version,reason:'ZZTEST blocked supplier order'},f.manager),{code:'RULE_NOT_CONFIGURED'});
 await rules.set(f.owner,'procurement.principal_ordering',{instructions:'ZZTEST review supplier and source order'},'ZZTEST confirmed principal rule');
 const check=await supplierPoCheck(db,po.id,f.manager);assert.ok(check.principalInstructions);
 assert.equal((await supplierPoAction(db,po.id,{action:'SUBMIT',version:po.version,reason:'ZZTEST reviewed principal instructions'},f.manager)).status,'PENDING_APPROVAL');
 await rules.set(f.owner,'procurement.principal_ordering',{instructions:'ZZTEST revised ordering instruction'},'ZZTEST revised confirmed rule');
 assert.notEqual((await supplierPoCheck(db,po.id,f.manager)).fingerprint,check.fingerprint);
}));
test('complaints can be recorded but progression requires confirmed bands and a selected band; warranty still blocks when unset',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),app=createApp({db,config:getConfig({mfaEnabled:false})});await app.modules.ready();
 try{
  const rules=app.modules.services.rules,service=app.modules.services.operations;
  await rules.clear(f.owner,'complaints.bands','ZZTEST complaint policy missing');
  const base={title:'ZZTEST support case',customerId:f.customer.id,ownerId:f.owner.id,backupId:f.manager.id,reason:'ZZTEST complaint intake',payload:{complaint:'ZZTEST customer report'}};
  let result=await service.create(f.owner,'SUPPORT',base);
  await assert.rejects(service.act(f.owner,result.record.id,{action:'START',version:1,reason:'ZZTEST unset bands'}),{code:'RULE_NOT_CONFIGURED'});
  await rules.set(f.owner,'complaints.bands',[{name:'ZZTEST standard',criteria:'ZZTEST confirmed classification',firstResponseHours:12}],'ZZTEST confirm bands');
  await assert.rejects(service.act(f.owner,result.record.id,{action:'START',version:1,reason:'ZZTEST unclassified complaint'}),/Select a confirmed complaint band/);
  result=await service.revise(f.owner,result.record.id,{version:1,reason:'ZZTEST classify complaint',payload:{...base.payload,complaintBand:'ZZTEST standard'}});
  result=await service.act(f.owner,result.record.id,{action:'START',version:result.record.version,reason:'ZZTEST progress classified complaint'});assert.equal(result.record.status,'IN_PROGRESS');assert.equal(result.firstResponse.targetHours,12);
  await rules.clear(f.owner,'warranty.policy','ZZTEST warranty decision missing');await assert.rejects(rules.require('warranty.policy'),{code:'RULE_NOT_CONFIGURED'});
 }finally{await app.close();installPermissionProvider(null);}
}));
