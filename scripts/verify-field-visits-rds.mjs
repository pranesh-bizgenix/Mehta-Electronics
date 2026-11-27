import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {randomUUID} from 'node:crypto';
import {withAuthorizedRdsRollbackVerification} from '../test-support/transaction.js';
import {createModules} from '../src/modules/container.js';import {getConfig} from '../src/config.js';
import {CustomerManagementService} from '../src/modules/customers/service.js';
import {FieldVisitService} from '../src/modules/customers/field-visit-service.js';
const tag='ZZTEST_VISIT_'+randomUUID(),reason=tag+' rollback verification',checks=[],pass=label=>{checks.push(label);console.log('PASS',label);};
for(let i=0;i<10;i++)await withAuthorizedRdsRollbackVerification(async db=>{
 const owner=await db.prepare("SELECT id,role FROM users WHERE role='OWNER' AND status='ACTIVE' ORDER BY id LIMIT 1").get();assert.ok(owner);
 const modules=i===0?createModules({db,config:getConfig()}):null;if(modules)await modules.ready();const customers=modules?.services.customerManagement||new CustomerManagementService({db});let staff,customer;
 await customers.transactions.run(owner,reason,async()=>{staff={id:(await db.prepare("INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(?,?,'OWNER','not-a-login',0) RETURNING id").get(tag,tag+'@example.test')).id,role:'OWNER'};customer=await db.prepare('INSERT INTO customers(name,normalized_name,owner_id,created_by,updated_by) VALUES(?,?,?,?,?) RETURNING id').get(tag,tag.toLowerCase(),staff.id,owner.id,owner.id);});
 const service=new FieldVisitService({db,customers});
 if(i===0){await assert.rejects(service.current({id:staff.id,role:'NO_ACCESS'}),{status:403});pass('Users without customer access cannot read visit state');}
 assert.equal((await service.current(staff)).data,null);
 const ids=[];
 {
  const body={requestKey:randomUUID(),title:'SAMPLE customer visit '+i,locationSource:i===1?'BROWSER':'MANUAL_NOTE',locationNote:'SAMPLE meeting location',reason,...(i===1?{latitude:'13.082680',longitude:'80.270718',accuracyMetres:'15.25',capturedAt:new Date().toISOString()}:{})};
  const row=await service.start(staff,customer.id,body);ids.push(row.id);assert.equal(row.staff_id,staff.id);assert.equal(row.request_hash,undefined);assert.equal((await service.current(staff)).data.id,row.id);
  if(i===1){const later=new FieldVisitService({db,customers,clock:{now:()=>new Date(Date.now()+360000)}});assert.equal((await later.start(staff,customer.id,body)).id,row.id);pass('A delayed retry of an already saved GPS visit returns its original record');}
  if(i===0){
   assert.equal((await service.start(staff,customer.id,body)).id,row.id);await assert.rejects(service.start(staff,customer.id,{...body,requestKey:randomUUID()}),{status:409});pass('A repeated start is idempotent and a second simultaneous visit is refused');
   await assert.rejects(service.finish(owner,customer.id,row.id,{version:row.version,action:'COMPLETE',notes:'SAMPLE cannot impersonate visit completion',reason}),{status:403});pass('Supervisors cannot claim another staff member completed a visit');
   await assert.rejects(service.finish(staff,customer.id,row.id,{version:row.version+1,action:'COMPLETE',notes:'SAMPLE stale version',reason}),{status:409});pass('Stale visit changes are rejected');
  }
  const cancelled=i===9,ended=await service.finish(cancelled?owner:staff,customer.id,row.id,{version:row.version,action:cancelled?'CANCEL':'COMPLETE',notes:'SAMPLE visit outcome '+i,reason});assert.equal(ended.status,cancelled?'CANCELLED':'COMPLETED');assert.ok(new Date(ended.checked_out_at)>=new Date(ended.checked_in_at));
  if(!cancelled){const activity=await db.prepare('SELECT customer_id,kind,owner_id,notes FROM crm_customer_activities WHERE id=?').get(ended.activity_id);assert.equal(activity.customer_id,customer.id);assert.equal(activity.owner_id,staff.id);assert.equal(activity.kind,'VISIT');assert.equal(activity.notes,'SAMPLE visit outcome '+i);}else assert.equal(ended.activity_id,null);
  await assert.rejects(service.finish(staff,customer.id,row.id,{version:ended.version,action:'COMPLETE',notes:'SAMPLE duplicate close',reason}),{status:409});
  pass('Visit '+(i+1)+': '+(cancelled?'supervisor cancellation retains history without a completed activity':'check-in, check-out and one linked customer activity'));
 }
 assert.equal((await service.current(staff)).data,null);const listed=await service.list(owner,customer.id);assert.equal(listed.data.length,1);assert.equal(listed.data.some(r=>r.request_hash!==undefined),false);if(i===0)pass('Visit history is visible with internal retry hashes omitted');
 const audits=await db.prepare("SELECT new_value FROM audit_logs WHERE entity='FIELD_VISIT' AND record_id=ANY(?::text[])").all(ids);assert.equal(audits.length,2);assert.equal(audits.some(a=>/latitude|longitude|13\.082680/.test(String(a.new_value))),false);if(i===0)pass('Existing audit log records visit actions without location coordinates');
 await assert.rejects(db.prepare('DELETE FROM crm_field_visits WHERE id=?').run(ids[0]));if(i===0)pass('Visit history cannot be hard deleted');
},{productionTransactions:true});
await fs.mkdir('verification-output/field-visits',{recursive:true});await fs.writeFile('verification-output/field-visits/rds-report.json',JSON.stringify({passed:checks.length,checks,scope:'Ten independent synthetic field-visit scenarios, each in its own uncommittable RDS transaction so customer-write advisory locks are released between cases; every fixture and audit rolled back. Browser GPS is device evidence, not independently verified attendance.'},null,2));console.log(JSON.stringify({passed:checks.length,rolledBack:true}));
