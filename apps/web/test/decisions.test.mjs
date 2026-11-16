import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import {decisionsApi} from '../features/decisions/api.ts';
import {decisionFixHref,decisionInputText,describeDecisionValue,parseDecisionInput} from '../features/decisions/presentation.ts';
import {initialStructuredDrafts,structuredDecisionValue} from '../features/decisions/editor-model.ts';
import {DecisionCatalog} from '../../../src/modules/decisions/catalog.js';
import {readDecisionCsv} from '../../../src/modules/decisions/csv.js';

test('decision inputs keep exact money strings and require explicit whole-number answers',()=>{
 const money={valueKind:'NUMBER',numberEncoding:'DECIMAL_STRING',options:[]};
 assert.equal(parseDecisionInput(money,'99999999999999.123456'),'99999999999999.123456');
 assert.equal(parseDecisionInput(money,'0'),'0');
 for(const value of ['','1,000','1.2345678','1e3','-1'])assert.throws(()=>parseDecisionInput(money,value));
 const count={valueKind:'NUMBER',numberEncoding:'INTEGER',options:[]};
 assert.equal(parseDecisionInput(count,'0'),0);
 assert.equal(parseDecisionInput(count,'48'),48);
 for(const value of ['','1.5','9007199254740993'])assert.throws(()=>parseDecisionInput(count,value));
});

test('decision choices start empty and structured answers reject lossy numeric values',()=>{
 const decision={valueKind:'CHOICE',value:null,options:[{label:'Tally creates the invoice',value:'TALLY_CREATES'}]};
 assert.equal(decisionInputText(decision),'');
 assert.throws(()=>parseDecisionInput(decision,''));
 assert.throws(()=>parseDecisionInput(decision,'-1'));
 assert.equal(parseDecisionInput(decision,'0'),'TALLY_CREATES');
 const shape={valueKind:'JSON',options:[]};
 assert.deepEqual(parseDecisionInput(shape,'{"maximumAmount":"0.10","count":2}'),{maximumAmount:'0.10',count:2});
 assert.throws(()=>parseDecisionInput(shape,'{"maximumAmount":0.1}'),/quoted decimal/);
 assert.throws(()=>parseDecisionInput(shape,'{"limit":9007199254740993}'),/quoted decimal/);
 assert.throws(()=>parseDecisionInput(shape,'not JSON'),/incomplete/);
 assert.equal(describeDecisionValue(null),'Not set');
 assert.equal(describeDecisionValue({maximumAmount:'0.10'}),'maximum Amount: 0.10');
});

test('decision workflow links remain in the CRM origin',()=>{
 assert.equal(decisionFixHref('/quotations?tool=policy'),'/quotations?tool=policy');
 for(const href of [undefined,'https://elsewhere.invalid','//elsewhere.invalid','/\\elsewhere.invalid','/rules\n'])assert.equal(decisionFixHref(href),'/rules');
});

test('plain tier, role and payment forms preserve decimal strings and supply no numeric defaults',()=>{
 assert.deepEqual(initialStructuredDrafts({key:'credit.tiers',value:null}),[]);
 assert.deepEqual(initialStructuredDrafts({key:'payments.authorisation',value:null}),[{maximumAmount:'',checks:''}]);
 assert.deepEqual(structuredDecisionValue('credit.tiers',[{name:'ZZTEST_TIER',criteria:'Explicit fixture criteria',limit:'99999999999999.123456'}]),[{name:'ZZTEST_TIER',criteria:'Explicit fixture criteria',limit:'99999999999999.123456'}]);
 assert.deepEqual(structuredDecisionValue('payments.authorisation',[{maximumAmount:'0.10',checks:'Fixture check one\nFixture check two'}]),{maximumAmount:'0.10',checks:['Fixture check one','Fixture check two']});
 assert.throws(()=>structuredDecisionValue('credit.tiers',[]),/explicit entry/);
 assert.throws(()=>structuredDecisionValue('payments.authorisation',[{maximumAmount:'1e4',checks:'Fixture check'}]),/exact number/);
 assert.deepEqual(structuredDecisionValue('tally.write.categories',[]),[]);
});

test('plain SLA editor starts unconfigured and only builds explicitly supplied working times and deadlines',()=>{
 const empty=initialStructuredDrafts({key:'sla.policy',value:null});
 assert.equal(empty[0].timezone,'');assert.equal(empty[0].businessDays,'');assert.equal(empty.length,1);
 assert.throws(()=>structuredDecisionValue('sla.policy',empty),/working day/);
 const value=structuredDecisionValue('sla.policy',[{timezone:'UTC',businessDays:'MON,TUE','businessHours.start':'09:00','businessHours.end':'17:00',holidays:''},{entity:'TASK',minutes:'60'}]);
 assert.deepEqual(value,{businessDays:['MON','TUE'],turnaroundMinutes:{TASK:60},timezone:'UTC',businessHours:{start:'09:00',end:'17:00'}});
 assert.throws(()=>structuredDecisionValue('sla.policy',[{timezone:'UTC',businessDays:'MON','businessHours.start':'09:00','businessHours.end':'17:00'},{entity:'TASK',minutes:'60'},{entity:'TASK',minutes:'120'}]),/only one deadline/);
});

test('typed decision client preserves versions, reasons, request identities and reviewed import fingerprints',async()=>{
 const calls=[],api={
  async get(path,options){calls.push({method:'GET',path,options});return {data:[],summary:{total:0}};},
  async data(method,path,body,options){calls.push({method,path,body,options});return {ok:true};}
 };
 const client=decisionsApi(api),change={expectedVersion:7,requestKey:'fixture-request',reason:'Reviewed by the test'};
 await client.list();
 await client.enter('credit.tiers',{...change,value:[{limit:'0.10'}],confirm:false});
 await client.decide('credit.tiers',{...change,decision:'CONFIRM'});
 await client.bulk({entries:[{key:'credit.tiers',expectedVersion:7}],decision:'REJECT',requestKey:'fixture-bulk',reason:'Review requested'});
 await client.previewImport('key,answer,version\n');
 await client.importSheet({csv:'key,answer,version\n',fingerprint:'reviewed-hash',requestKey:'fixture-import',reason:'Import for review'});
 await client.history('credit.tiers');
 assert.equal(calls[0].path,'/api/v1/decisions');
 assert.equal(calls[1].path,'/api/v1/decisions/credit.tiers/enter');
 assert.equal(calls[1].body.confirm,false);
 assert.equal(calls[1].body.value[0].limit,'0.10');
 assert.equal(calls[2].body.expectedVersion,7);
 assert.equal(calls[3].path,'/api/v1/decisions/bulk-decide');
 assert.equal(calls[4].path,'/api/v1/decisions/preview-import');
 assert.equal(calls[5].body.fingerprint,'reviewed-hash');
 assert.equal(calls[6].path,'/api/v1/decisions/credit.tiers/history');
 assert.equal(calls.every(call=>call.path.startsWith('/api/')),true);
});

test('the private-value-free Prem question sheet covers the catalogue without confirmed answers or invented versions',()=>{
 const catalogue=new DecisionCatalog(),definitions=catalogue.all().map(definition=>catalogue.metadata(definition));
 const markdown=fs.readFileSync(new URL('../../../docs/prem-decision-sheet.md',import.meta.url),'utf8');
 const csv=readDecisionCsv(fs.readFileSync(new URL('../../../docs/prem-decision-sheet.csv',import.meta.url),'utf8'));
 assert.deepEqual(csv.map(row=>row.key).sort(),definitions.map(row=>row.key).sort());
 for(const row of csv){
  assert.equal(row.answer,'');assert.equal(row.version,'');
  assert.ok(['EMPTY','PROPOSED'].includes(row.status));
  assert.ok(markdown.includes('`'+row.key+'`'));
  const definition=definitions.find(entry=>entry.key===row.key);
  assert.equal(row.value,definition.recommendedValue==null?'':JSON.stringify(definition.recommendedValue));
 }
 assert.match(markdown,/static discussion copy/);
 assert.match(markdown,/latest live sheet/);
});
