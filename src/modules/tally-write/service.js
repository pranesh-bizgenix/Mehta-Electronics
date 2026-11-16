import crypto from 'node:crypto';
import {TransactionRunner,fingerprint,sha256} from '../../core/runtime.js';
import {hasPermission} from '../../rbac.js';
import {CATEGORIES,APPROVAL_MODES,category,reason,uuid,required,fail,settingsIssues,mayProduce,businessApproval,documentHash,idempotencyKey,importCapability} from './contracts.js';
import {buildCreate,parseImportResponse} from './xml.js';
import {queries,verifyCompany,readback} from './verification.js';
import {WriteSources} from './sources.js';
import {MappingDrafts} from './mapping-drafts.js';

const json=value=>JSON.stringify(value),mutableSettings=['enabled','dry_run_only','company_id','mapping_id','approval_mode','conflict_winner','tally_version','xml_import_verified','max_attempts','backoff_seconds','failure_threshold','min_gap_seconds','per_day_cap','lease_seconds'];
const kinds=new Set(CATEGORIES),bool=value=>typeof value==='boolean';
export class TallyWriteService{
  constructor(db){this.db=db;this.tx=new TransactionRunner(db);this.sources=new WriteSources(db);this.mappingDrafts=new MappingDrafts(this);this.master=false;this.capabilities=new Map();this.enabledCategories=new Set();}
  one(sql,...args){return this.db.prepare(sql).get(...args);}
  many(sql,...args){return this.db.prepare(sql).all(...args);}
  change(sql,...args){return this.db.prepare(sql).run(...args);}
  can(user,permission){if(!hasPermission(user,permission))fail(403,'Permission denied.');}
  owner(user){if(user?.role!=='OWNER')fail(403,'Only the Owner may configure Tally writes.');this.can(user,'tally.write.manage');}
  async work(user,why,fn,connector=null){
    return this.tx.run(user,reason(why),async()=>{
      const previous=(await this.one("SELECT current_setting('mehta.tw_connector_id',true) AS value"))?.value??'';
      await this.one("SELECT set_config('mehta.tw_connector_id',?,true)",connector?.id??'');
      try{return await fn();}finally{await this.one("SELECT set_config('mehta.tw_connector_id',?,true)",previous);}
    });
  }
  observeHeartbeat(connector,body){
    const capability=importCapability(body?.writeCapability);
    if(capability)this.capabilities.set(connector.id,{...capability,companyName:body.selectedCompany,companyGuid:body.selectedCompanyGuid,reportedAt:Date.now()});
    else this.capabilities.delete(connector.id);
  }
  async control(){const row=await this.one('SELECT * FROM tw_control WHERE singleton');this.master=row?.master_enabled===true;return row;}
  async config(kind){const row=await this.one('SELECT c.*,coalesce(c.approval_mode,m.approval_mode) AS approval_mode,m.revision AS control_revision,m.master_enabled FROM tw_categories c CROSS JOIN tw_control m WHERE c.category=? AND m.singleton',category(kind));if(row?.enabled&&!row.paused)this.enabledCategories.add(kind);else this.enabledCategories.delete(kind);return row;}
  async settings(user){this.owner(user);return {control:await this.control(),categories:await this.many('SELECT * FROM tw_categories ORDER BY category'),blockedPrem:'Missing values stay empty; no category is enabled by this page load.'};}
  async setControl(user,body){this.owner(user);if(!bool(body.masterEnabled))fail(422,'Specify the master switch explicitly.');
    if(body.approvalMode!==undefined&&body.approvalMode!==null&&!APPROVAL_MODES.includes(body.approvalMode))fail(422,'Choose a supported approval mode.');
    return this.work(user,body.reason,async()=>{
      await this.one('SELECT pg_advisory_xact_lock(785451)');
      await this.one('SELECT singleton FROM tw_control WHERE singleton FOR UPDATE');
      await this.change('UPDATE tw_control SET master_enabled=?,approval_mode=?,revision=revision+1,updated_by=?,updated_at=clock_timestamp(),reason=? WHERE singleton',body.masterEnabled,body.approvalMode===undefined?(await this.control()).approval_mode:body.approvalMode,user.id,body.reason);
      if(!body.masterEnabled)await this.change("UPDATE tw_outbox SET status=CASE WHEN send_authorized_at IS NOT NULL OR sent_at IS NOT NULL THEN 'UNKNOWN' ELSE 'HELD' END,last_error='MASTER_KILL_SWITCH',reason=? WHERE status IN ('PENDING','APPROVED','CLAIMED','SENT')",body.reason);
      return this.control();
    });
  }
  async setCategory(user,kind,body){this.owner(user);category(kind);reason(body.reason);
    for(const key of Object.keys(body))if(!mutableSettings.includes(key)&&key!=='reason'&&key!=='confirmLive')fail(422,'Unknown write setting.');
    for(const key of ['enabled','dry_run_only','xml_import_verified'])if(body[key]!=null&&!bool(body[key]))fail(422,'Switch settings must be explicit booleans.');
    for(const key of ['company_id','mapping_id'])if(body[key]!=null)uuid(body[key]);
    if(body.approval_mode!=null&&!APPROVAL_MODES.includes(body.approval_mode))fail(422,'Choose a supported approval mode.');
    for(const key of ['max_attempts','backoff_seconds','failure_threshold','min_gap_seconds','per_day_cap','lease_seconds'])if(body[key]!=null&&(!Number.isSafeInteger(body[key])||body[key]<1||body[key]>2147483647))fail(422,'Thresholds must be explicit positive integers.');
    return this.work(user,body.reason,async()=>{
      await this.one('SELECT pg_advisory_xact_lock(785451)');
      const old=await this.config(kind),next={...old,...body};
      if(next.enabled){
        const issues=settingsIssues(next);if(issues.length)fail(409,issues.join('\n'));
        await this.sources.company(uuid(next.company_id));
        const mapping=await this.one("SELECT * FROM tw_mapping_versions WHERE id=? AND company_id=? AND category=? AND status='APPROVED'",uuid(next.mapping_id),next.company_id,kind);
        if(!mapping)fail(409,'Not set: Owner-approved field mapping for this company/category.');
        await this.mappingDrafts.requireApproved(mapping);
        for(const field of mapping.configuration.readback?.fields??[])if(!['CRM','TALLY'].includes(next.conflict_winner?.[field.crm]))fail(409,`Not set: tally.write.conflict_winner.${field.crm}`);
        if(!['CRM','TALLY'].includes(next.conflict_winner?.mapped_record))fail(409,'Not set: tally.write.conflict_winner.mapped_record');
        await this.sources.validateMappingImports(next.company_id,mapping.configuration,kind);
        if(next.dry_run_only===false&&body.confirmLive!==true)fail(422,'Explicit live-category confirmation is required.');
      }
      const keys=mutableSettings.filter(key=>Object.hasOwn(body,key));if(!keys.length)fail(422,'No settings supplied.');
      await this.change(`UPDATE tw_categories SET ${keys.map(key=>`${key}=?${key==='conflict_winner'?'::text::jsonb':''}`).join(',')},revision=revision+1,updated_by=?,updated_at=clock_timestamp(),reason=? WHERE category=?`,...keys.map(key=>key==='conflict_winner'&&body[key]!==null?json(body[key]):body[key]),user.id,body.reason,kind);
      await this.change("UPDATE tw_outbox SET status=CASE WHEN send_authorized_at IS NOT NULL OR sent_at IS NOT NULL THEN 'UNKNOWN' ELSE 'HELD' END,last_error='CATEGORY_CONFIGURATION_CHANGED',reason=? WHERE category=? AND status IN ('PENDING','APPROVED','CLAIMED','SENT')",body.reason,kind);
      return this.config(kind);
    });
  }
  async saveMapping(user,body){this.owner(user);return this.mappingDrafts.legacySave(user,body);}
  async sourceOptions(user,companyId,entity,search=''){
    this.owner(user);uuid(companyId);if(!['ledgers','items','groups','godowns','units','voucher_types'].includes(entity))fail(422,'Unsupported mapping source.');
    if(typeof search!=='string'||search.length>200)fail(422,'Invalid source search.');
    return this.many("SELECT record_key,record_id,name,summary_fields->>'/stored/tally_guid' AS tally_guid,summary_fields->>'/stored/master_id' AS master_id FROM tally_visibility_current_cache WHERE company_id=? AND entity=? AND name ILIKE ? ESCAPE '\\' ORDER BY name,record_key LIMIT 100",companyId,entity,'%'+search.replace(/[\\%_]/g,'\\$&')+'%');
  }
  async mappings(user,companyId,kind){this.owner(user);return this.many('SELECT * FROM tw_mapping_versions WHERE company_id=? AND category=? ORDER BY version DESC',uuid(companyId),category(kind));}
  async queue(user,body,{internal=false}={}){
    if(!internal)this.can(user,'tally.write.approve');category(body.category);reason(body.reason);
    const control=await this.control();if(!control.master_enabled)return {inactive:true};
    const config=await this.config(body.category);if(!mayProduce(control.master_enabled,config))return {inactive:true};
    return this.work(user,body.reason,async()=>{
      await this.one('SELECT pg_advisory_xact_lock(785451)');
      const current=await this.config(body.category);if(!mayProduce(current.master_enabled,current))return {inactive:true};
      if(body.companyId!==undefined&&uuid(body.companyId)!==current.company_id)fail(409,'Selected company differs from this category configuration. No document was queued.');
      const issues=settingsIssues(current);if(issues.length)fail(409,issues.join('\n'));
      const mapping=await this.one("SELECT * FROM tw_mapping_versions WHERE id=? AND company_id=? AND category=? AND status='APPROVED'",current.mapping_id,current.company_id,body.category);
      if(!mapping)fail(409,'Not set: approved field mapping.');
      await this.mappingDrafts.requireApproved(mapping);
      const company=await this.sources.company(current.company_id),document=await this.sources.document(body.category,body.entityId,current.company_id,mapping.configuration);
      businessApproval(document,body.category);const hash=documentHash(document),key=idempotencyKey(company.id,body.category,body.entityId,hash);
      await this.change("UPDATE tw_outbox SET status='HELD',last_error='STALE_DOCUMENT',reason=? WHERE category=? AND entity_id=? AND entity_version_hash<>? AND status IN ('PENDING','APPROVED')",body.reason,body.category,String(body.entityId),hash);
      const prior=await this.one('SELECT * FROM tw_outbox WHERE category=? AND entity_id=? AND entity_version_hash=?',body.category,String(body.entityId),hash);if(prior)return {id:prior.id,status:prior.status,replay:true,dryRun:prior.dry_run};
      const output=buildCreate({category:body.category,document,mapping:mapping.configuration,company,idempotencyKey:key});
      queries({company,mapping:mapping.configuration,key,category:body.category,document});
      const auto=current.approval_mode==='AUTO_AFTER_BUSINESS_APPROVAL'&&body.category!=='PARTY_LEDGER'&&(internal||user.id!==document.approvedBy);
      // An automatic producer carries the original document author's identity.
      // The actual triggering actor remains in creation events/audit and validation provenance.
      // A manual enqueue by the business approver still needs another push reviewer.
      const author=internal&&auto?document.createdBy:user.id;
      output.validation.producedBy=user.id;output.validation.automaticProducer=internal;
      const dryRun=body.dryRun===true||current.dry_run_only;
      const row=await this.one(`INSERT INTO tw_outbox(category,entity_type,entity_id,entity_version_hash,company_id,mapping_id,config_revision,control_revision,snapshot,payload_xml,validation_report,idempotency_key,request_hash,status,dry_run,created_by,business_maker_id,approved_by,approved_at,reason)
        VALUES(?,?,?,?,?,?,?,?,?::text::jsonb,?,?::text::jsonb,?,?,?,?,?,?,?,CASE WHEN ?::integer IS NULL THEN NULL ELSE clock_timestamp() END,?) RETURNING id,status,dry_run`,
        body.category,document.entityType,String(body.entityId),hash,company.id,mapping.id,current.revision,current.control_revision,json(document),output.xml,json(output.validation),key,sha256(output.xml),auto?'APPROVED':'PENDING',dryRun,author,document.createdBy,auto?document.approvedBy:null,auto?document.approvedBy:null,body.reason);
      return {...row,dryRun:row.dry_run,xml:output.xml,validation:output.validation};
    });
  }
  async monitor(user,companyId){this.can(user,'tally.write.read');uuid(companyId);
    return {control:await this.control(),categories:await this.many('SELECT * FROM tw_categories WHERE company_id=?',companyId),
      counts:await this.many('SELECT status,count(*) AS count,min(created_at) AS oldest FROM tw_outbox WHERE company_id=? GROUP BY status',companyId),
      jobs:await this.many('SELECT id,category,entity_type,entity_id,status,dry_run,attempts,last_error,created_at,updated_at FROM tw_outbox WHERE company_id=? ORDER BY created_at DESC,id DESC LIMIT 100',companyId),
      alerts:await this.many("SELECT * FROM tw_alerts WHERE company_id=? AND status='OPEN' ORDER BY created_at DESC LIMIT 100",companyId)};
  }
  async job(user,companyId,id){this.can(user,'tally.write.read');const row=await this.one('SELECT * FROM tw_outbox WHERE id=? AND company_id=?',uuid(id),uuid(companyId));if(!row)fail(404,'Write job not found in this company.');
    return {...row,events:await this.many('SELECT * FROM tw_outbox_events WHERE outbox_id=? ORDER BY id',row.id)};}
  async approve(user,companyId,id,body){this.can(user,'tally.write.approve');return this.work(user,body.reason,async()=>{
    const row=await this.one('SELECT * FROM tw_outbox WHERE id=? AND company_id=? FOR UPDATE',uuid(id),uuid(companyId));if(!row)fail(404,'Write job not found.');
    if(!['PENDING','HELD','FAILED','APPROVED'].includes(row.status)||row.send_authorized_at||row.sent_at)fail(409,'Ambiguous or sent jobs require read-back resolution, not another approval or retry.');
    if([row.created_by,row.business_maker_id,row.snapshot.updatedBy].includes(user.id))fail(403,'A different eligible person must approve this push.');
    const config=await this.config(row.category),issues=settingsIssues(config);if(!mayProduce(config.master_enabled,config)||issues.length)fail(409,issues.join('\n')||'Write switches are OFF.');
    if(config.mapping_id!==row.mapping_id)fail(409,'Mapping changed; review and enqueue a new approved snapshot.');
    const mapping=await this.one('SELECT configuration FROM tw_mapping_versions WHERE id=?',row.mapping_id);
    const document=await this.sources.document(row.category,row.entity_id,row.company_id,mapping.configuration);
    if(documentHash(document)!==row.entity_version_hash)fail(409,'Document changed; a new business approval and queued snapshot are required.');
    if(row.attempts>=config.max_attempts)fail(409,'Maximum attempts reached.');
    return this.one("UPDATE tw_outbox SET status='APPROVED',approved_by=?,approved_at=clock_timestamp(),dry_run=?,config_revision=?,control_revision=?,lease_owner=NULL,lease_token_hash=NULL,lease_expires_at=NULL,last_error=NULL,reason=?,updated_at=clock_timestamp() WHERE id=? RETURNING id,status,dry_run",user.id,config.dry_run_only,config.revision,config.control_revision,body.reason,row.id);
  });}
  async holdOrCancel(user,companyId,id,body){this.can(user,'tally.write.approve');if(!['HOLD','CANCEL'].includes(body.action))fail(422,'Choose Hold or Cancel.');return this.work(user,body.reason,async()=>{
    const row=await this.one('SELECT * FROM tw_outbox WHERE id=? AND company_id=? FOR UPDATE',uuid(id),uuid(companyId));if(!row)fail(404,'Write job not found.');
    if(row.status==='CONFIRMED')fail(409,'A confirmed Tally record cannot be cancelled or changed here.');
    return this.one("UPDATE tw_outbox SET status=?,last_error=?,reason=?,updated_at=clock_timestamp() WHERE id=? RETURNING id,status",row.send_authorized_at||row.sent_at?'UNKNOWN':body.action==='HOLD'?'HELD':'CANCELLED',row.send_authorized_at||row.sent_at?'SEND_OUTCOME_UNCERTAIN':null,body.reason,row.id);
  });}
}
