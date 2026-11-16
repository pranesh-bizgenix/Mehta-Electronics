import {s,validate} from '../../core/schema.js';
import {canonicalJson,sha256} from '../../core/runtime.js';
import {conflict,notFound,validationFailed} from '../../core/errors.js';
import {readItemSources,itemLinkMatches} from '../../tally-item-links.js';

export const itemPartKey=value=>String(value??'').normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');
const unitKey=value=>String(value??'').trim().toUpperCase();
const hsnKey=value=>String(value??'').trim().replace(/\s/g,'').toUpperCase();
const entry=s.object({recordKey:s.string({min:1,max:300,trim:false}),action:s.enum(['create','link']),itemId:s.id().optional(),partCode:s.string({min:1,max:200}).optional(),packSize:s.string({max:40}).optional(),acknowledgeDuplicates:s.bool().default(false)});
const fields={companyId:s.uuid(),entries:s.array(entry,{min:1,max:100}),reason:s.reason()};
const previewSchema=s.object(fields),commitSchema=s.object({...fields,previewFingerprint:s.string({pattern:/^[a-f0-9]{64}$/})});
const filters=s.object({companyId:s.uuid(),page:s.int({min:1,max:1000000}).default(1),pageSize:s.int({min:1,max:100}).default(25),search:s.string({max:200}).default(''),group:s.string({max:200}).optional(),brand:s.string({max:200}).optional(),brandStatus:s.enum(['all','delivered','missing']).default('all'),duplicates:s.enum(['all','with','without']).default('all'),linkage:s.enum(['all','unlinked','linked']).default('unlinked')});

export class ItemWizardRepository {
  constructor(db){this.db=db;}
  async company(id){return this.db.prepare('SELECT id,name,tally_guid FROM tally_companies WHERE id=?').get(id);}
  async sources(companyId){return readItemSources(this.db,companyId);}
  async items(){return this.db.prepare('SELECT id,part_code::text AS part_code,description,hsn,uom,brand,pack_size::text AS pack_size,status,updated_at::text AS revision FROM items ORDER BY id').all();}
  async links(companyId){return this.db.prepare('SELECT * FROM crm_tally_item_links WHERE company_id=? ORDER BY id').all(companyId);}
  async visibilityLinks(companyId){return this.db.prepare("SELECT record_key,crm_id FROM tally_visibility_crm_links WHERE company_id=? AND entity='items' AND crm_kind='item'").all(companyId);}
  async lock(){
    await this.db.prepare("SELECT set_config('lock_timeout','5s',true)").get();
    await this.db.prepare('SELECT pg_advisory_xact_lock(73429922),pg_advisory_xact_lock(73429924)').get();
    await this.db.exec('LOCK TABLE items IN SHARE ROW EXCLUSIVE MODE');
    await this.db.exec('LOCK TABLE crm_tally_item_links IN SHARE ROW EXCLUSIVE MODE');
    await this.db.exec('LOCK TABLE tally_visibility_current_cache IN SHARE MODE');
  }
  async create(source,entry,user){return (await this.db.prepare('INSERT INTO items(part_code,description,hsn,uom,brand,pack_size,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?) RETURNING id').get(entry.partCode??source.part_code,source.description||source.name,source.hsn||null,source.uom,source.brand||null,entry.packSize,user.id,user.id)).id;}
  async link(companyId,source,itemId,user,legacy){
    if(legacy){await this.db.prepare('UPDATE crm_tally_item_links SET tally_record_key=?,tally_guid=?,tally_master_id=? WHERE id=?').run(source.record_key,source.guid,source.master_id,legacy.id);return legacy.id;}
    return (await this.db.prepare('INSERT INTO crm_tally_item_links(company_id,item_id,tally_name,tally_record_key,tally_guid,tally_master_id,created_by) VALUES(?,?,?,?,?,?,?) RETURNING id').get(companyId,itemId,source.name,source.record_key,source.guid,source.master_id,user.id)).id;
  }
  async reason(user,reason){await this.db.prepare("SELECT set_config('mehta.actor_id',?,true),set_config('mehta.audit_reason',?,true)").get(String(user.id),reason);}
}

function duplicateIndex(items){
  const part=new Map(),tax=new Map();
  for(const item of items){const key=itemPartKey(item.part_code),hsn=hsnKey(item.hsn),uom=unitKey(item.uom);
    if(key){const rows=part.get(key)||[];rows.push(item);part.set(key,rows);}
    if(hsn&&uom){const k=`${hsn}\0${uom}`,rows=tax.get(k)||[];rows.push(item);tax.set(k,rows);}}
  const group=list=>({list,ids:new Set(list.map(i=>i.id)),fingerprint:sha256(canonicalJson(list))});
  const partGroups=new Map([...part].map(([key,list])=>[key,group(list)])),taxGroups=new Map([...tax].map(([key,list])=>[key,group(list)]));
  const empty=group([]);
  return (code,hsn,uom)=>{
    const p=partGroups.get(itemPartKey(code))||empty,t=hsn&&uom?taxGroups.get(`${hsnKey(hsn)}\0${unitKey(uom)}`)||empty:empty;
    const sample=[...p.list.slice(0,20),...t.list.slice(0,20)],matches=new Map();
    for(const item of sample)if(!matches.has(item.id))matches.set(item.id,{...item,reasons:[...(p.ids.has(item.id)?['PART_NUMBER']:[]),...(t.ids.has(item.id)?['HSN_UOM']:[])]});
    return {duplicates:[...matches.values()].slice(0,20),duplicateCount:t.list.length+p.list.filter(i=>!t.ids.has(i.id)).length,duplicateFingerprint:sha256(`${p.fingerprint}:${t.fingerprint}`)};
  };
}
export class ItemWizardService {
  constructor({repository,access,transactions,audit}){Object.assign(this,{repository,access,transactions,audit});}
  async state(user,companyId){
    this.access.require(user,'items.read');const company=await this.repository.company(companyId);if(!company)throw notFound('Selected imported company not found.');
    const [sources,items,links,visibility]=await Promise.all([this.repository.sources(companyId),this.repository.items(),this.repository.links(companyId),this.repository.visibilityLinks(companyId)]);
    const duplicates=duplicateIndex(items);
    return {company,items,links,visibility,duplicates,sources:sources.map(source=>{
      const linked=links.find(l=>l.status==='ACTIVE'&&!l.is_deleted&&itemLinkMatches(l,source));
      const legacy=links.find(l=>!l.tally_record_key&&l.tally_name===source.name);
      return {...source,...duplicates(source.part_code,source.hsn,source.uom),linked:linked?{itemId:linked.item_id,linkId:linked.id}:null,legacy:legacy?{itemId:legacy.item_id,status:legacy.status}:null};
    })};
  }
  async candidates(user,query){
    const q=validate(filters,query),state=await this.state(user,q.companyId),needle=q.search.toLocaleLowerCase();
    const rows=state.sources.filter(r=>(!needle||[r.name,r.part_code,r.hsn,r.guid,r.master_id].some(v=>String(v??'').toLocaleLowerCase().includes(needle)))&&(!q.group||r.parent_name===q.group)&&(!q.brand||r.brand===q.brand)&&(q.brandStatus==='all'||(q.brandStatus==='delivered')===Boolean(r.brand))&&(q.duplicates==='all'||(q.duplicates==='with')===Boolean(r.duplicateCount))&&(q.linkage==='all'||(q.linkage==='linked')===Boolean(r.linked)));
    return {company:state.company,data:rows.slice((q.page-1)*q.pageSize,q.page*q.pageSize),groups:[...new Set(state.sources.map(s=>s.parent_name).filter(Boolean))].sort(),brands:[...new Set(state.sources.map(s=>s.brand).filter(Boolean))].sort(),missingBrand:state.sources.filter(s=>!s.brand).length,pagination:{page:q.page,pageSize:q.pageSize,total:rows.length,pages:Math.ceil(rows.length/q.pageSize)},note:'Only selected Tally items can become CRM products. Brand is shown only when explicitly delivered. Duplicate HSN/UOM is a review hint, not proof of product identity.'};
  }
  async targets(user,query){const q=validate(s.object({companyId:s.uuid(),search:s.string({max:200}).default('')}),query),state=await this.state(user,q.companyId),needle=q.search.toLocaleLowerCase();return {data:state.items.filter(i=>i.status==='ACTIVE'&&(!needle||`${i.id} ${i.part_code} ${i.description} ${i.hsn??''}`.toLocaleLowerCase().includes(needle))).slice(0,100)};}
  async plan(user,body){
    const state=await this.state(user,body.companyId),used=new Set(),targets=new Set();
    const rows=body.entries.map(entry=>{
      this.access.require(user,entry.action==='create'?'items.create':'items.update');
      const stored=state.sources.find(s=>s.record_key===entry.recordKey),source=stored?{...stored}:null,issues=[];
      if(used.has(entry.recordKey))issues.push('A source item was selected twice.');used.add(entry.recordKey);
      if(!source)return {entry,source:null,target:null,legacy:null,issues:['Source item not found in the selected company.'],outcome:'BLOCKED'};
      if(!source.stable)issues.push(source.identityIssue);
      if(!String(source.uom??'').trim())issues.push('Tally did not deliver a base unit. Correct the source before linking.');
      const target=entry.action==='link'?state.items.find(i=>i.id===entry.itemId):null;
      const same=source.linked&&(entry.action==='create'||source.linked.itemId===entry.itemId);
      if(source.linked&&!same)issues.push('This Tally identity already has a different CRM link.');
      const existing=state.links.find(l=>l.item_id===entry.itemId),reserved=state.links.find(l=>l.tally_name===source.name&&!itemLinkMatches(l,source));
      const legacy=entry.action==='link'&&existing&&!existing.tally_record_key&&existing.tally_name===source.name&&existing.status==='ACTIVE'&&!existing.is_deleted?existing:null;
      if(reserved&&reserved.id!==legacy?.id)issues.push('An existing name-based or archived mapping reserves this Tally name. Review that mapping; it will not be overwritten.');
      const visible=state.visibility.find(l=>l.record_key===source.record_key);
      if(visible&&(!same)&&(entry.action!=='link'||entry.itemId!==visible.crm_id))issues.push('An existing visibility link points to a CRM product. Explicitly choose that product or review the old mapping.');
      if(entry.action==='link'){
        if(!target||target.status!=='ACTIVE')issues.push('Select an active existing CRM product.');
        if(targets.has(entry.itemId))issues.push('Two sources cannot link to the same CRM product in one company.');targets.add(entry.itemId);
        if(existing&&!legacy&&!same)issues.push('This CRM product already has another item mapping in the selected company.');
        if(target&&unitKey(target.uom)!==unitKey(source.uom))issues.push('CRM and Tally units differ. Correct the mapping details first; no unit conversion is inferred.');
        if(target&&source.hsn&&target.hsn&&hsnKey(source.hsn)!==hsnKey(target.hsn))issues.push('CRM and Tally HSN differ. Review the product before linking; neither record is overwritten.');
      }else if(!same){
        if(entry.itemId)issues.push('Choose link-to-existing when supplying an item ID.');
        const code=entry.partCode??source.part_code;
        if(!code?.trim()||code.length>200)issues.push('Enter a CRM part code of 1 to 200 characters.');
        if(entry.packSize===undefined)issues.push('Enter a confirmed pack size; no business default is supplied.');
        else try{const pack=validate(s.decimal({min:0}),entry.packSize);if(/^0(?:\.0+)?$/.test(pack))issues.push('Pack size must be greater than zero.');}catch{issues.push('Pack size must be an exact positive decimal with at most six decimal places.');}
        const dup=state.duplicates(code,source.hsn,source.uom);Object.assign(source,dup);
        if(state.items.some(i=>i.part_code.toUpperCase()===code.toUpperCase()))issues.push('This exact CRM part code exists. Link to the reviewed product instead.');
        else if(dup.duplicateCount&&!entry.acknowledgeDuplicates)issues.push('Review and acknowledge part-number or HSN/UOM similarities, or link to an existing product.');
        const peers=body.entries.filter(e=>e.action==='create'&&e.recordKey!==entry.recordKey).map(e=>({entry:e,source:state.sources.find(s=>s.record_key===e.recordKey)})).filter(p=>p.source);
        if(peers.some(p=>(p.entry.partCode??p.source.part_code).toUpperCase()===code.toUpperCase()))issues.push('Two selected create actions use the same CRM part code.');
        if(!entry.acknowledgeDuplicates&&peers.some(p=>itemPartKey(p.entry.partCode??p.source.part_code)===itemPartKey(code)||source.hsn&&hsnKey(p.source.hsn)===hsnKey(source.hsn)&&unitKey(p.source.uom)===unitKey(source.uom)))issues.push('Other selected items have similar part numbers or HSN/UOM. Review and acknowledge separate products.');
      }
      return {entry,source,target,legacy:legacy?{id:legacy.id,itemId:legacy.item_id}:null,issues,outcome:issues.length?'BLOCKED':same?'ALREADY_LINKED':legacy?'CONFIRM_LEGACY_LINK':entry.action==='create'?'CREATE_AND_LINK':'LINK_EXISTING'};
    });
    return {company:state.company,rows,canSave:rows.every(r=>!r.issues.length),previewFingerprint:sha256(canonicalJson({company:state.company,reason:body.reason,rows})),note:'BR-17: products originate in Tally. This batch creates CRM references only. Existing CRM fields, prices, costs and Tally data are not rewritten.'};
  }
  async preview(user,input){return this.plan(user,validate(previewSchema,input));}
  async commit(user,input){const body=validate(commitSchema,input);try{return await this.transactions.run(user,body.reason,async()=>{
    await this.repository.lock();const plan=await this.plan(user,body);
    if(plan.previewFingerprint!==body.previewFingerprint)throw conflict('The source, duplicates or mappings changed. Refresh the preview.','PREVIEW_STALE');
    if(!plan.canSave)throw validationFailed('Resolve every blocked row before saving.');
    await this.repository.reason(user,body.reason);const results=[];
    for(const row of plan.rows){if(row.outcome==='ALREADY_LINKED'){results.push({recordKey:row.source.record_key,itemId:row.source.linked.itemId,outcome:row.outcome});continue;}
      let itemId=row.target?.id;if(row.entry.action==='create'){itemId=await this.repository.create(row.source,row.entry,user);await this.audit.record({actorId:user.id,entity:'ITEM',recordId:itemId,action:'CREATE_FROM_TALLY_REVIEW',newValue:{companyId:body.companyId,partCode:row.entry.partCode??row.source.part_code,hsn:row.source.hsn,uom:row.source.uom,brand:row.source.brand,packSize:row.entry.packSize},reason:body.reason});}
      const linkId=await this.repository.link(body.companyId,row.source,itemId,user,row.legacy);
      await this.audit.record({actorId:user.id,entity:'TALLY_ITEM_LINK',recordId:linkId,action:row.outcome,newValue:{companyId:body.companyId,companyGuid:plan.company.tally_guid,itemId,recordKey:row.source.record_key,tallyGuid:row.source.guid,masterId:row.source.master_id,sourceRevision:row.source.record_id},reason:body.reason});
      results.push({recordKey:row.source.record_key,itemId,outcome:row.outcome});
    }return {company:plan.company,results};
  });}catch(e){if(e.code==='23505')throw conflict('A part code or source link now exists. Refresh the preview; the batch was rolled back.');if(e.code==='55P03')throw conflict('Item data is being updated. Retry after it completes.');throw e;}}
}
export class ItemWizardController {
  constructor({wizard}){this.wizard=wizard;}
  routes(){const w=this.wizard;return [
    {method:'GET',path:'/api/v1/tally/item-wizard',permission:'items.read',query:filters,handler:async({user,query})=>({data:await w.candidates(user,query)})},
    {method:'GET',path:'/api/v1/tally/item-wizard/targets',permission:'items.read',query:s.object({companyId:s.uuid(),search:s.string({max:200}).default('')}),handler:async({user,query})=>({data:await w.targets(user,query)})},
    {method:'POST',path:'/api/v1/tally/item-wizard/preview',permission:'items.read',body:previewSchema,handler:async({user,body})=>({data:await w.preview(user,body)})},
    {method:'POST',path:'/api/v1/tally/item-wizard/commit',permission:'items.read',body:commitSchema,idempotency:'required',handler:async({user,body})=>({data:await w.commit(user,body)})}
  ];}
}
