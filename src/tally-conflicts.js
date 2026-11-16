import crypto from 'node:crypto';
import {readCompany,pagination} from './tally-read-service.js';
import {TallyVisibilityService,isTallyFinancial} from './tally-visibility-service.js';
import {TallyVisibilityRepository} from './tally-visibility-repository.js';
import {transaction,saveCustomer,saveItem} from './crm-modules.js';
import {workflowRule} from './modules/rules/workflow-rules.js';
import {hasPermission} from './rbac.js';
import {writeAudit} from './db.js';
import {forbidden,validationFailed,notFound,conflict} from './core/errors.js';
import {requestTallyRead} from './tally-read-requests.js';
const kinds={customers:{entity:'ledgers',crmKind:'customer',permission:'customers.update',fields:[['name','name'],['gstin','gstin']]},vendors:{entity:'ledgers',crmKind:'vendor',permission:'purchasing.write',fields:[['name','name'],['gstin','gstin']]},items:{entity:'items',crmKind:'item',permission:'items.update',fields:[['hsn','hsn'],['uom','base_unit']]}};
Object.setPrototypeOf(kinds,null);
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const why=body=>{const reason=typeof body?.reason==='string'?body.reason.trim():'';if(reason.length<3||reason.length>2000)throw validationFailed('A reason of 3–2000 characters is required.');return reason;};
const requireSync=user=>{if(!hasPermission(user,'tally.sync'))throw forbidden('Tally sync permission is required.');};
const visible=(user,kind)=>Boolean(kinds[kind]||isTallyFinancial(user));
const conflictId=id=>{if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw validationFailed('Choose a valid conflict identifier.');return id;};
const readPermission=kind=>kind==='customers'?'customers.read':kind==='items'?'items.read':'tally.read';
export class TallyConflictService {
 constructor(db){this.db=db;this.repository=new TallyVisibilityRepository(db);this.visibility=new TallyVisibilityService(db);}
 async source(company,kind,key,user){
  const definition=kinds[kind];if(!definition)throw validationFailed('Automatic comparison currently supports explicitly linked customers, vendors and items. Other categories require confirmed field mappings.');
  if(!hasPermission(user,readPermission(kind)))throw forbidden('Read permission for this record category is required.');
  const url=new URL('http://localhost/api/tally');url.searchParams.set('companyId',company.id);
  const ctx=await this.visibility.context(kind,url,user);
  const source=await this.db.prepare(`${ctx.scope.fullCte} SELECT * FROM visible WHERE record_key=?`).get(...ctx.scope.args,key);
  if(!source)throw notFound('Source record not found in the selected company and category.');
  const receipt=await this.db.prepare('SELECT session_id,status,quarantined_count FROM tally_run_datasets WHERE company_id=? AND dataset=? ORDER BY processed_at DESC NULLS LAST,session_id DESC LIMIT 1').get(company.id,kind==='items'?'stockXml':'ledgersXml');
  if(receipt&&(!['imported','received_empty'].includes(receipt.status)||receipt.quarantined_count>0||receipt.session_id!==source.session_id))throw conflict('This source is not verified in the latest complete collection. Stored history is retained; request a fresh read and compare again.');
  const identity=source.fields['/stored/tally_guid']||source.fields['/stored/guid']||source.fields['/stored/master_id']||source.fields['/xml/GUID/#text']||source.fields['/xml/MASTERID/#text'];
  if(!identity)throw validationFailed('The source must have a stable GUID or Master ID.');
  const guid=source.fields['/stored/tally_guid']||source.fields['/stored/guid']||source.fields['/xml/GUID/#text'];
  const expression=guid?"COALESCE(r.fields->>'/stored/tally_guid',r.fields->>'/stored/guid',r.fields->>'/xml/GUID/#text',r.fields->>'/xml/GUID')":"COALESCE(r.fields->>'/stored/master_id',r.fields->>'/xml/MASTERID/#text',r.fields->>'/xml/MASTERID')";
  const duplicates=await this.db.prepare(`SELECT count(*) AS n FROM tally_visibility_current_cache c JOIN tally_visibility_records r ON r.id=c.record_id AND r.company_id=c.company_id WHERE c.company_id=? AND c.entity=? AND lower(${expression})=lower(?)`).get(company.id,definition.entity,String(identity));
  if(duplicates.n!==1)throw validationFailed('The stable source identity is missing or ambiguous in current records. Resolve source duplication before comparison.');
  const links=await this.repository.links(company.id,definition.entity,key),link=links.find(row=>row.crm_kind===definition.crmKind);
  if(!link)throw validationFailed('The source has no explicit CRM link. Review and link it first.');
  if(kind==='vendors'&&!await this.db.prepare("SELECT id FROM crm_parties WHERE id=? AND company_id=? AND party_role='VENDOR' AND NOT is_deleted").get(link.crm_id,company.id))throw validationFailed('The vendor link does not belong to this source company.');
  const crm=await this.repository.crmRecord(link.crm_kind,link.crm_id);if(!crm)throw notFound('Linked CRM record not found.');
  const summary=kind==='items'?(await this.db.prepare("SELECT summary_fields FROM tally_visibility_current_cache WHERE company_id=? AND entity='items' AND record_key=?").get(company.id,key))?.summary_fields:null;
  const pairs=definition.fields.map(([field,stored])=>({field,tally:source.fields[`/stored/${stored}`]??summary?.[`/stored/${stored}`]??summary?.[`/derived/${stored}`]??null,crm:crm[field]??null}));
  return {recordKey:key,identity:String(identity),recordId:source.id,sessionId:source.session_id,observedAt:source.observed_at,crmKind:link.crm_kind,crmId:link.crm_id,
   pairs,fingerprint:digest({company:company.id,kind,key,identity,crmId:link.crm_id,pairs,recordId:source.id})};
 }
 async list(url,user){
  const company=await readCompany(this.db,url),{page,pageSize}=pagination(url),status=url.searchParams.get('status')||'OPEN';
  if(!['OPEN','RESOLVED','ALL'].includes(status))throw validationFailed('Choose Open, Resolved or All.');
  const permitted=Object.keys(kinds).filter(kind=>hasPermission(user,readPermission(kind))),category=permitted.length?`entity_kind IN (${permitted.map(()=>'?').join(',')})`:'false';
  const filter=`company_id=? AND (${category}${isTallyFinancial(user)?" OR entity_kind NOT IN ('customers','vendors','items')":''})${status==='ALL'?'':' AND status=?'}`,args=[company.id,...permitted,...(status==='ALL'?[]:[status])];
  const total=(await this.db.prepare(`SELECT count(*) AS n FROM tally_conflicts WHERE ${filter}`).get(...args)).n;
  const data=await this.db.prepare(`SELECT id,company_id,entity_kind,external_id,conflict_type,status,created_at,created_by,resolved_at,resolved_by,resolution,resolution_reason FROM tally_conflicts WHERE ${filter} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize);
  const policy=await workflowRule(this.db,'tally.conflict_winners',false);
  return {company,data,pagination:{page,pageSize,total,pages:Math.ceil(total/pageSize)},winningSources:policy?.value??null,policyVersion:policy?.version??null};
 }
 async detail(url,id,user){
  conflictId(id);
  const company=await readCompany(this.db,url),row=await this.db.prepare('SELECT * FROM tally_conflicts WHERE company_id=? AND id=?').get(company.id,id);
  if(!row||!visible(user,row.entity_kind))throw notFound('Conflict not found in the permitted selected-company scope.');
  if(kinds[row.entity_kind]&&!hasPermission(user,readPermission(row.entity_kind)))throw forbidden('Read permission for this record category is required.');
  const policy=await workflowRule(this.db,'tally.conflict_winners',false),winner=policy?.value.find(entry=>entry.category===row.entity_kind)?.winner??null;
  let current=null,sourceError=null;
  if(kinds[row.entity_kind])try{current=await this.source(company,row.entity_kind,row.external_id,user);}catch(error){if(!error.status)throw error;sourceError=error.message;}
  const recovery=await this.db.prepare('SELECT id,status,created_at,completed_at,error_code,last_session_id FROM tally_read_requests WHERE company_id=? AND conflict_id=? ORDER BY created_at DESC,id DESC LIMIT 10').all(company.id,id);
  return {company,data:{id:row.id,kind:row.entity_kind,recordKey:row.external_id,status:row.status,createdBy:row.created_by,createdAt:row.created_at,resolution:row.resolution,resolutionReason:row.resolution_reason,resolvedAt:row.resolved_at,
   pairs:Array.isArray(row.source_snapshot?.pairs)?row.source_snapshot.pairs.filter(pair=>kinds[row.entity_kind]?.fields.some(([key])=>key===pair.field)).map(pair=>({field:pair.field,tally:typeof pair.tally==='string'?pair.tally:null,crm:typeof pair.crm==='string'?pair.crm:null})):[],snapshotFingerprint:row.source_snapshot?.fingerprint??null,winningSource:winner,policyVersion:policy?.version??null,
   current,sourceError,recovery,canResolve:Boolean(kinds[row.entity_kind]&&row.created_by!==user.id&&hasPermission(user,'tally.sync')&&hasPermission(user,kinds[row.entity_kind].permission)),
   ...(!kinds[row.entity_kind]&&isTallyFinancial(user)?{sourceSnapshot:row.source_snapshot,crmSnapshot:row.crm_snapshot}:{}),
   note:'No automatic resolution. Winning sources start unset. Retaining CRM never writes to Tally; accepting Tally updates only reviewed CRM fields.'}};
 }
 async detect(url,body,user){
  requireSync(user);const reason=why(body),company=await readCompany(this.db,url),kind=body.kind,keys=body.recordKeys;
  if(!kinds[kind]||!Array.isArray(keys)||!keys.length||keys.length>100||new Set(keys).size!==keys.length||keys.some(key=>typeof key!=='string'||key.length>300))throw validationFailed('Select 1–100 distinct linked source records in one supported category.');
  return transaction(this.db,user,reason,async()=>{
   const data=[];
   for(const key of keys){
    await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`${company.id}:${kind}:${key}`);
    const source=await this.source(company,kind,key,user);
    const differences=source.pairs.filter(row=>row.tally!==row.crm);
    const existing=await this.db.prepare("SELECT id,status FROM tally_conflicts WHERE company_id=? AND entity_kind=? AND external_id=? AND source_snapshot->>'fingerprint'=? ORDER BY created_at DESC LIMIT 1").get(company.id,kind,key,source.fingerprint);
    const obsolete=await this.db.prepare("SELECT id FROM tally_conflicts WHERE company_id=? AND entity_kind=? AND external_id=? AND status='OPEN' AND source_snapshot->>'fingerprint' IS DISTINCT FROM ? FOR UPDATE").all(company.id,kind,key,source.fingerprint);
    for(const old of obsolete){
     await this.db.prepare("UPDATE tally_conflicts SET status='SUPERSEDED',resolution='EVIDENCE_SUPERSEDED',resolution_reason=? WHERE id=?").run(reason,old.id);
     await writeAudit(this.db,{userId:user.id,entity:'TALLY_CONFLICT',recordId:old.id,action:'EVIDENCE_SUPERSEDED',oldValue:{status:'OPEN'},newValue:{status:'SUPERSEDED',comparisonFingerprint:source.fingerprint},reason});
    }
    if(!differences.length){data.push({recordKey:key,status:'MATCH',conflictId:null});continue;}
    if(existing){data.push({recordKey:key,status:existing.status,conflictId:existing.id});continue;}
    const id=crypto.randomUUID();await this.db.prepare("INSERT INTO tally_conflicts(id,company_id,entity_kind,external_id,conflict_type,source_snapshot,crm_snapshot,created_by) VALUES(?,?,?,?,'FIELD_DIFFERENCES',?::text::jsonb,?::text::jsonb,?)").run(id,company.id,kind,key,JSON.stringify(source),JSON.stringify({kind:source.crmKind,id:source.crmId,pairs:source.pairs.map(row=>({field:row.field,value:row.crm}))}),user.id);
    await writeAudit(this.db,{userId:user.id,entity:'TALLY_CONFLICT',recordId:id,action:'DETECTED',newValue:{companyId:company.id,kind,key,fingerprint:source.fingerprint,differences},reason});
    data.push({recordKey:key,status:'OPEN',conflictId:id});
   }
   const reconciliationId=crypto.randomUUID(),mismatch=data.some(row=>row.status!=='MATCH');
   await this.db.prepare('INSERT INTO tally_reconciliations(id,company_id,entity_kind,source_snapshot,result_summary,status,created_by) VALUES(?,?,?,?::text::jsonb,?::text::jsonb,?,?)').run(reconciliationId,company.id,kind,JSON.stringify({selectedRecordKeys:keys}),JSON.stringify({data}),mismatch?'MISMATCH':'MATCH',user.id);
   await writeAudit(this.db,{userId:user.id,entity:'TALLY_RECONCILIATION',recordId:reconciliationId,action:'COMPARED',newValue:{companyId:company.id,kind,data},reason});
   return {data,reconciliationId,note:'Only explicitly selected linked records were compared. No Tally record or CRM field was changed.'};
  });
 }
 async resolve(url,id,body,user){
  conflictId(id);
  requireSync(user);const reason=why(body),company=await readCompany(this.db,url);
  return transaction(this.db,user,reason,async()=>{
   const row=await this.db.prepare('SELECT * FROM tally_conflicts WHERE company_id=? AND id=? FOR UPDATE').get(company.id,id);
   if(!row||!kinds[row.entity_kind])throw notFound('A supported linked-master conflict was not found. Other categories require confirmed mappings.');
   if(row.status!=='OPEN')throw conflict('This conflict has already been resolved.');
   if(row.created_by===user.id)throw forbidden('The person who detected the conflict cannot approve its resolution. Use a second eligible reviewer.');
   if(!hasPermission(user,kinds[row.entity_kind].permission))throw forbidden('CRM update permission for this category is required.');
   const policy=await workflowRule(this.db,'tally.conflict_winners'),winner=policy.value.find(entry=>entry.category===row.entity_kind)?.winner;
   if(!winner)throw conflict('Owner has not confirmed the winning source for this category. Open Rules.');
   if(body.winner!==winner||body.policyVersion!==policy.version)throw conflict('The winning-source policy changed or was not reviewed. Refresh the conflict.');
   await this.db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get(`${company.id}:${row.entity_kind}:${row.external_id}`);
   await this.db.prepare('SELECT record_id FROM tally_visibility_current_cache WHERE company_id=? AND entity=? AND record_key=? FOR UPDATE').get(company.id,kinds[row.entity_kind].entity,row.external_id);
   await this.db.prepare('SELECT id FROM tally_visibility_crm_links WHERE company_id=? AND entity=? AND record_key=? FOR UPDATE').all(company.id,kinds[row.entity_kind].entity,row.external_id);
   const table={customers:'customers',items:'items',vendors:'crm_parties'}[row.entity_kind];
   if(!await this.db.prepare(`SELECT id FROM ${table} WHERE id=? FOR UPDATE`).get(row.source_snapshot.crmId))throw notFound('The original linked CRM record is unavailable.');
   if(row.entity_kind==='items')await this.db.prepare("SELECT id FROM crm_tally_item_links WHERE company_id=? AND item_id=? AND status='ACTIVE' AND NOT is_deleted FOR UPDATE").all(company.id,row.source_snapshot.crmId);
   const current=await this.source(company,row.entity_kind,row.external_id,user);
   if(body.fingerprint!==current.fingerprint||row.source_snapshot.fingerprint!==current.fingerprint)throw conflict('Source, CRM record or link changed after detection. Compare again before resolving.');
   if(winner==='TALLY'){
    const patch={reason};
    for(const pair of current.pairs.filter(pair=>pair.tally!==pair.crm)){
     if(pair.tally===null||typeof pair.tally!=='string'||!pair.tally.trim())throw validationFailed('An unavailable Tally field cannot clear a CRM value. Review the source first.');
     patch[pair.field]=pair.tally;
    }
    if(current.crmKind==='customer')await saveCustomer(this.db,current.crmId,patch,user);
    else if(current.crmKind==='item')await saveItem(this.db,current.crmId,patch,user);
    else {
     if(patch.gstin&&!/^[0-9]{2}[A-Z0-9]{13}$/.test(patch.gstin))throw validationFailed('Tally GSTIN is not valid for a CRM vendor update.');
     const old=await this.db.prepare('SELECT id,name,gstin FROM crm_parties WHERE id=? AND company_id=? FOR UPDATE').get(current.crmId,company.id);
     if(!old)throw notFound('Vendor not found.');
     await this.db.prepare('UPDATE crm_parties SET name=?,gstin=?,updated_at=now() WHERE id=? AND company_id=?').run(patch.name??old.name,patch.gstin??old.gstin,current.crmId,company.id);
     await writeAudit(this.db,{userId:user.id,entity:'CRM_PARTY',recordId:current.crmId,action:'CONFLICT_RESOLVED',oldValue:old,newValue:{...old,...patch},reason});
    }
   }
   await this.db.prepare("UPDATE tally_conflicts SET status='RESOLVED',resolution=?,resolution_reason=?,resolved_by=?,resolved_at=now() WHERE id=? AND company_id=?").run(winner==='TALLY'?'TALLY_ACCEPTED_IN_CRM':'CRM_RETAINED_WITH_REASON',reason,user.id,id,company.id);
   await writeAudit(this.db,{userId:user.id,entity:'TALLY_CONFLICT',recordId:id,action:'RESOLVED',oldValue:{status:row.status},newValue:{status:'RESOLVED',winner,policyVersion:policy.version,fingerprint:current.fingerprint},reason});
   return {id,status:'RESOLVED',winner};
  });
 }
 async recover(url,id,body,user){
  requireSync(user);const detail=await this.detail(url,id,user);
  const requested=await requestTallyRead(this.db,url,body,user,{conflictId:id,entityKind:detail.data.kind,recordKey:detail.data.recordKey});
  return requested;
 }
}
