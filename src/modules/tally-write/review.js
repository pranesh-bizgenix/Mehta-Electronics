import crypto from 'node:crypto';
import {TallyWriteTransport} from './transport.js';
import {uuid,reason,fail,mayProduce,required} from './contracts.js';
import {fingerprint} from '../../core/runtime.js';
import {compare,decimal} from '../../../public/money.js';
import {XMLBuilder} from 'fast-xml-parser';
import {readback} from './verification.js';

export class TallyWriteReview extends TallyWriteTransport{
  async partySnapshot(entityType,entityId){
    if(!['CUSTOMER','VENDOR'].includes(entityType)||!/^\d+$/.test(String(entityId)))fail(422,'Choose a CRM customer or procurement vendor.');
    const row=await this.one(`SELECT * FROM ${entityType==='CUSTOMER'?'customers':'crm_procurement_vendors'} WHERE id=? AND NOT is_deleted`,entityId);
    if(!row||row.status!=='ACTIVE')fail(409,'Choose an active CRM party.');
    const p=entityType==='CUSTOMER'?row:row.payload;
    return {name:p.name,gstin:p.gstin??null,address:entityType==='CUSTOMER'?row.billing_address??null:p.address??null};
  }
  async requestParty(user,body){this.owner(user);uuid(body.companyId);reason(body.reason);const snapshot=await this.partySnapshot(body.entityType,body.entityId);
    return this.work(user,body.reason,async()=>{
      await this.sources.company(body.companyId);
      const duplicate=await this.one("SELECT record_key FROM tally_visibility_current_cache WHERE company_id=? AND entity='ledgers' AND name=? LIMIT 1",body.companyId,snapshot.name);
      if(duplicate)fail(409,'This party name already exists in the imported company. Review/link it; do not create another ledger.');
      const hash=fingerprint(snapshot);
      const row=await this.one('INSERT INTO tw_party_reviews(company_id,entity_type,entity_id,snapshot,snapshot_hash,created_by,reason) VALUES(?,?,?,?::text::jsonb,?,?,?) ON CONFLICT(company_id,entity_type,entity_id,snapshot_hash) DO NOTHING RETURNING *',body.companyId,body.entityType,String(body.entityId),JSON.stringify(snapshot),hash,user.id,body.reason);
      return row??this.one('SELECT * FROM tw_party_reviews WHERE company_id=? AND entity_type=? AND entity_id=? AND snapshot_hash=?',body.companyId,body.entityType,String(body.entityId),hash);
    });
  }
  async approveParty(user,id,body){this.can(user,'tally.write.approve');return this.work(user,body.reason,async()=>{
    const row=await this.one('SELECT * FROM tw_party_reviews WHERE id=? AND company_id=? FOR UPDATE',uuid(id),uuid(body.companyId));if(!row)fail(404,'Party review not found.');
    if(row.status!=='PENDING'||row.created_by===user.id)fail(403,'A different eligible person must approve the pending party-ledger request.');
    if(fingerprint(await this.partySnapshot(row.entity_type,row.entity_id))!==row.snapshot_hash)fail(409,'Party changed; request a fresh review.');
    return this.one("UPDATE tw_party_reviews SET status='APPROVED',approved_by=?,approved_at=clock_timestamp(),updated_at=clock_timestamp(),reason=? WHERE id=? RETURNING *",user.id,body.reason,row.id);
  });}
  async resume(user,kind,body){this.owner(user);return this.work(user,body.reason,async()=>{
    const config=await this.config(kind);
    if(!config.enabled)fail(409,'Category is disabled; resuming does not enable it.');
    return this.one('UPDATE tw_categories SET paused=false,consecutive_failures=0,revision=revision+1,reason=?,updated_by=?,updated_at=clock_timestamp() WHERE category=? RETURNING *',body.reason,user.id,kind);
  });}
  async banner(){
    if(this.master!==true)return {live:false};
    const control=await this.control();if(!control.master_enabled)return {live:false};
    const categories=await this.many('SELECT category,company_id FROM tw_categories WHERE enabled AND NOT paused AND NOT dry_run_only');
    return {live:categories.length>0,active:true,categories};
  }
  health(base){return this.master?{...base,tallyWrite:{enabled:true,queueDepth:this.counters?.pending??null,unknown:this.counters?.unknown??null,observedAt:this.counters?.observedAt??null}}:base;}
  async monitor(user,companyId){const result=await super.monitor(user,companyId);this.counters={pending:result.counts.filter(r=>['PENDING','APPROVED'].includes(r.status)).reduce((n,r)=>n+r.count,0),unknown:result.counts.find(r=>r.status==='UNKNOWN')?.count??0,observedAt:new Date().toISOString()};return result;}
  async reconcile(user,companyId,why){this.can(user,'tally.write.read');uuid(companyId);reason(why);
    if(!(await this.control()).master_enabled)return {inactive:true};
    return this.work(user,why,async()=>{
      const jobs=await this.many("SELECT * FROM tw_outbox WHERE company_id=? AND status='CONFIRMED' ORDER BY confirmed_at DESC LIMIT 100",companyId),results=[];
      for(const job of jobs){
        const config=await this.config(job.category);if(!mayProduce(config.master_enabled,config))continue;
        required(config.conflict_winner,'tally.write.conflict_winner');
        const mapping=(await this.one('SELECT configuration FROM tw_mapping_versions WHERE id=?',job.mapping_id)).configuration;
        const entity=job.category==='PARTY_LEDGER'?'ledgers':'vouchers',guid=job.tally_voucher_ref?.guid;
        if(!guid){results.push({id:job.id,status:'NO_GUID_READ_LINK'});continue;}
        const source=await this.one("SELECT r.* FROM tally_visibility_current_cache c JOIN tally_visibility_records r ON r.id=c.record_id AND r.company_id=c.company_id WHERE c.company_id=? AND c.entity=? AND coalesce(c.summary_fields->>'/stored/tally_guid',c.summary_fields->>'/stored/guid',r.fields->>'/xml/GUID/#text',r.fields->>'/xml/GUID')=?",companyId,entity,guid);
        if(!source){results.push({id:job.id,status:'AWAITING_NORMAL_READ_SYNC'});continue;}
        const differences=[];
        for(const field of mapping.readback?.fields??[]){
          const delivered=source.fields[`/xml/${field.tally}/#text`]??source.fields[`/xml/${field.tally}`]??source.raw_record?.[field.tally];
          const value=job.snapshot[field.crm],expected=field.transform==='ISO_DATE_TO_TALLY'?String(value).replaceAll('-',''):value;let equal=false;
          if(typeof delivered==='string'&&expected!=null){try{equal=field.kind==='DECIMAL'?compare(decimal(delivered),decimal((field.sign==='NEGATIVE'?'-':'')+expected))===0:String(delivered)===String(expected);}catch{equal=false;}}
          if(!equal)differences.push({field:field.crm,tally:typeof delivered==='string'?delivered:null,crm:expected??null,winner:config.conflict_winner[field.crm]??null});
        }
        // Full mapped lines/accounting/godown checks use the normal import's retained raw record.
        try{
          const tag=job.category==='PARTY_LEDGER'?'LEDGER':'VOUCHER',record=source.raw_record?.[tag]??source.raw_record;
          const xml=new XMLBuilder({ignoreAttributes:false}).build({ENVELOPE:{COLLECTION:{[tag]:record}}});
          if(!readback(xml,{key:job.idempotency_key,mapping,document:job.snapshot,category:job.category}).found)throw new Error('Imported idempotency reference was not delivered.');
        }catch{
          differences.push({field:'mapped_record',tally:null,crm:'Approved mapped snapshot',winner:config.conflict_winner.mapped_record??null,review:'Raw imported mapped fields differ or were not fully delivered; review without rewriting Tally.'});
        }
        if(!differences.length){results.push({id:job.id,status:'MATCH'});continue;}
        const hash=fingerprint({outboxId:job.id,differences});
        const old=await this.one("SELECT o.conflict_id FROM tw_conflict_observations o JOIN tally_conflicts c ON c.id=o.conflict_id WHERE o.outbox_id=? AND o.comparison_hash=? AND c.status='OPEN' LIMIT 1",job.id,hash);
        if(old){results.push({id:job.id,status:'MISMATCH',conflictId:old.conflict_id});continue;}
        const id=crypto.randomUUID();
        await this.one("INSERT INTO tally_conflicts(id,company_id,entity_kind,external_id,conflict_type,source_snapshot,crm_snapshot,created_by) VALUES(?,?,?,?,'FIELD_DIFFERENCES',?::text::jsonb,?::text::jsonb,?) RETURNING id",id,companyId,'tally_write_'+job.category.toLowerCase(),guid,JSON.stringify({writeJobId:job.id,differences,recordId:source.id}),JSON.stringify(job.snapshot),user.id);
        await this.one('INSERT INTO tw_conflict_observations(outbox_id,conflict_id,imported_record_id,comparison_hash) VALUES(?,?,?,?) RETURNING id',job.id,id,source.id,hash);
        results.push({id:job.id,status:'MISMATCH',conflictId:id});
      }
      return {companyId,results,note:'Read-only comparison of imported values; conflicts never rewrite Tally or auto-resolve.'};
    });
  }
}
