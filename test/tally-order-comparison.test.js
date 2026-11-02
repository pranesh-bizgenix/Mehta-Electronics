import test from 'node:test';
import assert from 'node:assert/strict';
import {compareOrders} from '../src/tally-orders/compare.js';
import {parseOrderResponse} from '../src/tally-orders/parse.js';
import {dryRunSalesOrders} from '../src/tally-orders/fetchers/sales-orders.js';
import {dryRunPurchaseOrders} from '../src/tally-orders/fetchers/purchase-orders.js';
import {orderRequest} from '../src/tally-orders/fetchers/runtime.js';
import {tallyOrderComparisonRoutes} from '../src/tally-orders/routes.js';

const line=(price='100',qty='2')=>({itemCode:'PART-1',quantity:qty,unit:'NOS',unitPrice:price,discountPercent:'0',netAmount:String(Number(price)*Number(qty)),taxPercent:'18',hsn:'0012'});
const doc=(kind,price)=>({id:kind,companyId:'company-a',currency:'INR',kind,status:'RECORDED',lines:[line(price)]});
const run=(sales=doc('sales_orders','100'),po=doc('purchase_orders','60'),options={})=>compareOrders(sales,po,{mode:'SUPPLIER_PO',netExTaxConfirmed:true,...options});
const xml=(type='Sales Order',extra='')=>`<ENVELOPE><BODY><VOUCHER VCHTYPE="${type}"><GUID>stable-guid</GUID><MASTERID>20</MASTERID><ALTERID>22</ALTERID><DATE>20260401</DATE><VOUCHERNUMBER>SO-1</VOUCHERNUMBER>${extra}<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>PART-1</STOCKITEMNAME><BILLEDQTY>2 NOS</BILLEDQTY><RATE>100/NOS</RATE><AMOUNT>200</AMOUNT></ALLINVENTORYENTRIES.LIST></VOUCHER></BODY></ENVELOPE>`;

test('supplier PO gives expected gross profit, not realized or net profit',()=>{
  const result=run();assert.equal(result.estimatedOrderGrossProfit,'80.00');assert.equal(result.marginPercent,'40.00');assert.equal(result.realizedProfit,null);assert.equal(result.estimatedNetProfit,null);
});
test('loss and break-even are explicit',()=>{assert.equal(run(undefined,doc('purchase_orders','120')).outcome,'EXPECTED_GROSS_LOSS');assert.equal(run(undefined,doc('purchase_orders','100')).outcome,'BREAK_EVEN');});
test('customer PO compares agreement but never treats customer PO as cost',()=>{
  const result=run(undefined,doc('customer_po','95'),{mode:'CUSTOMER_PO'});assert.equal(result.complete,true);assert.equal(result.coveredPurchaseCost,null);assert.equal(result.estimatedOrderGrossProfit,null);assert.ok(result.rows[0].differences.some(d=>d.field==='unitPrice'));
});
test('partial quantities show covered margin without a whole-order profit',()=>{const po=doc('purchase_orders','60');po.lines=[line('60','1')];const r=run(undefined,po);assert.equal(r.coveredGrossProfit,'40.00');assert.equal(r.estimatedOrderGrossProfit,null);assert.equal(r.complete,false);});
test('missing cost, signed amounts and missing discounts are never assumed zero',()=>{
  for(const change of [{netAmount:null,unitPrice:null},{netAmount:'-120'},{netAmount:null,discountPercent:null}]){
    const po=doc('purchase_orders','60');Object.assign(po.lines[0],change);assert.equal(run(undefined,po).estimatedOrderGrossProfit,null);
  }
});
test('currency, company, tax review and cancellation block margin',()=>{
  for(const change of [{currency:null},{currency:'USD'},{companyId:'other'},{status:'CANCELLED'},{status:'DELETED'}]){const po={...doc('purchase_orders','60'),...change};assert.equal(run(undefined,po).estimatedOrderGrossProfit,null);}
  assert.equal(run(undefined,undefined,{netExTaxConfirmed:false}).estimatedOrderGrossProfit,null);
});
test('repeated items, missing items and mismatched units require review',()=>{
  for(const change of [po=>po.lines.push(line('60')),po=>po.lines[0].itemCode='OTHER',po=>po.lines[0].unit='BOX']){const po=doc('purchase_orders','60');change(po);assert.equal(run(undefined,po).estimatedOrderGrossProfit,null);}
});
test('decimal arithmetic retains precision and HSN preserves leading zeros',()=>{
  const a=doc('sales_orders','0.3'),b=doc('purchase_orders','0.1');a.lines[0].netAmount='0.60';b.lines[0].netAmount='0.20';b.lines[0].hsn='12';const r=run(a,b);assert.equal(r.estimatedOrderGrossProfit,'0.40');assert.ok(r.rows[0].differences.some(d=>d.field==='hsn'&&d.delta===null));
});
test('XML identifies exact voucher type, stable ID, quantities and cancellations',()=>{
  const options={kind:'sales_orders',companyId:'a'};const r=parseOrderResponse(xml('Sales Order','<ISCANCELLED>Yes</ISCANCELLED>'),options);assert.equal(r.records[0].id,'sales_orders:guid:stable-guid');assert.equal(r.records[0].lines[0].quantity,'2');assert.equal(r.records[0].lines[0].unit,'NOS');assert.equal(r.cancelled,1);assert.equal(parseOrderResponse(xml('Sales'),options).excluded,1);
  assert.equal(parseOrderResponse('<ENVELOPE/>',options).records.length,0);
});
test('malformed XML, entities, Tally errors and unidentified vouchers fail visibly',()=>{
  const opts={kind:'sales_orders',companyId:'a'};for(const value of ['<ENVELOPE>','<!DOCTYPE x><ENVELOPE/>','<ENVELOPE><LINEERROR>Rejected</LINEERROR></ENVELOPE>'])assert.throws(()=>parseOrderResponse(value,opts));
  assert.equal(parseOrderResponse(xml().replace('<GUID>stable-guid</GUID>','').replace('<MASTERID>20</MASTERID>',''),opts).errors.length,1);
});
test('default-off fetchers do not call Tally',async()=>{let calls=0;for(const fetcher of [dryRunSalesOrders,dryRunPurchaseOrders]){const result=await fetcher({env:{},transport:{request:()=>calls++}});assert.equal(result.writes,0);assert.equal(result.enabled,false);}assert.equal(calls,0);});
test('enabled dry-run requires whole-cycle coordination and performs no persistence',async()=>{
  const env={TALLY_FETCH_SALES_ORDERS_ENABLED:'true'};await assert.rejects(dryRunSalesOrders({env}),/coordination/);
  let lease=false;const r=await dryRunSalesOrders({env,companyId:'a',companyName:'A & B',windows:[{from:'20260401',to:'20260430'}],coordinator:{withExclusiveSyncCycle:async fn=>{lease=true;return fn();}},transport:{request:async request=>{assert.equal(lease,true);assert.match(request,/A &amp; B/);return xml();}}});assert.equal(r.records.length,1);assert.equal(r.writes,0);assert.equal(r.watermarkAdvanced,false);
});
test('request validates cursors, dates and entity',()=>{assert.throws(()=>orderRequest({kind:'other'}));assert.throws(()=>orderRequest({kind:'sales_orders',companyName:'A',from:'20260401',to:'20260301'}));});
test('new preview API rejects disabled comparison and unauthorized roles',async()=>{
  const routes=tallyOrderComparisonRoutes({route:(method,path,permission,handler)=>({method,path,permission,handler}),json:()=>{},readJson:async()=>({}),env:{}});
  await assert.rejects(routes[0].handler({user:{role:'EXECUTIVE'},res:{}}),e=>e.status===403);
  await assert.rejects(routes[1].handler({user:{role:'OWNER'},res:{}}),e=>e.status===409);
});
