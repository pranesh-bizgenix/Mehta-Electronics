import crypto from 'node:crypto';
import {TallyWriteService} from './service.js';
import {uuid,fail,settingsIssues,mayProduce,documentHash} from './contracts.js';
import {sha256} from '../../core/runtime.js';
import {queries,verifyCompany,verifyIdentityAbsent,readback} from './verification.js';
import {parseImportResponse,validateXml} from './xml.js';

export class TallyWriteTransport extends TallyWriteService{
  async connectorConfig(connector){
    const control=await this.control();if(!control.master_enabled)return {active:false};
    const capability=this.capabilities.get(connector.id);
    if(!capability||Date.now()-capability.reportedAt>180000)return {active:false,blocked:'WRITE_CAPABILITY_NOT_REPORTED'};
    const categories=await this.many('SELECT c.category,c.company_id,c.dry_run_only,t.name,t.tally_guid FROM tw_categories c JOIN tally_companies t ON t.id=c.company_id WHERE c.enabled AND NOT c.paused AND t.name=?',connector.expected_company_name);
    const companies=categories.filter(c=>c.name===capability.companyName&&c.tally_guid===capability.companyGuid).map(c=>({companyId:c.company_id,name:c.name,guid:c.tally_guid,category:c.category,dryRunOnly:c.dry_run_only}));
    return {active:companies.length>0,companies};
  }
  async bound(connector,companyId){
    const company=await this.sources.company(uuid(companyId)),capability=this.capabilities.get(connector.id);
    if(!capability||Date.now()-capability.reportedAt>180000)fail(403,'Explicit recent write capability is required.');
    if(company.name!==connector.expected_company_name||capability.companyName!==company.name||capability.companyGuid!==company.guid)fail(403,'Connector/company name or GUID mismatch.');
    return {company,capability};
  }
  async claim(connector,body){
    const {company,capability}=await this.bound(connector,body.companyId);
    const control=await this.control();if(!control.master_enabled)return {inactive:true};
    const live=await this.many('SELECT * FROM tw_categories WHERE company_id=? AND enabled AND NOT paused',company.id);
    if(!live.length)return {inactive:true};
    return this.work(null,'Authenticated connector requested a create lease',async()=>{
      await this.one('SELECT pg_advisory_xact_lock(785451)');
      if(!(await this.control()).master_enabled)return {inactive:true};
      await this.one('INSERT INTO tw_connector_capabilities(connector_id,company_id,protocol,version,create_only) VALUES(?,?,1,?,true) ON CONFLICT(connector_id) DO UPDATE SET company_id=excluded.company_id,protocol=excluded.protocol,version=excluded.version,create_only=true,reported_at=clock_timestamp(),updated_at=clock_timestamp() RETURNING connector_id',connector.id,company.id,capability.version);
      await this.change("UPDATE tw_outbox SET status=CASE WHEN send_authorized_at IS NULL AND sent_at IS NULL THEN 'PENDING' ELSE 'UNKNOWN' END,last_error=CASE WHEN send_authorized_at IS NULL AND sent_at IS NULL THEN 'LEASE_EXPIRED_BEFORE_SEND' ELSE 'LEASE_EXPIRED_AFTER_SEND_AUTHORIZATION' END,lease_owner=NULL,lease_token_hash=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE company_id=? AND status IN ('CLAIMED','SENT') AND lease_expires_at<clock_timestamp()",company.id);
      const verify=await this.one("SELECT * FROM tw_outbox WHERE company_id=? AND status='UNKNOWN' AND last_error='READBACK_REQUESTED' AND (lease_expires_at IS NULL OR lease_expires_at<clock_timestamp()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",company.id);
      if(verify)return this.lease(connector,verify,company,true);
      const active=await this.one("SELECT id FROM tw_outbox WHERE status IN ('CLAIMED','SENT','UNKNOWN') LIMIT 1");if(active)return {inactive:true,blocked:'ACTIVE_OR_UNCERTAIN_WRITE'};
      const job=await this.one("SELECT * FROM tw_outbox WHERE company_id=? AND status IN ('APPROVED','PENDING') AND approved_by IS NOT NULL AND NOT dry_run AND available_at<=clock_timestamp() ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",company.id);
      if(!job)return {inactive:true};
      const config=await this.config(job.category);
      if(!mayProduce(config.master_enabled,config)||config.dry_run_only)return {inactive:true};
      if(job.mapping_id!==config.mapping_id||job.config_revision!==config.revision||job.control_revision!==config.control_revision)return this.markHeld(job,'STALE_CONFIGURATION');
      if(job.attempts>=config.max_attempts)return this.markHeld(job,'MAX_ATTEMPTS_REACHED');
      const count=await this.one("SELECT count(*) AS n FROM tw_outbox WHERE category=? AND company_id=? AND sent_at>=clock_timestamp()-interval '24 hours'",job.category,company.id);
      if(count.n>=config.per_day_cap)return {inactive:true,blocked:'ROLLING_24_HOUR_CAP'};
      const gap=await this.one("SELECT last_sent_at IS NOT NULL AND last_sent_at+(min_gap_seconds*interval '1 second')>clock_timestamp() AS wait FROM tw_categories WHERE category=?",job.category);
      if(gap.wait)return {inactive:true,blocked:'MINIMUM_SEND_GAP'};
      await this.one('SELECT pg_advisory_xact_lock(812731)');
      try{await this.current(job);}catch(error){if(!error.status)throw error;return this.markHeld(job,'STALE_DOCUMENT_OR_MAPPING');}
      return this.lease(connector,job,company,false);
    },connector);
  }
  async markHeld(job,code){await this.change("UPDATE tw_outbox SET status='HELD',last_error=?,updated_at=clock_timestamp() WHERE id=?",code,job.id);return {inactive:true,blocked:code};}
  async current(job){
    const mapping=await this.one("SELECT * FROM tw_mapping_versions WHERE id=? AND company_id=? AND category=? AND status='APPROVED'",job.mapping_id,job.company_id,job.category);
    if(!mapping)fail(409,'Approved mapping is unavailable.');
    await this.mappingDrafts.requireApproved(mapping);
    const document=await this.sources.document(job.category,job.entity_id,job.company_id,mapping.configuration);
    if(documentHash(document)!==job.entity_version_hash)fail(409,'Approved document changed after queueing.');
    return {mapping:mapping.configuration,document};
  }
  async lease(connector,job,company,verifyOnly){
    const config=await this.config(job.category),issues=settingsIssues(config,{live:!verifyOnly});if(issues.length)return {inactive:true,blocked:issues};
    const token=crypto.randomBytes(32).toString('base64url'),mapping=(await this.one('SELECT configuration FROM tw_mapping_versions WHERE id=?',job.mapping_id)).configuration;
    const q=queries({company,mapping,key:job.idempotency_key,category:job.category,document:job.snapshot});
    const leased=await this.one(`UPDATE tw_outbox SET status=?,lease_owner=?,lease_token_hash=?,lease_expires_at=clock_timestamp()+(?*interval '1 second'),attempts=attempts+?,updated_at=clock_timestamp() WHERE id=? RETURNING lease_expires_at`,verifyOnly?'UNKNOWN':'CLAIMED',connector.id,sha256(token),config.lease_seconds,verifyOnly?0:1,job.id);
    return {job:{id:job.id,companyId:company.id,companyName:company.name,companyGuid:company.guid,category:job.category,operation:verifyOnly?'VERIFY_ONLY':'CREATE',leaseToken:token,leaseExpiresAt:leased.lease_expires_at,idempotencyKey:job.idempotency_key,requestHash:job.request_hash,...q}};
  }
  async owned(connector,body){
    uuid(body.jobId);if(typeof body.leaseToken!=='string'||body.leaseToken.length>200)fail(403,'Invalid lease.');
    const row=await this.one('SELECT * FROM tw_outbox WHERE id=? AND lease_owner=? AND lease_token_hash=? AND lease_expires_at>clock_timestamp() FOR UPDATE',body.jobId,connector.id,sha256(body.leaseToken));
    if(!row)fail(409,'Lease is absent, expired or replayed.');await this.bound(connector,row.company_id);return row;
  }
  async authorize(connector,body){
    return this.work(null,'Authenticated connector pre-send read-back check',async()=>{
      await this.one('SELECT pg_advisory_xact_lock(785451)');
      await this.one('SELECT pg_advisory_xact_lock(812731)');
      const row=await this.owned(connector,body),config=await this.config(row.category);
      if(!mayProduce(config.master_enabled,config)||config.dry_run_only||row.status!=='CLAIMED'||row.dry_run)fail(409,'Write switches are OFF, paused, dry-run only or the lease is not sendable.');
      if(row.config_revision!==config.revision||row.control_revision!==config.control_revision||row.mapping_id!==config.mapping_id)return this.markHeld(row,'STALE_CONFIGURATION');
      const company=await this.sources.company(row.company_id);verifyCompany(body.companyProbeXml,company);
      const {mapping,document}=await this.current(row);
      const found=readback(body.readbackXml,{key:row.idempotency_key,mapping,document,category:row.category});
      if(found.found){await this.confirm(row,found.reference,body.readbackXml);return {confirmed:true,reference:found.reference};}
      verifyIdentityAbsent(body.identityProbeXml,row.category);
      if(row.send_authorized_at||row.sent_at)fail(409,'A previously authorized send is ambiguous; do not retry.');
      if(sha256(row.payload_xml)!==row.request_hash)fail(409,'Stored request hash mismatch.');
      await this.change("UPDATE tw_outbox SET status='SENT',send_authorized_at=clock_timestamp(),sent_at=clock_timestamp(),readback_xml=?,updated_at=clock_timestamp() WHERE id=?",validateXml(body.readbackXml),row.id);
      await this.change('UPDATE tw_categories SET last_sent_at=clock_timestamp(),updated_at=clock_timestamp() WHERE category=?',row.category);
      return {authorized:true,xml:row.payload_xml,requestHash:row.request_hash,leaseExpiresAt:row.lease_expires_at};
    },connector);
  }
  async confirm(row,reference,xml){
    await this.change("UPDATE tw_outbox SET status='CONFIRMED',tally_voucher_ref=?::text::jsonb,confirmed_at=clock_timestamp(),readback_xml=?,last_error=NULL,updated_at=clock_timestamp() WHERE id=?",JSON.stringify(reference),validateXml(xml),row.id);
    await this.one('INSERT INTO tw_document_links(outbox_id,company_id,category,entity_type,entity_id,entity_version_hash,tally_ref) VALUES(?,?,?,?,?,?,?::text::jsonb) ON CONFLICT(outbox_id) DO NOTHING RETURNING id',row.id,row.company_id,row.category,row.entity_type,row.category==='PARTY_LEDGER'?row.snapshot.entityId:row.entity_id,row.entity_version_hash,JSON.stringify(reference));
    await this.change('UPDATE tw_categories SET consecutive_failures=0,updated_at=clock_timestamp() WHERE category=?',row.category);
  }
  async failure(row,config,status,code,response=null,xml=null){
    await this.change("UPDATE tw_outbox SET status=?,last_error=?,response_xml=?,readback_xml=?,available_at=CASE WHEN ?::integer IS NULL THEN available_at ELSE clock_timestamp()+(?*interval '1 second') END,updated_at=clock_timestamp() WHERE id=?",status,code,response,xml,config.backoff_seconds,config.backoff_seconds,row.id);
    const updated=await this.one('UPDATE tw_categories SET consecutive_failures=consecutive_failures+1,paused=(failure_threshold IS NULL OR consecutive_failures+1>=failure_threshold),updated_at=clock_timestamp() WHERE category=? RETURNING paused',row.category);
    if(status==='UNKNOWN'||updated.paused)await this.one('INSERT INTO tw_alerts(category,company_id,outbox_id,code,message,reason) VALUES(?,?,?,?,?,?) RETURNING id',row.category,row.company_id,row.id,updated.paused?'CIRCUIT_BREAKER_OPEN':code,'Tally create needs human review; no automatic retry is permitted.','Authenticated connector reported a failed or uncertain create.');
    return {status,code,paused:updated.paused};
  }
  async result(connector,body){
    return this.work(null,'Authenticated connector write result',async()=>{
      await this.one('SELECT pg_advisory_xact_lock(785451)');
      uuid(body.jobId);if(typeof body.leaseToken!=='string'||body.leaseToken.length>200)fail(403,'Invalid lease.');
      const receipt=await this.one("SELECT * FROM tw_outbox WHERE id=? AND lease_owner=? AND lease_token_hash=? AND status IN ('CONFIRMED','FAILED','HELD','UNKNOWN')",body.jobId,connector.id,sha256(body.leaseToken));
      if(receipt&&receipt.last_error!=='READBACK_REQUESTED'){await this.bound(connector,receipt.company_id);return {status:receipt.status,reference:receipt.tally_voucher_ref,replay:true};}
      const row=await this.owned(connector,body),config=await this.config(row.category);
      if(row.status==='CLAIMED'&&!row.send_authorized_at){
        if(['UNCERTAIN_SEND','CRASH_AFTER_AUTHORIZATION'].includes(body.code))return this.failure(row,config,'UNKNOWN','CLIENT_AUTHORIZATION_UNCERTAIN');
        if(!['TALLY_UNAVAILABLE','COMPANY_MISMATCH','PRE_SEND_FAILURE'].includes(body.code))fail(422,'A supported pre-send failure code is required.');
        return this.failure(row,config,body.code==='COMPANY_MISMATCH'?'HELD':'FAILED',body.code);
      }
      if(!['SENT','UNKNOWN'].includes(row.status))fail(409,'Job is not awaiting a result.');
      if(!body.responseXml&&row.status==='SENT')return this.failure(row,config,'UNKNOWN','SEND_RESPONSE_LOST');
      const mapping=(await this.one('SELECT configuration FROM tw_mapping_versions WHERE id=?',row.mapping_id)).configuration;
      const response=body.responseXml??null;
      if(response!==null&&(typeof response!=='string'||Buffer.byteLength(response)>1024*1024))fail(422,'Invalid or excessive import response.');
      if(response){
        let parsed;try{parsed=parseImportResponse(response);}catch(error){if(!error.status)throw error;return this.failure(row,config,'UNKNOWN','INVALID_IMPORT_RESPONSE',response);}
        await this.change('UPDATE tw_outbox SET response_xml=?,updated_at=clock_timestamp() WHERE id=?',response,row.id);
        if(!parsed.success)return this.failure(row,config,'FAILED',parsed.error,response);
      }
      try{
        const company=await this.sources.company(row.company_id);verifyCompany(body.companyProbeXml,company);
        const evidence=validateXml(body.readbackXml),found=readback(evidence,{key:row.idempotency_key,mapping,document:row.snapshot,category:row.category});
        if(!found.found)return this.failure(row,config,'UNKNOWN',row.status==='UNKNOWN'?'VERIFIED_KEY_ABSENT':'CREATED_WITHOUT_READBACK',response,evidence);
        await this.confirm(row,found.reference,evidence);return {status:'CONFIRMED',reference:found.reference};
      }catch(error){if(!error.status)throw error;return this.failure(row,config,'UNKNOWN','READBACK_UNVERIFIED',response);}
    },connector);
  }
  async requestReadback(user,companyId,id,body){this.owner(user);return this.work(user,body.reason,async()=>{
    const row=await this.one('SELECT * FROM tw_outbox WHERE id=? AND company_id=? FOR UPDATE',uuid(id),uuid(companyId));if(!row)fail(404,'Write job not found.');
    if(row.status!=='UNKNOWN'&&!(row.status==='FAILED'&&row.send_authorized_at))fail(409,'Only an uncertain previously authorized create needs this resolution.');
    return this.one("UPDATE tw_outbox SET status='UNKNOWN',last_error='READBACK_REQUESTED',lease_owner=NULL,lease_token_hash=NULL,lease_expires_at=NULL,reason=?,updated_at=clock_timestamp() WHERE id=? RETURNING id,status",body.reason,row.id);
  });}
  async resolveAbsent(user,companyId,id,body){this.owner(user);return this.work(user,body.reason,async()=>{
    const row=await this.one('SELECT * FROM tw_outbox WHERE id=? AND company_id=? FOR UPDATE',uuid(id),uuid(companyId));if(!row)fail(404,'Write job not found.');
    if(row.status!=='UNKNOWN'||row.last_error!=='VERIFIED_KEY_ABSENT'||!row.readback_xml||body.confirmManualTallyInspection!==true)fail(409,'An authenticated read-back proving key absence and explicit manual Tally inspection are required.');
    if([row.created_by,row.business_maker_id].includes(user.id))fail(403,'Independent Owner resolution is required.');
    return this.one("UPDATE tw_outbox SET status='HELD',send_authorized_at=NULL,sent_at=NULL,approved_by=NULL,approved_at=NULL,lease_owner=NULL,lease_token_hash=NULL,lease_expires_at=NULL,last_error='HUMAN_RESOLVED_NOT_CREATED',reason=?,updated_at=clock_timestamp() WHERE id=? RETURNING id,status",body.reason,row.id);
  });}
}
