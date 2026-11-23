import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {quotationFixture} from './quotation-fixture.js';
import {createModules} from '../src/modules/container.js';
import {getConfig} from '../src/config.js';
import {installPermissionProvider} from '../src/rbac.js';
import {saveCustomer,decideCustomerOnboarding} from '../src/crm-modules.js';
import {resolveCustomerPricing,bindCustomerPricing} from '../src/modules/customers/commercial.js';
import {canonicalParty} from '../src/sales-orders.js';

/** Existing-database, rollback-only checks. No permanent fixtures or credentials. */
export async function customerManagementChecks(db,{progress=()=>{},phase='all'}={}){
 const checks=[],passed=name=>{checks.push(name);progress(name);};
 const f=await quotationFixture(db),modules=createModules({db,config:getConfig({mfaEnabled:false})});
 await modules.ready();
 const service=modules.services.customerManagement,owner=f.owner,reviewer=f.customerReviewer,cid=f.customer.id,reason='VERIFY- customer-management verification';
 const address={label:'VERIFY- delivery A',kind:'DELIVERY',line1:'Synthetic address only',city:'Test city',stateCode:'33',countryCode:'IN',isDefault:true};
 try{
  if(phase!=='merge'){
  await assert.rejects(service.saveAddress({id:f.executive.id,role:'STORE_STAFF'},cid,null,{value:address,reason}),{status:403});passed('address writes require permission');
  const a=await service.saveAddress(owner,cid,null,{value:address,reason});
  const b=await service.saveAddress(owner,cid,null,{value:{...address,label:'VERIFY- delivery B'},reason});
  const addresses=await service.addresses(owner,cid);assert.equal(addresses.data.filter(x=>x.is_default).length,1);assert.equal(addresses.data.find(x=>x.id===b.id).is_default,true);passed('multiple addresses retain one default per type');
  await assert.rejects(service.saveAddress(owner,cid,a.id,{version:a.version,value:address,reason}),{status:409});passed('stale address updates are rejected');
  const previous=addresses.data.find(x=>x.id===a.id);await service.archive(owner,cid,'address',a.id,{version:previous.version,reason});
  assert.equal((await service.addresses(owner,cid)).data.find(x=>x.id===a.id).status,'ARCHIVED');passed('address archive retains history');
  const audits=await db.prepare("SELECT action FROM audit_logs WHERE entity='CUSTOMER_ADDRESS' AND record_id=?").all(a.id);assert.ok(audits.some(x=>x.action==='DEFAULT_REPLACED'));passed('implicit default replacement is audited');
  await assert.rejects(db.prepare("UPDATE crm_customer_addresses SET label='Unapproved edit' WHERE id=?").run(b.id),/authorised customer management/);passed('direct address writes are guarded');
  const activity=await service.saveActivity(owner,cid,{value:{kind:'VISIT',title:'VERIFY- visit',notes:'Synthetic verification notes',ownerId:f.executive.id,occurredAt:new Date(Date.now()-60000).toISOString()},reason});
  assert.ok((await service.activities(owner,cid,1)).data.some(x=>x.id===activity.id));passed('sales visits and notes persist and reload');
  await assert.rejects(service.saveActivity(f.executive,cid,{value:{kind:'CALL',title:'VERIFY- reassignment',notes:'Synthetic',ownerId:owner.id,occurredAt:new Date(Date.now()-60000).toISOString()},reason}),{status:403});passed('sales staff cannot assign another owner without authority');
  const opportunity=await service.saveOpportunity(owner,cid,null,{value:{title:'VERIFY- opportunity',stage:'PROPOSAL',ownerId:owner.id,expectedValue:'12345678901234.123456'},reason});assert.equal(opportunity.expected_value,'12345678901234.123456');passed('opportunity values retain exact decimals');
  await assert.rejects(service.saveOpportunity(owner,cid,opportunity.id,{version:opportunity.version,value:{title:opportunity.title,stage:'WON',ownerId:owner.id,closeReason:'Synthetic closing reason'},reason}),{status:409});passed('Won requires an approved order for this customer');
  const lost=await service.saveOpportunity(owner,cid,opportunity.id,{version:opportunity.version,value:{title:opportunity.title,stage:'LOST',ownerId:owner.id,closeReason:'Synthetic loss'},reason});assert.equal(lost.stage,'LOST');
  await assert.rejects(service.saveOpportunity(owner,cid,opportunity.id,{version:opportunity.version,value:{title:opportunity.title,stage:'NEW',ownerId:owner.id},reason}),{status:409});passed('opportunity stages require current versions');
  assert.equal((await service.classification(owner,cid,f.company)).state,'NOT_CONFIGURED');passed('history classification starts unconfigured');
  let controls=await modules.services.operations.controls(owner,cid,{classification:'NEW',pricingClass:'MEDIUM_DISCOUNT',creditExempt:false,version:0,reason});
  await assert.rejects(resolveCustomerPricing(db,cid,f.company,{itemId:f.item.id,quantity:'1'}),{code:'CUSTOMER_PRICING_NOT_CONFIGURED'});passed('unconfigured pricing class blocks commercial use');
  let policy=await service.savePolicy(owner,cid,f.company,{version:0,value:{classes:{MEDIUM_DISCOUNT:{strategy:'MANUAL_REVIEW'}},classification:{basis:'PO',statuses:['ACTIVE'],periodDays:null,existingMinimum:1,potentialBelow:null}},reason});
  const preview=await service.previewPricing(owner,cid,f.company,{itemId:f.item.id,quantity:'1'});assert.equal(preview.state,'MANUAL_REVIEW');
  const binding=await bindCustomerPricing(db,cid,f.company,{itemId:f.item.id,quantity:'1',unitPrice:'100',discountPercent:'0'});assert.equal(binding.pricingClass,'MEDIUM_DISCOUNT');passed('pricing class resolves through company policy');
  policy=await service.savePolicy(owner,cid,f.company,{version:policy.version,value:policy.value,reason});
  await assert.rejects(bindCustomerPricing(db,cid,f.company,{itemId:f.item.id,quantity:'1',unitPrice:'100',discountPercent:'0',customerPricing:binding}),{code:'CUSTOMER_PRICING_CHANGED'});passed('policy edits invalidate retained price bindings');
  const party=await modules.transactions.run(owner,reason,()=>canonicalParty(db,cid,owner.id));
  const pos=[];
  for(let i=0;i<6;i++){
   await modules.transactions.run(owner,reason,async()=>{
    await db.prepare("SELECT set_config('mehta.order_write','authorized',true)").get();
    const po=await db.prepare("INSERT INTO customer_pos(customer_party_id,legacy_customer_id,po_number,po_number_key,po_date,source_total,calculated_total,place_of_supply,created_by,updated_by) VALUES(?,?,?,?,'2026-11-23',100,100,'33',?,?) RETURNING id").get(party,cid,'VERIFY-CUSTOMER-PO-'+i,'VERIFY-CUSTOMER-PO-'+i,owner.id,owner.id);pos.push(po.id);
    const order=await db.prepare("INSERT INTO sales_orders(order_number,customer_id,customer_po_id,customer_po_number,created_by,updated_by) VALUES(?,?,?,?,?,?) RETURNING id").get('VERIFY-CUSTOMER-ORDER-'+randomUUID(),cid,po.id,'VERIFY-CUSTOMER-PO-'+i,owner.id,owner.id);
    await db.prepare("INSERT INTO crm_order_workflows(sales_order_id,customer_id,po_key,public_snapshot,private_snapshot,created_by) VALUES(?,?,?,?::text::jsonb,'{}',?) RETURNING id").get(order.id,cid,'VERIFY-CUSTOMER-PO-'+i,JSON.stringify({companyId:f.company}),owner.id);
   });
   if(i>=3){const result=await service.classification(owner,cid,f.company);assert.equal(result.count,i+1);assert.equal(result.tier,i<4?'EARLY_BIRD':'ELITE');}
  }passed('database history counts 4, 5 and 6 POs with five-inclusive Elite');
  controls=await service.applyClassification(owner,cid,f.company,{policyVersion:policy.version,controlVersion:controls.version,reason});assert.equal(controls.classification,'EXISTING');assert.equal(controls.pricing_class,'MEDIUM_DISCOUNT');assert.equal(controls.credit_exempt,false);passed('history classification preserves pricing and credit controls');
  controls=await modules.services.operations.controls(owner,cid,{classification:'DO_NOT_QUOTE',pricingClass:controls.pricing_class,creditExempt:false,version:controls.version,reason});
  await assert.rejects(service.applyClassification(owner,cid,f.company,{policyVersion:policy.version,controlVersion:controls.version,reason}),{status:409});
  await assert.rejects(service.previewPricing(owner,cid,f.company,{itemId:f.item.id,quantity:'1'}),{code:'DO_NOT_QUOTE'});passed('history and price preview cannot bypass Do Not Quote');
  }
  const invoice=await modules.services.operations.create(owner,'INVOICE',{title:'VERIFY- invoice history',customerId:cid,ownerId:owner.id,backupId:reviewer.id,reason,payload:{invoiceNumber:'VERIFY-CUSTOMER-INV',invoiceDate:'2026-11-23',amount:'100.00',sourceReference:'Synthetic existing invoice',sourceObservedAt:new Date(Date.now()-60000).toISOString()}});
  assert.ok((await service.history(owner,cid,{})).data.some(x=>x.id===invoice.record.id));assert.ok(!(await service.history(f.executive,cid,{})).data.some(x=>x.kind==='INVOICE'));passed('history links invoice records only for authorised finance users');
  const make=async name=>{const customer=await saveCustomer(db,null,{name:'VERIFY- '+name,stateCode:'33',creditLimit:'0',creditDays:0,ownerId:f.executive.id,reason},owner);await decideCustomerOnboarding(db,customer.id,{version:customer.onboarding.version,decision:'APPROVE',reason},reviewer);return customer;};
  const source=await make('Duplicate source'),target=await make('Duplicate target');
  const sourceAddress=await service.saveAddress(owner,source.id,null,{value:address,reason});
  await assert.rejects(service.previewMerge(f.executive,source.id,{targetId:target.id}),{status:403});passed('merge requests require the new explicit permission');
  let mp=await service.previewMerge(owner,source.id,{targetId:target.id});assert.deepEqual(mp.blockers,[]);
  let request=await service.requestMerge(owner,source.id,{targetId:target.id,fingerprint:mp.fingerprint,reason});
  await assert.rejects(service.decideMerge(owner,source.id,request.id,{decision:'APPROVE',version:request.version,reason}),{status:403});passed('merge maker cannot approve own request');
  await service.saveAddress(owner,source.id,sourceAddress.id,{version:sourceAddress.version,value:{...address,city:'Changed synthetic city'},reason});
  await assert.rejects(service.decideMerge(reviewer,source.id,request.id,{decision:'APPROVE',version:request.version,reason}),{code:'MERGE_PREVIEW_STALE'});passed('changed source data invalidates merge review');
  await service.decideMerge(reviewer,source.id,request.id,{decision:'REJECT',version:request.version,reason});
  mp=await service.previewMerge(owner,source.id,{targetId:target.id});request=await service.requestMerge(owner,source.id,{targetId:target.id,fingerprint:mp.fingerprint,reason});
  const merged=await service.decideMerge(reviewer,source.id,request.id,{decision:'APPROVE',version:request.version,reason});assert.equal(merged.identity.canonicalId,target.id);
  assert.ok((await service.addresses(owner,target.id)).data.some(x=>x.id===sourceAddress.id));assert.equal((await db.prepare('SELECT customer_id FROM crm_customer_addresses WHERE id=?').get(sourceAddress.id)).customer_id,source.id);passed('merge retains original linked records and joins customer history');
  await assert.rejects(service.saveAddress(owner,source.id,null,{value:{...address,label:'VERIFY- forbidden'},reason}),{code:'CUSTOMER_MERGED'});
  await assert.rejects(db.prepare("UPDATE customers SET status='ACTIVE' WHERE id=?").run(source.id),/Customer was merged/);passed('merged source cannot be reactivated or receive new business');
  assert.ok((await service.previewMerge(owner,target.id,{targetId:cid})).blockers.length);passed('merge chains are rejected');
  return {checks,passed:checks.length};
 }finally{modules.scheduler.stop();installPermissionProvider(null);await f.close();}
}
