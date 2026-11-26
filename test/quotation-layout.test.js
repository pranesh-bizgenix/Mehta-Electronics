import test from 'node:test';
import assert from 'node:assert/strict';
import {quotationPdf,quotationPrintHtml,quotationDocumentModel} from '../src/quotation-document.js';
import {createQuotationPdf} from '../src/quotation-pdf.js';
import {calculateQuotation} from '../public/quotation-math.js';

const fixture=(count=2,state='33')=>({
 quotation_number:'SAMPLE-QTN/2026-27/000001',documentDate:'2026-11-26',validUntil:'2026-12-10',version:1,status:'DRAFT',
 letterhead:{name:'Mehta Electric Corporation - SAMPLE ONLY',address:'[Registered address not supplied]',gstin:'[GSTIN not supplied]',email:'sample@example.test'},
 customer_name:'SAMPLE fictional customer',customerAddress:'[Customer address not supplied]',sellerState:'33',placeOfSupply:state,
 terms:'[Approved payment, delivery, warranty and exclusion terms not supplied]',notes:'SAMPLE ONLY - fictional layout demonstration.',
 ...calculateQuotation(Array.from({length:count},(_,i)=>({partCode:'SAMPLE-ITEM-'+(i+1),description:'Fictional electrical component',hsn:'00000000',quantity:'2',uom:'NOS',unitPrice:'100',discountPercent:'10',taxPercent:'18'})),'33',state)
});
const pageCount=bytes=>(bytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length;

test('Normal quotations contain three pages with separate cover, pricing and sign-off',async()=>{
 const geometry=[],bytes=await quotationPdf(fixture(),{onLayout:v=>geometry.push(v)});assert.equal(pageCount(bytes),3);
 assert.deepEqual([...new Set(geometry.map(v=>v.section))],[1,2,3]);assert.match(bytes.toString('latin1'),/\/Subtype \/Image/);
});
test('Quotation public model preserves saved amounts, local and interstate tax labels',()=>{
 for(const [state,label]of [['33','CGST'],['27','IGST']]){
  const q=fixture(2,state),before=JSON.stringify(q),model=quotationDocumentModel(q);assert.equal(model.total,'424.80');assert.equal(model.items[0].rate,'90.00');assert.ok(model.taxRows.some(row=>row[0]===label));assert.equal(JSON.stringify(q),before);
 }
});
test('Costs, list prices, discounts, margins and private availability evidence stay outside the PDF model',()=>{
 const q=fixture();q.pricing={unitCost:'SECRET-COST'};q.lines[0].unitCost='SECRET-COST';q.lines[0].requestDetails={make:'SAMPLE make',availabilitySource:'SECRET-EVIDENCE',leadTime:'SAMPLE lead time'};
 const m=JSON.stringify(quotationDocumentModel(q));for(const secret of ['SECRET-COST','SECRET-EVIDENCE','unitCost','discountPercent','pricingSelection','marginPercent'])assert.ok(!m.includes(secret));assert.ok(m.includes('SAMPLE make'));
});
test('Customer requested terms stay internal; only the saved quotation terms enter customer output',()=>{
 const q=fixture();for(const termsConfirmed of [false,true]){q.request={customerTerms:'SECRET customer requested terms',termsConfirmed};assert.ok(!JSON.stringify(quotationDocumentModel(q)).includes('SECRET'));assert.ok(!quotationPrintHtml(q).includes('SECRET'));}
});
test('Missing references and commercial terms remain explicit without invented policy',()=>{
 const q=fixture();q.terms='';const m=quotationDocumentModel(q);assert.equal(m.reference,'[Not supplied]');assert.equal(m.terms,'');assert.match(quotationPrintHtml(q),/Commercial terms not supplied/);
});
test('Draft and historical reference notices survive every page; issued status is not invented',()=>{
 const q=fixture();assert.match(quotationDocumentModel(q).notice,/DRAFT/);q.status='APPROVED';assert.equal(quotationDocumentModel(q).notice,'');q.request={referenceOnly:true};assert.match(quotationDocumentModel(q).notice,/HISTORICAL PRICING/);
});
test('Browser print has three sections, escaped customer inputs and the Mehta logo',()=>{
 const q=fixture();q.customer_name='<script>unsafe</script>';const html=quotationPrintHtml(q);assert.equal((html.match(/<article /g)||[]).length,3);assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));assert.ok(!html.includes('<script>unsafe'));assert.match(html,/\/brand\/mehta-logo.png/);
});
test('Legacy quotations use the shared three-page layout with exact source totals',async()=>{
 const q={quotation_number:'SAMPLE-LEGACY',customer_name:'SAMPLE customer',valid_until:'2026-12-10',subtotal:'180.00',tax_total:'32.40',total:'212.40',lines:[{part_code:'SAMPLE-1',description:'Fictional component',quantity:'2',uom:'NOS',unit_price:'100',discount_percent:'10',tax_percent:'18'}]};
 const bytes=await createQuotationPdf({companyName:'SAMPLE Mehta',companyAddress:'SAMPLE address'},q);assert.equal(pageCount(bytes),3);
});
test('Long specifications, 100 items and long terms continue without leaving the A4 content bounds',async()=>{
 const q=fixture(100);q.lines[0].description='SAMPLE_LONG_CODE_'.repeat(65);q.terms='SAMPLE supplied terms only. '.repeat(350);
 const geometry=[],bytes=await quotationPdf(q,{onLayout:v=>geometry.push(v)});assert.ok(pageCount(bytes)>3);
 for(const v of geometry){assert.ok(v.x>=0&&v.y>=0&&v.x+v.width<=596&&v.y+v.height<842,JSON.stringify(v));if(v.kind==='text')assert.ok(v.y+v.height<795,JSON.stringify(v));}
 assert.equal(geometry.filter(v=>v.section===3).some(v=>v.kind==='panel'),true);
});
test('Six-decimal prices and fractional quantities keep their existing exact calculation',()=>{
 const q=fixture(1);Object.assign(q,calculateQuotation([{...q.lines[0],quantity:'0.333333',unitPrice:'19.999999',discountPercent:'5',taxPercent:'18'}],'33','33'));const m=quotationDocumentModel(q);assert.equal(m.items[0].rate,'19.00');assert.equal(m.items[0].amount,q.subtotal);assert.ok(m.items[0].quantity.startsWith('0.333333'));
});
