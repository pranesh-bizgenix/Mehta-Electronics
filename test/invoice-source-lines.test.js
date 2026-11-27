import test from 'node:test';import assert from 'node:assert/strict';import {invoiceSourceLines,sourceLineInput} from '../src/modules/billing/source-lines.js';
const items=[{id:7,part_code:'CSC16/3T',uom:'NOS'}],line={code:'CSC16/3T',description:'SAMPLE original invoice fact',uom:'NOS',quantity:'2.000001'};
test('Invoice source facts retain special-character SKUs and exact quantities',()=>{const rows=invoiceSourceLines([line],items);assert.equal(rows[0].quantity,'2.000001');assert.equal(rows[0].itemId,7);assert.deepEqual(invoiceSourceLines(sourceLineInput(rows),items),rows);});
test('Unknown or ambiguous products cannot become verified invoice facts',()=>{assert.throws(()=>invoiceSourceLines([{...line,code:'UNKNOWN'}],items),{status:422});assert.throws(()=>invoiceSourceLines([line],[...items,...items]),{status:422});});
test('Invoice source facts do not infer unit conversions or zero quantities',()=>{for(const value of [{...line,uom:'BOX'},{...line,quantity:'0'},{...line,quantity:'1e2'},{...line,quantity:2}])assert.throws(()=>invoiceSourceLines([value],items),{status:422});});
test('Copy facts cannot inject prices, tax authority or approval fields',()=>{assert.throws(()=>invoiceSourceLines([{...line,approved:true}],items),{status:422});assert.throws(()=>invoiceSourceLines([{...line,unitPrice:'100'}],items),{status:422});});

test('Invoice source facts reject unsupported control characters',()=>{assert.throws(()=>invoiceSourceLines([{...line,description:'bad\u0000fact'}],items),{status:422});});
