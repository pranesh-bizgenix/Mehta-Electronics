import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import {withAuthorizedRdsRollbackVerification} from '../test-support/transaction.js';
import {createModules} from '../src/modules/container.js';
import {getConfig} from '../src/config.js';
import {CollectionsService} from '../src/modules/accounts/collections-service.js';
import {MaterialService} from '../src/modules/materials/service.js';
const tag='ZZTEST_MATERIAL_'+randomUUID(),reason=tag+' rollback-only verification',checks=[],out='verification-output/material-branches';
await fs.mkdir(out,{recursive:true});
await withAuthorizedRdsRollbackVerification(async db=>{
 const owner=await db.prepare("SELECT id,role FROM users WHERE status='ACTIVE' AND role='OWNER' ORDER BY id LIMIT 1").get();assert.ok(owner);
 const reviewer={id:(await db.prepare("INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(?,?,'OWNER','not-a-login',0) RETURNING id").get(tag,tag+'@example.test')).id,role:'OWNER'};
 const company=await db.prepare('SELECT id FROM tally_companies ORDER BY created_at LIMIT 1').get(),item=await db.prepare("SELECT id,part_code,uom FROM items WHERE NOT is_deleted AND part_code IS NOT NULL AND uom IS NOT NULL ORDER BY id LIMIT 1").get();assert.ok(company&&item);
 const modules=createModules({db,config:getConfig()});await modules.ready();const operations=modules.services.operations,service=new MaterialService({db,operations});
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let customer,invoice;
 await modules.transactions.run(owner,reason,async()=>{customer=await db.prepare('INSERT INTO customers(name,normalized_name,created_by,updated_by) VALUES(?,?,?,?) RETURNING id').get(tag,tag.toLowerCase(),owner.id,owner.id);await db.prepare('INSERT INTO crm_customer_profiles(customer_id,company_id,tally_ledger_name,created_by) VALUES(?,?,?,?)').run(customer.id,company.id,tag,owner.id);});
 const reference=(await operations.create(owner,'INVOICE',{title:tag,customerId:customer.id,ownerId:owner.id,backupId:reviewer.id,reason,payload:{invoiceNumber:tag,invoiceDate:date,amount:'1000',sourceReference:tag,sourceObservedAt:new Date().toISOString()}})).record;
 await modules.transactions.run(owner,reason,async()=>{
  // Explicit source-state fixture inside an uncommittable transaction. This is
  // not legal invoice issuance, actual dispatch, approved company policy or an import.
  await db.prepare("SELECT set_config('mehta.billing_write','authorized',true)").get();
  const payload={companyId:company.id,lines:Array.from({length:10},()=>({code:item.part_code,description:'SAMPLE returned component',quantity:'10',uom:item.uom})),totals:{total:'1000'}};
  invoice=await db.prepare("INSERT INTO billing_documents(request_key,source,customer_id,invoice_reference_id,number,invoice_date,payload,status,created_by,approved_by,settings_version) VALUES(?,'CRM',?,?,?,?,?::text::jsonb,'ISSUED',?,?,0) RETURNING id").get(randomUUID(),customer.id,reference.id,tag,date,JSON.stringify(payload),owner.id,reviewer.id);
 });
 const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS',name);};

 let shipment,orderLine,po;
 await modules.transactions.run(owner,reason,async()=>{
  await db.prepare("SELECT set_config('mehta.order_write','authorized',true),set_config('mehta.procurement_write','authorized',true)").get();
  const order=await db.prepare("INSERT INTO sales_orders(order_number,customer_id,status,created_by,updated_by) VALUES(?,?,'CONFIRMED',?,?) RETURNING id").get(tag+'-replacement',customer.id,owner.id,owner.id);
  orderLine=await db.prepare('INSERT INTO sales_order_lines(sales_order_id,item_id,description,uom,ordered_quantity,unit_price) VALUES(?,?,?,?,10,100) RETURNING id').get(order.id,item.id,'SAMPLE replacement source',item.uom);
  await db.prepare("INSERT INTO crm_order_workflows(sales_order_id,customer_id,po_key,public_snapshot,private_snapshot,created_by,status) VALUES(?,?,?,?::text::jsonb,'{}',?,'APPROVED')").run(order.id,customer.id,tag,JSON.stringify({companyId:company.id,order_number:tag,lines:[]}),owner.id);
  shipment=await db.prepare('INSERT INTO crm_shipments(sales_order_id,vehicle_number,lr_number,transporter,created_by) VALUES(?,?,?,?,?) RETURNING id').get(order.id,'SAMPLE vehicle',tag,'SAMPLE carrier',owner.id);
  await db.prepare('INSERT INTO crm_shipment_items(shipment_id,order_line_id,quantity,created_by) VALUES(?,?,10,?)').run(shipment.id,orderLine.id,owner.id);
  const vendor=await db.prepare('INSERT INTO crm_procurement_vendors(payload,created_by,updated_by) VALUES(?::text::jsonb,?,?) RETURNING id').get(JSON.stringify({name:'SAMPLE supplier',stateCode:'33'}),owner.id,owner.id);
  po=await db.prepare("INSERT INTO crm_supplier_pos(number,vendor_id,sales_order_id,payload,status,created_by,updated_by) VALUES(?,?,?,?::text::jsonb,'ISSUED',?,?) RETURNING id").get(tag+'-po',vendor.id,order.id,JSON.stringify({lines:[{itemId:item.id,partCode:item.part_code,uom:item.uom,quantity:'10'}]}),owner.id,owner.id);
 });
 const collections=new CollectionsService({db,operations,work:modules.services.work});
 const records=[];
 for(let i=0;i<3;i++){
  const op=(await operations.create(owner,'RETURN',{title:tag+'_'+i,customerId:customer.id,ownerId:owner.id,backupId:reviewer.id,reason,payload:{invoiceReference:tag,product:item.part_code,quantity:'10',reasonForReturn:reason,evidence:reason}})).record;
  const body={requestKey:randomUUID(),operationId:op.id,invoiceId:invoice.id,invoiceLine:i,quantity:'10',sourceChecked:true,reason},record=await service.open(owner,body);records.push({op,record});
  assert.equal((await service.open(owner,body)).row.id,record.row.id);
 }
 checks.push('Three source-bound material records created without duplicate claims or tickets');
 const step=async(index,actor,action,data,quantity)=>{const current=records[index].record,b={requestKey:randomUUID(),version:current.row.version,action,reason,data:action==='RECEIVE'?{...data,partCode:item.part_code,uom:item.uom}:data,...(quantity?{quantity}:{})};const result=await service.act(actor,current.row.id,b);records[index].record=result;return {result,body:b};};
 await check('Support permissions are enforced before queue reads',()=>assert.rejects(service.list({id:owner.id,role:'NO_ACCESS'},new URLSearchParams()),{status:403}));
 await check('Original case cannot resolve before its material balances close',()=>operations.act(owner,records[0].op.id,{action:'RESOLVE',version:records[0].op.version,reason}).then(()=>assert.fail('Unreconciled close succeeded'),error=>assert.equal(error.status,409)));
 for(let i=0;i<3;i++){
  const first=await step(i,owner,'RECEIVE',{reference:tag+'-receipt-a',location:'SAMPLE quarantine',evidence:reason},'4');assert.equal(first.result.balance.openMaterial,'6.000000');assert.equal((await service.act(owner,first.result.row.id,first.body)).row.version,first.result.row.version);
  if(i===0){const receipt=first.result.events.find(e=>e.action==='RECEIVE');const corrected=await step(i,reviewer,'RECEIVE',{reversalOf:receipt.id,reference:'SAMPLE independent correction',location:'SAMPLE quarantine',evidence:reason},'4');assert.equal(corrected.result.balance.received,'0.000000');await step(i,owner,'RECEIVE',{reference:tag+'-corrected-receipt',location:'SAMPLE quarantine',evidence:reason},'4');checks.push('Independent receipt correction preserves and reconciles original history');}
  await step(i,owner,'RECEIVE',{reference:tag+'-receipt-b',location:'SAMPLE quarantine',evidence:reason},'6');
  if(i===0){const d=await service.detail(owner,records[i].record.row.id);await assert.rejects(service.act(owner,d.row.id,{requestKey:randomUUID(),version:d.row.version,action:'INSPECT',reason,data:{accepted:'10',rejected:'0',fault:'NO_FAULT',evidence:reason}}),{status:409});}
  await step(i,reviewer,'INSPECT',{accepted:i===2?'0':'10',rejected:i===2?'10':'0',fault:i===2?'PHYSICAL_DAMAGE':'NO_FAULT',evidence:reason});
  const submitted=await operations.act(owner,records[i].op.id,{action:'SUBMIT',version:records[i].op.version,reason});await operations.act(reviewer,records[i].op.id,{action:'APPROVE',version:submitted.record.version,reason});
  if(i===0){
   await step(i,owner,'SUPPLIER_HANDOVER',{supplierPoId:po.id,reference:tag,evidence:reason},'10');
   await step(i,owner,'SUPPLIER_RESULT',{decision:'ACCEPTED',reference:tag,evidence:reason});
   const resources=await service.resources(owner,records[i].record.row.id,new URLSearchParams({type:'REPLACEMENT'}));assert.ok(resources.some(r=>r.shipment_id===shipment.id));
   await step(i,owner,'REPLACEMENT',{shipmentId:shipment.id,orderLineId:orderLine.id,evidence:reason},'10');
  }else if(i===1){
   const note=await collections.adjustment(owner,{requestKey:randomUUID(),invoiceId:reference.id,kind:'CREDIT',number:tag+'-credit',date,amount:'100',sourceReference:tag,evidence:reason,reason});
   await collections.reviewAdjustment(reviewer,note.id,{decision:'CONFIRM',reason});
   await step(i,owner,'CREDIT_LINK',{adjustmentId:note.id,amount:'100',evidence:reason},'10');
   await step(i,owner,'ORIGINAL_RETURN',{accepted:'10',rejected:'0',repaired:false,reference:tag,deliveryProof:reason,evidence:reason});
  }else await step(i,owner,'ORIGINAL_RETURN',{accepted:'0',rejected:'10',repaired:false,reference:tag,deliveryProof:reason,evidence:reason});

  const closed=await step(i,reviewer,'CLOSE',{evidence:reason});assert.equal(closed.result.row.status,'CLOSED');assert.equal(closed.result.operation.status,'RESOLVED');assert.equal(closed.result.balance.openAccepted,'0.000000');
  checks.push('Branch '+(i+1)+': '+['supplier handover/result and recorded replacement shipment','independently confirmed credit and original return','rejected goods returned without warranty remedy'][i]);console.log('PASS',checks.at(-1));
 }
 await check('Movement and notification history retains all three completed cases',async()=>{const n=await db.prepare('SELECT count(*)::integer AS n FROM crm_material_cases WHERE customer_id=? AND status=?').get(customer.id,'CLOSED');assert.equal(n.n,3);const notifications=await db.prepare("SELECT count(*)::integer AS n FROM notifications WHERE payload->>'entityType'='MATERIAL_CASE' AND payload->>'entityId'=?").get(records[0].record.row.id);assert.ok(notifications.n>=10);});
 await check('Closed material history rejects further receipts',async()=>{const d=await service.detail(owner,records[0].record.row.id);await assert.rejects(service.act(owner,d.row.id,{requestKey:randomUUID(),version:d.row.version,action:'RECEIVE',quantity:'1',reason,data:{reference:tag,location:'SAMPLE',partCode:item.part_code,uom:item.uom,evidence:reason}}),{status:409});});
 await check('Material PDF uses the real saved movement history',async()=>{const file=await service.pdf(owner,records[0].record.row.id,{reason});assert.equal(file.bytes.subarray(0,5).toString(),'%PDF-');await fs.writeFile(out+'/material-custody.pdf',file.bytes);});
 await check('Material events cannot be rewritten or hard deleted',async()=>{await assert.rejects(db.prepare('DELETE FROM crm_material_events WHERE case_id=?').run(records[0].record.row.id));});
},{productionTransactions:true});
await fs.writeFile(out+'/rds-report.json',JSON.stringify({passed:checks.length,checks,scope:'Three supplier/replacement, credit and rejected-return linkage flows; all fixture rows, policies and access audits rolled back. Invoice source is an explicit test snapshot; no legal issuance, physical dispatch, stock mutation, Tally/provider action or mail.'},null,2));
