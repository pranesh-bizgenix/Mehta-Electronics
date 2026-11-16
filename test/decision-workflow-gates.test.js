import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {salesOrderFixture} from '../test-support/sales-order-fixture.js';
import {procurementFixture} from '../test-support/procurement-fixture.js';
import {fixtureRuleService} from '../test-support/business-rule-fixture.js';
import {DecisionService} from '../src/modules/decisions/service.js';
import {saveQuote,saveQuotePolicy,quoteAction,quoteForDocument,quotePolicy} from '../src/quotation-workflow.js';
import {QuotationPolicyFloorSource} from '../src/modules/rules/quotation-policy-source.js';
import {saveOrder,orderDetail} from '../src/sales-orders.js';
import {saveVendor,saveSupplierPo,supplierPoAction,supplierPoCheck} from '../src/procurement.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {testFetch} from '../test-support/http-client.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';

const reason='ZZTEST reviewed withdrawal of commercial policy';
async function stageMargin(service,owner,value){
 const state=await service.state(service.catalog.require('margin.floor_percent'));
 return service.enter(owner,'margin.floor_percent',{value,confirm:false,expectedVersion:state.version,requestKey:randomUUID(),reason});
}

test('withdrawing a retained margin decision blocks existing quotation progression, document approval and new order creation',()=>withTestTransaction(async db=>{
 const f=await salesOrderFixture(db),service=new DecisionService({db}),policy=await quotePolicy(db);
 assert.equal((await quoteForDocument(db,f.quote.id,f.owner)).status,'APPROVED');
 await stageMargin(service,f.owner,'25');
 assert.equal((await quotePolicy(db)).revision,policy.revision,'Staging a decision must retain the original policy.');
 assert.equal((await quoteForDocument(db,f.quote.id,f.owner)).status,'DRAFT');
 await assert.rejects(()=>quoteAction(db,f.quote.id,{action:'SEND',version:f.quote.version,reason},f.owner),{code:'RULE_NOT_CONFIGURED'});
 await assert.rejects(()=>saveOrder(db,null,f.body,f.executive),{code:'RULE_NOT_CONFIGURED'});
 await assert.rejects(()=>saveQuote(db,null,{customerId:f.customer.id,validUntil:'2099-12-31',placeOfSupply:'27',supplyType:'DOMESTIC_STANDARD',reason,lines:f.quote.lines},f.executive),{code:'RULE_NOT_CONFIGURED'});
 const rules=fixtureRuleService(db);
 await assert.rejects(()=>rules.set(f.owner,'payments.authorisation',{maximumAmount:1.1,checks:['ZZTEST required check']},reason),{status:422});
}));

test('margin-only Rules changes cannot overwrite a concurrently changed quotation letterhead',()=>withTestTransaction(async db=>{
 const f=await salesOrderFixture(db),original=await quotePolicy(db);let intercepted=false;
 const racingDb={...db,prepare(statement){const prepared=db.prepare(statement);if(!statement.startsWith('SELECT *,floor_percent::text AS floor_percent FROM crm_quotation_policy'))return prepared;
  return {...prepared,async get(...args){const before=await prepared.get(...args);if(!intercepted){intercepted=true;await saveQuotePolicy(db,{floorPercent:before.floor_percent,marginBasis:before.margin_basis,sellerState:before.seller_state,letterhead:{...before.letterhead,name:'ZZTEST independently revised letterhead'},reason},f.owner);}return before;}};
 }};
 const adapter=new QuotationPolicyFloorSource({db:racingDb});
 await assert.rejects(()=>adapter.write(f.owner,'25',reason),{code:'POLICY_VERSION_CHANGED'});
 const retained=await quotePolicy(db);assert.equal(retained.letterhead.name,'ZZTEST independently revised letterhead');assert.equal(retained.floor_percent,original.floor_percent);
}));

test('withdrawing the margin decision invalidates order verification and blocks supplier PO progression',()=>withTestTransaction(async db=>{
 const f=await procurementFixture(db),service=new DecisionService({db});
 const vendor=await saveVendor(db,null,{name:'ZZTEST policy supplier',stateCode:'27',reason},f.manager);
 const po=await saveSupplierPo(db,null,{salesOrderId:f.order.id,vendorId:vendor.id,deliveryBy:'2099-12-31',reason,lines:[{itemId:f.item.id,quantity:'10',unitPrice:'70',taxPercent:'18'}]},f.manager);
 await stageMargin(service,f.owner,'25');
 const order=await orderDetail(db,f.order.id,f.owner);
 assert.ok(order.verification.flags.includes('MISSING_POLICY'));
 assert.notEqual(order.effectiveStatus,'APPROVED');
 assert.ok((await supplierPoCheck(db,po.id,f.manager)).flags.includes('QUOTATION_POLICY_NOT_CONFIRMED'));
 await assert.rejects(()=>supplierPoAction(db,po.id,{action:'SUBMIT',version:po.version,reason},f.manager),{code:'RULE_NOT_CONFIGURED'});
}));

test('quotation policy API exposes confirmation state without exposing internal pricing to Sales',()=>withTestTransaction(async db=>{
 const f=await salesOrderFixture(db),service=new DecisionService({db}),config=getConfig({localReviewAccess:false,mfaEnabled:false});
 const token=randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${f.executive.id},${tokenDigest(token)},'ZZTEST csrf',now()+interval '1 hour')`;
 const ownerToken=randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${f.owner.id},${tokenDigest(ownerToken)},'ZZTEST csrf',now()+interval '1 hour')`;
 const app=createApp({db,config}),fetch=testFetch(app);
 try{
  const before=await fetch('/api/crm/quotation-policy',{headers:{cookie:`crm_session=${token}`}}),beforeBody=await before.json();
  assert.equal(before.status,200);assert.equal(beforeBody.data.confirmed,true);assert.equal('floor_percent' in beforeBody.data,false);assert.equal('margin_basis' in beforeBody.data,false);
  const setupBefore=await (await fetch('/api/v1/setup',{headers:{cookie:`crm_session=${ownerToken}`}})).json();
  assert.equal(setupBefore.data.rows.find(row=>row.key==='policy').status,'READY');
  await stageMargin(service,f.owner,'25');
  const after=await fetch('/api/crm/quotation-policy',{headers:{cookie:`crm_session=${token}`}}),afterBody=await after.json();
  assert.equal(after.status,200);assert.equal(afterBody.data.confirmed,false);assert.equal('floor_percent' in afterBody.data,false);
  const setupAfter=await (await fetch('/api/v1/setup',{headers:{cookie:`crm_session=${ownerToken}`}})).json();
  assert.equal(setupAfter.data.rows.find(row=>row.key==='policy').status,'NEEDS_ATTENTION');
  assert.equal(setupAfter.data.rows.find(row=>row.key==='policy').href,'/decisions?key=margin.floor_percent');
 }finally{await app.close();installPermissionProvider(null);}
}));
