import test from 'node:test';
import assert from 'node:assert/strict';
import {invoicePayload} from '../src/modules/billing/domain.js';
import {act} from '../src/modules/billing/service.js';

// Transaction protocol tests only: they do not claim to execute PostgreSQL.
function issuanceFixture({failReceiptReference=false,existingReference=null}={}){
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const payload=invoicePayload({date,placeOfSupply:'33',billTo:'SAMPLE billing address',shipTo:'SAMPLE shipping address',terms:'SAMPLE only',lines:[{code:'SAMPLE',description:'Sample control component',hsn:'8536',uom:'NOS',quantity:'2',unitPrice:'100.000000',taxPercent:'18'}]},{id:1,name:'SAMPLE customer'},{});
 payload.shipmentVersion=1;
 const record={id:'12345678-1234-4234-8234-123456789abc',source:'CRM',status:'APPROVED',version:3,created_by:1,approved_by:2,customer_id:1,shipment_id:10,settings_version:1,invoice_reference_id:existingReference,payload,number:null};
 const trace=[],created=[],initial=structuredClone(record);
 const db={
  withConnection:async fn=>fn(),
  exec:async sql=>{trace.push(sql);if(sql==='ROLLBACK')Object.assign(record,structuredClone(initial));},
  prepare:sql=>({
   get:async()=>{
    if(sql.startsWith('SELECT * FROM billing_documents'))return structuredClone(record);
    if(sql.startsWith('SELECT * FROM billing_document_settings'))return {version:1,value:{confirmed:true,crmIssuanceEnabled:true,irnRequired:false,prefix:'TST'}};
    if(sql.includes('FROM crm_shipments'))return {id:10,sales_order_id:1,order_status:'DISPATCHED',order_version:1,public_snapshot:{placeOfSupply:'33'}};
    if(sql.includes('FROM crm_customer_onboarding'))return {status:'APPROVED'};
    if(sql.includes('FROM customers'))return {id:1};
    if(sql.startsWith('INSERT INTO billing_document_counters')){trace.push('NUMBER');return {n:'1'};}
   },
   all:async()=>[{id:1,item_id:1,description:'Sample control component',uom:'NOS',unit_price:'100',discount_percent:'0',tax_percent:'18',quantity:'2',part_code:'SAMPLE',hsn:'8536'}],
   run:async(...args)=>{
    if(sql.startsWith('UPDATE billing_documents SET invoice_reference_id')){record.invoice_reference_id=args[0];trace.push('LINK');}
    else if(sql.startsWith('UPDATE billing_documents')){record.status=args[0];record.number=args[1];record.version++;trace.push('ISSUED');}
    if(sql.startsWith('INSERT INTO audit_logs'))trace.push('AUDIT');
   }
  })
 };
 const operations={create:async(user,kind,input)=>{
  assert.ok(trace.includes('BEGIN'));assert.ok(!trace.includes('COMMIT'));trace.push('REFERENCE');created.push({user,kind,input});
  if(failReceiptReference)throw new Error('SAMPLE reference failure');
  return {record:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}};
 }};
 return {db,record,trace,created,operations};
}
test('Issued CRM invoice joins the existing collection reference in the same transaction',async()=>{
 const f=issuanceFixture(),result=await act(f.db,{id:3,role:'OWNER'},f.record.id,{action:'ISSUE',version:3,reason:'SAMPLE issuance verification'},{operations:f.operations});
 assert.equal(result.status,'ISSUED');assert.equal(f.created.length,1);
 const {kind,input}=f.created[0];assert.equal(kind,'INVOICE');assert.equal(input.payload.invoiceNumber,result.number);
 assert.equal(input.payload.amount,'236.00');assert.equal(input.ownerId,1);assert.equal(input.backupId,2);
 assert.equal(input.customerId,1);assert.equal(input.payload.sourceReference,'CRM_INVOICE:'+f.record.id);
 assert.equal(f.record.invoice_reference_id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 assert.ok(f.trace.indexOf('NUMBER')<f.trace.indexOf('REFERENCE'));
 assert.ok(f.trace.indexOf('LINK')<f.trace.indexOf('ISSUED'));
 assert.ok(f.trace.indexOf('ISSUED')<f.trace.indexOf('COMMIT'));
 await assert.rejects(act(f.db,{id:3,role:'OWNER'},f.record.id,{action:'ISSUE',version:4,reason:'SAMPLE retry'},{operations:f.operations}),{status:409});
 assert.equal(f.created.length,1);
});
test('A collection-reference failure rolls back invoice issuance rather than leaving an unlinked issued bill',async()=>{
 const f=issuanceFixture({failReceiptReference:true});
 await assert.rejects(act(f.db,{id:3,role:'OWNER'},f.record.id,{action:'ISSUE',version:3,reason:'SAMPLE rollback verification'},{operations:f.operations}),/SAMPLE reference failure/);
 assert.ok(f.trace.includes('ROLLBACK'));assert.ok(!f.trace.includes('COMMIT'));
 assert.equal(f.record.status,'APPROVED');assert.equal(f.record.number,null);assert.equal(f.record.invoice_reference_id,null);
});
test('An invoice with an existing collection reference does not create a second receivable',async()=>{
 const f=issuanceFixture({existingReference:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});
 await act(f.db,{id:3,role:'OWNER'},f.record.id,{action:'ISSUE',version:3,reason:'SAMPLE existing reference'},{operations:f.operations});
 assert.equal(f.created.length,0);assert.equal(f.record.invoice_reference_id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
});
