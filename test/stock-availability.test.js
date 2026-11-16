import assert from 'node:assert/strict';
import {test} from 'node:test';
import {evaluateStock,stockQuantity,stockPointer,stockPolicyProblem} from '../src/modules/stock/availability.js';
const now=new Date('2026-11-06T06:00:00Z'),policy={version:1,value:{maximumSourceAgeMinutes:10,reservedQuantityPointer:'/RESERVEDQTY',reservationsPointer:'/ORDERALLOCATIONS.LIST',reservationShape:'ARRAY',reservationQuantityPointer:'/ACTUALQTY',reservationKeyPointer:'/ORDERGUID',reservationReferencePointer:'/ORDERNO',reservationPartyPointer:'/PARTYNAME',instructions:'VERIFY- confirmed source meanings'}};
function source(){return {stable:true,item_id:1,company_id:'VERIFY-company',record_key:'VERIFY-stock_guid',session_id:'VERIFY-session',sourceTimestamp:'2026-11-06T05:59:00Z',uom:'NOS',closing_quantity_text:'9007199254740993.123456 NOS',raw_record:{RESERVEDQTY:'3.123456 NOS','ORDERALLOCATIONS.LIST':[{ORDERGUID:'VERIFY-order_1',ORDERNO:'VERIFY-SO1',PARTYNAME:'VERIFY-party',ACTUALQTY:'1.000000 NOS',AMOUNT:'VERIFY-SECRET'},{ORDERGUID:'VERIFY-order_2',ORDERNO:'VERIFY-SO2',ACTUALQTY:'2.123456 NOS',RATE:'VERIFY-SECRET'}]}};}
const evaluate=(overrides={})=>evaluateStock({source:source(),policy,now,latestAttempt:{status:'imported',quarantined_count:0},requestedQuantity:'1',basis:'FREE_STOCK',...overrides});
test('stock evidence uses exact units/quantities and exposes no financial fields; reserved IDs never match by name',()=>{
 const free=evaluate();assert.equal(free.status,'VERIFIED');assert.equal(free.freeQuantity,'9007199254740990.000000');assert.equal(free.available,true);assert.equal(JSON.stringify(free).includes('SECRET'),false);
 const reserved=evaluate({basis:'RESERVED_STOCK',reservationKey:'VERIFY-order_2',requestedQuantity:'2.123456'});assert.equal(reserved.selectedReservedQuantity,'2.123456');assert.equal(reserved.available,true);
 assert.equal(evaluate({basis:'RESERVED_STOCK',reservationKey:'VERIFY-SO2'}).available,null);
 assert.equal(stockQuantity('100.25','NOS'),null);assert.equal(stockQuantity('1 BOX','NOS'),null);assert.equal(stockQuantity('-2 NOS','NOS'),'-2.000000');
 assert.equal(stockPointer({},'/__proto__/x'),undefined);assert.ok(stockPolicyProblem({...policy.value,reservationKeyPointer:'/PARTYNAME'}));assert.ok(stockPolicyProblem({...policy.value,reservationPartyPointer:'/AMOUNT'}));
});
test('missing policy, mismatched details, unknown/future source time and stale/failed sync evidence never pass as current',()=>{
 const empty=evaluate({policy:null});assert.equal(empty.status,'UNVERIFIED');assert.equal(empty.reservedQuantity,null);assert.equal(empty.freeQuantity,null);assert.equal(empty.available,null);
 const s=source();s.raw_record.RESERVEDQTY='5 NOS';const mismatch=evaluate({source:s});assert.equal(mismatch.status,'REVIEW_REQUIRED');assert.equal(mismatch.available,null);
 const absent=source();delete absent.sourceTimestamp;assert.equal(evaluate({source:absent}).available,null);
 const future=source();future.sourceTimestamp='2026-11-06T06:00:01Z';assert.equal(evaluate({source:future}).available,null);
 assert.equal(evaluate({now:new Date('2026-11-06T06:10:01Z')}).status,'STALE');assert.equal(evaluate({latestAttempt:{status:'failed'}}).available,null);
 const missing=source();delete missing.raw_record['ORDERALLOCATIONS.LIST'];assert.equal(evaluate({source:missing}).available,null);
 const explicit=source();explicit.raw_record.RESERVEDQTY='0 NOS';explicit.raw_record['ORDERALLOCATIONS.LIST']=[];assert.equal(evaluate({source:explicit}).reservedQuantity,'0.000000');assert.equal(evaluate({source:explicit}).status,'VERIFIED');
 assert.throws(()=>evaluate({requestedQuantity:'0'}),{status:422});
 assert.notEqual(evaluate().previewFingerprint,evaluate({policy:{...policy,version:2}}).previewFingerprint);
 assert.equal(evaluate({latestAttempt:null}).available,null);assert.equal(evaluate({latestAttempt:{status:'imported',quarantined_count:1}}).available,null);
 const overflow=source();overflow.closing_quantity_text='-999999999999999999999999 NOS';assert.throws(()=>evaluate({source:overflow}),{status:422});
});
