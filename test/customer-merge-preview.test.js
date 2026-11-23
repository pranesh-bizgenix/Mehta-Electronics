import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergePreview} from '../src/modules/customers/merge.js';

function fixture(){
 const base={name:'Synthetic duplicate',company_id:null,gstin:null,pan:null,tally_guid:null,status:'ACTIVE',credit_limit:'0.000000',credit_days:0,owner_id:5};
 const customers=[{...base,id:1},{...base,id:2}],states=customers.map(customer=>({id:customer.id,customer,profile:{company_id:null,tally_ledger_name:null},onboarding:{status:'APPROVED'},controls:null}));
 const value={customers,states,links:[],bindings:[],open:{quotes:0,orders:0,contracts:0,cases:0,invoices:0,enquiries:0,opportunities:0,followups:0,legacy_quotes:0,legacy_orders:0}};
 const service={access:async()=>{},repository:{customer:async id=>customers.find(c=>c.id===id),all:async sql=>sql.includes('to_jsonb(c)')?states:sql.includes('FROM crm_customer_merge_links')?value.links:sql.includes('FROM tally_visibility_crm_links')?value.bindings:[],one:async()=>value.open}};
 return {value,service};
}
test('clean merge preview returns a review fingerprint without financial profile payloads',async()=>{
 const {value,service}=fixture();value.states[0].customer.privateValue='SENSITIVE-SYNTHETIC';
 const p=await mergePreview(service,{id:9},1,2);assert.deepEqual(p.blockers,[]);assert.match(p.fingerprint,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(p).includes('SENSITIVE-SYNTHETIC'));
});
for(const [name,change,match]of [
 ['pending onboarding',v=>{v.states[0].onboarding.status='PENDING_APPROVAL';},/onboarding/],
 ['different credit limits',v=>{v.customers[0].credit_limit='100.000000';},/credit terms/],
 ['different ownership',v=>{v.customers[0].owner_id=6;},/ownership/],
 ['open work',v=>{v.open.orders=1;},/open source/],
 ['existing merge chain',v=>{v.links=[{source_id:1,target_id:3}];},/chains/],
 ['unmatched ledger profile',v=>{v.states[0].profile.tally_ledger_name='Synthetic ledger';},/ledger profile/],
 ['unmatched ledger mapping',v=>{v.bindings=[{crm_id:1,company_id:'company',record_key:'ledger'}];},/ledger mappings/],
 ['different legacy identity',v=>{v.customers[0].tally_guid='synthetic-guid';},/legacy Tally/],
 ['restricted customer',v=>{v.states[0].controls={classification:'DO_NOT_QUOTE',credit_exempt:false,pricing_class:null};},/restrictions/]
 ])test('merge preview blocks '+name,async()=>{const {value,service}=fixture();change(value);assert.ok((await mergePreview(service,{id:9},1,2)).blockers.some(x=>match.test(x)));});
