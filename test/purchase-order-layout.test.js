import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {purchaseDocumentPdf} from '../src/purchase-document-pdf.js';
import {purchaseDocumentTotals} from '../src/purchase-document-math.js';

export function samplePurchaseOrder({state='33',showListPriceDiscount=true,lines,terms,roundToRupee=true}={}){
 const totals=purchaseDocumentTotals(lines||[{partCode:'SAMPLE-PO-001',description:'Fictional component for layout demonstration only',make:'SAMPLE MAKE',hsn:'00000000',quantity:'2',uom:'NOS',unitPrice:'100',discountPercent:'10',taxPercent:'18',netRate:'90.00'}],state,'33',roundToRupee);
 return {kind:'PO',number:'SAMPLE-PO/2026-27/000001',status:'DRAFT',payload:{company:{name:'Mehta Electric Corporation - SAMPLE ONLY',address:'[Registered address pending confirmation]',gstin:'[GSTIN pending confirmation]',contact:'[Contact pending confirmation]',stateCode:'33',showListPriceDiscount,footer:'Fictional data for layout review only'},supplier:{name:'SAMPLE supplier - fictional',address:'[Supplier address not supplied]',gstin:'[Supplier GSTIN not supplied]'},date:'2026-11-26',deliveryDate:'2026-12-01',paymentTerms:'[Payment terms not supplied]',freightPacking:'[Freight / packing not supplied]',billTo:'[Billing address not supplied]',shipTo:'[Delivery address not supplied]',signatory:'[Signatory not supplied]',terms:terms||'[Purchasing terms pending confirmation]',lines:totals.lines,totals}};
}

test('PO preview and download use one reference-based renderer',()=>{
 const source=readFileSync(new URL('../src/purchase-document-pdf.js',import.meta.url),'utf8');assert.match(source,/record.kind==='PO'\)return supplierPurchaseOrderPdf/);
 const routes=readFileSync(new URL('../src/purchase-documents.js',import.meta.url),'utf8');assert.match(routes,/await purchaseDocumentPdf\(row,\{draft\}\)/);
});
test('PO renderer retains exact local and interstate totals with signed round-off',async()=>{
 for(const state of ['33','19']){
  const record=samplePurchaseOrder({state}),before=JSON.stringify(record),bytes=await purchaseDocumentPdf(record,{sample:true});
  assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.equal(JSON.stringify(record),before);assert.equal(record.payload.totals.total,'212.00');assert.equal(record.payload.totals.roundOff,'-0.40');
 }
});
test('PO renderer rejects mismatched stored totals instead of silently changing GST',()=>{
 const r=samplePurchaseOrder();r.payload.totals.cgst='0.00';assert.throws(()=>purchaseDocumentPdf(r),{status:422});
 const t=samplePurchaseOrder();t.payload.totals.total='999.00';assert.throws(()=>purchaseDocumentPdf(t),{status:422});
});
test('Both list-discount and net-rate policies render within A4 bounds',async()=>{
 for(const showListPriceDiscount of [true,false]){
  const geometry=[];await purchaseDocumentPdf(samplePurchaseOrder({showListPriceDiscount}),{sample:true,onLayout:value=>geometry.push(value)});
  assert.equal(Math.max(...geometry.map(box=>box.page)),1);
  for(const box of geometry){assert.ok(box.x>=24&&box.x+box.width<572,JSON.stringify(box));assert.ok(box.y>=24&&box.y+box.height<842,JSON.stringify(box));}
 }
});
test('100 PO lines, long descriptions, mixed units and supplied terms paginate safely',async()=>{
 const line=samplePurchaseOrder().payload.lines[0],lines=Array.from({length:100},(_,i)=>({...line,partCode:'SAMPLE-'+i,description:'Fictional long description. '.repeat(30),uom:i%2?'MTR':'NOS'}));
 const geometry=[],bytes=await purchaseDocumentPdf(samplePurchaseOrder({lines,terms:'Fictional user-supplied note. '.repeat(300)}),{sample:true,onLayout:value=>geometry.push(value)});
 assert.ok(bytes.length>10000);assert.ok(Math.max(...geometry.map(box=>box.page))>2);
 for(const box of geometry)assert.ok(box.x>=24&&box.x+box.width<572&&box.y>=24&&box.y+box.height<842,JSON.stringify(box));
});
test('RFQ format remains on its existing renderer',async()=>{
 const r=samplePurchaseOrder();r.kind='RFQ';r.payload.requestedTerms={};r.payload.responseDeadline='2026-12-01';
 const bytes=await purchaseDocumentPdf(r,{sample:true,draft:true});assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
});
