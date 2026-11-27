import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptAllocations,collectionBalance,collectionAgeing,validateArrangement,chequeClosure,assertIssuedInvoiceClosure} from '../src/modules/accounts/collection-domain.js';
import {CollectionsService} from '../src/modules/accounts/collections-service.js';
import {commitmentPlan,commitmentProgress,commitmentCoverage} from '../src/modules/sourcing/commitment-domain.js';
test('One bank payment is allocated exactly across distinct invoice receipts',()=>{const p=receiptAllocations('0.30',[{invoiceId:'A',amount:'0.10'},{invoiceId:'B',amount:'0.20'}]);assert.equal(p.amount,'0.30');assert.equal(p.rows.length,2);assert.throws(()=>receiptAllocations('100',[{invoiceId:'A',amount:'60'},{invoiceId:'B',amount:'41'}]),{status:422});assert.throws(()=>receiptAllocations('100',[{invoiceId:'A',amount:'60'},{invoiceId:'A',amount:'40'}]),{status:422});});
test('Verified credit/debit notes and receipts produce the actual remaining amount',()=>{const b=collectionBalance({amount:'100',receipts:[{amount:'40'}],adjustments:[{kind:'CREDIT',amount:'20'},{kind:'DEBIT',amount:'5'}]});assert.equal(b.adjusted,'85.000000');assert.equal(b.outstanding,'45.000000');assert.equal(b.paid,'40.000000');});
test('An overpayment is retained as a customer credit instead of hidden at zero',()=>{const b=collectionBalance({amount:'100',receipts:[{amount:'100'}],adjustments:[{kind:'CREDIT',amount:'20'}]});assert.equal(b.outstanding,'-20.000000');assert.equal(collectionAgeing(b,null,'2026-11-26').bucket,'CREDIT_BALANCE');});
test('Ageing respects each exact overdue boundary and leaves unknown due dates explicit',()=>{const b=collectionBalance({amount:'100'});assert.equal(collectionAgeing(b,null,'2026-11-26').bucket,'DUE_DATE_NOT_CONFIRMED');for(const [date,bucket] of [['2026-11-26','CURRENT'],['2026-11-25','1_30'],['2026-10-27','1_30'],['2026-10-26','31_60'],['2026-09-27','31_60'],['2026-09-26','61_90'],['2026-08-28','61_90'],['2026-08-27','OVER_90']])assert.equal(collectionAgeing(b,date,'2026-11-26').bucket,bucket,date);});
test('Collection terms never invent a due date, promise amount or cheque identity',()=>{assert.throws(()=>validateArrangement('DUE_DATE',{date:'2026-02-30'},'100'),{status:422});assert.throws(()=>validateArrangement('PROMISE',{date:'2026-11-30',amount:'101'},'100'),{status:409});assert.throws(()=>validateArrangement('PDC',{date:'2026-11-30',amount:'100'},'100'),{status:422});assert.equal(validateArrangement('PDC',{date:'2026-11-30',amount:'100',chequeNumber:'001',bankName:'SAMPLE Bank'},'100').chequeNumber,'001');});
test('Dated commitments must exactly cover the original quantity and combine repeated dates',()=>{assert.equal(commitmentPlan([{date:'2026-12-01',quantity:'0.1'},{date:'2026-12-02',quantity:'0.2'}],'0.3').length,2);for(const rows of [[{date:'2026-12-01',quantity:'1'}],[{date:'2026-12-01',quantity:'1'},{date:'2026-12-01',quantity:'1'}],[{date:'2026-02-30',quantity:'2'}]])assert.throws(()=>commitmentPlan(rows,'2'),{status:422});});
test('Partial supply consumes earliest dated quantities while retaining later pending quantities',()=>{const rows=commitmentPlan([{date:'2026-11-20',quantity:'4'},{date:'2026-12-01',quantity:'6'}],'10'),p=commitmentProgress(rows,'3','2026-11-26');assert.equal(p[0].pending,'1.000000');assert.equal(p[0].overdue,true);assert.equal(p[1].pending,'6.000000');assert.equal(p[1].overdue,false);});
test('Supplier coverage compares quantities available by each customer date rather than final totals',()=>{const r=commitmentCoverage([{date:'2026-11-20',quantity:'4'},{date:'2026-12-01',quantity:'6'}],[{date:'2026-11-21',quantity:'10'}]);assert.equal(r[0].shortfall,'4.000000');assert.equal(r[1].shortfall,'0.000000');});

const cheque={id:'cheque',invoice_id:'invoice-A',kind:'PDC',status:'ACTIVE',created_by:1,payload:{date:'2026-11-25',amount:'100.00'}};
const receipt={id:'receipt-A',kind:'RECEIPT',status:'CONFIRMED',payload:{invoiceId:'invoice-A',amount:'100.000000',paymentDate:'2026-11-26'}};
const closure={decision:'CLEARED',actorId:2,evidence:'SAMPLE bank clearance reference',receipt,today:'2026-11-26'};
test('Cheque clearance requires independent bank evidence and an exact confirmed receipt',()=>{
 assert.deepEqual(chequeClosure(cheque,closure),{status:'CLEARED',receiptId:'receipt-A'});
 assert.throws(()=>chequeClosure(cheque,{...closure,actorId:1}),{status:403});
 assert.throws(()=>chequeClosure(cheque,{...closure,evidence:''}),{status:422});
 for(const patch of [{status:'PENDING_APPROVAL'},{kind:'INVOICE'},{payload:{...receipt.payload,invoiceId:'other'}},{payload:{...receipt.payload,amount:'100.01'}}])assert.throws(()=>chequeClosure(cheque,{...closure,receipt:{...receipt,...patch}}),{status:409});
});
test('Cheque dates prevent premature clearance and unrelated older receipts',()=>{
 assert.throws(()=>chequeClosure(cheque,{...closure,today:'2026-11-24'}),{status:409});
 for(const paymentDate of ['2026-11-24','2026-11-27'])assert.throws(()=>chequeClosure(cheque,{...closure,receipt:{...receipt,payload:{...receipt.payload,paymentDate}}}),{status:409});
 assert.throws(()=>chequeClosure({...cheque,status:'CLEARED'},closure),{status:409});
});
test('Bounced cheques remain evidence-based and do not fabricate a receipt',()=>{
 assert.deepEqual(chequeClosure(cheque,{...closure,decision:'BOUNCED',receipt:null}),{status:'BOUNCED',receiptId:null});
 assert.throws(()=>chequeClosure(cheque,{...closure,decision:'BOUNCED',evidence:' '}),{status:422});
});
test('Non-financial roles cannot read collection balances, sources or allocations',async()=>{
 const service=new CollectionsService({db:{prepare(){throw new Error('Unauthorised database access');}}});
 for(const role of ['EXECUTIVE','MANAGER','LOGISTICS_LEAD','STORE_STAFF','CUSTOM']){
  const user={id:1,role};
  await assert.rejects(service.ageing(user,{}),{status:403});
  await assert.rejects(service.invoice(user,'11111111-1111-4111-8111-111111111111'),{status:403});
  await assert.rejects(service.createBatch(user,{}),{status:403});
 }
});
test('An issued invoice cannot disappear from receivables through a cancelled reference',()=>{
 for(const outstanding of ['100','0','-10'])assert.throws(()=>assertIssuedInvoiceClosure({action:'CANCEL',hasIssuedDocument:true,outstanding}),{status:409});
 assert.throws(()=>assertIssuedInvoiceClosure({action:'RESOLVE',hasIssuedDocument:true,outstanding:'0.01'}),{status:409});
 for(const outstanding of ['0','-10'])assert.doesNotThrow(()=>assertIssuedInvoiceClosure({action:'RESOLVE',hasIssuedDocument:true,outstanding}));
 assert.doesNotThrow(()=>assertIssuedInvoiceClosure({action:'CANCEL',hasIssuedDocument:false,outstanding:'100'}));
});
