import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from '../src/core/schema.js';
import {addressSchema,validateActivity,validateCommercial,classifyHistory} from '../src/modules/customers/domain.js';
import {requireCustomerHandler} from '../src/modules/operations/customer-gates.js';

test('customer history has no invented default classification policy',()=>{
 assert.deepEqual(classifyHistory(100,null),{state:'NOT_CONFIGURED',classification:null,tier:null,count:null});
});
test('PO history uses the confirmed five-inclusive Elite boundary',()=>{
 const policy={basis:'PO',existingMinimum:1,potentialBelow:null};
 for(const n of [0,1,4,5,6,100]){
  const result=classifyHistory(n,policy);
  assert.equal(result.tier,n===0?null:n<5?'EARLY_BIRD':'ELITE');
  assert.equal(result.classification,n===0?'NEW':'EXISTING');
 }
});
test('potential classification and lookback are explicit company policy',()=>{
 const policy={basis:'ORDER',existingMinimum:2,potentialBelow:5};
 assert.equal(classifyHistory(1,policy).classification,'NEW');
 assert.equal(classifyHistory(2,policy).classification,'POTENTIAL');
 assert.equal(classifyHistory(5,policy).classification,'EXISTING');
 assert.equal(classifyHistory(5,policy).tier,null);
});
test('commercial policy validates status sets and contract exclusivity',()=>{
 for(const value of [
  {classes:{RATE_CONTRACT:{strategy:'MANUAL_REVIEW'}}},
  {classes:{NEW:{strategy:'PRICE_LEVEL'}}},
  {classes:{NEW:{strategy:'MANUAL_REVIEW',level:1}}},
  {classification:{basis:'PO',statuses:['ISSUED'],periodDays:null,existingMinimum:1,potentialBelow:null}},
  {classification:{basis:'ORDER',statuses:['APPROVED','APPROVED'],periodDays:null,existingMinimum:1,potentialBelow:null}}
 ])assert.throws(()=>validateCommercial(value),{status:422});
 assert.equal(validateCommercial({classes:{NEW:{strategy:'PRICE_LEVEL',level:4}}}).classes.NEW.level,4);
});
test('call logs require timezone, a real past activity and coherent follow-up/link',()=>{
 const value={kind:'CALL',title:'Synthetic call',notes:'Synthetic outcome',ownerId:1,occurredAt:'2026-11-23T08:00:00Z'};
 assert.equal(validateActivity(value,new Date('2026-11-23T09:00:00Z')).occurredAt,value.occurredAt.replace('Z','.000Z'));
 for(const patch of [{occurredAt:'2026-11-23T08:00:00'},{occurredAt:'2026-11-24T08:00:00Z'},{followUpAt:'2026-11-22T08:00:00Z'},{relatedKind:'ORDER'},{relatedId:2}])assert.throws(()=>validateActivity({...value,...patch},new Date('2026-11-23T09:00:00Z')),{status:422});
});
test('address payloads reject unknown fields and require explicit country',()=>{
 const value={label:'Test delivery',kind:'DELIVERY',line1:'Synthetic address',city:'Test city',stateCode:'33',countryCode:'IN',isDefault:false};
 assert.equal(validate(addressSchema,value).kind,'DELIVERY');
 assert.throws(()=>validate(addressSchema,{...value,countryCode:undefined}),{status:422});
 assert.throws(()=>validate(addressSchema,{...value,customerId:100}),{status:422});
});
test('loaded customer ownership is reused without changing salesperson restrictions',async()=>{
 const db={prepare(){throw new Error('Unexpected repeated ownership lookup');}};
 await requireCustomerHandler(db,1,{id:5,role:'EXECUTIVE'},{owner_id:5});
 await assert.rejects(requireCustomerHandler(db,1,{id:6,role:'EXECUTIVE'},{owner_id:5}),{status:403});
 await requireCustomerHandler(db,1,{id:6,role:'OWNER'},{owner_id:5});
});
