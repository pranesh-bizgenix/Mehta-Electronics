import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSalesIntakePolicy,tierResult} from '../src/modules/sales-intake/policy.js';

for(const [key,basis,statuses]of [['po','PO',['ACTIVE']],['enquiry','ENQUIRY',['NEW','QUALIFIED','QUOTED']]])for(let count=0;count<10;count++)test(`confirmed ${basis} tier: ${count} distinct qualifying records`,()=>{
 const input={tiers:{[key]:{basis,statuses,includeCurrent:true,threshold:5,companyScoped:true}}};
 const normalized=validateSalesIntakePolicy(input),policy=normalized.tiers[key];
 assert.equal(policy.exactlyFive,'ELITE');
 assert.equal(input.tiers[key].exactlyFive,undefined);
 assert.deepEqual({tier:tierResult(count,policy).tier,state:tierResult(count,policy).state},{tier:count<5?'EARLY_BIRD':'ELITE',state:'CLASSIFIED'});
 assert.equal(tierResult(5,input.tiers[key]).tier,'ELITE');
 assert.equal(tierResult(5,null).state,'TIER_POLICY_REQUIRED');
 assert.deepEqual(validateSalesIntakePolicy({}),{});
});

for(let i=0;i<10;i++)test(`response and tier policy ${i+1}: page visits cannot count as responses; unsupported statuses cannot manufacture a tier`,()=>{
 const response={qualifyingActions:['CUSTOMER_RESPONSE_REFERENCE'],instructions:'ZZTEST confirmed manual customer-response evidence',reassignmentAttribution:'FIRST_ASSIGNEE',excludeCancelled:true,pauseMode:'NO_PAUSES',reopenBehavior:'KEEP_FIRST_ASSIGNMENT_AND_RESPONSE'};
 assert.doesNotThrow(()=>validateSalesIntakePolicy({response}));
 for(const action of ['OPENED_SCREEN','VIEWED_RECORD','READ_NOTIFICATION','ASSIGNED','LOGIN','DASHBOARD_VISIT','OPENED_EMAIL','MARK_READ','RECORD_DISPLAYED','UNKNOWN_ACTION'].slice(0,i+1))assert.throws(()=>validateSalesIntakePolicy({response:{...response,qualifyingActions:[action]}}),{status:422});
 const tier={basis:'PO',statuses:['ACTIVE'],includeCurrent:true,threshold:5,exactlyFive:'REVIEW',companyScoped:true};
 assert.throws(()=>validateSalesIntakePolicy({tiers:{po:{...tier,statuses:['APPROVED']}}}),{status:422});
 assert.throws(()=>validateSalesIntakePolicy({tiers:{po:{...tier,statuses:['ACTIVE','ACTIVE']}}}),{status:422});
 assert.doesNotThrow(()=>validateSalesIntakePolicy({tiers:{enquiry:{...tier,basis:'ENQUIRY',statuses:['NEW','QUALIFIED']}}}));
});
