import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DecisionCatalog} from '../src/modules/decisions/catalog.js';
import {DecisionService} from '../src/modules/decisions/service.js';
import {decisionCsv,readDecisionCsv,csvCell} from '../src/modules/decisions/csv.js';

test('every decision key blocks unless confirmed; evidence suggestions do not become settings',async()=>{
 const catalog=new DecisionCatalog();assert.ok(catalog.all().length>40);
 for(const d of catalog.all()){
  const metadata=catalog.metadata(d);assert.equal(metadata.key,d.key);assert.ok(metadata.blockedWorkflows.length);assert.ok(metadata.options.length<=3);assert.ok(metadata.fixHref.startsWith('/'));
  // Read protocol stubs only; this test does not instantiate any database.
  for(const status of ['EMPTY','PROPOSED','ENTERED','REJECTED']){
   const service=new DecisionService({repository:{current:async()=>status==='EMPTY'?null:{status,value_json:metadata.recommendedValue??'VERIFY- not confirmed',version:1},canonical:async()=>null}});
   assert.equal(await service.getSetting(d.key),null);
   await assert.rejects(()=>service.requireSetting(d.key),error=>error.code==='RULE_NOT_CONFIGURED'&&error.details.rule===d.key&&error.message.includes('awaiting confirmation'));
  }
 }
 assert.equal(catalog.metadata(catalog.require('invoice.authority')).recommendedValue,'TALLY_CREATES');
 assert.equal(catalog.metadata(catalog.require('margin.floor_percent')).recommendedValue,null);
 assert.equal(catalog.metadata(catalog.require('credit.tier_labels')).recommendedValue,null);
});
test('decision shapes reject floating money, unknown fields and unsupported workflow authority',()=>{
 const c=new DecisionCatalog();
 for(const key of ['margin.floor_percent','credit.default_limit_new_customer','extraction.total_tolerance_inr'])assert.throws(()=>c.validate(c.require(key),1.1),{status:422});
 assert.throws(()=>c.validate(c.require('payments.authorisation'),{maximumAmount:1.1,checks:['VERIFY-review']}),{status:422});
 assert.equal(c.validate(c.require('extraction.total_tolerance_inr'),'1.000001'),'1.000001');
 assert.throws(()=>c.validate(c.require('invoice.authority'),'GUESS'),{status:422});
 assert.throws(()=>c.validate(c.require('quotation.cost_basis'),{basis:'RECORDED_ITEM_COST',instructions:'VERIFY-review',extra:true}),{status:422});
});
test('decision sheet CSV preserves quoted JSON and blocks malformed or excessive imports',()=>{
 const csv=decisionCsv([{key:'invoice.authority',plainQuestion:'=unsafe formula',status:'EMPTY',value:null,evidenceSource:'+unsafe evidence',version:0}]);
 assert.ok(csv.includes("'=unsafe formula"));assert.ok(csv.includes("'+unsafe evidence"));assert.equal(csvCell(' -1+2'),'"\' -1+2"');
 const rows=readDecisionCsv('key,answer,version,evidence_source\r\ninvoice.authority,"""TALLY_CREATES""",0,"VERIFY-line 1\nline 2"\r\n');
 assert.equal(rows[0].answer,'"TALLY_CREATES"');assert.equal(rows[0].evidence_source,'VERIFY-line 1\nline 2');
 for(const text of ['key,answer,version\na,"oops,0','key,key,version\na,b,0','key,answer,version\na,"b"junk,0','key,answer,version\na,b,0,extra','a'.repeat(262145)])assert.throws(()=>readDecisionCsv(text),{status:422});
});
test('confirmed decision reads revalidate shapes and reject unsafe or excessive JSON',async()=>{
 const catalog=new DecisionCatalog(),service=new DecisionService({repository:{}}),definition=catalog.require('quotation.cost_basis');
 await assert.rejects(()=>service.checked(definition,{basis:'RECORDED_ITEM_COST',instructions:'a'.repeat(21000)}),{status:422});
 await assert.rejects(()=>service.checked(definition,JSON.parse('{"basis":"RECORDED_ITEM_COST","instructions":"VERIFY-review","__proto__":{}}')),{status:422});
 let nested={};for(let i=0;i<15;i++)nested={child:nested};await assert.rejects(()=>service.checked(definition,nested),{status:422});
 const invalid=new DecisionService({repository:{current:async()=>({status:'CONFIRMED',value_json:'INVALID',version:1}),canonical:async()=>null}});
 assert.equal(await invalid.getSetting('invoice.authority'),null);
 await assert.rejects(()=>invalid.requireSetting('invoice.authority'),{code:'RULE_NOT_CONFIGURED'});
});
