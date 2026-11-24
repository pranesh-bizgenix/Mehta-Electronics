import test from 'node:test';import assert from 'node:assert/strict';
import {AccountsIntakeService} from '../src/modules/accounts-intake/service.js';
const service=new AccountsIntakeService({db:{prepare(){throw Error('Unexpected database access');}}});
for(const p of [null,{id:1,role:'OWNER'},{kind:'AUTOMATION_SERVICE',scope:'automation.read'},{kind:'AUTOMATION_SERVICE',scope:'automation.write.drafts'}])test('Staff or wrong machine scope cannot ingest '+JSON.stringify(p),async()=>assert.rejects(service.receive(p,{},''),{status:403}));
for(const actor of [{id:1,role:'EXECUTIVE'},{id:2,role:'MANAGER'},{id:3,role:'STORE_STAFF'}])test('Non-finance role cannot browse Accounts '+actor.role,async()=>assert.rejects(service.list(actor,new URLSearchParams()),{status:403}));
test('Invalid company/filter is rejected before database access',async()=>{await assert.rejects(service.list({id:1,role:'OWNER'},new URLSearchParams('companyId=bad')),{status:422});await assert.rejects(service.list({id:1,role:'OWNER'},new URLSearchParams('companyId=84409d59-74f3-4793-8e9d-a0bf7b2c0c8e&category=BAD')),{status:422});});
