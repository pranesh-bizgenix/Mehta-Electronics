import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mappingCandidates,selectedMappingBindings} from '../src/modules/tally-write/mapping-candidates.js';
import {MappingDrafts} from '../src/modules/tally-write/mapping-drafts.js';

test('mapping candidates retain explicit source IDs and unknowns without inventing numbering, tax, signs or a mapping',()=>{
 const row={entity:'vouchers',record_key:'guid:ZZTEST_voucher',record_id:'ZZTEST_record',name:'ZZTEST Order',session_id:'ZZTEST_session',content_hash:'a'.repeat(64),raw_record:{GUID:'ZZTEST_guid',VOUCHERTYPENAME:'ZZTEST Custom Order',DATE:'20261106',ISOPTIONAL:'Yes',REFERENCE:'ZZTEST_external_reference','ALLINVENTORYENTRIES.LIST':[{STOCKITEMNAME:'ZZTEST Item',BILLEDQTY:'1 NOS'}]}};
 const plan=mappingCandidates({company:{id:'ZZTEST_company',name:'ZZTEST Company',guid:'ZZTEST_company_guid'},category:'SALES_ORDER',records:[row],counts:[{entity:'vouchers',count:2}],receipts:[]});
 assert.equal(plan.sources[0].stable,true);assert.equal(plan.sources[0].guid,'ZZTEST_guid');assert.equal(plan.coverage.find(row=>row.entity==='vouchers').truncated,true);
 assert.deepEqual(plan.vouchers[0].optional,{yes:1,no:0,unknown:0});assert.equal(plan.vouchers[0].referencePresent,1);assert.equal(plan.vouchers[0].narrationPresent,0);
 assert.equal(plan.vouchers[0].dateFormats.YYYYMMDD,1);assert.ok(plan.fieldCandidates.some(row=>row.path==='ALLINVENTORYENTRIES.LIST/BILLEDQTY'));
 assert.equal(plan.numbering,undefined);assert.equal(plan.configuration,undefined);assert.equal(plan.tax,undefined);
 assert.equal(plan.evidence.records[0].contentHash,'a'.repeat(64));assert.equal(JSON.stringify(plan.evidence).includes('ZZTEST_external_reference'),false);
 const missing=mappingCandidates({company:plan.company,category:'SALES_ORDER',records:[{...row,raw_record:{DATE:'ambiguous-date'}}],counts:[],receipts:[]});
 assert.equal(missing.sources[0].stable,false);assert.deepEqual(missing.vouchers[0].optional,{yes:0,no:0,unknown:1});assert.equal(missing.vouchers[0].dateFormats.OTHER_DELIVERED_FORMAT,1);
 assert.notEqual(plan.sourceFingerprint,missing.sourceFingerprint);
});

test('candidate fingerprints change with company, retained content, category and latest receipt evidence',()=>{
 const input={company:{id:'ZZTEST_A',name:'ZZTEST Company',guid:'ZZTEST_GUID_A'},category:'SALES_ORDER',records:[],counts:[],receipts:[]};
 const first=mappingCandidates(input).sourceFingerprint;
 assert.notEqual(first,mappingCandidates({...input,company:{...input.company,id:'ZZTEST_B',guid:'ZZTEST_GUID_B'}}).sourceFingerprint);
 assert.notEqual(first,mappingCandidates({...input,category:'PURCHASE_ORDER'}).sourceFingerprint);
 assert.notEqual(first,mappingCandidates({...input,receipts:[{dataset:'itemsXml',status:'failed',session_id:'ZZTEST_new_session'}]}).sourceFingerprint);
 assert.equal(first,mappingCandidates(input).sourceFingerprint);
});

test('explicit binding evidence includes all selected stable source keys once and rejects malformed mapping collections',()=>{
 const bindings=selectedMappingBindings({voucherTypeSourceKey:'ZZTEST_voucher',godownSourceKey:'ZZTEST_store',unitSourceKeys:{1:'ZZTEST_unit',2:'ZZTEST_unit'},itemBindings:{1:'ZZTEST_item'},partyBindings:{'CUSTOMER:1':'ZZTEST_party'},ledgerEntries:[{party:true},{recordKey:'ZZTEST_tax'}]});
 assert.equal(bindings.length,6);assert.ok(bindings.some(row=>row.entity==='units'&&row.key==='ZZTEST_unit'));
 assert.throws(()=>selectedMappingBindings({ledgerEntries:{}}),/must be a list/);
 assert.throws(()=>selectedMappingBindings({unitSourceKeys:'bad'}),/identity object/);
 assert.throws(()=>selectedMappingBindings({itemBindings:{1:{name:'ZZTEST_no_identity'}}}),/stable record keys/);
});

test('candidate repository reads one bounded company-scoped SQL snapshot and labels omitted oversized bodies',async()=>{
 const calls=[],companyId='11111111-1111-4111-8111-111111111111',host={owner:()=>{},one:async(sql,...args)=>{calls.push({sql,args});return {id:companyId,name:'ZZTEST_snapshot_company',tally_guid:'ZZTEST_snapshot_guid',records:[{entity:'vouchers',record_key:'ZZTEST_big',record_id:'ZZTEST_big_id',name:'ZZTEST big voucher',content_hash:'a'.repeat(64),source_content_available:false,raw_record:{},summary_fields:{'/stored/guid':'ZZTEST_big_guid'}}],counts:[{entity:'vouchers',count:1}],receipts:[]};}};
 const plan=await new MappingDrafts(host).candidates({role:'OWNER'},companyId,'SALES_ORDER');
 assert.equal(calls.length,1);assert.match(calls[0].sql,/LIMIT 150/);assert.match(calls[0].sql,/65536/);assert.match(calls[0].sql,/FROM tally_companies t WHERE t.id=\?/);assert.equal(calls[0].args.at(-1),companyId);
 assert.doesNotMatch(calls[0].sql,/tw_outbox|tw_control|INSERT|UPDATE|DELETE/);
 assert.equal(plan.coverage.find(row=>row.entity==='vouchers').oversized,1);assert.equal(plan.evidence.records[0].rawAvailable,false);assert.equal(plan.sources[0].stable,true);
});
