import test from 'node:test';
import assert from 'node:assert/strict';
import {operationsDeliveryContext} from '../src/modules/operations-intake/make-delivery.js';
const companyId='84409d59-74f3-4793-8e9d-a0bf7b2c0c8e';
function fixture(){return {companyId,staged:{payload:{department:'OPERATIONS',email_message_id:'11111111-1111-4111-8111-111111111111',operations_type:'STOCK_PROCUREMENT',review_reasons:[],automatic_reply:{facts:[{id:'untrusted',text:'Stock available'}]}}},response:{statusCode:201,data:{data:{id:'22222222-2222-4222-8222-222222222222',companyId,kind:'STOCK',status:'NEEDS_REVIEW',duplicate:false,requiresReview:true,version:1}}}};}
test('First delivery validates receipt and logs only identifiers',()=>{const f=fixture(),r=operationsDeliveryContext(f);assert.equal(r.payload.crm_delivery,'DELIVERED');assert.ok(r.query.includes(r.receipt.id));assert.ok(!r.query.includes('Stock available'));assert.equal(f.staged.payload.crm_delivery,undefined);});
test('Idempotent replay accepts HTTP 200 and retains receipt identity',()=>{const f=fixture();f.response.statusCode=200;f.response.data.data.duplicate=true;assert.equal(operationsDeliveryContext(f).receipt.id,f.response.data.data.id);});
test('Serialized Make bundles and body format are accepted',()=>{const f=fixture();f.staged=JSON.stringify(f.staged);f.response={status:201,body:JSON.stringify(f.response.data)};assert.equal(operationsDeliveryContext(f).payload.requires_review,true);});
test('Transport receipt never releases external or model-generated facts',()=>{const r=operationsDeliveryContext(fixture());assert.deepEqual(r.facts,[]);assert.deepEqual(r.payload.automatic_reply.facts,[]);assert.equal(r.requires_human_followup,true);});
for(const [name,mutate] of [
 ['HTTP failure',f=>{f.response.statusCode=401;}],
 ['Missing receipt',f=>{f.response.data={};}],
 ['Wrong company',f=>{f.response.data.data.companyId='other';}],
 ['Invalid receipt identifier',f=>{f.response.data.data.id="'; DROP TABLE users;";}],
 ['Wrong queue kind',f=>{f.response.data.data.kind='ORDER_STATUS';}],
 ['Wrong lifecycle status',f=>{f.response.data.data.status='SENT';}],
 ['Invalid source identifier',f=>{f.staged.payload.email_message_id='bad';}],
 ['Invalid version',f=>{f.response.data.data.version=0;}]
])test(name+' stops downstream processing',()=>{const f=fixture();mutate(f);assert.throws(()=>operationsDeliveryContext(f));});
