import {isTallyFinancial} from './tally-visibility-service.js';

/** Status is an interpretation of explicit persisted associations, never a name match. */
export function orderSyncState({job=null,conflict=null,reconciliation=null,source=null}={},financial=false){
 const base={status:'NOT_YET_SYNCED',company:job?{id:job.company_id,name:job.company_name}:conflict?{id:conflict.company_id,name:conflict.company_name}:null,
  lastSyncAt:source?.observed_at??null,lastAttemptAt:job?.started_at??job?.created_at??null,lastError:null,conflict:null,
  note:'No order-specific sync attempt is recorded. Presence in Tally is unknown; voucher names and numbers are not used to guess a match.'};
 if(conflict){base.status='CONFLICT';base.conflict={id:conflict.id,path:`/tally/conflicts?companyId=${conflict.company_id}&open=${conflict.id}`};base.note='An explicitly associated open conflict needs review.';}
 else if(job&&['FAILED','ERROR','QUARANTINED'].includes(job.status.toUpperCase())){base.status='FAILED';base.lastError=financial?job.error_detail:{code:'SYNC_FAILED',message:'An order-specific sync failed. Ask Owner or Accounts to inspect the error.'};base.note='Failure is recorded against this CRM order.';}
 else if(reconciliation?.status?.toUpperCase()==='MISMATCH'){base.status='MISMATCH';base.note='A persisted order-specific reconciliation reports a mismatch.';}
 else if(job&&['STORED','SUCCEEDED','SUCCESS','IN_TALLY'].includes(job.status.toUpperCase())&&source){base.status='IN_TALLY';base.note='A recorded order sync is associated with a stable Tally source identity in its company. This is not a claim that every business field was compared.';}
 else if(job){base.note='An order-specific attempt is recorded, but no successful stable source match is verified. Check the attempt and connector evidence.';}
 return base;
}
export async function orderSyncStates(db,ids,user){
 if(!ids.length)return new Map();
 const placeholders=ids.map(()=>'?').join(','),financial=isTallyFinancial(user);
 const jobs=await db.prepare(`SELECT DISTINCT ON(i.crm_sales_order_id) i.*,c.name AS company_name FROM tally_sync_job_items i JOIN tally_companies c ON c.id=i.company_id
  WHERE i.crm_sales_order_id IN (${placeholders}) ORDER BY i.crm_sales_order_id,i.created_at DESC,i.id DESC`).all(...ids);
 const conflicts=await db.prepare(`SELECT DISTINCT ON(f.crm_sales_order_id) f.id,f.company_id,c.name AS company_name,f.crm_sales_order_id FROM tally_conflicts f JOIN tally_companies c ON c.id=f.company_id
  WHERE f.crm_sales_order_id IN (${placeholders}) AND f.status='OPEN' ORDER BY f.crm_sales_order_id,f.created_at DESC,f.id DESC`).all(...ids);
 const reconciliations=await db.prepare(`SELECT DISTINCT ON(crm_sales_order_id) crm_sales_order_id,status,created_at FROM tally_reconciliations
  WHERE crm_sales_order_id IN (${placeholders}) ORDER BY crm_sales_order_id,created_at DESC,id DESC`).all(...ids);
 const result=new Map();
 for(const id of ids){
  const job=jobs.find(row=>row.crm_sales_order_id===id);
  const sources=job?await db.prepare(`SELECT observed_at FROM tally_visibility_current_cache WHERE company_id=? AND entity='vouchers'
   AND summary_fields->>'/stored/voucher_type'='Sales Order'
   AND (record_key=? OR summary_fields->>'/stored/guid'=? OR summary_fields->>'/stored/master_id'=? OR 'guid:'||(summary_fields->>'/stored/guid')=? OR 'master:'||(summary_fields->>'/stored/master_id')=?) LIMIT 2`).all(job.company_id,...Array(5).fill(job.external_id)):[];
  const source=sources.length===1?sources[0]:null;
  result.set(id,orderSyncState({job,source,conflict:conflicts.find(row=>row.crm_sales_order_id===id),reconciliation:reconciliations.find(row=>row.crm_sales_order_id===id)},financial));
 }
 return result;
}
