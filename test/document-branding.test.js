import test from 'node:test';
import assert from 'node:assert/strict';
import {quotationPdf} from '../src/quotation-document.js';
import {createQuotationPdf} from '../src/quotation-pdf.js';

test('managed and legacy quotations embed the company logo as a PDF image',async()=>{
 const managed=await quotationPdf({quotation_number:'TEST-LOGO',version:1,status:'DRAFT',letterhead:{name:'TEST_ Mehta'},customer_name:'TEST_ Buyer',validUntil:'2026-11-27',sellerState:'33',placeOfSupply:'33',subtotal:'0.00',cgst:'0.00',sgst:'0.00',igst:'0.00',total:'0.00',lines:[]});
 const legacy=await createQuotationPdf({companyName:'TEST_ Mehta',companyAddress:'TEST_ Address'},{quotation_number:'TEST-LOGO',customer_name:'TEST_ Buyer',valid_until:'2026-11-27',subtotal:'0.00',tax_total:'0.00',total:'0.00',lines:[]});
 for(const pdf of [managed,legacy]){
  assert.equal(pdf.subarray(0,4).toString(),'%PDF');
  assert.match(pdf.toString('latin1'),/\/Subtype \/Image/);
 }
});
