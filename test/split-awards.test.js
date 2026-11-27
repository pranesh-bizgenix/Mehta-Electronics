import test from 'node:test';
import assert from 'node:assert/strict';
import {splitAwardGroups,splitAwardDecision} from '../src/modules/sourcing/award-domain.js';
import {SplitAwardService} from '../src/modules/sourcing/awards.js';

function sample(){
 const requested=[{itemId:1,partCode:'SAMPLE-ITEM',description:'Fictional component',quantity:'10',uom:'NOS',taxPercent:'18'}];
 const offers=[6,4].map((quantity,i)=>({id:i+1,vendorId:i+11,version:1,status:'RECORDED',vendorStatus:'ACTIVE',vendor:{name:'SAMPLE supplier '+i,stateCode:'33'},validUntil:'2026-12-20',terms:'SAMPLE supplied terms',commercial:{chargesConfirmed:true,charges:[{kind:'FREIGHT',amount:'10',taxPercent:'18'}]},lines:[{itemId:1,baseQuantity:String(quantity),baseUom:'NOS',baseUnitPrice:'100',discountPercent:'10',taxPercent:'18'}]}));
 const allocations=offers.map((offer,i)=>({replyId:offer.id,itemId:1,quantity:offer.lines[0].baseQuantity,promisedOn:'2026-12-01',lineKey:'SAMPLE-'+i}));
 return {requested,offers,allocations,today:'2026-11-26',buyerState:'33',termsConfirmed:true};
}
test('Approved split preview keeps exact quantities, supplier prices, GST and one freight charge per PO',()=>{
 const s=sample(),before=JSON.stringify(s),result=splitAwardGroups(s);assert.equal(result.groups.length,2);assert.equal(result.groups[0].total,'649.00');assert.equal(result.groups[1].total,'436.60');assert.equal(result.total,'1085.60');assert.equal(result.groups[0].lines[0].quantity,'6.000000');assert.equal(JSON.stringify(s),before);
});
test('Every requested quantity must be fully allocated without exceeding supplier capacity',()=>{
 for(const changes of [[{quantity:'5'},{quantity:'4'}],[{quantity:'7'},{quantity:'3'}],[{quantity:'0'},{quantity:'4'}]]){const s=sample();s.allocations=s.allocations.map((a,i)=>({...a,...changes[i]}));assert.throws(()=>splitAwardGroups(s),{status:422});}
});
test('Duplicate supplier/item allocations and ambiguous RFQ item rows require review',()=>{
 const s=sample();s.allocations.push({...s.allocations[0]});assert.throws(()=>splitAwardGroups(s),{status:422});const r=sample();r.requested.push({...r.requested[0]});assert.throws(()=>splitAwardGroups(r),{status:422});
});
test('Unknown items, expired offers, inactive vendors and unknown conversions fail closed',()=>{
 for(const patch of [{validUntil:'2026-11-25'},{vendorStatus:'INACTIVE'},{status:'WITHDRAWN'},{flagsByItem:{1:['PACK_CONVERSION_CHANGED_OR_EXPIRED']}}]){const s=sample();Object.assign(s.offers[0],patch);assert.throws(()=>splitAwardGroups(s),{status:409});}
 const s=sample();s.allocations[0].itemId=99;assert.throws(()=>splitAwardGroups(s),{status:422});
});
test('Terms and full supplier charges need explicit confirmation for split quantities',()=>{
 const s=sample();s.termsConfirmed=false;assert.throws(()=>splitAwardGroups(s),{status:422});s.termsConfirmed=true;s.offers[0].commercial.chargesConfirmed=false;assert.throws(()=>splitAwardGroups(s),{status:409});
});
test('Confirmed base units and real nonpast delivery dates are mandatory',()=>{
 const s=sample();s.offers[0].lines[0].baseUom='PKT';assert.throws(()=>splitAwardGroups(s),{status:409});
 for(const date of ['2026-02-30','2026-11-25','not a date']){const r=sample();r.allocations[0].promisedOn=date;assert.throws(()=>splitAwardGroups(r),{status:422});}
});
test('Fractional split quantities and interstate GST use exact saved rate precision',()=>{
 const s=sample();s.requested[0].quantity='0.3';s.allocations[0].quantity='0.1';s.allocations[1].quantity='0.2';for(const o of s.offers){o.vendor.stateCode='19';o.commercial.charges=[];o.lines[0].discountPercent='0';o.lines[0].baseUnitPrice='0.50';}
 const r=splitAwardGroups(s);assert.equal(r.groups[0].totals.cgst,'0.00');assert.equal(r.groups[0].totals.igst,'0.01');assert.equal(r.groups[0].total,'0.06');assert.equal(r.total,'0.18');
});
test('Comparison flags for partial supplier quantities are allowed only within exact aggregate demand',()=>{
 const s=sample();s.offers[0].flagsByItem={1:['PARTIAL_QUANTITY']};assert.equal(splitAwardGroups(s).groups.length,2);
});
test('The creator cannot approve or reject their own split and stale versions fail',()=>{
 const r={status:'PENDING_APPROVAL',version:1,created_by:1};for(const action of ['APPROVE','REJECT'])assert.throws(()=>splitAwardDecision(r,action,1,1),{status:403});assert.throws(()=>splitAwardDecision(r,'APPROVE',2,2),{status:409});assert.equal(splitAwardDecision(r,'APPROVE',2,1),'APPROVED');
});
test('Only approved plans materialise; an ordered-plan retry preserves its terminal state',()=>{
 assert.throws(()=>splitAwardDecision({status:'PENDING_APPROVAL',version:1},'CREATE_ORDERS',2,1),{status:409});assert.equal(splitAwardDecision({status:'APPROVED',version:2},'CREATE_ORDERS',2,2),'ORDERED');assert.equal(splitAwardDecision({status:'ORDERED',version:3},'CREATE_ORDERS',2,3),'ORDERED');
});
test('Unauthorised callers are rejected before any database access',async()=>{
 const service=new SplitAwardService({db:{}});await assert.rejects(service.create({role:'UNKNOWN'},1,{}),{status:403});await assert.rejects(service.list({role:'UNKNOWN'},1),{status:403});
});
