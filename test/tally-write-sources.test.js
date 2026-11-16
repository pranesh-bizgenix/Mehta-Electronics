import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {procurementFixture} from '../test-support/procurement-fixture.js';
import {writeFixture} from '../test-support/tally-write-fixture.js';
import {writeMapping} from '../test-support/tally-write-data.js';
import {TallyWriteReview} from '../src/modules/tally-write/review.js';
import * as procurement from '../src/procurement.js';
import {buildCreate} from '../src/modules/tally-write/xml.js';

test('all three dry-run builders load real canonical CRM rows and selected-company imported identities without a mocked source repository',()=>withTestTransaction(async db=>{
 const f=await procurementFixture(db),w=await writeFixture(db),service=new TallyWriteReview(db);
 try{
  const source=async(entity,key,name)=>{
   const id='ZZTEST_'+crypto.randomBytes(12).toString('hex'),fields={'/stored/tally_guid':`ZZTEST_guid_${key}`};
   await db.sql`INSERT INTO tally_visibility_records(id,company_id,entity,record_key,session_id,name,raw_record,fields,content_hash,observed_at) VALUES(${id},${w.company},${entity},${key},${w.session},${name},'{}',${db.sql.json(fields)},'ZZTEST_hash',clock_timestamp())`;
   assert.equal((await service.sources.imported(w.company,entity,key)).name,name);return key;
  };
  const partyKey=await source('ledgers','ZZTEST_party','ZZTEST Imported party'),itemKey=await source('items','ZZTEST_item','ZZTEST Imported item');
  const voucherKey=await source('voucher_types','ZZTEST_vtype',writeMapping.voucherType),godownKey=await source('godowns','ZZTEST_store',writeMapping.godown),unitKey=await source('units','ZZTEST_unit','NOS');
  const ledgerKeys=[];for(const entry of writeMapping.ledgerEntries.filter(e=>!e.party))ledgerKeys.push(await source('ledgers',`ZZTEST_ledger_${ledgerKeys.length}`,entry.name));
  const mapping={...writeMapping,voucherTypeSourceKey:voucherKey,godownSourceKey:godownKey,units:{[f.item.id]:'NOS'},unitSourceKeys:{[f.item.id]:unitKey},itemBindings:{[f.item.id]:itemKey},partyBindings:{[`CUSTOMER:${f.customer.id}`]:partyKey},ledgerEntries:writeMapping.ledgerEntries.filter(e=>e.source!=='igst').concat([{name:'ZZTEST IGST',recordKey:ledgerKeys[1],source:'cgst',sign:'POSITIVE'},{name:'ZZTEST IGST',recordKey:ledgerKeys[1],source:'sgst',sign:'POSITIVE'}]).map(e=>e.name==='ZZTEST Sales'?{...e,recordKey:ledgerKeys[0]}:e)};
  const sales=await service.sources.document('SALES_ORDER',f.order.id,w.company,mapping);
  assert.equal(sales.locked,true);assert.equal(sales.partyIdentity.key,partyKey);assert.equal(sales.lines[0].tallyIdentity.key,itemKey);
  const salesXml=buildCreate({category:'SALES_ORDER',document:sales,mapping,company:await service.sources.company(w.company),idempotencyKey:'a'.repeat(64)});assert.match(salesXml.xml,/ACTION="Create"/);
  const candidates=await service.mappingDrafts.candidates(w.maker,w.company,'SALES_ORDER');
  const retained=await service.mappingDrafts.draft(w.maker,{companyId:w.company,category:'SALES_ORDER',configuration:mapping,sourceFingerprint:candidates.sourceFingerprint,requestKey:crypto.randomUUID(),reason:'ZZTEST retain canonical draft evidence'});
  const preview=await service.mappingDrafts.preview(w.maker,{companyId:w.company,mappingId:retained.id,entityId:String(f.order.id),reason:'ZZTEST preview actual canonical source with writes OFF'});
  assert.equal(preview.ready,true,preview.missing.join(', '));assert.equal(preview.mappingStatus,'DRAFT');assert.match(preview.xml,/ACTION="Create"/);
  assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM tw_outbox WHERE company_id=?').get(w.company)).count,0);
  await assert.rejects(service.sources.document('SALES_ORDER',f.order.id,f.company,mapping),/absent from this company|company.guid/);
  const vendor=await procurement.saveVendor(db,null,{name:'ZZTEST New canonical vendor',stateCode:'27',reason:'ZZTEST canonical source vendor'},f.manager);
  let po=await procurement.saveSupplierPo(db,null,{salesOrderId:f.order.id,vendorId:vendor.id,deliveryBy:'2099-12-01',lines:[{itemId:f.item.id,quantity:'10',unitPrice:'70',discountPercent:'0',taxPercent:'18'}],reason:'ZZTEST canonical supplier document'},f.manager);
  po=await procurement.supplierPoAction(db,po.id,{action:'SUBMIT',version:po.version,reason:'ZZTEST submit canonical supplier document'},f.manager);
  const check=await procurement.supplierPoCheck(db,po.id,f.owner);
  po=await procurement.supplierPoAction(db,po.id,{action:'APPROVE',version:po.version,fingerprint:check.fingerprint,acceptExceptions:true,reason:'ZZTEST independent canonical supplier approval'},f.owner);
  const purchaseMapping={...mapping,sourceFields:{date:'deliveryBy',sellerState:'vendorState',placeOfSupply:'buyerState'},partyBindings:{[`VENDOR:${vendor.id}`]:partyKey}};
  const purchase=await service.sources.document('PURCHASE_ORDER',po.id,w.company,purchaseMapping);
  assert.equal(purchase.locked,true);assert.equal(purchase.updatedBy,f.manager.id);assert.equal(purchase.approvedBy,f.owner.id);
  assert.match(buildCreate({category:'PURCHASE_ORDER',document:purchase,mapping:purchaseMapping,company:await service.sources.company(w.company),idempotencyKey:'b'.repeat(64)}).xml,/ACTION="Create"/);
  let party=await service.requestParty(w.maker,{companyId:w.company,entityType:'VENDOR',entityId:vendor.id,reason:'ZZTEST canonical new party review'});
  await assert.rejects(service.approveParty(w.maker,party.id,{companyId:w.company,reason:'ZZTEST self review denied'}),{status:403});
  party=await service.approveParty(w.checker,party.id,{companyId:w.company,reason:'ZZTEST separate canonical new party approval'});
  const partyDocument=await service.sources.document('PARTY_LEDGER',party.id,w.company,{});
  const partyMapping={templateVersion:1,reportName:'ZZTEST Masters',idempotencyField:'REFERENCE',parentField:'PARENT',parentName:'ZZTEST Debtors',partyFields:{}};
  assert.match(buildCreate({category:'PARTY_LEDGER',document:partyDocument,mapping:partyMapping,company:await service.sources.company(w.company),idempotencyKey:'c'.repeat(64)}).xml,/ZZTEST New canonical vendor/);
  assert.equal((await service.control()).master_enabled,false,'Canonical preview tests never enable production settings.');
 }finally{await f.close();}
}));
