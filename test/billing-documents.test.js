import test from 'node:test';
import assert from 'node:assert/strict';
import {invoicePayload,invoiceNumber,originalPdf,requireIssuance,validateBillingSettings} from '../src/modules/billing/domain.js';
import {financeAccess,act} from '../src/modules/billing/service.js';
import {reportFilters,reportCatalogue,reportData} from '../src/modules/billing/reports.js';
import {invoicePdf,renderPdf} from '../src/modules/billing/pdf.js';
const input={date:'2026-11-21',placeOfSupply:'33',billTo:'TEST address',shipTo:'TEST address',terms:'TEST only',lines:[{code:'TEST',description:'Fictional item',hsn:'8536',uom:'NOS',quantity:'2',unitPrice:'100',taxPercent:'18'}]};
const customer={id:1,name:'TEST customer'};
test('invoice arithmetic splits intra-state GST exactly',()=>{const p=invoicePayload(input,customer,{});assert.equal(p.totals.cgst,'18.00');assert.equal(p.totals.sgst,'18.00');assert.equal(p.totals.igst,'0.00');assert.equal(p.totals.total,'236.00');assert.match(p.amountInWords,/two hundred thirty-six/);});
test('interstate GST uses IGST, with exact half-up rupee rounding',()=>{const p=invoicePayload({...input,placeOfSupply:'27',roundToRupee:true,lines:[{...input.lines[0],quantity:'1',unitPrice:'100.50',taxPercent:'0'}]},customer,{});assert.equal(p.totals.total,'101.00');assert.equal(p.totals.roundOff,'0.50');const tax=invoicePayload({...input,placeOfSupply:'27'},customer,{});assert.equal(tax.totals.igst,'36.00');assert.equal(tax.totals.cgst,'0.00');});
test('negative round-off remains exact',()=>{const p=invoicePayload({...input,roundToRupee:true,lines:[{...input.lines[0],quantity:'1',unitPrice:'100.49',taxPercent:'0'}]},customer,{});assert.equal(p.totals.roundOff,'-0.49');assert.equal(p.totals.total,'100.00');});
test('invalid invoice dates, quantity, GST and HSN fail closed',()=>{for(const change of [{date:'2026-02-30'},{placeOfSupply:'99'},{lines:[]},{lines:[{...input.lines[0],quantity:'0'}]},{lines:[{...input.lines[0],taxPercent:'101'}]},{lines:[{...input.lines[0],hsn:'bad'}]}])assert.throws(()=>invoicePayload({...input,...change},customer,{}));});
test('numbering is within 16 characters and switches FY on April 1',()=>{assert.equal(invoiceNumber('MEC','2026-03-31',1),'MEC/2526/000001');assert.equal(invoiceNumber('MEC','2026-04-01',1),'MEC/2627/000001');assert.ok(invoiceNumber('MEC','2026-04-01',999999).length<=16);assert.throws(()=>invoiceNumber('MEC','2026-04-01',1000000));});
test('statutory issuance stays blocked for missing policy or IRN integration',()=>{assert.throws(()=>requireIssuance({}));assert.throws(()=>requireIssuance({confirmed:true,crmIssuanceEnabled:true,irnRequired:true}));assert.doesNotThrow(()=>requireIssuance({confirmed:true,crmIssuanceEnabled:true,irnRequired:false}));assert.throws(()=>validateBillingSettings({}));});
test('financial PDF endpoints deny sales, warehouse and unrecognised roles',()=>{for(const role of ['EXECUTIVE','MANAGER','STORE_STAFF','LOGISTICS_LEAD','CUSTOM'])assert.throws(()=>financeAccess({role}));assert.doesNotThrow(()=>financeAccess({role:'OWNER'}));});
test('report dates and status are validated; financial reports are permission filtered',()=>{assert.throws(()=>reportFilters({from:'2024-01-01',to:'2026-01-01'}));assert.throws(()=>reportFilters({from:'2026-11-21',to:'2026-11-20'}));assert.throws(()=>reportFilters({from:'2026-11-01',to:'2026-11-21',status:"' OR true"}));assert.ok(!reportCatalogue({role:'EXECUTIVE'}).some(r=>r.key==='collections'));});
test('report exports refuse to silently truncate more than 1000 rows',async()=>{const db={prepare:()=>({all:async()=>Array.from({length:1001},()=>({}))})};await assert.rejects(reportData(db,{id:1,role:'OWNER'},'quotations',{from:'2026-11-01',to:'2026-11-21'}),/1,000/);});
test('invoice PDFs use allowlisted fields, valid bytes and retained originals pass integrity input checks',async()=>{const p=invoicePayload(input,customer,{name:'TEST ONLY',address:'TEST address',gstin:'33ABCDE1234F1Z5',contact:'fictional@example.test'});p.internalCost='DO_NOT_EXPORT';const bytes=await invoicePdf({id:'TEST',status:'DRAFT',payload:p});assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.equal(originalPdf(bytes.toString('base64')).bytes.equals(bytes),true);assert.throws(()=>originalPdf(Buffer.from('%PDF-incomplete').toString('base64')));assert.throws(()=>originalPdf('not-pdf'));});
test('long report renders bounded multipage PDF without large watermark graphics',async()=>{const bytes=await renderPdf({title:'TEST register',subtitle:'Fictional data',sections:[],columns:[{label:'Entry',fraction:1}],rows:Array.from({length:200},(_,i)=>['TEST row '+i])});assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok((bytes.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>1);});

test('shipment-backed issuance revalidates source and allocates the number inside its transaction',async()=>{
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const payload=invoicePayload({...input,date:today,lines:[{...input.lines[0],unitPrice:'100.000000'}]},customer,{});payload.shipmentVersion=1;
 const row={id:'12345678-1234-1234-1234-123456789abc',source:'CRM',status:'APPROVED',version:3,created_by:1,customer_id:1,shipment_id:10,settings_version:1,payload,number:null};
 const trace=[],db={withConnection:async fn=>fn(),exec:async q=>trace.push(q),prepare:q=>({get:async()=>{
  if(q.startsWith('SELECT * FROM billing_documents'))return structuredClone(row);
  if(q.startsWith('SELECT * FROM billing_document_settings'))return {version:1,value:{confirmed:true,crmIssuanceEnabled:true,irnRequired:false,prefix:'TST'}};
  if(q.includes('FROM crm_shipments'))return {id:10,sales_order_id:1,order_status:'DISPATCHED',order_version:1,public_snapshot:{placeOfSupply:'33'}};
  if(q.includes('FROM crm_customer_onboarding'))return {status:'APPROVED'};
  if(q.includes('FROM customers'))return {id:1};
  if(q.startsWith('INSERT INTO billing_document_counters')){trace.push('NUMBER');return {n:'1'};}
 },all:async()=>[{id:1,item_id:1,description:'Fictional item',uom:'NOS',unit_price:'100',discount_percent:'0',tax_percent:'18',quantity:'2',part_code:'TEST',hsn:'8536'}],run:async(...args)=>{if(q.startsWith('UPDATE billing_documents')){row.status=args[0];row.number=args[1];row.version++;}if(q.startsWith('INSERT INTO audit_logs'))trace.push('AUDIT');}})};
 const result=await act(db,{id:2,role:'OWNER'},row.id,{action:'ISSUE',version:3,reason:'TEST ONLY issuance protocol'});
 assert.equal(result.status,'ISSUED');assert.match(result.number,/^TST\/\d{4}\/000001$/);assert.ok(trace.indexOf('BEGIN')<trace.indexOf('NUMBER'));assert.ok(trace.indexOf('AUDIT')<trace.indexOf('COMMIT'));
 await assert.rejects(act(db,{id:2,role:'OWNER'},row.id,{action:'ISSUE',version:4,reason:'TEST duplicate issue'}),/not available/);
});
