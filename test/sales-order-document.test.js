import test from 'node:test';
import assert from 'node:assert/strict';
import {salesOrderPdf,salesOrderPdfModel,downloadSalesOrderPdf,requireSalesOrderPdfAccess} from '../src/sales-order-document.js';
import {calculateQuotation} from '../public/quotation-math.js';
import {quotationSupplierTerms} from '../src/quotation-supplier-terms.js';
import {quotationWorkflowRoutes} from '../src/quotation-workflow-routes.js';
import {salesOrderRoutes} from '../src/sales-order-routes.js';
import {readFileSync} from 'node:fs';

const fixture=(count=2,state='33')=>({order_number:'SAMPLE-SO/2026-27/000001',customer_name:'SAMPLE customer',status:'HELD',effectiveStatus:'HELD',poNumber:'SAMPLE-PO-001',promisedDate:'2026-12-01',placeOfSupply:state,notes:'SAMPLE order notes',...calculateQuotation(Array.from({length:count},(_,i)=>({partCode:'SAMPLE-ITEM-'+i,description:'Fictional electrical component',hsn:'00000000',quantity:'2',uom:'NOS',unitPrice:'100',discountPercent:'10',taxPercent:'18'})),'33',state)});
const context={company:{name:'Mehta Electric Corporation - SAMPLE ONLY',address:'[Registered address not supplied]'},customer:{billing_address:'SAMPLE bill to',shipping_address:'SAMPLE ship to'},createdAt:'2026-11-26T04:00:00Z'};
test('Sales-order layout uses saved amounts, addresses, customer PO and reference title',async()=>{
 const order=fixture(),before=JSON.stringify(order),model=salesOrderPdfModel(order,context),bytes=await salesOrderPdf(order,context,{sample:true});
 assert.equal(model.presentation.title,'Sales Order');assert.equal(model.record.payload.totals.total,'424.80');assert.equal(model.record.payload.lines[0].netRate,'90.00');assert.equal(JSON.stringify(order),before);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
 assert.ok(model.presentation.metadata[1].some(([label,value])=>label==='Customer PO-ID'&&value==='SAMPLE-PO-001'));
});
test('Commercial PDFs deny warehouse-only and unknown roles before reading any database record',async()=>{
 for(const role of ['LOGISTICS_LEAD','STORE_STAFF','UNKNOWN']){assert.throws(()=>requireSalesOrderPdfAccess({role}),{status:403});await assert.rejects(downloadSalesOrderPdf({},1,{reason:'SAMPLE test'}, {role}),{status:403});}
 assert.doesNotThrow(()=>requireSalesOrderPdfAccess({role:'EXECUTIVE'}));
});
test('Missing access reason or invalid preview flag fails before the transaction',async()=>{
 for(const b of [{reason:''},{reason:'xx'},{reason:'SAMPLE test',preview:'yes'}])await assert.rejects(downloadSalesOrderPdf({},1,b,{role:'OWNER'}),{status:422});
});
test('Unapproved orders are drafts and missing delivery/stock data is never presented as Ex-Stock',()=>{
 const m=salesOrderPdfModel(fixture(),{});assert.equal(m.draft,true);assert.equal(m.record.payload.shipTo,'[Not supplied]');assert.ok(!JSON.stringify(m).includes('Ex-Stock'));assert.equal(salesOrderPdfModel(fixture(),{...context,approved:true}).draft,true);assert.equal(salesOrderPdfModel({...fixture(),status:'APPROVED',effectiveStatus:'APPROVED'},{...context,approved:true}).draft,false);
});
test('HSN from quotation is used only for a unique exact matching line',()=>{
 const o=fixture();delete o.lines[0].hsn;const quote={lines:[{partCode:o.lines[0].partCode,hsn:'SAMPLE-HSN'}]};
 assert.equal(salesOrderPdfModel(o,{...context,quote}).record.payload.lines[0].hsn,'SAMPLE-HSN');quote.lines.push({...quote.lines[0]});assert.equal(salesOrderPdfModel(o,{...context,quote}).record.payload.lines[0].hsn,'[Not supplied]');
});
test('Sales-order PDF rejects inconsistent stored totals and keeps internal costs outside its model',()=>{
 const order=fixture();order.pricing={cost:'SECRET-COST'};order.lines[0].unitCost='SECRET-COST';assert.ok(!JSON.stringify(salesOrderPdfModel(order,context)).includes('SECRET-COST'));order.total='999.00';assert.throws(()=>salesOrderPdf(order,context),{status:422});
});
test('Sales-order pagination handles 100 items and local/interstate tax without clipping',async()=>{
 for(const state of ['33','27']){
  const geometry=[],bytes=await salesOrderPdf(fixture(100,state),context,{sample:true,onLayout:v=>geometry.push(v)});assert.ok((bytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>1);
  for(const v of geometry)assert.ok(v.x>=24&&v.x+v.width<572&&v.y>=24&&v.y+v.height<842,JSON.stringify(v));
 }
});
test('Supplier reference download retains the original supplied six-page PDF bytes',async()=>{
 const file=await quotationSupplierTerms();assert.equal(file.sha256,'5ba9bfcfef53da7767509afbd30f5e39d9e2e42afcdb2107fb3be8e0925e6b06');assert.ok(file.filename.startsWith('KGEP-supplier'));assert.equal(file.bytes.subarray(0,5).toString(),'%PDF-');
});
test('Sales-order PDF and supplier attachment routes retain existing permission middleware',()=>{
 const route=(method,path,permission,handler)=>({method,path,permission,handler});const order=salesOrderRoutes({db:{},route}).find(r=>r.path==='/api/crm/orders/:id/pdf');assert.equal(order.method,'POST');assert.equal(order.permission,'orders.read');
 const terms=quotationWorkflowRoutes({db:{},route}).find(r=>r.path==='/api/crm/quotation-supplier-terms');assert.equal(terms.permission,'quotations.read');
 const page=readFileSync(new URL('../apps/web/app/(app)/orders/page.tsx',import.meta.url),'utf8');assert.match(page,/PdfActions path=\{`\/api\/crm\/orders\/\$\{detail.id\}\/pdf`\}/);
});
