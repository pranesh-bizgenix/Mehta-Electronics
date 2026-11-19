import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCustomerPo} from '../src/customer-po-comparison.js';
const line={itemId:1,partCode:'DEMO-1',description:'Fictional component',uom:'NOS',quantity:'2',unitPrice:'100',discountPercent:'60',taxPercent:'18'};
const quote={quotation_number:'DEMO-Q',version:3,total:'94.40',sellerState:'33',placeOfSupply:'33',lines:[line]};
const order={poTotal:'94.40',sellerState:'33',placeOfSupply:'33',lines:[{...line}]};
test('matching and reordered PO lines agree without positional matching',()=>{
 const other={...line,itemId:2,partCode:'DEMO-2'};
 assert.deepEqual(compareCustomerPo(order,quote).flags,[]);
 const result=compareCustomerPo({...order,lines:[other,line]},{...quote,lines:[line,other]});
 assert.deepEqual(result.flags,[]);assert.equal(result.comparisons[0].quote.partCode,'DEMO-2');
});
test('exact quantity, list/net price, discount and GST differences have signed deltas',()=>{
 const result=compareCustomerPo({...order,lines:[{...line,quantity:'1.999999',unitPrice:'101',discountPercent:'63',taxPercent:'12'}]},quote);
 for(const code of ['QUANTITY_DIFFERENCE','RATE_DIFFERENCE','DISCOUNT_DIFFERENCE','TAX_DIFFERENCE','NET_RATE_DIFFERENCE'])assert.ok(result.flags.includes(code));
 assert.equal(result.comparisons[0].differences.find(d=>d.field==='quantity').delta,'-0.000001');
 assert.equal(result.comparisons[0].differences.find(d=>d.field==='netUnitPrice').delta,'-2.63');
});
test('missing and extra items produce explicit rows',()=>{
 const result=compareCustomerPo({...order,lines:[{...line,itemId:2,partCode:'DEMO-2'}]},quote);
 assert.deepEqual(result.flags.sort(),['PART_NOT_IN_QUOTE','QUOTE_ITEMS_MISSING']);
 assert.equal(result.comparisons.length,2);assert.equal(result.comparisons[0].quote,null);assert.equal(result.comparisons[1].po,null);
});
test('duplicate items on either side require resolution and are never paired by position',()=>{
 for(const [po,q]of [[{...order,lines:[line,line]},quote],[order,{...quote,lines:[line,line]}]]){
  const result=compareCustomerPo(po,q);assert.ok(result.flags.includes('AMBIGUOUS_QUOTE_LINE'));
  assert.ok(result.comparisons.every(row=>row.po===null||row.quote===null));
 }
});
test('confirmed item links support customer aliases but conflicting IDs never match',()=>{
 assert.deepEqual(compareCustomerPo({...order,lines:[{...line,partCode:'CUSTOMER-ALIAS'}]},quote).flags,[]);
 assert.ok(compareCustomerPo({...order,lines:[{...line,itemId:2}]},quote).flags.includes('PART_NOT_IN_QUOTE'));
 const unmapped={...line,itemId:null};assert.deepEqual(compareCustomerPo({...order,lines:[unmapped]},quote).flags,[]);
});
test('unit and jurisdiction differences remain visible and totals keep existing review boundary',()=>{
 const result=compareCustomerPo({...order,placeOfSupply:'19',poTotal:'95.41',lines:[{...line,uom:'BOX'}]},quote);
 for(const code of ['UOM_DIFFERENCE','TAX_JURISDICTION_DIFFERENCE','QUOTE_TOTAL_DIFFERENCE_OVER_1'])assert.ok(result.flags.includes(code));
 assert.equal(result.quoteDifference,'1.01');
 assert.ok(!compareCustomerPo({...order,poTotal:'95.40'},quote).flags.includes('QUOTE_TOTAL_DIFFERENCE_OVER_1'));
 assert.equal(compareCustomerPo({...order,poTotal:'93.39'},quote).quoteDifference,'-1.01');
});
test('manual orders are marked unlinked and public comparison excludes private cost/source fields',()=>{
 assert.equal(compareCustomerPo(order,null).linked,false);
 const result=compareCustomerPo(order,{...quote,lines:[{...line,unitCost:'secret',marginPercent:'secret',sourceDiscount:'secret'}]});
 assert.ok(!JSON.stringify(result).includes('secret'));assert.equal(result.quoteVersion,3);
});
test('net rate differences smaller than six decimal places remain visible',()=>{
 const quoted={...line,unitPrice:'1',discountPercent:'0'};
 const result=compareCustomerPo({...order,lines:[{...quoted,discountPercent:'0.000001'}]},{...quote,lines:[quoted]});
 assert.equal(result.comparisons[0].differences.find(d=>d.field==='netUnitPrice').delta,'-0.00000001');
});
