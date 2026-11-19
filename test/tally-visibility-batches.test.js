import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visibilityBatches} from '../src/tally-visibility-replay.js';

const payload={company_id:'VERIFY-company',session_id:'VERIFY-session'};
const row=n=>({entity:'vouchers',key:`VERIFY-${n}`,name:`VERIFY-${n}`,raw:{AMOUNT:{'#text':'1234567890123456.78'}},stored:{name:`VERIFY-${n}`,raw_record:'must not duplicate'}});
test('visibility writes bound row count while preserving every identity, order and exact amount',()=>{
 const records=Array.from({length:251},(_,i)=>row(i)),batches=[...visibilityBatches(records,payload)];
 assert.deepEqual(batches.map(b=>b.length),[100,100,51]);
 const flat=batches.flat();assert.equal(flat.length,251);
 for(let i=0;i<flat.length;i++){
  assert.equal(flat[i].key,records[i].key);assert.deepEqual(flat[i].raw,records[i].raw);
  assert.equal(flat[i].stored.company_id,payload.company_id);assert.equal(flat[i].stored.session_id,payload.session_id);
  assert.ok(!JSON.stringify(flat[i].stored).includes('must not duplicate'));
 }
 assert.deepEqual([...visibilityBatches([],payload)],[]);
});
test('byte budget splits independently of row limit; a single large source record is preserved',()=>{
 const records=[row(1),row(2),row(3)];
 records[1].raw.ORIGINAL='x'.repeat(4096);
 const batches=[...visibilityBatches(records,payload,{maxBytes:1024,maxRows:100})];
 assert.deepEqual(batches.map(b=>b.length),[1,1,1]);assert.equal(batches[1][0].raw.ORIGINAL.length,4096);
});
