import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readinessSummary,readReadiness} from '../src/modules/tally-write/readiness.js';
import {createTallyWriteModule} from '../src/modules/tally-write/module.js';

const now=Date.parse('2026-11-21T08:00:00Z'),company={id:'84409d59-74f3-4793-8e9d-a0bf7b2c0c8e',name:'TEST_COMPANY'};
const input=()=>({company,now,control:{master_enabled:false},categories:[],mappings:[],coverage:[],connectors:[],capabilities:[]});
const connection=(age=0)=>({id:'TEST_connector',status:'active',expected_company_name:company.name,selected_company:company.name,tally_available:true,heartbeat_at:new Date(now-age).toISOString()});

test('an online connector does not claim that posting or unsupported document types work',()=>{
 const result=readinessSummary({...input(),connectors:[connection()]});
 assert.equal(result.connection,'AVAILABLE');assert.equal(result.writeCapability,'UNKNOWN');
 assert.equal(result.categories.length,3);assert.ok(result.categories.every(row=>row.status==='BLOCKED'));
 assert.ok(result.unsupported.some(row=>row.record==='Tax invoice'));assert.ok(result.unsupported.some(row=>row.record==='Quotation'));
 assert.ok(result.categories.find(row=>row.category==='PURCHASE_ORDER').blockers.some(text=>text.includes('voucher_types')));
});

test('stale, future, unavailable, inactive and wrong-company heartbeats cannot establish availability',()=>{
 for(const row of [connection(180001),connection(-1),{...connection(),tally_available:false},{...connection(),status:'revoked'},{...connection(),selected_company:'OTHER'}]){
  assert.equal(readinessSummary({...input(),connectors:[row]}).connection,'UNKNOWN_OR_OFFLINE');
 }
});

test('write capability must match a fresh connected identity and this exact company',()=>{
 const capability={connector_id:'TEST_connector',company_id:company.id,protocol:1,create_only:true,reported_at:new Date(now).toISOString()};
 assert.equal(readinessSummary({...input(),connectors:[connection()],capabilities:[capability]}).writeCapability,'RECENTLY_OBSERVED');
 for(const patch of [{company_id:'OTHER'},{connector_id:'OTHER'},{protocol:2},{create_only:false},{reported_at:new Date(now-180001).toISOString()}]){
  assert.equal(readinessSummary({...input(),connectors:[connection()],capabilities:[{...capability,...patch}]}).writeCapability,'UNKNOWN');
 }
});

test('even complete configuration reports required document validation, never verified live sync',()=>{
 const config={category:'SALES_ORDER',company_id:company.id,enabled:true,paused:false,dry_run_only:false,mapping_id:'TEST_mapping',approval_mode:'SEPARATE_PUSH_APPROVAL',conflict_winner:{mapped_record:'TALLY'},tally_version:'TEST_version',xml_import_verified:true,max_attempts:1,backoff_seconds:1,failure_threshold:1,min_gap_seconds:1,per_day_cap:1,lease_seconds:1};
 const args={...input(),control:{master_enabled:true},categories:[config],mappings:[{id:'TEST_mapping',category:'SALES_ORDER',status:'APPROVED',reviewed:true}],coverage:['voucher_types','ledgers','items','units','godowns'].map(entity=>({entity,count:1})),connectors:[connection()],capabilities:[{connector_id:'TEST_connector',company_id:company.id,protocol:1,create_only:true,reported_at:new Date(now).toISOString()}]};
 assert.equal(readinessSummary(args).categories[0].status,'REQUIRES_DOCUMENT_VALIDATION');
 assert.equal(readinessSummary({...args,mappings:[{...args.mappings[0],reviewed:false}]}).categories[0].status,'BLOCKED');
 assert.equal(readinessSummary({...args,categories:[{...config,paused:true}]}).categories[0].status,'BLOCKED');
});

test('readiness requires Owner access before querying, rejects invalid scopes and performs only one SELECT',async()=>{
 let queries=0;
 const denied={owner(){throw Object.assign(new Error('Permission denied'),{status:403});},one(){queries++;}};
 await assert.rejects(readReadiness(denied,{},company.id),{status:403});assert.equal(queries,0);
 const service={owner(){},async one(sql,id){queries++;assert.match(sql,/^SELECT /);assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|set_config)\b/i);assert.equal(id,company.id);return {...company,control:{master_enabled:false}};}};
 await assert.rejects(readReadiness(service,{},'invalid'),{status:422});assert.equal(queries,0);
 assert.equal((await readReadiness(service,{},company.id)).company.id,company.id);assert.equal(queries,1);
 await assert.rejects(readReadiness({...service,one:async()=>null},{},company.id),{status:404});
});

test('readiness route uses the existing manage permission and validates selected company',async()=>{
 const routes=[];
 createTallyWriteModule({db:{},connectorStore:{},route:(...args)=>{routes.push(args);return args;},json(){},readJson(){},readConnectorJson(){}});
 const route=routes.find(row=>row[1]==='/api/tally-write/readiness');assert.deepEqual(route.slice(0,3),['GET','/api/tally-write/readiness','tally.write.manage']);
 await assert.rejects(route[3]({url:new URL('http://test/api/tally-write/readiness')}),{status:422});
});
