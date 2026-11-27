import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {withAuthorizedRdsRollbackVerification} from '../test-support/transaction.js';
import {TransactionRunner} from '../src/core/runtime.js';
import {invoicePayload} from '../src/modules/billing/domain.js';
import {GstPreparationService} from '../src/modules/billing/gst-preparation.js';

const tag='ZZTEST_GST_'+randomUUID(),reason=tag+' rollback-only verification',checks=[];
await withAuthorizedRdsRollbackVerification(async db=>{
 const owner=await db.prepare("SELECT id,role FROM users WHERE role='OWNER' AND status='ACTIVE' ORDER BY id LIMIT 1").get();assert.ok(owner);
 const reviewer={id:(await db.prepare("INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(?,?,'OWNER','not-a-login',0) RETURNING id").get(tag,tag+'@example.test')).id,role:'OWNER'};
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const tx=new TransactionRunner(db),service=new GstPreparationService({db});
 let customer,source;
 await tx.run(owner,reason,async()=>{
  customer=await db.prepare('INSERT INTO customers(name,normalized_name,created_by,updated_by) VALUES(?,?,?,?) RETURNING id,name').get(tag,tag.toLowerCase(),owner.id,owner.id);
  // Explicit approved-snapshot fixture, rolled back. This does not issue or
  // approve a legal invoice and never changes live company commercial settings.
  const payload=invoicePayload({date,placeOfSupply:'33',billTo:'SAMPLE billing address',shipTo:'SAMPLE shipping address',lines:[{code:'SAMPLE',description:'SAMPLE component',hsn:'8536',uom:'NOS',quantity:'1',unitPrice:'100',taxPercent:'18'}],terms:'SAMPLE rollback-only terms'},{...customer,gstin:'33ABCDE1234F1Z5'},{name:'SAMPLE seller',stateCode:'33',gstin:'33ABCDE1234F1Z5'});
  await db.prepare("SELECT set_config('mehta.billing_write','authorized',true)").get();
  source=await db.prepare("INSERT INTO billing_documents(request_key,source,customer_id,invoice_date,payload,status,created_by,approved_by,settings_version) VALUES(?,'CRM',?,?,?::text::jsonb,'APPROVED',?,?,0) RETURNING *").get(randomUUID(),customer.id,date,JSON.stringify(payload),owner.id,reviewer.id);
 });
 const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS',name);};
 const body={requestKey:randomUUID(),kind:'IRN',sourceId:source.id,additional:{sellerPincode:'600001',buyerPincode:'600002'},reason};
 await check('GST preview validates the actual saved source while provider remains unconfigured',async()=>{const preview=await service.preview(owner,body);assert.deepEqual(preview.issues,[]);assert.equal(preview.provider.status,'NOT_CONFIGURED');});
 const record=await service.create(owner,body);
 await check('Repeated preparation returns the same record',async()=>assert.equal((await service.create(owner,body)).id,record.id));
 await check('A second active preparation cannot duplicate the same invoice and kind',()=>assert.rejects(service.create(owner,{...body,requestKey:randomUUID()}),{status:409}));
 await check('Preparation maker cannot approve their own source snapshot',()=>assert.rejects(service.decide(owner,record.id,{version:record.version,decision:'APPROVE',reason}),{status:403}));
 await check('Unreviewed preparation cannot be exported',()=>assert.rejects(service.export(owner,record.id,{reason}),{status:409}));
 let reviewed=await service.decide(reviewer,record.id,{version:record.version,decision:'APPROVE',reason});
 await check('Independent approval records internal readiness without government success',async()=>{assert.equal(reviewed.status,'READY_FOR_PROVIDER');const file=await service.export(owner,record.id,{reason});assert.equal(file.providerStatus,'NOT_CONFIGURED');assert.equal(file.statutorySubmission,false);assert.equal(file.requiresFinalNumberConfirmation,true);});
 await check('GST register renders as a genuine branded PDF',async()=>assert.equal((await service.pdf(owner,record.id,{reason,preview:true})).bytes.subarray(0,5).toString(),'%PDF-'));
 await tx.run(owner,reason,async()=>{await db.prepare("SELECT set_config('mehta.billing_write','authorized',true)").get();await db.prepare("UPDATE billing_documents SET payload=jsonb_set(payload,'{terms}',to_jsonb(?::text)),version=version+1 WHERE id=?").run('SAMPLE revised source terms',source.id);});
 await check('A source change blocks export of the previously reviewed snapshot',()=>assert.rejects(service.export(owner,record.id,{reason}),{status:409}));
 reviewed=await service.decide(owner,record.id,{version:reviewed.version,decision:'CANCEL',reason});assert.equal(reviewed.status,'CANCELLED');
 const transport={...body,requestKey:randomUUID(),kind:'EWAY',additional:{...body.additional,dispatchPincode:'600001',shipPincode:'600002',transportMode:'ROAD',distanceKm:'10',transporterReference:'SAMPLE TRANSPORT',vehicleNumber:'SAMPLE VEHICLE'}};
 await check('Missing road transport evidence prevents e-Way preparation',()=>assert.rejects(service.create(owner,{...transport,additional:body.additional}),{status:422}));
 const eway=await service.create(owner,transport);const approved=await service.decide(reviewer,eway.id,{version:eway.version,decision:'APPROVE',reason});
 await check('Reviewed e-Way preparation remains an internal record only',async()=>{assert.equal(approved.status,'READY_FOR_PROVIDER');assert.equal((await service.export(owner,eway.id,{reason})).statutorySubmission,false);});
},{productionTransactions:true});
await withAuthorizedRdsRollbackVerification(async db=>assert.equal((await db.prepare('SELECT count(*)::int AS n FROM customers WHERE name=?').get(tag)).n,0));
await fs.mkdir('verification-output/crm-completion',{recursive:true});
await fs.writeFile('verification-output/crm-completion/gst-rds.json',JSON.stringify({checks,passed:checks.length,cleanup:'ROLLBACK_VERIFIED',limitations:'Approved invoice snapshots and GST identifiers were fictional rollback-only fixtures. No invoice issuance, actual IRN/e-Way generation or provider call was performed.'},null,2));
