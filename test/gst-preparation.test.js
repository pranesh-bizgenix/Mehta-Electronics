import test from 'node:test';
import assert from 'node:assert/strict';
import {gstPreparationIssues,GstPreparationService} from '../src/modules/billing/gst-preparation.js';
import {calculateQuotation} from '../public/quotation-math.js';
function source(){const lines=[{code:'SAMPLE',description:'Sample component',hsn:'8536',uom:'NOS',quantity:'1',unitPrice:'100',discountPercent:'0',taxPercent:'18'}];return {source:'CRM',status:'APPROVED',payload:{company:{gstin:'33ABCDE1234F1Z5',stateCode:'33'},customer:{gstin:'33ABCDE1234F1Z5'},placeOfSupply:'33',billTo:'Sample billing address',shipTo:'Sample shipping address',lines,totals:calculateQuotation(lines,'33','33')}};}
const details={sellerPincode:'600001',buyerPincode:'600002'};
test('Internal GST preparation validates the saved approved invoice and amounts',()=>assert.deepEqual(gstPreparationIssues('IRN',source(),details),[]));
test('Draft, cancelled and reference-only Tally invoices cannot become ready for provider submission',()=>{for(const patch of [{status:'DRAFT'},{status:'CANCELLED'},{source:'TALLY'}])assert.ok(gstPreparationIssues('IRN',{...source(),...patch},details).length);});
test('Buyer and seller GSTIN and postcodes remain explicit missing-information checks',()=>{const s=source();s.payload.customer.gstin='';assert.ok(gstPreparationIssues('IRN',s,details).some(i=>i.includes('Buyer GSTIN')));assert.ok(gstPreparationIssues('IRN',source(),{}).length>=2);});
test('A one-paise tax or total mismatch blocks preparation',()=>{for(const key of ['subtotal','cgst','sgst','igst','total']){const s=source();s.payload.totals[key]='0.01';assert.ok(gstPreparationIssues('IRN',s,details).length);}});
test('Transport preparation requires actual transport details rather than invented defaults',()=>{assert.ok(gstPreparationIssues('EWAY',source(),details).length>=4);assert.deepEqual(gstPreparationIssues('EWAY',source(),{...details,dispatchPincode:'600001',shipPincode:'600002',transportMode:'ROAD',distanceKm:'10',transporterReference:'SAMPLE-TRANSPORT',vehicleNumber:'SAMPLE'}),[]);});
test('Purchase-tax preparation cannot infer input-credit eligibility from an unreceived invoice',()=>{assert.ok(gstPreparationIssues('PURCHASE_TAX',{kind:'DISPATCH_INVOICE',status:'REVIEWED',receiptMatch:{matched:false}}).length);assert.deepEqual(gstPreparationIssues('PURCHASE_TAX',{kind:'DISPATCH_INVOICE',status:'REVIEWED',receiptMatch:{matched:true}}),[]);});
test('Warehouse roles cannot read GST preparation records',async()=>{const service=new GstPreparationService({db:{prepare(){assert.fail('Must not query');}}});await assert.rejects(service.list({id:1,role:'STORE_STAFF'}),{status:403});});
test('GST preparation reuses the existing GSTIN and state validation',()=>{
 const seller=source();seller.payload.company.stateCode='27';assert.ok(gstPreparationIssues('IRN',seller,details).some(issue=>issue.includes('Seller GSTIN')));
 const buyer=source();buyer.payload.customer.gstin='33AAAAAAAAAAAAA';assert.ok(gstPreparationIssues('IRN',buyer,details).some(issue=>issue.includes('Buyer GSTIN')));
 const supply=source();supply.payload.placeOfSupply='00';assert.ok(gstPreparationIssues('IRN',supply,details).some(issue=>issue.includes('place-of-supply')));
});
