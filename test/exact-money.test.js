import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decimal,add,format,formatIndian,lineNet,legacyTotals,sumMoney} from '../public/money.js';
import * as compatibility from '../src/tally-orders/decimal.js';
import {calculateQuotation} from '../public/quotation-math.js';
import {quotationView,salesOrderView} from '../src/db.js';
import {withTestTransaction} from '../test-support/transaction.js';

const line={quantity:'4',ordered_quantity:'4',unit_price:'1600',discount_percent:'10',tax_percent:'18'};
test('shared money preserves decimal arithmetic, large amounts, signed round-off and half-up boundaries',()=>{
  assert.equal(format(add(decimal('0.1'),decimal('0.2'))),'0.30');
  assert.equal(sumMoney(['99999999999999.123456','0.006544']),'99999999999999.13');
  assert.equal(sumMoney(['100.00','-0.49']),'99.51');
  assert.equal(format(decimal('-1.005')),'-1.01');
  assert.equal(format(decimal('1.005')),'1.01');
  assert.equal(formatIndian('1234567890123456.005'),'1,23,45,67,89,01,23,456.01');
  assert.equal(formatIndian('-0.004'),'0.00');
  for(const value of ['',null,'NaN','Infinity','1e3'])assert.throws(()=>decimal(value));
  assert.equal(compatibility.decimal,decimal,'Tally compatibility path must use the same shared implementation.');
});

test('legacy summaries preserve established totals and aggregate rounding while eliminating binary-float accumulation',()=>{
  assert.deepEqual(legacyTotals([line]),{subtotal:'5760.00',tax_total:'1036.80',total:'6796.80'});
  assert.deepEqual(legacyTotals([line],'ordered_quantity'),legacyTotals([line]));
  assert.equal(format(lineNet(line)),'5760.00');
  const fractional={quantity:'3',unit_price:'0.1',discount_percent:'0',tax_percent:'18'};
  assert.deepEqual(legacyTotals([fractional]),{subtotal:'0.30',tax_total:'0.05',total:'0.35'});
  assert.deepEqual(legacyTotals([]),{subtotal:'0.00',tax_total:'0.00',total:'0.00'});
  assert.equal(legacyTotals([{...line,quantity:'1',unit_price:'99999999999999.123456',discount_percent:'0',tax_percent:'0'}]).total,'99999999999999.12');
  assert.throws(()=>legacyTotals([{...line,unit_price:null}]),/plain decimal/,'Unknown money must not become zero.');
});

test('existing managed quotation GST component rounding remains distinct from legacy aggregate rounding',()=>{
  const input=[{quantity:'1',unitPrice:'0.05',discountPercent:'0',taxPercent:'18'}];
  const local=calculateQuotation(input,'27','27'),interstate=calculateQuotation(input,'27','29');
  assert.deepEqual([local.cgst,local.sgst,local.igst,local.total],['0.00','0.00','0.00','0.05']);
  assert.deepEqual([interstate.cgst,interstate.sgst,interstate.igst,interstate.total],['0.00','0.00','0.01','0.06']);
});

test('legacy quotation and order readers return exact decimal totals without numeric coercion',async()=>{
  const db={prepare:query=>({get:async()=>({id:1}),all:async()=>{
    assert.match(query,/unit_price::text AS unit_price/);
    return [line];
  }})};
  for(const reader of [quotationView,salesOrderView]){
    const row=await reader(db,1);
    assert.equal(row.total,'6796.80');assert.equal(row.subtotal,'5760.00');assert.equal(row.tax_total,'1036.80');
  }
});

test('live PostgreSQL NUMERIC values arrive as decimal strings without precision loss',()=>withTestTransaction(async db=>{
  const [row]=await db.sql`SELECT 99999999999999.123456::numeric(20,6) AS amount, -0.005::numeric(20,6) AS round_off`;
  assert.equal(row.amount,'99999999999999.123456');assert.equal(row.round_off,'-0.005000');
}));
