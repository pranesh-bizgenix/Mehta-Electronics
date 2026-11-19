import test from 'node:test';import assert from 'node:assert/strict';
import {financialYear,documentNumber,purchaseDocumentTotals,amountInWords,validateDocumentYear,validateDocumentPrefixes} from '../src/purchase-document-math.js';
import {documentTransition} from '../src/purchase-documents.js';
const line={quantity:'2',unitPrice:'100',discountPercent:'60',taxPercent:'18'};
test('purchase prices cover all four supplied Siemens discount levels',()=>{
 for(const [discount,net,total] of [['60','40.00','47.20'],['63','37.00','43.66'],['68','32.00','37.76'],['74','26.00','30.68']]){
  const actual=purchaseDocumentTotals([{...line,quantity:'1',discountPercent:discount}],'19','33');
  assert.equal(actual.subtotal,net);assert.equal(actual.total,total);
 }
});
test('price validation rejects invalid quantities, amounts, discounts and taxes',()=>{
 for(const field of ['quantity','unitPrice','discountPercent','taxPercent'])for(const value of ['', '-1','NaN','Infinity','1e3','1,000','0.0000001','1000000000000']){
  assert.throws(()=>purchaseDocumentTotals([{...line,[field]:value}],'33','33'),`${field}: ${value}`);
 }
 for(const changes of [{quantity:'0'},{discountPercent:'100.000001'},{taxPercent:'100.000001'}])assert.throws(()=>purchaseDocumentTotals([{...line,...changes}],'33','33'));
 const free=purchaseDocumentTotals([{...line,discountPercent:'100'}],'33','33');assert.equal(free.total,'0.00');
});
test('mixed GST lines sum rounded components and retain exact decimal precision',()=>{
 const rows=[{quantity:'3',unitPrice:'19.99',discountPercent:'5',taxPercent:'18'},{quantity:'0.125',unitPrice:'80',discountPercent:'0',taxPercent:'5'}];
 const local=purchaseDocumentTotals(rows,'33','33');
 assert.deepEqual([local.subtotal,local.cgst,local.sgst,local.total],['66.97','5.38','5.38','77.73']);
 const inter=purchaseDocumentTotals(rows,'27','33');assert.equal(inter.igst,'10.75');assert.equal(inter.total,'77.72');
 // Each local tax component rounds independently; do not force it to equal IGST.
 assert.equal(purchaseDocumentTotals([{...line,quantity:'1',unitPrice:'0.05',discountPercent:'0'}],'33','33').total,'0.05');
});
test('rupee rounding boundaries and numbering limits are deterministic',()=>{
 for(const [price,total,delta]of [['10.49','10.00','-0.49'],['10.50','11.00','0.50'],['10.51','11.00','0.49'],['0','0.00','0.00']]){
  const actual=purchaseDocumentTotals([{...line,quantity:'1',unitPrice:price,discountPercent:'0',taxPercent:'0'}],'33','33',true);assert.equal(actual.total,total);assert.equal(actual.roundOff,delta);
 }
 assert.equal(financialYear('2028-02-29'),'2027-28');assert.throws(()=>financialYear('2027-02-29'));
 assert.equal(documentNumber('PO','2026-27',999999999n),'PO/2026-27/999999999');assert.throws(()=>documentNumber('PO','2026-27',1000000000n));
});
test('purchase GST uses supplier origin and Tamil Nadu buyer destination',()=>{
 const local=purchaseDocumentTotals([line],'33','33');assert.deepEqual([local.subtotal,local.cgst,local.sgst,local.igst,local.total],['80.00','7.20','7.20','0.00','94.40']);
 const interstate=purchaseDocumentTotals([line],'19','33');assert.deepEqual([interstate.cgst,interstate.sgst,interstate.igst,interstate.total],['0.00','0.00','14.40','94.40']);
 assert.throws(()=>purchaseDocumentTotals([line],'','33'));assert.throws(()=>purchaseDocumentTotals([line],'19','27'));
});
test('rounding uses exact signed half-up adjustment without changing GST',()=>{
 const up=purchaseDocumentTotals([{...line,quantity:'1',unitPrice:'10.50',discountPercent:'0',taxPercent:'0'}],'33','33',true);assert.equal(up.total,'11.00');assert.equal(up.roundOff,'0.50');
 const down=purchaseDocumentTotals([line],'33','33',true);assert.equal(down.total,'94.00');assert.equal(down.roundOff,'-0.40');assert.equal(down.cgst,'7.20');
 const precise=purchaseDocumentTotals([{...line,quantity:'0.333333',unitPrice:'100',discountPercent:'0',taxPercent:'18'}],'19','33');assert.equal(precise.total,'39.33');
});
test('Indian amount in words handles zero, paise, lakh and crore',()=>{
 assert.equal(amountInWords('0.00'),'Rupees zero only');assert.equal(amountInWords('94.40'),'Rupees ninety-four and forty paise only');assert.equal(amountInWords('12345678.50'),'Rupees one crore twenty-three lakh forty-five thousand six hundred seventy-eight and fifty paise only');
});
test('financial year changes on 1 April; sequential format rejects invalid prefixes',()=>{
 assert.equal(financialYear('2026-03-31'),'2025-26');assert.equal(financialYear('2026-04-01'),'2026-27');assert.equal(documentNumber('DEMO-RFQ','2026-27',1n),'DEMO-RFQ/2026-27/000001');assert.equal(documentNumber('DEMO-PO','2026-27',1000000n),'DEMO-PO/2026-27/1000000');assert.throws(()=>financialYear('2026-02-30'));assert.throws(()=>documentNumber('../x','2026-27',1));assert.throws(()=>documentNumber('PO','2026-27',0));
 assert.equal(validateDocumentYear('2026-12-01','2026-11-18'),'2026-27');assert.throws(()=>validateDocumentYear('2027-04-01','2026-11-18'));
 assert.throws(()=>validateDocumentPrefixes('MEHTA','MEHTA'));assert.doesNotThrow(()=>validateDocumentPrefixes('MEHTA-RFQ','MEHTA-PO'));
});
test('purchasing lifecycle enforces independent approval including Owner',()=>{
 const draft={status:'DRAFT',created_by:1};assert.equal(documentTransition(draft,'SUBMIT',1),'PENDING_APPROVAL');
 assert.throws(()=>documentTransition({...draft,status:'PENDING_APPROVAL'},'APPROVE',1),{status:403});
 assert.throws(()=>documentTransition({...draft,status:'PENDING_APPROVAL',payload:{editorId:2}},'APPROVE',2),{status:403});
 assert.equal(documentTransition({...draft,status:'PENDING_APPROVAL'},'APPROVE',2),'APPROVED');assert.throws(()=>documentTransition(draft,'MARK_SENT',1),{status:409});
 assert.equal(documentTransition({...draft,status:'APPROVED'},'MARK_SENT',2),'SENT');assert.throws(()=>documentTransition({...draft,status:'SENT'},'CANCEL',2),{status:409});
});
test('every document status rejects unsupported workflow actions',()=>{
 const allowed={DRAFT:{SUBMIT:'PENDING_APPROVAL',CANCEL:'CANCELLED'},PENDING_APPROVAL:{APPROVE:'APPROVED',RETURN:'DRAFT',CANCEL:'CANCELLED'},APPROVED:{RETURN:'DRAFT',MARK_SENT:'SENT',CANCEL:'CANCELLED'},SENT:{},CANCELLED:{}};
 for(const [status,actions]of Object.entries(allowed))for(const action of ['SUBMIT','APPROVE','RETURN','MARK_SENT','CANCEL','UNKNOWN']){
  const row={status,created_by:1,payload:{editorId:3}};
  if(actions[action])assert.equal(documentTransition(row,action,2),actions[action]);else assert.throws(()=>documentTransition(row,action,2),{status:409});
 }
});
