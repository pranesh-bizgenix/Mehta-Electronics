import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierPerformance} from '../src/modules/sourcing/supplier-performance.js';
import {schemeProgress,validateScheme} from '../src/modules/sourcing/schemes.js';

function evidence(){return {vendor:{id:1,payload:{name:'SAMPLE supplier'}},invitations:[{rfq_id:1,created_at:'2026-11-01T00:00:00Z',replyBy:'2026-11-02'}],replies:[{rfq_id:1,created_at:'2026-11-01T06:00:00Z'}],orders:[{id:1,vendor_id:1,payload:{deliveryBy:'2026-11-10',lines:[{lineKey:'A',itemId:1,partCode:'SAMPLE-A',uom:'NOS',quantity:'10',unitPrice:'12.34',discountPercent:'10'}]}}],receipts:[{id:1,supplier_po_id:1,status:'POSTED',is_deleted:false,payload:{receivedDate:'2026-11-09',lines:[{poLineKey:'A',accepted:'4',rejected:'1'}]}},{id:2,supplier_po_id:1,status:'POSTED',is_deleted:false,payload:{receivedDate:'2026-11-11',lines:[{poLineKey:'A',accepted:'6',rejected:'0'}]}}],to:'2026-11-26'};}
test('Supplier response and partial receipt completion are based on saved evidence',()=>{
 const r=supplierPerformance(evidence());assert.equal(r.responseRate,'100.00');assert.equal(r.averageRecordedResponseHours,'6.00');assert.equal(r.completed,1);assert.equal(r.onTimeCompleted,0);assert.equal(r.acceptedValueExGst,'111.06');assert.equal(r.damagedReceipts,1);assert.equal(r.weightedScore,null);
});
test('Held, deleted and future receipts do not improve supplier performance',()=>{
 const e=evidence();e.receipts[1].status='HELD';assert.equal(supplierPerformance(e).completed,0);e.receipts[1].status='POSTED';e.receipts[1].is_deleted=true;assert.equal(supplierPerformance(e).completed,0);e.receipts[1].is_deleted=false;e.receipts[1].payload.receivedDate='2026-11-27';assert.equal(supplierPerformance(e).completed,0);
});
test('No source data produces no fabricated supplier grade or response percentage',()=>{
 const e=evidence();Object.assign(e,{invitations:[],replies:[],orders:[],receipts:[]});const r=supplierPerformance(e);assert.equal(r.responseRate,null);assert.equal(r.onTimeCompletionRate,null);assert.equal(r.averageRecordedResponseHours,null);assert.equal(r.acceptedValueExGst,'0.00');
});
test('Quantities with different units remain separate in supplier scorecards',()=>{
 const e=evidence();e.orders[0].payload.lines.push({lineKey:'B',itemId:2,uom:'MTR',quantity:'2',unitPrice:'1',discountPercent:'0'});e.receipts[0].payload.lines.push({poLineKey:'B',accepted:'2',rejected:'0'});assert.deepEqual(supplierPerformance(e).units.map(u=>u.uom),['NOS','MTR']);
});
test('Late saved replies cannot count as responses before the reporting cut-off',()=>{
 const e=evidence();e.replies[0].created_at='2026-12-01T00:00:00Z';const r=supplierPerformance(e);assert.equal(r.responded,0);
});
const scheme=()=>({vendor_id:1,valid_from:'2026-11-01',valid_to:'2026-11-30',payload:{basis:'ACCEPTED_NET_VALUE',threshold:'100',itemId:null}});
test('Scheme targets use accepted PO value without claiming a rebate or payment',()=>{
 const e=evidence(),r=schemeProgress(scheme(),e.orders,e.receipts,e.to);assert.equal(r.value,'111.06');assert.equal(r.targetReached,true);assert.equal(r.confirmedRebate,null);
});
test('Quantity schemes count only the specified item from the specified supplier',()=>{
 const e=evidence(),s=scheme();s.payload={basis:'ACCEPTED_ITEM_QUANTITY',itemId:1,threshold:'10'};assert.equal(schemeProgress(s,e.orders,e.receipts,e.to).value,'10.000000');s.vendor_id=2;assert.equal(schemeProgress(s,e.orders,e.receipts,e.to).value,'0.000000');
});
test('Quantity scheme cannot mix a changed pack unit with its agreed base unit',()=>{
 const e=evidence(),s=scheme();s.payload={basis:'ACCEPTED_ITEM_QUANTITY',itemId:1,threshold:'10',uom:'MTR'};const r=schemeProgress(s,e.orders,e.receipts,e.to);assert.equal(r.value,'0.000000');assert.equal(r.issues.length,1);
});
test('Scheme progress excludes out-of-window, held and substitute goods',()=>{
 const e=evidence();e.receipts[0].payload.receivedDate='2026-10-31';e.receipts[1].payload.lines[0].actualPartCode='OTHER';const r=schemeProgress(scheme(),e.orders,e.receipts,e.to);assert.equal(r.value,'0.00');assert.equal(r.issues.length,1);
});
test('Scheme targets and benefits must be explicit and commercially possible',()=>{
 const b={validFrom:'2026-11-01',validTo:'2026-11-30',basis:'ACCEPTED_NET_VALUE',itemId:null,threshold:'100',benefitKind:'PERCENT_REBATE',benefitValue:'5'};assert.equal(validateScheme(b),b);
 for(const patch of [{threshold:'0'},{validTo:'2026-10-31'},{basis:'ACCEPTED_ITEM_QUANTITY'},{benefitValue:'101'},{benefitValue:null}])assert.throws(()=>validateScheme({...b,...patch}),{status:422});
});
