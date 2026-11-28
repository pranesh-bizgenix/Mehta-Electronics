import test from 'node:test';import assert from 'node:assert/strict';import {receivableReportRow} from '../src/modules/billing/operational-reports.js';
const row={reference:'SAMPLE-INVOICE',customer_name:'SAMPLE',status:'NEW',invoice_date:'2026-10-01',due_date:'2026-10-20',amount:'100.000001',receipts:[{amount:'10.000001'}],adjustments:[{kind:'CREDIT',amount:'20'},{kind:'DEBIT',amount:'5'}]};
test('Ageing report reconciles confirmed amounts without floating-point rounding',()=>{const r=receivableReportRow(row,'2026-11-27');assert.equal(r.outstanding,'75.000000');assert.equal(r.confirmed_paid,'10.000001');assert.equal(r.bucket,'31_60');assert.equal(r.days_overdue,'38');});
test('Missing due dates remain unconfirmed rather than assumed overdue',()=>{const r=receivableReportRow({...row,due_date:null},'2026-11-27');assert.equal(r.bucket,'DUE_DATE_NOT_CONFIRMED');assert.equal(r.days_overdue,'Not confirmed');});
test('Overpayments remain visible as credit balances',()=>{const r=receivableReportRow({...row,receipts:[{amount:'200'}]},'2026-11-27');assert.equal(r.bucket,'CREDIT_BALANCE');assert.equal(r.outstanding,'-114.999999');});
test('Invalid financial or date evidence stops export',()=>{for(const patch of [{amount:'NaN'},{receipts:[{amount:'-1'}]},{due_date:'2026-02-30'}])assert.throws(()=>receivableReportRow({...row,...patch},'2026-11-27'),{status:422});});

test('Unknown adjustment types cannot disappear from a financial balance',()=>assert.throws(()=>receivableReportRow({...row,adjustments:[{kind:'UNKNOWN',amount:'5'}]},'2026-11-27'),{status:422}));
test('Reference-only amounts stay visibly unverified',()=>assert.equal(receivableReportRow(row,'2026-11-27').source_status,'REFERENCE_ONLY_REVIEW'));
