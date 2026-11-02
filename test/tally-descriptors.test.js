import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseCollection,prepareMasterRecords} from '../src/tally-import.js';
import {TALLY_ENTITY_DESCRIPTORS,describeTallyEntity,describeTallyField,formatTallyField} from '../public/tally-entity-descriptors.js';
import {tallyVisibilityRoutes} from '../src/tally-visibility-routes.js';
const provenance=JSON.parse(await fs.readFile(new URL('./fixtures/tally-real-anonymized/provenance.json',import.meta.url),'utf8'));
const flatten=(value,prefix='/xml',out={})=>{
 if(Array.isArray(value)&&value.length)value.forEach((child,index)=>flatten(child,`${prefix}/${index}`,out));
 else if(value&&typeof value==='object'&&Object.keys(value).length)for(const [key,child]of Object.entries(value))flatten(child,`${prefix}/${key.replaceAll('~','~0').replaceAll('/','~1')}`,out);
 else out[prefix]=value;return out;
};
for(const entity of provenance.entities)test(`${entity}: real anonymized XML, missing fields and exhaustive column/detail contract`,async()=>{
 const config=TALLY_ENTITY_DESCRIPTORS[entity],xml=await fs.readFile(new URL(`./fixtures/tally-real-anonymized/${entity}.xml`,import.meta.url),'utf8');
 const records=parseCollection(xml,config.xmlTag);assert.equal(records.length,1);
 const fields=flatten(records[0]),descriptor=describeTallyEntity(entity,Object.keys(fields));
 assert.deepEqual(new Set(descriptor.fields.map(field=>field.key)),new Set(Object.keys(fields)),'Every parsed field must drive a UI column/detail row');
 for(const field of descriptor.fields){assert.ok(['stored','xml','source'].includes(field.section));assert.equal(typeof formatTallyField(fields[field.key],field,fields),'string');}
 const sparse={'@_NAME':'Missing optional fields'};
 if(['items','groups','ledgers'].includes(entity)){const result=prepareMasterRecords([sparse],entity,'company','session');assert.equal(result.good.length,1);assert.equal(result.bad.length,0);}
 if(entity==='ledgers')assert.equal(records[0]['@_NAME'],'CafÃƒÂ©');
});
test('money remains exact, rates preserve units, dates use IST and Dr/Cr is never invented',()=>{
 assert.equal(formatTallyField('9007199254740993.12',describeTallyField('/stored/closing_value','items')),'9,00,71,99,25,47,40,993.12');
 assert.equal(formatTallyField('-1234.50',describeTallyField('/stored/closing_balance','ledgers')),'-1,234.50 · Dr/Cr not supplied');
 assert.equal(formatTallyField('1234.50 Cr',describeTallyField('/xml/CLOSINGBALANCE/#text','ledgers')),'1,234.50 · Cr');
 assert.equal(formatTallyField('1234.50/NOS',describeTallyField('/xml/CLOSINGRATE/#text','items')),'1,234.50/NOS');
 assert.equal(describeTallyField('/xml/STANDARDCOSTLIST.LIST/0/DATE/#text','items').type,'date');
 assert.match(formatTallyField('2026-04-01T00:00:00Z',describeTallyField('/meta/observed_at','items')),/5:30:00/);
});
test('v1 endpoints are additive aliases with the same permission and handler contracts',()=>{
 const routes=tallyVisibilityRoutes({db:{},route:(method,pattern,permission,handler)=>({method,pattern,permission,handler}),json:()=>{},readJson:async()=>({}),service:{}});
 for(const old of routes.filter(route=>route.pattern.startsWith('/api/tally/'))){const next=routes.find(route=>route.method===old.method&&route.pattern===old.pattern.replace('/api/tally/','/api/v1/tally/'));assert.equal(next.permission,old.permission);assert.equal(next.handler,old.handler);}
});
