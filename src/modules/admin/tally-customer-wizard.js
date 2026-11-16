import {s,validate} from '../../core/schema.js';
import {canonicalJson,sha256} from '../../core/runtime.js';
import {conflict,notFound,validationFailed} from '../../core/errors.js';
import {classifyLedgers} from '../../tally-read-service.js';

export const customerNameKey=value=>String(value??'').normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');
export const customerPhoneKey=value=>{let n=String(value??'').replace(/\D/g,'');if(n.length===12&&n.startsWith('91'))n=n.slice(2);return n.length>=7?n:'';};
const gstKey=value=>String(value??'').trim().toUpperCase();
const entrySchema=s.object({recordKey:s.string({min:1,max:300,trim:false}),action:s.enum(['create','link']),customerId:s.id().optional(),creditLimit:s.string({max:40}).optional(),creditDays:s.int({min:0,max:3650}).optional(),acknowledgeDuplicates:s.bool().default(false)});
const base={companyId:s.uuid(),entries:s.array(entrySchema,{min:1,max:100}),reason:s.reason()};
export const customerWizardBody=s.object(base);
export const customerWizardCommit=s.object({...base,previewFingerprint:s.string({pattern:/^[a-f0-9]{64}$/})});
const querySchema=s.object({companyId:s.uuid(),page:s.int({min:1,max:1000000}).default(1),pageSize:s.int({min:1,max:100}).default(25),search:s.string({max:200}).default(''),group:s.string({max:200}).optional(),duplicates:s.enum(['all','with','without']).default('all'),linkage:s.enum(['all','unlinked','linked']).default('unlinked')});

export class CustomerWizardRepository {
  constructor(db){this.db=db;}
  async company(id){return this.db.prepare('SELECT id,name,tally_guid FROM tally_companies WHERE id=?').get(id);}
  async sources(companyId){return this.db.prepare("SELECT record_key,record_id,name,parent_name,summary_fields FROM tally_visibility_current_cache WHERE company_id=? AND entity='ledgers' ORDER BY name,record_key").all(companyId);}
  async groups(companyId){return this.db.prepare("SELECT record_key AS id,name,parent_name FROM tally_visibility_current_cache WHERE company_id=? AND entity='groups'").all(companyId);}
  async customers(){return this.db.prepare(`SELECT c.id,c.name,c.gstin,c.status,c.updated_at,COALESCE(jsonb_agg(cc.phone ORDER BY cc.id) FILTER(WHERE cc.phone IS NOT NULL),'[]'::jsonb) AS phones
    FROM customers c LEFT JOIN customer_contacts cc ON cc.customer_id=c.id AND NOT cc.is_deleted GROUP BY c.id ORDER BY c.id`).all();}
  async links(companyId){return this.db.prepare("SELECT record_key,crm_id,crm_kind FROM tally_visibility_crm_links WHERE company_id=? AND entity='ledgers'").all(companyId);}
  async lock(){
    // Serialize with the existing single-record link flow; block concurrent CRM/source changes during the final recheck.
    await this.db.prepare('SELECT pg_advisory_xact_lock(73429924)').get();
    await this.db.exec('LOCK TABLE customers IN SHARE ROW EXCLUSIVE MODE');
    await this.db.exec('LOCK TABLE customer_contacts IN SHARE MODE');
    await this.db.exec('LOCK TABLE tally_visibility_current_cache IN SHARE MODE');
  }
  async create(source,entry,user){
    const id=(await this.db.prepare('INSERT INTO customers(name,normalized_name,gstin,pan,billing_address,credit_limit,credit_days,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id').get(source.name,customerNameKey(source.name),source.gstin||null,source.pan||null,source.address||null,entry.creditLimit,entry.creditDays,user.id,user.id)).id;
    let contactId=null;
    if(source.phone||source.email)contactId=(await this.db.prepare('INSERT INTO customer_contacts(customer_id,name,phone,email,is_primary) VALUES(?,?,?,?,1) RETURNING id').get(id,source.contactName||source.name,source.phone||null,source.email||null)).id;
    return {id,contactId};
  }
  async link(companyId,recordKey,id,user){await this.db.prepare("INSERT INTO tally_visibility_crm_links(company_id,entity,record_key,crm_kind,crm_id,created_by) VALUES(?,'ledgers',?,'customer',?,?)").run(companyId,recordKey,id,user.id);}
}

export class CustomerWizardService {
  constructor({repository,access,transactions,audit}){Object.assign(this,{repository,access,transactions,audit});}
  async state(user,companyId){
    this.access.require(user,'customers.read');
    this.access.require(user,'customers.duplicates');
    const company=await this.repository.company(companyId);if(!company)throw notFound('Selected imported company not found.');
    const [raw,groups,customers,links]=await Promise.all([this.repository.sources(companyId),this.repository.groups(companyId),this.repository.customers(),this.repository.links(companyId)]);
    const identities=new Map();
    const all=raw.map(row=>{
      const f=row.summary_fields,field=k=>String(f[`/stored/${k}`]??'').trim();
      const guid=field('tally_guid'),masterId=field('master_id');
      const identity=guid?`guid:${guid.toLowerCase()}`:masterId?`master:${masterId}`:null;
      for(const alias of [guid?`guid:${guid.toLowerCase()}`:null,masterId?`master:${masterId}`:null].filter(Boolean))identities.set(alias,(identities.get(alias)||0)+1);
      return {recordKey:row.record_key,revision:row.record_id,name:row.name,parent_name:row.parent_name,guid:guid||null,masterId:masterId||null,identity,
        gstin:gstKey(field('gstin')||f['/derived/gstin']),phone:field('phone'),email:field('email'),pan:field('pan'),address:field('address'),contactName:field('contact_person')};
    });
    const sources=classifyLedgers(groups,all).filter(row=>row.category==='customers').map(source=>{
      const linked=links.find(l=>l.record_key===source.recordKey);
      const duplicates=customers.flatMap(c=>{
        const reasons=[];
        if(source.gstin&&source.gstin===gstKey(c.gstin))reasons.push('GSTIN');
        if(customerNameKey(source.name)&&customerNameKey(source.name)===customerNameKey(c.name))reasons.push('NORMALISED_NAME');
        if(customerPhoneKey(source.phone)&&(c.phones||[]).some(p=>customerPhoneKey(p)===customerPhoneKey(source.phone)))reasons.push('PHONE');
        return reasons.length?[{id:c.id,name:c.name,gstin:c.gstin,status:c.status,reasons,phones:c.phones,linkedRecordKey:links.find(l=>l.crm_kind==='customer'&&l.crm_id===c.id)?.record_key??null}]:[];
      });
      return {...source,stable:Boolean(source.identity&&identities.get(source.identity)===1),identityIssue:!source.identity?'No GUID or Master ID was delivered.':identities.get(source.identity)>1?'Source identity is ambiguous within this company.':null,linked:linked?{customerId:linked.crm_id,kind:linked.crm_kind}:null,duplicates};
    });
    return {company,sources,customers,links};
  }
  async candidates(user,query){
    const q=validate(querySchema,query),state=await this.state(user,q.companyId),needle=q.search.toLocaleLowerCase();
    const filtered=state.sources.filter(r=>(!needle||[r.name,r.gstin,r.phone,r.guid,r.masterId].some(v=>String(v??'').toLocaleLowerCase().includes(needle)))&&(!q.group||r.parent_name===q.group)&&(q.duplicates==='all'||(q.duplicates==='with')===Boolean(r.duplicates.length))&&(q.linkage==='all'||(q.linkage==='linked')===Boolean(r.linked)));
    return {company:state.company,groups:[...new Set(state.sources.map(r=>r.parent_name).filter(Boolean))].sort(),data:filtered.slice((q.page-1)*q.pageSize,q.page*q.pageSize),pagination:{page:q.page,pageSize:q.pageSize,total:filtered.length,pages:Math.ceil(filtered.length/q.pageSize)},note:'Sundry Debtors and their subgroups only. Duplicate suggestions never create a link. Select specific source IDs; nothing is selected automatically.'};
  }
  async targets(user,query){
    const q=validate(s.object({companyId:s.uuid(),search:s.string({max:200}).default('')}),query),state=await this.state(user,q.companyId),needle=q.search.toLocaleLowerCase();
    return {data:state.customers.filter(c=>c.status==='ACTIVE'&&(!needle||`${c.name} ${c.gstin??''} ${c.id} ${(c.phones||[]).join(' ')}`.toLocaleLowerCase().includes(needle))).slice(0,100).map(c=>({...c,linkedRecordKey:state.links.find(l=>l.crm_kind==='customer'&&l.crm_id===c.id)?.record_key??null})),company:state.company};
  }
  async plan(user,body){
    const state=await this.state(user,body.companyId),used=new Set(),targets=new Set();
    const rows=body.entries.map(entry=>{
      this.access.require(user,entry.action==='create'?'customers.create':'customers.update');
      const source=state.sources.find(s=>s.recordKey===entry.recordKey),issues=[];
      if(used.has(entry.recordKey))issues.push('A source record was selected twice.');used.add(entry.recordKey);
      if(!source)return {entry,source:null,target:null,issues:['Source is not a customer ledger in the selected company.'],outcome:'BLOCKED'};
      if(!source.stable)issues.push(source.identityIssue);
      const target=entry.action==='link'?state.customers.find(c=>c.id===entry.customerId):null;
      if(entry.action==='link'){
        if(!target||target.status!=='ACTIVE')issues.push('Select an active existing CRM customer.');
        if(targets.has(entry.customerId))issues.push('Two selected ledgers cannot link to the same customer in this company.');targets.add(entry.customerId);
        const existing=state.links.find(l=>l.crm_kind==='customer'&&l.crm_id===entry.customerId&&l.record_key!==source.recordKey);
        if(existing)issues.push('This CRM customer is already linked to another ledger in this company.');
      }
      const sameLink=source.linked?.kind==='customer'&&(entry.action==='create'||source.linked.customerId===entry.customerId);
      if(source.linked&&!sameLink)issues.push('Source already has a different link; existing links are never overwritten.');
      if(entry.action==='create'&&!sameLink){
        if(entry.customerId)issues.push('Choose link-to-existing when specifying a CRM customer ID.');
        if(entry.creditLimit===undefined||entry.creditDays===undefined)issues.push('Enter an explicit credit limit and credit days. No business defaults are supplied.');
        if(entry.creditLimit!==undefined){try{validate(s.decimal({min:0}),entry.creditLimit);}catch{issues.push('Credit limit must be an exact non-negative decimal with at most six decimal places.');}}
        if(source.gstin&&!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(source.gstin))issues.push('Delivered GSTIN has an invalid format; correct the source or use a reviewed existing customer.');
        if(source.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(source.email))issues.push('Delivered email has an invalid format; correct the source or link to an existing customer.');
        if(source.duplicates.some(d=>d.reasons.includes('GSTIN')))issues.push('An existing CRM customer has this GSTIN. Link to the correct existing customer.');
        else if(source.duplicates.length&&!entry.acknowledgeDuplicates)issues.push('Review and acknowledge the name/phone duplicates, or link to an existing customer.');
        const peers=body.entries.filter(e=>e.action==='create'&&e.recordKey!==source.recordKey).map(e=>state.sources.find(s=>s.recordKey===e.recordKey)).filter(Boolean);
        if(source.gstin&&peers.some(p=>p.gstin===source.gstin))issues.push('Another selected create action has this GSTIN. Resolve the duplicate before saving.');
        const similar=peers.filter(p=>customerNameKey(p.name)===customerNameKey(source.name)||customerPhoneKey(source.phone)&&customerPhoneKey(p.phone)===customerPhoneKey(source.phone));
        if(similar.length&&!entry.acknowledgeDuplicates)issues.push(`Similar selected sources: ${similar.map(p=>p.name).join(', ')}. Review and acknowledge before creating separate customers.`);
      }
      return {entry,source,target:target?{id:target.id,name:target.name,gstin:target.gstin,status:target.status,phones:target.phones,updatedAt:target.updated_at}:null,issues,outcome:issues.length?'BLOCKED':sameLink?'ALREADY_LINKED':entry.action==='create'?'CREATE_AND_LINK':'LINK_EXISTING'};
    });
    const fingerprint=sha256(canonicalJson({company:state.company,reason:body.reason,rows}));
    return {company:state.company,rows,previewFingerprint:fingerprint,canSave:rows.every(r=>!r.issues.length),note:'Existing CRM fields are retained when linking. Tally is never changed. A refreshed preview is required if sources, duplicates or targets change.'};
  }
  async preview(user,input){const body=validate(customerWizardBody,input);return this.plan(user,body);}
  async commit(user,input){
    const body=validate(customerWizardCommit,input);
    try{return await this.transactions.run(user,body.reason,async()=>{
      await this.repository.lock();
      const plan=await this.plan(user,body);
      if(plan.previewFingerprint!==body.previewFingerprint)throw conflict('The reviewed data changed. Refresh the preview before saving.','PREVIEW_STALE');
      if(!plan.canSave)throw validationFailed('Resolve every blocked preview row before saving.');
      const results=[];
      for(const row of plan.rows){
        if(row.outcome==='ALREADY_LINKED'){results.push({recordKey:row.source.recordKey,customerId:row.source.linked.customerId,outcome:row.outcome});continue;}
        let customerId=row.target?.id;
        if(row.entry.action==='create'){
          const created=await this.repository.create(row.source,row.entry,user);customerId=created.id;
          await this.audit.record({actorId:user.id,entity:'CUSTOMER',recordId:customerId,action:'CREATE_FROM_TALLY_REVIEW',newValue:{name:row.source.name,gstin:row.source.gstin,creditLimit:row.entry.creditLimit,creditDays:row.entry.creditDays,companyId:body.companyId,recordKey:row.source.recordKey},reason:body.reason});
          if(created.contactId)await this.audit.record({actorId:user.id,entity:'CUSTOMER_CONTACT',recordId:created.contactId,action:'CREATE_FROM_TALLY_REVIEW',newValue:{customerId,phone:row.source.phone,email:row.source.email},reason:body.reason});
        }
        await this.repository.link(body.companyId,row.source.recordKey,customerId,user);
        await this.audit.record({actorId:user.id,entity:'TALLY_CRM_LINK',recordId:row.source.recordKey,action:row.entry.action==='create'?'BULK_CREATE_AND_LINK':'BULK_LINK_EXISTING',newValue:{companyId:body.companyId,companyGuid:plan.company.tally_guid,entity:'ledgers',crmKind:'customer',crmId:customerId,recordKey:row.source.recordKey,tallyGuid:row.source.guid,masterId:row.source.masterId,sourceRevision:row.source.revision},reason:body.reason});
        results.push({recordKey:row.source.recordKey,customerId,outcome:row.outcome});
      }
      return {company:plan.company,results};
    });}catch(e){if(e.code==='23505')throw conflict('A customer or source link changed concurrently. Refresh the preview; no batch changes were saved.');throw e;}
  }
}

export class CustomerWizardController {
  constructor({wizard}){this.wizard=wizard;}
  routes(){const w=this.wizard;return [
    {method:'GET',path:'/api/v1/tally/customer-wizard',permission:'customers.duplicates',query:querySchema,handler:async({user,query})=>({data:await w.candidates(user,query)})},
    {method:'GET',path:'/api/v1/tally/customer-wizard/targets',permission:'customers.duplicates',query:s.object({companyId:s.uuid(),search:s.string({max:200}).default('')}),handler:async({user,query})=>({data:await w.targets(user,query)})},
    {method:'POST',path:'/api/v1/tally/customer-wizard/preview',permission:'customers.duplicates',body:customerWizardBody,handler:async({user,body})=>({data:await w.preview(user,body)})},
    {method:'POST',path:'/api/v1/tally/customer-wizard/commit',permission:'customers.duplicates',body:customerWizardCommit,idempotency:'required',handler:async({user,body})=>({data:await w.commit(user,body)})}
  ];}
}
