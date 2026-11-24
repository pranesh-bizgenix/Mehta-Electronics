import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapMakeSalesDelivery,makeSalesReceipt} from '../src/modules/sales-intake/make-adapter.js';
import {normalizeIntake} from '../src/modules/sales-intake/contract.js';
import {mergeReviewResolutions} from '../src/modules/sales-intake/review.js';
import {validateSalesIntakePolicy} from '../src/modules/sales-intake/policy.js';

const fixture=(i=0)=>({companyId:'11111111-1111-4111-8111-111111111111',mailbox:'sample@example.test',providerMessageId:'SAMPLE_MESSAGE_'+i,receivedAt:'2026-11-23T04:00:00Z',originalText:'SAMPLE source text',staged:{email_message_id:'SAMPLE',review_reasons:[],crm_payload:{department:'SALES',sales_type:'PO_RECEIVED',documents:[{source:{sha256:'a'.repeat(64)},review_reasons:[],data:{document_type:'PO',currency:'INR',po_number:'SAMPLE_PO_'+i,po_date:'2026-11-23',buyer_company_name:'Sample buyer',supplier_vendor_name:'Sample supplier',billing_address:'Sample billing',delivery_address:'Sample shipping',gst_number:'33ZZZZZ1234Z1Z5',contact_person:'Sample contact',email:'sample@example.test',phone_number:'12345',total_po_value:118,delivery_date:'2026-12-01',payment_terms:'Customer supplied sample terms',other_terms_conditions:'Customer supplied sample instructions',items:[{item_description:'Sample terminal',product_material_code:'SAMPLE_ITEM',hsn_sac_code:'8536',quantity:1,unit_of_measurement:'NOS',unit_price:100,discount:'0%',gst_rate:18,taxable_amount:100}]}}]}}});
for(let i=0;i<10;i++)test('Make PO '+(i+1)+': maps 23 fields to a valid exact CRM envelope and stable retry identity',()=>{
 const input=fixture(i),before=JSON.stringify(input),delivery=mapMakeSalesDelivery(input).deliveries[0],raw=JSON.parse(delivery.body),n=normalizeIntake(raw);
 assert.equal(n.messageType,'CUSTOMER_PO');assert.equal(n.header.poNumber,'SAMPLE_PO_'+i);assert.equal(n.items[0].unitPrice,'100');assert.equal(n.items[0].quantity,'1');assert.equal(n.items[0].discount.kind,'PERCENT');assert.deepEqual(n.reviewIssues,undefined);assert.equal(mapMakeSalesDelivery(input).deliveries[0].eventId,delivery.eventId);assert.equal(JSON.stringify(input),before);
});
test('Ambiguous values become explicit review issues, never fabricated dates, totals or discounts',()=>{
 const input=fixture(),data=input.staged.crm_payload.documents[0].data;data.po_date='01/02/26';data.gst_number='Buyer and supplier GSTINs';data.items[0].discount='10';data.items[0].unit_price=0.0000001;data.currency=null;
 const n=normalizeIntake(JSON.parse(mapMakeSalesDelivery(input).deliveries[0].body));assert.equal(n.header.poDate,null);assert.equal(n.header.gstin,null);assert.equal(n.items[0].discount,null);assert.equal(n.items[0].unitPrice,null);assert.ok(n.reviewIssues.length>=5);assert.ok(n.source.originalText.includes('01/02/26'));
});
test('Multiple documents retain distinct source identities and never combine unrelated POs',()=>{
 const input=fixture(),other=structuredClone(input.staged.crm_payload.documents[0]);other.source.sha256='b'.repeat(64);other.data.po_number='SAMPLE_OTHER_PO';input.staged.crm_payload.documents.push(other);
 const deliveries=mapMakeSalesDelivery(input).deliveries;assert.equal(deliveries.length,2);assert.notEqual(deliveries[0].eventId,deliveries[1].eventId);assert.notEqual(normalizeIntake(JSON.parse(deliveries[0].body)).source.messageId,normalizeIntake(JSON.parse(deliveries[1].body)).source.messageId);
});
test('Unclear extraction survives as a review request; source-review acknowledgement is validated',()=>{
 const input=fixture();input.staged.crm_payload.documents=[{data:null,needs_review:true,review_reasons:['UNREADABLE_SOURCE']}];
 const n=normalizeIntake(JSON.parse(mapMakeSalesDelivery(input).deliveries[0].body)),row={normalized:n,resolutions:{}};assert.ok(n.reviewIssues.includes('UNREADABLE_SOURCE'));assert.equal(n.items.length,0);
 assert.deepEqual(mergeReviewResolutions(row,{reviewedSourceIssues:[0]}).reviewedSourceIssues,[0]);
 for(const indexes of [[-1],[999],[0,0],['0'],null])assert.throws(()=>mergeReviewResolutions(row,{reviewedSourceIssues:indexes}),{status:422});
 const cleared={...JSON.parse(mapMakeSalesDelivery(input).deliveries[0].body),reviewIssues:[]};assert.notEqual(normalizeIntake(cleared).businessHash,n.businessHash);
});
test('Quotation requests and leads do not receive invented PO identifiers or prices',()=>{
 for(const [sales_type,document_type,messageType]of [['QUOTATION_REQUEST','QUOTATION_REQUEST','QUOTATION_REQUEST'],['LEAD','LEAD','LEAD_ENQUIRY']]){const input=fixture();input.staged.crm_payload.sales_type=sales_type;input.staged.crm_payload.documents=[{data:{document_type,items:[]}}];const n=normalizeIntake(JSON.parse(mapMakeSalesDelivery(input).deliveries[0].body));assert.equal(n.messageType,messageType);assert.equal(n.header.poNumber,null);assert.equal(n.header.totalPoValue,null);}
});
test('No source time, unsupported department or excessive lines fails without silently dropping data',()=>{
 const input=fixture();delete input.receivedAt;assert.throws(()=>mapMakeSalesDelivery(input),/receipt time/);
 input.receivedAt='2026-11-23T04:00:00Z';input.staged.crm_payload.department='ACCOUNTS';assert.throws(()=>mapMakeSalesDelivery(input),/Sales/);
 input.staged.crm_payload.department='SALES';input.staged.crm_payload.documents[0].data.items=Array(101).fill({});assert.throws(()=>mapMakeSalesDelivery(input),/no lines were discarded/);
});
test('Existing customer owner with explicit fallback is configurable without changing fixed assignment',()=>{
 assert.deepEqual(validateSalesIntakePolicy({assignment:{mode:'CUSTOMER_OWNER',fallbackUserId:49}}).assignment,{mode:'CUSTOMER_OWNER',fallbackUserId:49});
 assert.throws(()=>validateSalesIntakePolicy({assignment:{mode:'FIXED',userId:49,fallbackUserId:49}}),{status:422});
});
test('Make receipt records only IDs after a valid CRM acknowledgement',()=>{
 const id='11111111-1111-4111-8111-111111111111',receipt={id,status:'NEEDS_REVIEW',duplicate:false};
 for(const response of [{statusCode:201,data:{data:receipt}},{statusCode:200,body:JSON.stringify({data:{...receipt,duplicate:true}})}])assert.equal(makeSalesReceipt(response,id).requestId,id);
 for(const response of [{statusCode:401,data:{error:'No access'}},{statusCode:200,data:{}},{statusCode:500,data:{data:receipt}}])assert.throws(()=>makeSalesReceipt(response,id),/not acknowledged/);
 assert.throws(()=>makeSalesReceipt({statusCode:201,data:{data:receipt}},"';DROP"),/not acknowledged/);
});

for(const name of ['Purchase Order 01.pdf','MEHTA 4600778676.pdf','PO 018 DT 07.08.2026.pdf','Mehta -17.11.2026.xlsx','two  spaces.pdf',' leading.pdf','trailing .pdf','already%20encoded.pdf','tab\tname.pdf','unicode\u00a0space.pdf'])test('Attachment location retains the S3 key with URI-safe whitespace: '+JSON.stringify(name),()=>{
 const input=fixture();input.attachments=[{id:'sample-attachment',name,mimeType:'application/pdf',bytes:'100',sha256:'a'.repeat(64),storageReference:'s3://sample-bucket/attachments/'+name}];
 const original=JSON.stringify(input),n=normalizeIntake(JSON.parse(mapMakeSalesDelivery(input).deliveries[0].body)),reference=n.source.attachments[0].storageReference;
 assert.equal(reference,'s3://sample-bucket/attachments/'+name.replace(/\s/gu,c=>encodeURIComponent(c)));assert.equal(/\s/u.test(reference),false);assert.equal(JSON.stringify(input),original);
});

test('Whitespace normalization never admits a non-S3 attachment URL',()=>{
 const input=fixture();input.attachments=[{id:'sample',name:'sample.pdf',mimeType:'application/pdf',bytes:1,sha256:'a'.repeat(64),storageReference:'https://sample.example/a b.pdf'}];
 assert.throws(()=>normalizeIntake(JSON.parse(mapMakeSalesDelivery(input).deliveries[0].body)),{status:422});
});

test('Already queued Make deliveries accept URI-safe normalization without changing their event identity',()=>{
 const raw=JSON.parse(mapMakeSalesDelivery(fixture()).deliveries[0].body);raw.source.attachments=[{id:'sample',name:'Purchase Order.pdf',mimeType:'application/pdf',bytes:100,sha256:'a'.repeat(64),storageReference:'s3://sample-bucket/Purchase Order.pdf'}];
 const before=JSON.stringify(raw),n=normalizeIntake(raw);assert.equal(n.source.attachments[0].storageReference,'s3://sample-bucket/Purchase%20Order.pdf');assert.equal(n.eventId,raw.eventId);assert.equal(JSON.stringify(raw),before);
});
