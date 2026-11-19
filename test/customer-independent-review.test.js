import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decideCustomerOnboarding} from '../src/crm-modules.js';

for(const [label,actorId] of [['original creator after another editor resubmits',1],['current submitter',2]]){
 test(`customer onboarding rejects ${label} before any decision is written`,async()=>{
  let writes=0;
  const row={customer_id:99,version:2,status:'PENDING_APPROVAL',created_by:1,submitted_by:2};
  const commands=[];
  const db={withConnection:callback=>callback(),exec:async command=>commands.push(command),prepare:statement=>({get:async()=>statement.includes('FROM crm_customer_onboarding')?row:{},run:async()=>{writes++;}})};
  await assert.rejects(decideCustomerOnboarding(db,99,{decision:'APPROVE',version:2,reason:'VERIFY- independent review regression'},{id:actorId,role:'OWNER'}),{status:403});
  assert.equal(writes,0);assert.equal(commands.at(-1),'ROLLBACK');
 });
}
