import test from 'node:test';import assert from 'node:assert/strict';import {quotationMargin} from '../src/modules/billing/margin-report.js';
const row={reference:'Q-0001',customer_name:'SAMPLE',status:'SENT',public_snapshot:{subtotal:'100.123456'},private_snapshot:{cost:'80.000001',missingCost:false,marginPercent:'20.10',floorPercent:'10',belowFloor:false,marginBasis:'LINE_AND_TOTAL'}};
test('Margin report preserves exact source values and subtracts without floating point',()=>{const r=quotationMargin(row);assert.equal(r.quoted_profit,'20.123455');assert.equal(r.flag,'WITHIN_CAPTURED_FLOOR');assert.equal(r.margin_percent,'20.10');});
test('Unknown costs cannot become zero or inferred profit',()=>{const r=quotationMargin({...row,private_snapshot:{...row.private_snapshot,missingCost:true}});assert.equal(r.quoted_profit,'');assert.equal(r.captured_cost,'');assert.equal(r.flag,'COST_NOT_AVAILABLE');});
test('Missing floors remain unknown rather than adopting a default threshold',()=>assert.equal(quotationMargin({...row,private_snapshot:{cost:'80',missingCost:false}}).flag,'THRESHOLD_NOT_AVAILABLE'));
test('Below-cost quoted profit remains visible as a loss',()=>{const r=quotationMargin({...row,private_snapshot:{...row.private_snapshot,cost:'120',belowFloor:true}});assert.equal(r.quoted_profit,'-19.876544');assert.equal(r.flag,'BELOW_CAPTURED_FLOOR');});
test('Malformed or inexact source numbers are not silently repaired',()=>{for(const value of [80,'1e2','bad','-10'])assert.equal(quotationMargin({...row,private_snapshot:{...row.private_snapshot,cost:value}}).flag,'COST_NOT_AVAILABLE');});

test('Negative captured margins remain visible without changing their formula',()=>assert.equal(quotationMargin({...row,private_snapshot:{...row.private_snapshot,marginPercent:'-12.50'}}).margin_percent,'-12.50'));

test('Large captured costs retain their declared thirty-digit precision',()=>{const r=quotationMargin({...row,public_snapshot:{subtotal:'999999999999999999999999999999.999999'},private_snapshot:{...row.private_snapshot,cost:'999999999999999999999999999998.999998'}});assert.equal(r.quoted_profit,'1.000001');});
