import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createTallyWriteModule,guardTallyWriteMutation,notifyTallyWrite,requireTallyWriteConfirmation} from '../src/modules/tally-write/module.js';

function fixture(){
  let queries=0;const db={prepare(){queries++;throw new Error('Unexpected query.');}};
  const module=createTallyWriteModule({db,connectorStore:{},route:(...args)=>args,json(){},readJson:async()=>({}),readConnectorJson:async()=>({})});
  return {db,module,count:()=>queries};
}
test('G3 default-disabled mutation/producer/dispatch hooks perform zero queries and zero queue/build calls',async()=>{
  const f=fixture();let queued=0;f.module.service.queue=async()=>{queued++;throw new Error('Must not run.');};
  await guardTallyWriteMutation(f.db,'SALES_ORDER',1);
  await notifyTallyWrite(f.db,'SALES_ORDER',1,{id:1,role:'OWNER'});
  await requireTallyWriteConfirmation(f.db,'SALES_ORDER',1);
  assert.deepEqual(await f.module.service.banner(),{live:false});
  assert.equal(f.count(),0);assert.equal(queued,0);assert.deepEqual(f.module.health({status:'ok'}),{status:'ok'});
});
test('an enabled post-commit producer failure is isolated from the completed CRM action',async()=>{
  const f=fixture();f.module.service.master=true;f.module.service.config=async()=>{throw new Error('VERIFY- isolated producer failure');};
  await assert.doesNotReject(notifyTallyWrite(f.db,'SALES_ORDER',1,{id:1,role:'OWNER'}));
  assert.equal(f.module.service.lastProducerError,'ENQUEUE_BLOCKED');assert.equal(f.count(),0);
});
