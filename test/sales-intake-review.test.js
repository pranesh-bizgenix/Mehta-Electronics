import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeIntake} from '../src/modules/sales-intake/contract.js';
import {validateReviewCommand,mergeReviewResolutions} from '../src/modules/sales-intake/review.js';

function fixture(){return {normalized:normalizeIntake({schemaVersion:'1.0',eventId:'ZZTEST_review',companyId:'11111111-1111-4111-8111-111111111111',messageType:'CUSTOMER_PO',source:{system:'Make',mailbox:'sample@example.test',messageId:'ZZTEST_review',receivedAt:'2026-11-23T04:00:00Z'},provenance:{extractor:'Sample',version:'1',reference:'ZZTEST_review'},header:{buyerName:'Original buyer',poNumber:'ZZTEST_PO',poDate:'2026-11-23'},items:[]}),resolutions:{header:{contactPerson:'Previously confirmed',phone:'12345'}}};}

test('partial follow-up review preserves earlier corrections and immutable extraction',()=>{
 const row=fixture(),before=JSON.stringify(row),first=mergeReviewResolutions(row,{header:{buyerName:'Reviewed buyer',billingAddress:{line1:'Sample address',stateCode:'33',pincode:'600001'}}});
 assert.equal(first.header.contactPerson,'Previously confirmed');assert.equal(first.header.buyerName,'Reviewed buyer');assert.equal(JSON.stringify(row),before);
 const next=mergeReviewResolutions({...row,resolutions:first},{header:{deliveryDate:'2026-12-01',phone:null}});
 assert.equal(next.header.buyerName,'Reviewed buyer');assert.equal(next.header.phone,null);assert.equal(next.header.contactPerson,'Previously confirmed');
 assert.equal(row.normalized.header.buyerName,'Original buyer');
});
test('review can supply missing item lines with exact prices and no fabricated defaults',()=>{
 const items=[{lineId:'review-line-1',description:'Sample terminal',quantity:'2',uom:'NOS',unitPrice:'0.123456',discount:{kind:'PERCENT',value:'0'},gstRate:'18',deliverySchedules:[{date:'2026-12-01',quantity:'2'}]}];
 const row=fixture(),result=mergeReviewResolutions(row,{items});assert.deepEqual(result.items,items);assert.deepEqual(row.normalized.items,[]);
 assert.throws(()=>mergeReviewResolutions(row,{items:[{...items[0],deliverySchedules:[{date:'2026-12-01',quantity:'1'}]}]}),{status:422});
});
for(const patch of [{status:'PREPARED'},{approved:true},{header:null},{header:[]},{header:{madeUp:'value'}},{header:{poDate:'2026-02-30'}},{header:{totalPoValue:118}},{items:null},{customerId:0},{customerId:null},{assignedTo:'1'},{assignedTo:-1}])test('invalid review patch rejected: '+JSON.stringify(patch),()=>assert.throws(()=>mergeReviewResolutions(fixture(),patch),{status:422}));
for(const body of [null,[],{}, {version:0},{version:1.5},{version:'1'},{version:1,resolutions:null},{version:1,resolutions:[]},{version:1,status:'PREPARED'}])test('invalid review command rejected: '+JSON.stringify(body),()=>assert.throws(()=>validateReviewCommand(body),{status:422}));
test('refresh without corrections and valid optimistic version are supported',()=>{
 assert.doesNotThrow(()=>validateReviewCommand({version:3,reason:'Refresh current requirements'}));
 const row=fixture();assert.deepEqual(mergeReviewResolutions(row),row.resolutions);
});
