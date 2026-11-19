import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTallyImportCoordinator} from '../src/tally-import-coordinator.js';

test('concurrent finalization requests share one import until it settles',async()=>{
 let finish,calls=0;
 const coordinator=createTallyImportCoordinator(async id=>{calls++;assert.equal(id,'VERIFY-session');await new Promise(resolve=>{finish=resolve;});return {status:'stored'};});
 const first=coordinator.start('VERIFY-session');
 assert.equal(coordinator.start('VERIFY-session'),first);
 assert.equal(coordinator.isPending('VERIFY-session'),true);
 await Promise.resolve();assert.equal(calls,1);finish();
 assert.deepEqual(await first,{status:'stored'});
 assert.equal(coordinator.isPending('VERIFY-session'),false);
});
test('an indexing exception is contained and allows the retained session to retry',async()=>{
 let calls=0;
 const coordinator=createTallyImportCoordinator(()=>{calls++;if(calls===1)throw new Error('VERIFY-transient');return {status:'stored'};});
 assert.equal(await coordinator.start('VERIFY-session'),undefined);
 assert.equal(coordinator.isPending('VERIFY-session'),false);
 assert.deepEqual(await coordinator.start('VERIFY-session'),{status:'stored'});
 assert.equal(calls,2);
});
