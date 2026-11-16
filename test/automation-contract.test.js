import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {automationCompatibilitySurface,compatibilityDifferences} from '../test-support/automation-compatibility.js';
import {automationOpenApi,AUTOMATION_OPERATIONS,AUTOMATION_SCOPES,AUTOMATION_API_VERSION} from '../src/modules/automation-api/contract.js';
import {getConfig} from '../src/config.js';
const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/automation/compatibility-v1.json',import.meta.url),'utf8'));
const credentialsAddendum=JSON.parse(fs.readFileSync(new URL('./fixtures/automation/credentials-addendum-v1.json',import.meta.url),'utf8'));
test('A1 proposed OpenAPI matches the versioned manifest, bounds writes and has no approval/send/settings mutation scope',()=>{
 const api=automationOpenApi(),written=JSON.parse(fs.readFileSync(new URL('../docs/automation-openapi.yaml',import.meta.url),'utf8'));assert.deepEqual(written,api);
 assert.equal(api.openapi,'3.0.3');assert.equal(api.info.version,AUTOMATION_API_VERSION);assert.deepEqual(api.servers,[{url:'/'}]);
 assert.equal(Object.keys(api.paths).length,AUTOMATION_OPERATIONS.length);
 for(const op of AUTOMATION_OPERATIONS){const spec=api.paths[op.path][op.method.toLowerCase()];assert.ok(AUTOMATION_SCOPES.includes(op.scope));assert.equal(spec['x-required-scope'],op.scope);assert.equal(spec['x-implementation-status'],op.id==='readSwitches'?'IMPLEMENTED':'PLANNED');assert.ok(!/approve|send|delete|settings\//i.test(op.path));
  if(op.method==='POST'){const schema=api.components.schemas[op.request];assert.equal(schema.additionalProperties,false);assert.ok(schema.required.includes('companyId'));if(op.scope!=='automation.read'){assert.ok(schema.required.includes('reason'));assert.ok(spec.parameters.some(p=>p.name==='Idempotency-Key'&&p.required));}}
  else assert.ok(spec.parameters.some(p=>p.name==='companyId'&&p.required));
  for(const forbidden of ['cost','margin','listPrice','discountPercent'])assert.equal(forbidden in api.components.schemas[op.response].properties,false);
 }
});
test('A9 metadata contract detects a removed column, changed permission or endpoint and accepts additive members',()=>{
 const added=structuredClone(baseline);added.columns.push({...added.columns[0],name:'ZZTEST_added_column'});assert.deepEqual(compatibilityDifferences(baseline,added),[]);
 for(const group of ['columns','constraints','permissions','endpoints']){const missing=structuredClone(baseline);missing[group].shift();assert.ok(compatibilityDifferences(baseline,missing).some(d=>d.startsWith(group+': removed')));}
 const changed=structuredClone(baseline);changed.endpoints[0].permission='ZZTEST_weakened';assert.ok(compatibilityDifferences(baseline,changed).some(d=>d.startsWith('endpoints: changed')));
});
test('A9 existing automation/work/task/approval schemas, permission catalogue and staff endpoint guards retain their captured contract',()=>withTestTransaction(async db=>{
 const current=await automationCompatibilitySurface(db,getConfig({localReviewAccess:false}));assert.deepEqual(compatibilityDifferences(baseline,current),[]);
 assert.deepEqual(compatibilityDifferences(credentialsAddendum,current),[]);
}));
