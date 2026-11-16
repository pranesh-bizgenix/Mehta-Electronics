import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inr,quotationPrintHtml} from '../src/quotation-document.js';

test('customer quotation currency uses the rupee symbol and exact Indian grouping',()=>{
 assert.equal(inr('1234567.89'),'\u20b912,34,567.89');
 assert.equal(inr('0'),'\u20b90.00');
 assert.equal(inr('9007199254740993.12'),'\u20b99,00,71,99,25,47,40,993.12');
 const q={quotation_number:'VERIFY-CURRENCY',version:1,status:'APPROVED',letterhead:{name:'VERIFY-seller'},customer_name:'VERIFY-buyer',validUntil:'2099-12-31',sellerState:'27',placeOfSupply:'27',subtotal:'180.00',cgst:'16.20',sgst:'16.20',igst:'0.00',localTaxLabel:'SGST',total:'212.40',terms:'VERIFY- confirmed terms',lines:[{partCode:'VERIFY-PART',description:'VERIFY-item',uom:'NOS',quantity:'2',unitPrice:'100',discountPercent:'10',taxPercent:'18',net:'180.00'}]};
 const html=quotationPrintHtml(q);
 assert.ok(html.includes('\u20b990.00'));assert.ok(html.includes('\u20b9212.40'));assert.ok(html.includes(q.terms));assert.ok(!html.includes('?212.40'));
});
