import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {customerManagementChecks} from '../test-support/customer-management-checks.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {customerManagementHttpChecks} from '../test-support/customer-management-http-checks.js';
test('customer-management services preserve records, permissions, pricing and history',()=>withTestTransaction(db=>customerManagementChecks(db)));
test('customer-management HTTP routes enforce session, CSRF, schema and retry identity',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db);try{await customerManagementHttpChecks(db,f);}finally{await f.close();}
}));
