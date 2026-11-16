import assert from 'node:assert/strict';
import {test} from 'node:test';
import {guardedProduce,settingsIssues,businessApproval,documentHash,idempotencyKey,expireStatus,importCapability} from '../src/modules/tally-write/contracts.js';
import {buildCreate,parseImportResponse} from '../src/modules/tally-write/xml.js';

const mapping={templateVersion:1,reportName:'Vouchers',voucherType:'VERIFY- Sales Order',numbering:'CRM',idempotencyField:'REFERENCE',
  header:{date:'DATE',party:'PARTYLEDGERNAME',voucherType:'VOUCHERTYPENAME',number:'VOUCHERNUMBER'},
  inventory:{container:'ALLINVENTORYENTRIES.LIST',item:'STOCKITEMNAME',quantity:'BILLEDQTY',rate:'RATE',amount:'AMOUNT',amountSign:'POSITIVE'},
  batch:{container:'BATCHALLOCATIONS.LIST',godown:'GODOWNNAME',quantity:'BILLEDQTY',amount:'AMOUNT'},
  units:{'1':'NOS'},godown:'VERIFY- Store',ledgerContainer:'LEDGERENTRIES.LIST',ledgerNameField:'LEDGERNAME',ledgerAmountField:'AMOUNT',
  ledgerEntries:[{party:true,source:'total',sign:'NEGATIVE'},{name:'VERIFY- Sales',source:'subtotal',sign:'POSITIVE'},{name:'VERIFY- IGST',source:'igst',sign:'POSITIVE'}]};
const document={number:'VERIFY-1',date:'2026-11-05',partyLedgerName:'VERIFY- A & <B>',sellerState:'27',placeOfSupply:'29',total:'35.40',
  status:'APPROVED',locked:true,createdBy:1,updatedBy:1,approvedBy:2,
  lines:[{itemId:1,tallyItemName:'VERIFY- <item>',uom:'NOS',quantity:'3',unitPrice:'10',discountPercent:'0',taxPercent:'18'}]};
const command={category:'SALES_ORDER',document,mapping,company:{name:'VERIFY- A & <B>',guid:'VERIFY-guid'},idempotencyKey:'a'.repeat(64)};
test('G3 disabled gates call no producer, repository, XML builder or transport',async()=>{
  for(const [master,config]of [[false,{enabled:true}],[true,{enabled:false}],[true,{enabled:true,paused:true}],[false,null]]){
    let calls=0;assert.deepEqual(await guardedProduce({master,config,produce:()=>{calls++;throw Error('Must not run.');}}),{inactive:true});assert.equal(calls,0);
  }
});
test('empty settings block, capability is explicit and expired send authorization is ambiguous',()=>{
  const issues=settingsIssues({});assert.ok(issues.some(v=>v.includes('approval_mode')));assert.ok(issues.some(v=>v.includes('conflict_winner')));assert.ok(issues.some(v=>v.includes('Unverified')));
  assert.equal(importCapability(null),null);assert.equal(importCapability({protocol:1,version:'1.0.0',createOnly:false}),null);
  assert.ok(importCapability({protocol:1,version:'1.0.0',createOnly:true}));
  assert.equal(expireStatus({status:'CLAIMED'}),'PENDING');assert.equal(expireStatus({status:'CLAIMED',send_authorized_at:'now'}),'UNKNOWN');assert.equal(expireStatus({status:'SENT'}),'UNKNOWN');
});
test('create templates escape text, target the exact company, reconcile money and never produce ALTER or DELETE',()=>{
  const output=buildCreate(command);
  assert.match(output.xml,/ACTION="Create"/);assert.match(output.xml,/VERIFY- A &amp; &lt;B&gt;/);assert.match(output.xml,/35\.400000/);
  assert.equal(/ACTION="(?:Alter|Delete)"/.test(output.xml),false);
  assert.equal(output.validation.totalsVerified,true);
  assert.throws(()=>buildCreate({...command,document:{...document,total:'35.41'}}),/does not reconcile/);
  assert.throws(()=>buildCreate({...command,mapping:{...mapping,idempotencyField:null}}),/Not set/);
  assert.throws(()=>buildCreate({...command,mapping:{...mapping,header:{...mapping.header,date:'DATE><DELETE'}}}),/Unsupported/);
  assert.throws(()=>buildCreate({...command,mapping:{...mapping,ledgerEntries:[...mapping.ledgerEntries,{name:'VERIFY- extra',source:'total',sign:'POSITIVE'}]}}),/do not balance/);
});
test('business maker-checker, locked version and extra party approval are mandatory',()=>{
  businessApproval(document,'SALES_ORDER');
  assert.throws(()=>businessApproval({...document,locked:false},'SALES_ORDER'),/approved, locked/);
  assert.throws(()=>businessApproval({...document,approvedBy:1},'SALES_ORDER'),/Independent/);
  assert.throws(()=>businessApproval(document,'PARTY_LEDGER'),/Separate approval/);
  businessApproval({...document,extraPartyApproval:true},'PARTY_LEDGER');
  assert.notEqual(documentHash(document),documentHash({...document,total:'35.41'}));
  assert.equal(idempotencyKey('company','SALES_ORDER',1,documentHash(document)),idempotencyKey('company','SALES_ORDER',1,documentHash(document)));
});
test('Tally import success requires exactly one create, no mutation/error and secure XML',()=>{
  const response='<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED><ERRORS>0</ERRORS></RESPONSE>';
  assert.equal(parseImportResponse(response).success,true);
  for(const xml of [response.replace('<CREATED>1','<CREATED>2'),response.replace('<ALTERED>0','<ALTERED>1'),response.replace('</RESPONSE>','<LINEERROR>VERIFY- rejected</LINEERROR></RESPONSE>'),'<RESPONSE/>'])assert.equal(parseImportResponse(xml).success,false);
  assert.throws(()=>parseImportResponse('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///private">]><RESPONSE>&y;</RESPONSE>'),/Invalid/);
});
