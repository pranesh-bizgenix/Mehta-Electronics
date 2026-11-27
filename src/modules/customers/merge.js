import {fingerprint} from '../../core/runtime.js';
import {conflict,forbidden,notFound,validationFailed} from '../../core/errors.js';
import {customerIdentity} from './identity.js';

export async function mergePreview(service,user,sourceId,targetId){
 if(sourceId===targetId)throw validationFailed('Choose a different surviving customer.');
 const r=service.repository,[source,target]=await Promise.all([r.customer(sourceId),r.customer(targetId)]);
 if(!source||!target)throw notFound('Customer not found.');await service.access(user,sourceId);await service.access(user,targetId);
 const blockers=[];
 const ids=[sourceId,targetId],states=await r.all('SELECT c.id,to_jsonb(c) AS customer,(SELECT to_jsonb(p) FROM crm_customer_profiles p WHERE p.customer_id=c.id) AS profile,(SELECT to_jsonb(o) FROM crm_customer_onboarding o WHERE o.customer_id=c.id) AS onboarding,(SELECT to_jsonb(x) FROM crm_customer_controls x WHERE x.customer_id=c.id) AS controls FROM customers c WHERE c.id=ANY(?::integer[]) ORDER BY c.id',ids);
 const identities=await r.all('SELECT source_id,target_id FROM crm_customer_merge_links WHERE source_id=ANY(?::integer[]) OR target_id=?',ids,sourceId);
 if(identities.length)blockers.push('Resolve existing merge identities first; merge chains are not permitted.');
 if(source.company_id!==target.company_id)blockers.push('Customers belong to different company scopes.');
 for(const key of ['gstin','pan'])if(source[key]&&target[key]&&source[key]!==target[key])blockers.push('Conflicting '+key.toUpperCase()+' requires identity review.');
 const onboarding=states.find(x=>x.id===targetId)?.onboarding;
 if(states.find(x=>x.id===sourceId)?.onboarding?.status==='PENDING_APPROVAL')blockers.push('Resolve the source onboarding review before merging. Its approval history must remain final.');
 if(target.status!=='ACTIVE'||onboarding&&onboarding.status!=='APPROVED')blockers.push('The surviving customer must be active and approved for billing.');
 if(source.credit_limit!==target.credit_limit||source.credit_days!==target.credit_days)blockers.push('Align approved credit terms before merging; no credit limit is combined.');
 if(source.owner_id!==target.owner_id)blockers.push('Align customer ownership before merging so salesperson access remains consistent.');
 const profiles=states.map(x=>x.profile);
 if(fingerprint(profiles[0]?{companyId:profiles[0].company_id,ledger:profiles[0].tally_ledger_name}:null)!==fingerprint(profiles[1]?{companyId:profiles[1].company_id,ledger:profiles[1].tally_ledger_name}:null))blockers.push('Resolve company and ledger profile links before merging; an outstanding ledger must not be lost from credit checks.');
 if((source.tally_guid??null)!==(target.tally_guid??null))blockers.push('Resolve different legacy Tally identity links before merging.');
 const controls=states.map(x=>x.controls);
 if(fingerprint(controls[0]?{classification:controls[0].classification,creditExempt:controls[0].credit_exempt,pricingClass:controls[0].pricing_class}:null)!==fingerprint(controls[1]?{classification:controls[1].classification,creditExempt:controls[1].credit_exempt,pricingClass:controls[1].pricing_class}:null))blockers.push('Customer restrictions, pricing classes or credit exemptions differ. Review them first.');
 const bindings=await r.all("SELECT crm_id,company_id,record_key FROM tally_visibility_crm_links WHERE crm_kind='customer' AND crm_id=ANY(?::integer[]) ORDER BY company_id,record_key",ids);
 const ledgerKeys=id=>bindings.filter(x=>x.crm_id===id).map(x=>({companyId:x.company_id,key:x.record_key}));
 if(fingerprint(ledgerKeys(sourceId))!==fingerprint(ledgerKeys(targetId)))blockers.push('Align reviewed ledger mappings before merging. Existing financial source links are not transferred or discarded automatically.');
 for(const a of bindings.filter(x=>x.crm_id===sourceId))if(bindings.some(b=>b.crm_id===targetId&&b.company_id===a.company_id&&b.record_key!==a.record_key))blockers.push('Different Tally ledgers in the same company cannot be silently combined.');
 const open=await r.one(`SELECT
  (SELECT count(*)::integer FROM crm_quotation_workflows WHERE (public_snapshot->>'customerId')::integer=? AND status IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT')) AS quotes,
  (SELECT count(*)::integer FROM crm_order_workflows WHERE customer_id=? AND status NOT IN ('CANCELLED','DELIVERED')) AS orders,
  (SELECT count(*)::integer FROM crm_customer_rate_contracts WHERE customer_id=? AND status='APPROVED' AND valid_to>=CURRENT_DATE AND NOT is_deleted) AS contracts,
  (SELECT count(*)::integer FROM crm_operations WHERE customer_id=? AND status NOT IN ('RESOLVED','CANCELLED','CONFIRMED','REJECTED')) AS cases,
  (SELECT count(*)::integer FROM billing_documents WHERE customer_id=? AND status IN ('DRAFT','PENDING_APPROVAL','APPROVED')) AS invoices,
  (SELECT count(*)::integer FROM enquiries WHERE customer_id=? AND status NOT IN ('WON','LOST','CANCELLED') AND NOT is_deleted) AS enquiries,
  (SELECT count(*)::integer FROM crm_customer_opportunities WHERE customer_id=? AND stage NOT IN ('WON','LOST')) AS opportunities,
  (SELECT count(*)::integer FROM crm_customer_activities WHERE customer_id=? AND status='ACTIVE' AND follow_up_at>clock_timestamp()) AS followups,
  (SELECT count(*)::integer FROM quotations q WHERE q.customer_id=? AND NOT q.is_deleted AND q.status NOT IN ('WON','LOST','CANCELLED') AND NOT EXISTS(SELECT 1 FROM crm_quotation_workflows w WHERE w.quotation_id=q.id)) AS legacy_quotes,
  (SELECT count(*)::integer FROM sales_orders o WHERE o.customer_id=? AND NOT o.is_deleted AND o.status NOT IN ('CANCELLED','COMPLETED') AND NOT EXISTS(SELECT 1 FROM crm_order_workflows w WHERE w.sales_order_id=o.id)) AS legacy_orders`,sourceId,sourceId,sourceId,sourceId,sourceId,sourceId,sourceId,sourceId,sourceId,sourceId);
 open.field_visits=(await r.one("SELECT count(*)::integer AS n FROM crm_field_visits WHERE customer_id=? AND status='IN_PROGRESS'",sourceId)).n;
 if(Object.values(open).some(n=>n>0))blockers.push('Close or explicitly resolve open source-customer work before merging. Existing live workflows are not reassigned silently.');
 const additions=await r.all(`SELECT 'address' AS kind,id::text,version FROM crm_customer_addresses WHERE customer_id=ANY(?::integer[]) UNION ALL SELECT 'activity',id::text,version FROM crm_customer_activities WHERE customer_id=ANY(?::integer[]) UNION ALL SELECT 'opportunity',id::text,version FROM crm_customer_opportunities WHERE customer_id=ANY(?::integer[]) ORDER BY kind,id`,ids,ids,ids);
 const evidence={sourceId,targetId,states,bindings,identities,open,additions};
 return {source:{id:source.id,name:source.name},target:{id:target.id,name:target.name},blockers:[...new Set(blockers)],openWork:open,fingerprint:fingerprint(evidence),note:'Original records, documents, contracts and audit history retain their original customer IDs. The surviving profile provides a linked history; financial balances are not added together.'};
}
export async function requestMerge(service,user,customerId,b){
 service.permission(user,'customers.merge.request');
 return service.run(user,b.reason,async()=>{
  const ids=[customerId,b.targetId].sort((a,c)=>a-c);for(const id of ids)await service.repository.customer(id,true);
  const preview=await mergePreview(service,user,customerId,b.targetId);if(preview.blockers.length)throw conflict(preview.blockers.join(' '),'CUSTOMER_MERGE_BLOCKED');
  if(preview.fingerprint!==b.fingerprint)throw conflict('Customer data changed. Preview the merge again.');
  const row=await service.repository.one('INSERT INTO crm_customer_merge_requests(source_id,target_id,fingerprint,snapshot,reason,created_by) VALUES(?,?,?,?::text::jsonb,?,?) RETURNING *',customerId,b.targetId,preview.fingerprint,JSON.stringify(preview),b.reason,user.id);
  await service.audit(user,'CUSTOMER_MERGE',row.id,'REQUEST',null,{sourceId:customerId,targetId:b.targetId},b.reason);return row;
 });
}
export async function decideMerge(service,user,customerId,requestId,b){
 service.permission(user,'customers.merge.approve');
 return service.run(user,b.reason,async()=>{
  const r=service.repository,row=await r.one('SELECT * FROM crm_customer_merge_requests WHERE id=? AND (source_id=? OR target_id=?) FOR UPDATE',requestId,customerId,customerId);
  if(!row)throw notFound();if(row.status!=='PENDING_APPROVAL'||row.version!==b.version)throw conflict('Merge request changed. Reload.');
  if(row.created_by===user.id)throw forbidden('A different authorised person must decide the merge.');
  for(const id of [row.source_id,row.target_id].sort((a,c)=>a-c))await r.customer(id,true);
  await service.access(user,row.source_id);await service.access(user,row.target_id);
  if(b.decision==='APPROVE'){
   const preview=await mergePreview(service,user,row.source_id,row.target_id);
   if(preview.blockers.length||preview.fingerprint!==row.fingerprint)throw conflict('Source records changed or have unresolved work. Reject this request and prepare a fresh preview.','MERGE_PREVIEW_STALE');
   await r.one("UPDATE customers SET status='INACTIVE',updated_by=?,updated_at=clock_timestamp() WHERE id=? RETURNING id",user.id,row.source_id);
   await r.one('INSERT INTO crm_customer_merge_links(source_id,target_id,request_id,approved_by) VALUES(?,?,?,?) RETURNING source_id',row.source_id,row.target_id,row.id,user.id);
  }
  const saved=await r.one('UPDATE crm_customer_merge_requests SET status=?,decided_by=?,decided_at=clock_timestamp(),decision_reason=?,version=version+1 WHERE id=? RETURNING *',b.decision==='APPROVE'?'APPROVED':'REJECTED',user.id,b.reason,row.id);
  await service.audit(user,'CUSTOMER_MERGE',row.id,b.decision,{status:row.status},{status:saved.status,sourceId:row.source_id,targetId:row.target_id},b.reason);
  return {id:saved.id,status:saved.status,version:saved.version,identity:await customerIdentity(service.db,row.source_id)};
 });
}
