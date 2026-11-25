import {workflowRule} from '../rules/workflow-rules.js';
import {hasPermission} from '../../rbac.js';
import {financeAccess} from '../billing/service.js';

/** Credentials authenticate the sender; department settings assign business work.
 * Replays resolve their original receipt before this helper is called. */
export function selectDepartmentOwners(principal,department,rule,users,permissions,can=hasPermission){
 const fallback={ownerId:principal.ownerId,backupOwnerId:principal.backupOwnerId,routing:'INTEGRATION_DEFAULT'};
 const setting=rule?.value?.find(r=>r.companyId===principal.companyId&&r.department===department);
 if(!setting)return fallback;
 const ready=id=>{
  const user=users.find(u=>u.id===id);
  if(!user||user.status!=='ACTIVE'||user.on_leave||user.must_change_password||!permissions.every(p=>can(user,p)))return false;
  if(department==='ACCOUNTS'){try{financeAccess(user,true);}catch(error){if(error.status!==403)throw error;return false;}}
  return true;
 };
 if(setting.ownerUserId===setting.backupUserId||!ready(setting.ownerUserId)||!ready(setting.backupUserId))return {...fallback,routing:'DEPARTMENT_UNAVAILABLE'};
 return {ownerId:setting.ownerUserId,backupOwnerId:setting.backupUserId,routing:'DEPARTMENT_POLICY',ruleVersion:rule.version};
}
export async function departmentOwners(db,principal,department,permissions){
 const rule=await workflowRule(db,'intake.department_owners',false);
 const setting=rule?.value?.find(r=>r.companyId===principal.companyId&&r.department===department);
 if(!setting)return {ownerId:principal.ownerId,backupOwnerId:principal.backupOwnerId,routing:'INTEGRATION_DEFAULT'};
 const users=await db.prepare('SELECT id,role,status,on_leave,must_change_password FROM users WHERE id IN (?,?)').all(setting.ownerUserId,setting.backupUserId);
 return selectDepartmentOwners(principal,department,rule,users,permissions);
}
