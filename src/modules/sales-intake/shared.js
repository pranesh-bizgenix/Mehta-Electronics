import {TransactionRunner,AuditRepository} from '../../core/runtime.js';
import {NotificationRepository,NotificationService} from '../notifications/notification-service.js';
import {forbidden,validationFailed} from '../../core/errors.js';
import {hasPermission} from '../../rbac.js';
export const why=value=>{if(typeof value!=='string'||value.trim().length<3||value.length>2000)throw validationFailed('Provide a reason of 3 to 2,000 characters.');return value.trim();};
export const uuid=value=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw validationFailed('Use a valid UUID.');return value;};
export function permission(user,key){if(!user?.id||!hasPermission(user,key))throw forbidden();}
export async function salesWork(db,user,reason,fn){return new TransactionRunner(db).run(user,why(reason),async()=>{await db.prepare("SELECT pg_advisory_xact_lock(812731),set_config('mehta.sales_intake_write','authorized',true)").get();return fn();});}
export async function intakeEvent(db,row,user,action,reason,detail={},credentialId=null){
 await db.prepare('INSERT INTO crm_sales_intake_events(intake_id,company_id,action,actor_id,credential_id,reason,detail) VALUES(?,?,?,?,?,?,?::text::jsonb)').run(row.id??null,row.company_id,action,user?.id??null,credentialId,why(reason),JSON.stringify(detail));
 // Operational evidence stays on the restricted intake timeline. The shared
 // audit contains identifiers and decisions, never response/source contents.
 const {evidenceReference,...auditDetail}=detail;
 await new AuditRepository(db).record({actorId:user?.id??null,entity:'SALES_INTAKE',recordId:row.id??row.company_id,action,reason,newValue:{companyId:row.company_id,...auditDetail,...(credentialId?{credentialId}:{})}});
}
export async function notifySales(db,intakeId,type,key){
 const row=await db.prepare('SELECT i.id,i.assigned_to,i.enquiry_id,i.quotation_id,u.role,u.status FROM crm_sales_intakes i LEFT JOIN users u ON u.id=i.assigned_to WHERE i.id=?').get(intakeId);
 if(!row?.assigned_to||row.status!=='ACTIVE')return;
 const entityType=row.quotation_id?'QUOTATION':row.enquiry_id?'ENQUIRY':'SALES_INTAKE',entityId=String(row.quotation_id??row.enquiry_id??row.id);
 const needed=entityType==='QUOTATION'?'quotations.read':entityType==='ENQUIRY'?'enquiries.read':'sales_intake.read';
 if(!hasPermission({role:row.role},needed))return;
 await new NotificationService({repository:new NotificationRepository(db)}).notify(row.assigned_to,{type,title:type.replaceAll('_',' '),message:'Open the linked CRM record for the current request and its review history.',entityType,entityId},`sales-intake:${row.id}:${key}`);
}
