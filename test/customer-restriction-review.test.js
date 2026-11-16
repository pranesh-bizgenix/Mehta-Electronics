import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {createModules} from '../src/modules/container.js';
import {getConfig} from '../src/config.js';
import {installPermissionProvider} from '../src/rbac.js';
import {requireQuotableCustomer,requireCustomerHandler} from '../src/modules/operations/customer-gates.js';

test('Do Not Quote requires a different Owner; unrelated edits cannot replace the restriction maker',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),modules=createModules({db,config:getConfig({mfaEnabled:false})});await modules.ready();
 const reviewer={id:(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('ZZTEST_Restriction Reviewer','ZZTEST_restriction_reviewer@example.test','OWNER','not-a-login',0) RETURNING id`)[0].id,role:'OWNER'};
 const service=modules.services.operations;
 const save=(actor,classification,version)=>service.controls(actor,f.customer.id,{classification,creditExempt:false,version,reason:'ZZTEST reviewed customer restriction'});
 try{
  await save(f.owner,'DO_NOT_QUOTE',0);
  await assert.rejects(requireQuotableCustomer(db,f.customer.id),error=>error.code==='DO_NOT_QUOTE'&&error.details.review.href===`/customers/${f.customer.id}`&&/Owner/.test(error.message));
  await assert.rejects(save(f.owner,'EXISTING',1),{status:403});
  // A different editor may update unrelated controls while retaining the block.
  await save(reviewer,'DO_NOT_QUOTE',1);
  await assert.rejects(save(f.owner,'EXISTING',2),{status:403});
  const cleared=await save(reviewer,'POTENTIAL',2);assert.equal(cleared.classification,'POTENTIAL');await requireQuotableCustomer(db,f.customer.id);
  await db.sql`UPDATE customers SET owner_id=${f.executive.id} WHERE id=${f.customer.id}`;
  await requireCustomerHandler(db,f.customer.id,f.executive);
  await assert.rejects(requireCustomerHandler(db,f.customer.id,{...f.executive,id:reviewer.id}),{status:403});
 }finally{modules.scheduler.stop();installPermissionProvider(null);await f.close();}
}));
