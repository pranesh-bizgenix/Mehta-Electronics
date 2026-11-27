import {s,validate} from '../../core/schema.js';
import {fingerprint} from '../../core/runtime.js';
import {hasPermission} from '../../rbac.js';
import {conflict,forbidden,notFound,validationFailed} from '../../core/errors.js';
import {validateFieldVisit,fieldVisitEnd,FIELD_VISIT_NOTE} from './field-visit-domain.js';
const publicVisit=row=>{const {request_key,request_hash,...visible}=row;return visible;};
export class FieldVisitService{
 constructor({db,customers,clock}){this.db=db;this.customers=customers;this.clock=clock||{now:()=>new Date()};}
 async current(actor){this.customers.permission(actor,'customers.read');return {data:await this.db.prepare("SELECT v.id,v.customer_id,c.name AS customer_name,v.title,v.checked_in_at,v.version FROM crm_field_visits v JOIN customers c ON c.id=v.customer_id WHERE v.staff_id=? AND v.status='IN_PROGRESS'").get(actor.id)||null,note:FIELD_VISIT_NOTE};}
 async list(actor,customerId,page=1){page=validate(s.int({min:1,max:100000}),page);const ids=(await this.customers.context(actor,customerId)).customerIds;return {data:await this.db.prepare('SELECT v.*,v.latitude::text AS latitude,v.longitude::text AS longitude,v.accuracy_metres::text AS accuracy_metres,u.name AS staff_name FROM crm_field_visits v JOIN users u ON u.id=v.staff_id WHERE v.customer_id=ANY(?::integer[]) AND (?::boolean OR v.staff_id=?) ORDER BY v.checked_in_at DESC,v.id LIMIT 25 OFFSET ?').all(ids,hasPermission(actor,'work.reassign'),actor.id,(page-1)*25).then(rows=>rows.map(publicVisit)),page,pageSize:25,note:FIELD_VISIT_NOTE};}
 async start(actor,customerId,body){const b=validateFieldVisit(body,this.clock.now(),{fresh:false}),hash=fingerprint({customerId,...b,reason:undefined});return this.customers.run(actor,b.reason,async()=>{
  await this.customers.access(actor,customerId,{write:true});await this.db.prepare("SELECT pg_advisory_xact_lock(812739,?),set_config('mehta.field_visit_write','authorized',true)").get(actor.id);
  const old=await this.db.prepare('SELECT * FROM crm_field_visits WHERE request_key=?').get(b.requestKey);if(old){if(old.request_hash!==hash||old.staff_id!==actor.id)throw conflict('This retry key belongs to different visit details.');return publicVisit(old);}
  validateFieldVisit(b,this.clock.now());
  if(await this.db.prepare("SELECT id FROM crm_field_visits WHERE staff_id=? AND status='IN_PROGRESS'").get(actor.id))throw conflict('Finish or cancel your current visit before starting another.');
  const row=await this.db.prepare('INSERT INTO crm_field_visits(request_key,request_hash,customer_id,staff_id,title,location_source,location_note,latitude,longitude,accuracy_metres,device_captured_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?::timestamptz,?) RETURNING *').get(b.requestKey,hash,customerId,actor.id,b.title,b.locationSource,b.locationNote,b.latitude??null,b.longitude??null,b.accuracyMetres??null,b.capturedAt??null,actor.id);
  await this.customers.audit(actor,'FIELD_VISIT',row.id,'CHECK_IN',null,{customerId,staffId:actor.id,locationSource:b.locationSource},b.reason);return publicVisit(row);
 });}
 async finish(actor,customerId,recordId,body){const b=validate(fieldVisitEnd,body);if(b.notes.trim().length<3||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(b.notes+b.reason))throw validationFailed('Visit notes contain unsupported control characters.');return this.customers.run(actor,b.reason,async()=>{
  await this.customers.access(actor,customerId);this.customers.permission(actor,'customers.update');await this.db.prepare("SELECT set_config('mehta.field_visit_write','authorized',true)").get();
  const row=await this.db.prepare('SELECT * FROM crm_field_visits WHERE id=? AND customer_id=? FOR UPDATE').get(validate(s.uuid(),recordId),customerId);if(!row)throw notFound('Visit not found.');if(row.staff_id!==actor.id&&(b.action!=='CANCEL'||!hasPermission(actor,'work.reassign')))throw forbidden('Only the checked-in staff member can finish a visit. A supervisor may cancel with a reason.');
  if(row.status!=='IN_PROGRESS'||row.version!==b.version)throw conflict('Visit changed or has already ended. Reload its history.');
  let activityId=null;if(b.action==='COMPLETE'){
   // Finish under the existing customer write context even if this customer was
   // merged during a visit; preserve its original identity and source history.
   const activity=await this.db.prepare("INSERT INTO crm_customer_activities(customer_id,kind,title,notes,occurred_at,owner_id,created_by,updated_by) VALUES(?,'VISIT',?,?,?, ?,?,?) RETURNING id").get(customerId,row.title,b.notes,row.checked_in_at,row.staff_id,actor.id,actor.id);activityId=activity.id;await this.customers.audit(actor,'CUSTOMER_ACTIVITY',activityId,'CREATE',null,{customerId,kind:'VISIT',fieldVisitId:row.id},b.reason);
  }
  const saved=await this.db.prepare("UPDATE crm_field_visits SET status=?,checked_out_at=clock_timestamp(),activity_id=?,closing_note=?,version=version+1,updated_by=?,updated_at=clock_timestamp() WHERE id=? RETURNING *").get(b.action==='COMPLETE'?'COMPLETED':'CANCELLED',activityId,b.notes,actor.id,row.id);await this.customers.audit(actor,'FIELD_VISIT',row.id,b.action,null,{customerId,staffId:row.staff_id,activityId,version:saved.version},b.reason);return publicVisit(saved);
 });}
}
