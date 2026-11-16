import crypto from 'node:crypto';
import {fingerprint} from '../../core/runtime.js';
import {uuid,category,reason,fail,documentHash,idempotencyKey,businessApproval,required} from './contracts.js';
import {buildCreate} from './xml.js';
import {queries} from './verification.js';
import {mappingCandidates,selectedMappingBindings,MAPPING_ENTITIES,MAPPING_GENERATOR_VERSION} from './mapping-candidates.js';

const json=value=>JSON.stringify(value);
const hash=value=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))fail(422,'A reviewed source fingerprint is required.');return value;};
const configuration=value=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Buffer.byteLength(json(value))>100000)fail(422,'A mapping object of at most 100 KB is required.');
 for(const key of ['sourceFields','header','inventory','batch','units','unitSourceKeys','itemBindings','partyBindings','companyProbe','identityProbe','readback','partyFields'])if(value[key]!=null&&(typeof value[key]!=='object'||Array.isArray(value[key])))fail(422,`Mapping ${key} must be an object.`);
 if(value.readback?.fields!=null&&(!Array.isArray(value.readback.fields)||value.readback.fields.some(field=>!field||typeof field!=='object'||Array.isArray(field))))fail(422,'Mapping read-back fields must be a list of field objects.');
 if(value.readback?.inventory!=null&&(typeof value.readback.inventory!=='object'||Array.isArray(value.readback.inventory)))fail(422,'Mapping read-back inventory must be an object.');
 selectedMappingBindings(value);return value;
};
const exactFields=(body,allowed)=>{for(const key of Object.keys(body))if(!allowed.includes(key))fail(422,'Unknown mapping review field.');};

/** Mapping-only review. This class has no connector, network, queue, outbox or control dependency. */
export class MappingDrafts {
 constructor(host){this.host=host;}
 async candidates(user,companyId,kind){
  const h=this.host;h.owner(user);uuid(companyId);category(kind);
  // One statement uses one PostgreSQL snapshot for company, counts, bounded
  // records and receipts; separate import commits cannot mix these observations.
  const row=await h.one(`SELECT t.id,t.name,t.tally_guid,
   (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.entity) FROM (SELECT c.entity,count(*)::integer AS count FROM tally_visibility_current_cache c WHERE c.company_id=t.id AND c.entity=ANY(?::text[]) GROUP BY c.entity) n) AS counts,
   (SELECT jsonb_agg(to_jsonb(sample) ORDER BY sample.entity,sample.record_key) FROM unnest(?::text[]) AS kinds(entity) CROSS JOIN LATERAL
    (SELECT c.entity,c.record_key,c.record_id,c.name,c.session_id,c.observed_at,c.summary_fields,
      CASE WHEN octet_length(r.raw_record::text)<=65536 THEN r.raw_record ELSE '{}'::jsonb END AS raw_record,
      octet_length(r.raw_record::text)<=65536 AS source_content_available,r.content_hash,r.payload_id
     FROM tally_visibility_current_cache c JOIN tally_visibility_records r ON r.id=c.record_id AND r.company_id=c.company_id AND r.entity=c.entity
     WHERE c.company_id=t.id AND c.entity=kinds.entity ORDER BY c.record_key LIMIT 150) sample) AS records,
   (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.dataset) FROM (SELECT DISTINCT ON(dataset) dataset,status,processed_at,session_id,quarantined_count FROM tally_run_datasets WHERE company_id=t.id ORDER BY dataset,processed_at DESC NULLS LAST,session_id DESC) d) AS receipts
   FROM tally_companies t WHERE t.id=?`,MAPPING_ENTITIES,MAPPING_ENTITIES,companyId);if(!row)fail(404,'Selected company is not imported.');
  const company={id:row.id,name:row.name,guid:required(row.tally_guid,'company.guid')};
  return mappingCandidates({company,category:kind,records:row.records??[],counts:row.counts??[],receipts:row.receipts??[]});
 }
 async replay(user,body,operation){
  const row=await this.host.one('SELECT e.*,m.* FROM tw_mapping_evidence e JOIN tw_mapping_versions m ON m.id=e.mapping_id WHERE e.request_key=?',uuid(body.requestKey));
  if(!row)return null;
  const requestHash=fingerprint({operation,userId:user.id,body});if(row.created_by!==user.id||row.request_hash!==requestHash)fail(409,'This mapping request key was already used for a different action.');
  return {...row,id:row.mapping_id,replayed:true};
 }
 async bind(plan,config){
  const selectedImports=[],bindings=selectedMappingBindings(config),rows=bindings.length?await this.host.many(`SELECT requested.entity,requested.key,c.record_id,c.session_id,c.summary_fields,r.content_hash,r.payload_id FROM jsonb_to_recordset(?::text::jsonb) AS requested(entity text,key text)
   LEFT JOIN tally_visibility_current_cache c ON c.company_id=? AND c.entity=requested.entity AND c.record_key=requested.key
   LEFT JOIN tally_visibility_records r ON r.id=c.record_id AND r.company_id=c.company_id AND r.entity=c.entity`,json(bindings),plan.company.id):[];
  for(const binding of bindings){
   const row=rows.find(row=>row.entity===binding.entity&&row.key===binding.key);
   const stable=Boolean(row&&(row.summary_fields?.['/stored/tally_guid']||row.summary_fields?.['/stored/guid']||row.summary_fields?.['/stored/master_id']));
   selectedImports.push({...binding,recordId:row?.record_id??null,sessionId:row?.session_id??null,payloadId:row?.payload_id??null,contentHash:row?.content_hash??null,stable});
  }
  const evidence={...plan.evidence,selectedImports};return {...plan,evidence,sourceFingerprint:fingerprint(evidence)};
 }
 async retain(user,mapping,plan,body,operation,expert=null){
  if(Buffer.byteLength(json(plan.evidence))>524288)fail(422,'The retained mapping evidence exceeds the supported review size. Reduce the explicit source bindings and review again.');
  return this.host.one(`INSERT INTO tw_mapping_evidence(mapping_id,company_id,generator_version,source_fingerprint,evidence,expert_name,expert_reference,expert_reviewed_at,request_key,request_hash,created_by,reason)
   VALUES(?,?,?,?,?::text::jsonb,?,?,CASE WHEN ?::boolean THEN clock_timestamp() ELSE NULL END,?,?,?,?) RETURNING id`,mapping.id,mapping.company_id,MAPPING_GENERATOR_VERSION,plan.sourceFingerprint,json(plan.evidence),expert?.name??null,expert?.reference??null,Boolean(expert),body.requestKey,fingerprint({operation,userId:user.id,body}),user.id,body.reason);
 }
 async insert(user,{companyId,category:kind,configuration:config,parentVersionId=null,status,reason:why}){
  const h=this.host,version=(await h.one('SELECT coalesce(max(version),0)+1 AS version FROM tw_mapping_versions WHERE company_id=? AND category=?',companyId,kind)).version;
  return h.one('INSERT INTO tw_mapping_versions(company_id,category,version,configuration,configuration_hash,status,parent_version_id,created_by,approved_by,reason) VALUES(?,?,?,?::text::jsonb,?,?,?,?,?,?) RETURNING *',companyId,kind,version,json(config),fingerprint(config),status,parentVersionId,user.id,status==='APPROVED'?user.id:null,why);
 }
 async draft(user,body,{legacy=false}={}){
  const h=this.host;h.owner(user);exactFields(body,['companyId','category','configuration','parentVersionId','sourceFingerprint','requestKey','reason']);uuid(body.companyId);category(body.category);configuration(body.configuration);reason(body.reason);uuid(body.requestKey);if(!legacy)hash(body.sourceFingerprint);if(body.parentVersionId)uuid(body.parentVersionId);
  return h.work(user,body.reason,async()=>{
   await h.one('SELECT pg_advisory_xact_lock(785451)');const prior=await this.replay(user,body,'DRAFT');if(prior)return prior;
   const plan=await this.candidates(user,body.companyId,body.category);if(body.sourceFingerprint&&body.sourceFingerprint!==plan.sourceFingerprint)fail(409,'Retained mapping evidence changed. Refresh and review the candidates again.');
   if(body.parentVersionId&&!await h.one('SELECT id FROM tw_mapping_versions WHERE id=? AND company_id=? AND category=?',body.parentVersionId,body.companyId,body.category))fail(409,'Parent mapping is not in this company and category.');
   const bound=await this.bind(plan,body.configuration),mapping=await this.insert(user,{...body,status:'DRAFT'});await this.retain(user,mapping,bound,body,'DRAFT');return mapping;
  });
 }
 async approved(user,body){
  const h=this.host;h.owner(user);exactFields(body,['companyId','category','parentVersionId','configuration','sourceFingerprint','requestKey','expertName','expertReference','reason']);uuid(body.companyId);category(body.category);uuid(body.parentVersionId);uuid(body.requestKey);hash(body.sourceFingerprint);reason(body.reason);
  if(typeof body.expertName!=='string'||body.expertName.trim().length<2||body.expertName.length>200||typeof body.expertReference!=='string'||body.expertReference.trim().length<3||body.expertReference.length>1000)fail(422,'Name the Tally expert and provide their review reference.');
  return h.work(user,body.reason,async()=>{
   await h.one('SELECT pg_advisory_xact_lock(785451)');const prior=await this.replay(user,body,'APPROVE');if(prior)return prior;
   const parent=await h.one("SELECT m.*,e.source_fingerprint,e.evidence FROM tw_mapping_versions m JOIN tw_mapping_evidence e ON e.mapping_id=m.id WHERE m.id=? AND m.company_id=? AND m.category=? AND m.status='DRAFT'",body.parentVersionId,body.companyId,body.category);
   if(!parent)fail(409,'Choose a retained draft with source-review evidence in this company.');if(parent.created_by===user.id)fail(403,'A different Owner must approve the mapping draft.');
   if(body.configuration&&fingerprint(configuration(body.configuration))!==parent.configuration_hash)fail(409,'Save changed configuration as a new draft before approval.');
   const plan=await this.bind(await this.candidates(user,body.companyId,body.category),parent.configuration);if(plan.sourceFingerprint!==body.sourceFingerprint||plan.sourceFingerprint!==parent.source_fingerprint)fail(409,'Retained source evidence changed. Create and review a new mapping draft.');
   if(plan.evidence.selectedImports.some(row=>!row.stable))fail(409,'A selected mapping source is missing or lacks stable identity in this company. Review the retained source keys.');
   const m=parent.configuration;for(const key of ['templateVersion','reportName','idempotencyField','idempotencyMethod','companyProbe','readback'])required(m[key],`field_mapping.${key}`);
   if(body.category!=='PARTY_LEDGER')for(const key of ['sourceFields','voucherType','numbering','header','inventory','batch','ledgerEntries','units','unitSourceKeys'])required(m[key],`field_mapping.${key}`);
   await h.sources.validateMappingImports(body.companyId,m,body.category);queries({company:plan.company,mapping:m,key:'0'.repeat(64),category:body.category});
   const mapping=await this.insert(user,{...body,configuration:m,status:'APPROVED'});await this.retain(user,mapping,plan,body,'APPROVE',{name:body.expertName.trim(),reference:body.expertReference.trim()});return mapping;
  });
 }
 async legacySave(user,body){
  if(!['DRAFT','APPROVED'].includes(body.status))fail(422,'Choose Draft or Approved.');
  const {status,...input}=body;if(status==='APPROVED')return this.approved(user,input);
  return this.draft(user,{...input,requestKey:input.requestKey??crypto.randomUUID()},{legacy:true});
 }
 async evidence(user,companyId,id){this.host.owner(user);return this.host.one('SELECT e.* FROM tw_mapping_evidence e JOIN tw_mapping_versions m ON m.id=e.mapping_id WHERE m.id=? AND m.company_id=?',uuid(id),uuid(companyId));}
 async requireApproved(mapping){
  if(!mapping||mapping.status!=='APPROVED'||!await this.host.one('SELECT id FROM tw_mapping_evidence WHERE mapping_id=? AND expert_name IS NOT NULL AND expert_reference IS NOT NULL AND expert_reviewed_at IS NOT NULL',mapping.id))fail(409,'Not set: independently approved mapping with named Tally expert review.');
 }
 async preview(user,body){
  const h=this.host;h.owner(user);exactFields(body,['companyId','mappingId','entityId','reason']);uuid(body.companyId);uuid(body.mappingId);reason(body.reason);
  const mapping=await h.one('SELECT * FROM tw_mapping_versions WHERE id=? AND company_id=?',body.mappingId,body.companyId);if(!mapping)fail(404,'Mapping not found in this company.');
  if(mapping.category==='PARTY_LEDGER')uuid(body.entityId);else if(!/^[1-9]\d{0,9}$/.test(String(body.entityId)))fail(422,'Choose an approved CRM document ID.');
  const keys=['templateVersion','reportName','idempotencyField','idempotencyMethod','companyProbe','readback',...(mapping.category==='PARTY_LEDGER'?['parentField','parentName']:['sourceFields','voucherType','numbering','header','inventory','batch','ledgerEntries','units','unitSourceKeys'])],missing=keys.filter(key=>mapping.configuration[key]===null||mapping.configuration[key]===undefined||mapping.configuration[key]==='');
  if(missing.length)return {ready:false,dryRun:true,mappingId:mapping.id,mappingStatus:mapping.status,companyId:body.companyId,xml:null,validation:null,missing:missing.map(key=>`Not set: field_mapping.${key}`),note:'Mapping-only preview blocked. No job is queued or source changed.'};
  try{
   const company=await h.sources.company(body.companyId);await h.sources.validateMappingImports(body.companyId,mapping.configuration,mapping.category);
   const document=await h.sources.document(mapping.category,body.entityId,body.companyId,mapping.configuration);businessApproval(document,mapping.category);
   const key=idempotencyKey(company.id,mapping.category,body.entityId,documentHash(document)),result=buildCreate({category:mapping.category,document,mapping:mapping.configuration,company,idempotencyKey:key});
   queries({company,mapping:mapping.configuration,key,category:mapping.category,document});
   return {ready:true,dryRun:true,mappingId:mapping.id,mappingStatus:mapping.status,companyId:company.id,xml:result.xml,validation:result.validation,missing:[],note:'Mapping-only preview. No job is queued, no switch changes and no connector or Tally is contacted.'};
  }catch(error){if(![409,422].includes(error.status))throw error;return {ready:false,dryRun:true,mappingId:mapping.id,mappingStatus:mapping.status,companyId:body.companyId,xml:null,validation:null,missing:[error.message],note:'Mapping-only preview blocked. No job is queued or source changed.'};}
 }
}
