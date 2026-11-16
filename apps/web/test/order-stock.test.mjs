import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {orderStockApi} from '../features/orders/stock-api.ts';

test('typed fulfillment API keeps company, receipt fingerprints and retry identity in relative CRM calls',async()=>{
 const calls=[],api={async data(method,path,body,options){calls.push({method,path,body,options});return [];}},client=orderStockApi(api);
 await client.sources('ZZTEST_company');await client.pending('ZZTEST_company');await client.preview('ZZTEST_movement');
 const body={requestKey:'ZZTEST_retry',reason:'ZZTEST_independent review',evidenceReference:'ZZTEST_Tally movement',attestedInTally:true,sourceFingerprint:'a'.repeat(64)};
 await client.review('ZZTEST_movement',body);
 assert.deepEqual(calls[0].options.query,{companyId:'ZZTEST_company'});assert.deepEqual(calls[1].options.query,{companyId:'ZZTEST_company'});assert.deepEqual(calls[3].body,body);assert.ok(calls.every(call=>call.path.startsWith('/api/crm/')));
});

test('order form saves explicit company and stock basis while reconciliation requires independent evidence',()=>{
 const page=fs.readFileSync(new URL('../app/(app)/orders/page.tsx',import.meta.url),'utf8'),component=fs.readFileSync(new URL('../features/orders/stock-context.tsx',import.meta.url),'utf8');
 assert.match(page,/companyId:orderCompanyId/);assert.match(page,/setOrderCompanyId\(order\?\.companyId\|\|''\)/);assert.match(page,/OrderStockBinding/);assert.match(page,/OrderStockEvidenceTable/);assert.match(page,/StockConsumptionReviews/);
 assert.match(component,/role==='OWNER'/);assert.match(component,/sourceFingerprint:preview\.fingerprint/);assert.match(component,/attestedInTally:attested/);assert.match(component,/New unassociated orders remain blocked/);assert.match(component,/A new import does not automatically clear/);
 assert.doesNotMatch(component,/setOrderCompanyId\(.*companyId/);
});
