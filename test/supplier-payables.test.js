import test from 'node:test';
import assert from 'node:assert/strict';
import {payableMoney,payableBalance,assertPaymentCapacity} from '../src/modules/accounts/payable-domain.js';
import {PayablesService} from '../src/modules/accounts/payables-service.js';

test('Supplier amounts preserve exact paise while accepting database six-place decimals',()=>{
 assert.equal(payableMoney('100.000000'),'100.00');assert.equal(payableMoney('0.010000'),'0.01');
 for(const amount of [100,'0','-1','0.001','1e3','NaN','100.000001'])assert.throws(()=>payableMoney(amount),{status:422});
});
test('Supplier balance includes only approved notes and actually confirmed payment records',()=>{
 const balance=payableBalance('1000',{notes:[{status:'APPROVED',amount:'100'},{status:'PENDING_APPROVAL',amount:'500'}],payments:[{id:'paid',status:'CONFIRMED',amount:'200'},{id:'pending',status:'PENDING_APPROVAL',amount:'100'},{id:'approved',status:'APPROVED',amount:'50'},{id:'rejected',status:'REJECTED',amount:'500'}]});
 assert.equal(balance.net,'900.000000');assert.equal(balance.paid,'200.000000');assert.equal(balance.outstanding,'700.000000');assert.equal(balance.reserved,'150.000000');assert.equal(balance.available,'550.000000');
});
test('Pending supplier approvals reserve capacity and prevent a second request spending it',()=>{
 const balance=payableBalance('100',{payments:[{id:'one',status:'PENDING_APPROVAL',amount:'60'}]});
 assert.equal(assertPaymentCapacity('40',balance),'40.00');assert.throws(()=>assertPaymentCapacity('40.01',balance),{status:409});
});
test('Review excludes the current reservation without excluding confirmed payments',()=>{
 const rows=[{id:'one',status:'APPROVED',amount:'60'},{id:'two',status:'CONFIRMED',amount:'30'}];
 const balance=payableBalance('100',{payments:rows,excludePaymentId:'one'});
 assert.equal(balance.available,'70.000000');assert.equal(assertPaymentCapacity('60',balance),'60.00');
 assert.equal(payableBalance('100',{payments:rows,excludePaymentId:'two'}).paid,'30.000000');
});
test('An adjusted supplier invoice settles only when confirmed payments cover its adjusted amount',()=>{
 const balance=payableBalance('100',{notes:[{status:'APPROVED',amount:'20'}],payments:[{id:'one',status:'CONFIRMED',amount:'80'}]});
 assert.equal(balance.outstanding,'0.000000');assert.throws(()=>assertPaymentCapacity('0.01',balance),{status:409});
});
test('Unknown, warehouse and sales roles are denied supplier financial records before database access',async()=>{
 const service=new PayablesService({db:{prepare(){throw new Error('Unexpected financial read');}}});
 for(const role of ['EXECUTIVE','MANAGER','LOGISTICS_LEAD','STORE_STAFF','UNKNOWN']){
  const actor={id:1,role};await assert.rejects(service.list(actor),{status:403});await assert.rejects(service.sources(actor),{status:403});await assert.rejects(service.createDue(actor,{}),{status:403});await assert.rejects(service.reviewPayment(actor,'bad',{}),{status:403});
 }
});
test('Unconfigured supplier payment authority is explicit rather than silently assigned a limit',async()=>{
 const service=new PayablesService({db:{},rules:{get:async()=>null}}),policy=await service.policy({id:1,role:'OWNER'});
 assert.equal(policy.configured,false);assert.equal(policy.maximumAmount,null);assert.deepEqual(policy.checks,[]);
});
