import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planPriceImport} from '../src/modules/pricing/import-plan.js';
import {readPriceCsv} from '../src/modules/pricing/tabular.js';
import {PriceLevelService} from '../src/modules/pricing/levels.js';
import {quotationRequest,quotationRequestBlock,quotationPricingDate} from '../public/quotation-request.js';
import {quotationPrintHtml,quotationPdf} from '../src/quotation-document.js';
const item={id:1,part_code:'VERIFY-PART',uom:'NOS',status:'ACTIVE',updated_at:'VERIFY-revision'};
const mapping={dataStartRow:2,columns:{partCode:0,uom:1,unitPrice:2,minQuantity:3,discountPercent:4},discountUnit:'FRACTION'};
const table=value=>readPriceCsv(`Part,Unit,Price,MOQ,Discount\nVERIFY-PART,NOS,100,1,${value}`);
test('fractional workbook discounts convert exactly, preserve source and bind the reviewed units',()=>{
 for(const [source,percent]of [['0.60','60.000000'],['0.27353','27.353000'],['0.00000001','0.000001'],['1','100.000000']]){
  const plan=planPriceImport(table(source),mapping,[item]);assert.equal(plan.canSave,true);assert.equal(plan.rows[0].discountPercent,percent);assert.equal(plan.rows[0].sourceDiscount,source);
 }
 const percent=planPriceImport(table('0.60'),{...mapping,discountUnit:'PERCENT'},[item]);
 assert.equal(percent.rows[0].discountPercent,'0.60');
 assert.notEqual(percent.previewFingerprint,planPriceImport(table('0.60'),mapping,[item]).previewFingerprint);
 for(const bad of ['1.01','60','-0.1','0.123456789'])assert.equal(planPriceImport(table(bad),mapping,[item]).canSave,false);
 assert.throws(()=>planPriceImport(table('0.6'),{...mapping,discountUnit:'GUESS'},[item]),/discount units/);
});
test('all four levels are available, with expiry enforced against the explicitly selected pricing date',async()=>{
 const repository={all:async()=>[],available:async()=>[],record:async level=>({id:'VERIFY-level',label:`Level ${level}`,status:'CONFIRMED',meaning:{instructions:'VERIFY- supplied level'},configuration:{priceListId:1,calculation:'LINE_DISCOUNT'}}),list:async()=>({id:1,currency:'INR',effective_from:'2026-07-01',effective_to:'2026-07-31',discount_percent:'0'}),tier:async()=>({id:1,unit_price:'100',discount_percent:'74',item_revision:'a',current_item_revision:'a',approved_uom:'NOS',current_uom:'NOS',approved_part_code:'VERIFY-PART',current_part_code:'VERIFY-PART'})};
 const service=new PriceLevelService({repository,access:{require(){}}});
 assert.deepEqual((await service.list({})).levels.map(l=>l.number),[1,2,3,4]);
 assert.equal((await service.resolve(4,1,'1','2026-07-15')).unitPrice,'26.000000');
 await assert.rejects(service.resolve(4,1,'1','2026-11-18'),/expired/);
 await assert.rejects(service.resolve(5,1,'1','2026-07-15'));
});
test('customer requests are reviewed separately and historical reference drafts cannot enter approval',()=>{
 let request=quotationRequest({customerTerms:'Payment 45 days; warranty 12/18 months; freight under supplier scope',quantityInstructions:'3 sets'});
 assert.equal(request.termsConfirmed,false);assert.equal(request.quantityConfirmed,false);
 assert.match(quotationRequestBlock(request),/requested terms/);
 request={...request,termsConfirmed:true};assert.match(quotationRequestBlock(request),/final quantities/);
 request={...request,quantityConfirmed:true};assert.equal(quotationRequestBlock(request),null);
 assert.match(quotationRequestBlock(request,''),/accepted quotation terms/);
 assert.equal(quotationRequestBlock(request,'VERIFY- accepted terms'),null);
 request={...request,referenceOnly:true,referenceDate:'2026-07-01'};
 assert.equal(quotationPricingDate(request,'2026-11-18'),'2026-07-01');
 assert.match(quotationRequestBlock(request),/cannot be submitted/);
 assert.throws(()=>quotationPricingDate(request,'2026-11-18',true),/not permitted in production/);
 for(const date of ['','2026-02-31','2027-01-01'])assert.throws(()=>quotationPricingDate({...request,referenceDate:date},'2026-11-18'));
});
export const sampleQuote={quotation_number:'VERIFY-SOURCE-PDF',version:1,status:'APPROVED',letterhead:{name:'VERIFY- Mehta quotation'},customer_name:'VERIFY- buyer',validUntil:'2026-12-31',sellerState:'33',placeOfSupply:'33',subtotal:'80.00',cgst:'7.20',sgst:'7.20',igst:'0.00',total:'94.40',terms:'VERIFY- accepted payment and delivery terms',request:{referenceOnly:true,referenceDate:'2026-07-01',customerTerms:'VERIFY- CUSTOMER REQUEST NOT ACCEPTED',termsConfirmed:false},lines:[{partCode:'VERIFY-PART',description:'VERIFY- contactor',hsn:'8536',uom:'NOS',quantity:'2',unitPrice:'100',discountPercent:'60',taxPercent:'18',net:'80.00'}]};
test('reference PDFs remain unissued and requested terms/private pricing never enter customer output',async()=>{
 const html=quotationPrintHtml(sampleQuote);
 assert.ok(html.includes('DEVELOPMENT REFERENCE ONLY'));assert.ok(html.includes('NOT APPROVED FOR ISSUE'));
 assert.ok(html.includes('₹40.00'));assert.ok(html.includes('₹94.40'));assert.ok(html.includes(sampleQuote.terms));
 assert.ok(!html.includes('CUSTOMER REQUEST NOT ACCEPTED'));assert.ok(!html.includes('60%'));
 const pdf=await quotationPdf(sampleQuote);assert.equal(pdf.subarray(0,4).toString(),'%PDF');
});
