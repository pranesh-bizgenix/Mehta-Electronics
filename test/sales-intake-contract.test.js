import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizeIntake,missingBusinessFields,HEADER_ALIASES,ITEM_ALIASES} from '../src/modules/sales-intake/contract.js';
import {validateSalesIntakePolicy,tierResult} from '../src/modules/sales-intake/policy.js';
import {locationEvidence,unreflectedHolds} from '../src/modules/sales-intake/availability.js';
import {evaluateStock} from '../src/modules/stock/availability.js';
import {planPriceImport,priceFileHash} from '../src/modules/pricing/import-plan.js';
import {levelWorkbookPreset,LEVEL_WORKBOOK_HEADERS} from '../src/modules/pricing/workbook-preset.js';
import {readPriceCsv} from '../src/modules/pricing/tabular.js';
import {quotationDiscount} from '../src/modules/sales-intake/discount.js';
const company='11111111-1111-4111-8111-111111111111';
export const payload=(index=0)=>({schemaVersion:'1.0',eventId:'ZZTEST_event_'+index,messageType:'CUSTOMER_PO',companyId:company,source:{system:'Make',mailbox:'zztest_inbox@example.test',messageId:'ZZTEST_message_'+index,receivedAt:'2026-11-20T04:00:00Z'},provenance:{extractor:'ZZTEST_extractor',version:'1',reference:'ZZTEST_ref'},header:{poNumber:'ZZTEST_PO_'+index,poDate:'2026-11-20',buyerName:'ZZTEST_Buyer',supplierName:'ZZTEST_Issuer',billingAddress:'ZZTEST address',deliveryAddress:{line1:'ZZTEST address',stateCode:'33',pincode:'600001'},totalPoValue:'118',placeOfSupply:'33'},items:[{lineId:'1',description:'ZZTEST terminal',productCode:'ZZTEST_CODE',quantity:'1',uom:'NOS',unitPrice:'100',discount:{kind:'PERCENT',value:'0'},gstRate:'18',taxableAmount:'100'}]});
for(let i=0;i<10;i++){
 test(`amount discount ${i+1}: exact conversion preserves meaning; non-representable percentages need review`,()=>{
  assert.deepEqual(quotationDiscount({quantity:String(i+1),unitPrice:'100',discount:{kind:'AMOUNT',value:String(i+1),scope:'LINE'}}),{percent:'1.000000',blocker:null});
  assert.equal(quotationDiscount({quantity:'3',unitPrice:'1',discount:{kind:'AMOUNT',value:'1',scope:'LINE'}}).blocker,'DISCOUNT_PRECISION_REVIEW_REQUIRED');
  assert.equal(quotationDiscount({quantity:'1',unitPrice:'1',discount:{kind:'AMOUNT',value:'2',scope:'LINE'}}).blocker,'DISCOUNT_EXCEEDS_LINE_VALUE');
  assert.equal(quotationDiscount({quantity:'1',unitPrice:'0',discount:{kind:'AMOUNT',value:'0',scope:'LINE'}}).percent,'0');
  assert.equal(quotationDiscount({}).percent,null);
 });
 test(`contract ${i+1}: categories, 23 fields, aliases, immutable normalization and independent lines`,()=>{
  const p=payload(i);Object.entries(HEADER_ALIASES).forEach(([alias,key])=>{if(p.header[key]!=null){p.header[alias]=p.header[key];delete p.header[key];}});Object.entries(ITEM_ALIASES).forEach(([alias,key])=>{if(p.items[0][key]!=null){p.items[0][alias]=p.items[0][key];delete p.items[0][key];}});
  const original=JSON.stringify(p),n=normalizeIntake(p);assert.equal(JSON.stringify(p),original);assert.deepEqual(missingBusinessFields(n),[]);assert.equal(n.header.billingAddress.text,'ZZTEST address');assert.equal(n.items[0].discount.value,'0');
  const retry=normalizeIntake({...payload(i),eventId:'ZZTEST_retry_'+i});assert.equal(n.businessHash,retry.businessHash);
  for(const type of ['LEAD_ENQUIRY','QUOTATION_REQUEST']){const q=payload(i);q.messageType=type;q.header={buyerName:'ZZTEST lead'};q.items=[];assert.deepEqual(missingBusinessFields(normalizeIntake(q)),['items']);}
  const q=payload(i);q.items.push({...q.items[0],lineId:'2',quantity:String(i+2)});assert.equal(normalizeIntake(q).items.length,2);
 });
 test(`validation ${i+1}: missing differs from zero; invalid decimal/date/unit/alias/discount rejects`,()=>{
  for(const [key,value]of [['quantity','0'],['quantity',i+1],['unitPrice','1e'+i],['gstRate','101'],['uom','NOS<script>'],['lineId','']]){const p=payload(i);p.items[0][key]=value;assert.throws(()=>normalizeIntake(p),{status:422});}
  const p=payload(i);p.header.poDate=`2026-02-${String(30+i).padStart(2,'0')}`;assert.throws(()=>normalizeIntake(p),{status:422});
  const a=payload(i);a.header['PO Number']='ZZTEST_DIFFERENT';assert.throws(()=>normalizeIntake(a),/Conflicting aliases/);
  const b=payload(i);b.items[0].discount={kind:'AMOUNT',value:'1'};assert.throws(()=>normalizeIntake(b),/LINE scope/);
  b.items[0].discount={kind:'AMOUNT',scope:'LINE',value:'1'};assert.equal(normalizeIntake(b).items[0].discount.kind,'AMOUNT');
  const c=payload(i);c.items[0].unitPrice=null;c.items[0].discount=null;const n=normalizeIntake(c);assert.equal(n.items[0].unitPrice,null);assert.equal(n.items[0].discount,null);
  const d=payload(i);d.items.push({...d.items[0]});assert.throws(()=>normalizeIntake(d),/distinct stable/);
  const e=payload(i);e.items[0].deliverySchedules=[{date:'2026-11-30',quantity:'2'}];assert.throws(()=>normalizeIntake(e),/must equal/);
 });
 test(`tier policy ${i+1}: exact-five choice and confirmed counting basis are explicit`,()=>{
  const t={basis:'PO',statuses:['ACTIVE'],includeCurrent:true,threshold:5,exactlyFive:'REVIEW',companyScoped:true};
  assert.equal(tierResult(4,t).tier,'EARLY_BIRD');assert.equal(tierResult(6+i,t).tier,'ELITE');assert.equal(tierResult(5,t).state,'TIER_POLICY_REQUIRED');
  assert.equal(tierResult(5,{...t,exactlyFive:'ELITE'}).tier,'ELITE');assert.equal(tierResult(5,{...t,exactlyFive:'UNCLASSIFIED'}).tier,null);assert.equal(tierResult(5,null).state,'TIER_POLICY_REQUIRED');
  assert.throws(()=>validateSalesIntakePolicy({tiers:{po:{...t,threshold:4}}}),{status:422});assert.throws(()=>validateSalesIntakePolicy({tiers:{po:{...t,basis:'ENQUIRY'}}}),{status:422});assert.throws(()=>validateSalesIntakePolicy({tiers:{po:{...t,companyScoped:false}}}),{status:422});
 });
 test(`stock accounting ${i+1}: exact location evidence, stale source and reflected holds`,()=>{
  const quantity=String(20+i),source={stable:true,item_id:1,company_id:company,record_key:'ZZTEST_stock',session_id:'ZZTEST_receipt',sourceTimestamp:'2026-11-21T04:00:00Z',uom:'NOS',closing_quantity_text:quantity+' NOS',raw_record:{RESERVEDQTY:'2 NOS',ORDERRESERVATIONS:[{ORDERGUID:'CRM-QUOTE:ZZTEST_line',ACTUALQTY:'2 NOS'}],WAREHOUSES:[{NAME:'ZZTEST_WH',QTY:quantity+' NOS',RESERVEDQTY:'2 NOS',RESERVATIONS:[{id:'CRM-QUOTE:ZZTEST_line',quantity:'2 NOS'}]}]}};
  const mapping={balancesPointer:'/WAREHOUSES',namePointer:'/NAME',quantityPointer:'/QTY',reservedPointer:'/RESERVEDQTY',reservationsPointer:'/RESERVATIONS'},policy={version:1,value:{maximumSourceAgeMinutes:10,reservedQuantityPointer:'/RESERVEDQTY',reservationsPointer:'/ORDERRESERVATIONS',reservationShape:'ARRAY',reservationQuantityPointer:'/ACTUALQTY',reservationKeyPointer:'/ORDERGUID',instructions:'ZZTEST explicit stock policy'}};
  const plan=evaluateStock({source,policy,now:new Date('2026-11-21T04:01:00Z'),latestAttempt:{status:'imported',quarantined_count:0},requestedQuantity:'1',basis:'FREE_STOCK'}),l=locationEvidence(source,plan,mapping);assert.equal(plan.status,'VERIFIED');assert.deepEqual(l.issues,[]);
  const hold={availability_line_id:'ZZTEST_line',quantity:'2',warehouse_key:'ZZTEST_WH'};assert.equal(unreflectedHolds([hold],plan,l.locations).length,0);assert.equal(unreflectedHolds([{...hold,quantity:'3'}],plan,l.locations).length,1);assert.equal(unreflectedHolds([{...hold,warehouse_key:'other'}],plan,l.locations).length,1);
  assert.ok(locationEvidence({...source,raw_record:{WAREHOUSES:[{NAME:'ZZTEST_WH'}]}},plan,mapping).issues.length);assert.equal(locationEvidence(source,plan,null).issues[0],'LOCATION_STOCK_POLICY_REQUIRED');
  assert.equal(evaluateStock({source,policy,now:new Date('2026-11-21T04:11:00Z'),latestAttempt:{status:'imported',quarantined_count:0},requestedQuantity:'1',basis:'FREE_STOCK'}).status,'STALE');
 });
 test(`workbook ${i+1}: fractional discount and explicitly approved exact-match UOM fallback`,()=>{
  const table=readPriceCsv(`Code,Description,Price,MOQ,Link,Brand,Pack,UOM,Edition,Discount\nZZTEST_${i},Terminal,100,1,On request,Sample,,,Edition-A,0.63`),mapping=levelWorkbookPreset(LEVEL_WORKBOOK_HEADERS,'level 2');
  const items=[{id:i+1,part_code:'ZZTEST_'+i,uom:'NOS',status:'ACTIVE',updated_at:'ZZTEST_revision'}],plan=planPriceImport(table,mapping,items,{fileSha256:priceFileHash(Buffer.from('ZZTEST')),metadata:{}});assert.equal(plan.rows[0].discountPercent,'63.000000');assert.equal(plan.rows[0].uom,'NOS');assert.equal(plan.rows[0].uomSource,'MATCHED_CRM');assert.equal(plan.canSave,true);
  assert.equal(planPriceImport(table,{...mapping,uomFallback:undefined},items).canSave,false);assert.equal(planPriceImport(table,mapping,[]).canSave,false);assert.equal(planPriceImport(table,mapping,[...items,{...items[0],id:1000+i}]).canSave,false);assert.equal(levelWorkbookPreset(['Unrelated'],'level 2'),null);
 });
}
