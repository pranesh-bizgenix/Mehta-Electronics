import {fingerprint} from '../../core/runtime.js';
export const MAPPING_GENERATOR_VERSION='1.0.0';
export const MAPPING_ENTITIES=Object.freeze(['vouchers','quotations','ledgers','groups','godowns','units','items','voucher_types']);
export function selectedMappingBindings(mapping){
 const bindings=[];
 if(mapping.ledgerEntries!=null&&!Array.isArray(mapping.ledgerEntries))throw Object.assign(new Error('Mapping ledgerEntries must be a list.'),{status:422});
 for(const key of ['unitSourceKeys','itemBindings','partyBindings'])if(mapping[key]!=null&&(typeof mapping[key]!=='object'||Array.isArray(mapping[key])))throw Object.assign(new Error(`Mapping ${key} must be an identity object.`),{status:422});
 const add=(entity,key)=>{if(key==null||key==='')return;if(typeof key!=='string'||key.length>3000)throw Object.assign(new Error('Mapping source identities must be bounded stable record keys.'),{status:422});bindings.push({entity,key});};
 add('voucher_types',mapping.voucherTypeSourceKey);add('godowns',mapping.godownSourceKey);add('groups',mapping.parentSourceKey);
 for(const row of mapping.ledgerEntries??[]){if(!row||typeof row!=='object'||Array.isArray(row))throw Object.assign(new Error('Each mapping ledger entry must be an object.'),{status:422});if(row.party!==true)add('ledgers',row.recordKey);}
 for(const key of Object.values(mapping.unitSourceKeys??{}))add('units',key);
 for(const key of Object.values(mapping.itemBindings??{}))add('items',key);
 for(const key of Object.values(mapping.partyBindings??{}))add('ledgers',key);
 const unique=[...new Map(bindings.map(row=>[JSON.stringify([row.entity,row.key]),row])).values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 if(unique.length>500)throw Object.assign(new Error('Review at most 500 explicit mapping source bindings per version.'),{status:422});return unique;
}
const scalar=value=>value==null?null:typeof value==='object'?scalar(value['#text']):String(value).trim()||null;
const values=value=>value==null?[]:Array.isArray(value)?value:[value];
const limited=value=>typeof value==='string'?value.slice(0,300):value;

/** Pure analysis of retained observations. No source name establishes a CRM binding. */
export function mappingCandidates({company,category,records,counts,receipts}){
 const sources=[],voucherGroups=new Map(),fields=new Map(),evidence=[];
 const observe=(path,id)=>{const found=fields.get(path)??new Set();found.add(id);fields.set(path,found);};
 for(const row of records){
  const raw=row.raw_record??{},stored=row.summary_fields??{},guid=scalar(stored['/stored/tally_guid']??stored['/stored/guid']??raw.GUID),masterId=scalar(stored['/stored/master_id']??raw.MASTERID);
  const ref={entity:row.entity,recordKey:row.record_key,recordId:row.record_id,payloadId:row.payload_id??null,sessionId:row.session_id,contentHash:row.content_hash,observedAt:row.observed_at,rawAvailable:row.source_content_available!==false};evidence.push(ref);
  sources.push({...ref,name:limited(row.name),guid,masterId,stable:Boolean(guid||masterId)});
  if(['vouchers','quotations'].includes(row.entity)){
   const type=scalar(raw.VOUCHERTYPENAME??raw['@_VCHTYPE'])??scalar(stored['/stored/voucher_type']),optional=scalar(raw.ISOPTIONAL)??scalar(stored['/stored/is_optional']),date=scalar(raw.DATE)??scalar(stored['/stored/date']);
   const key=JSON.stringify([row.entity,type]),group=voucherGroups.get(key)??{entity:row.entity,type,count:0,optional:{yes:0,no:0,unknown:0},dateFormats:{},referencePresent:0,narrationPresent:0,evidenceIds:[]};
   group.count++;group.optional[/^(yes|true|1)$/i.test(optional??'')?'yes':/^(no|false|0)$/i.test(optional??'')?'no':'unknown']++;
   const dateFormat=/^\d{8}$/.test(date??'')?'YYYYMMDD':/^\d{4}-\d{2}-\d{2}$/.test(date??'')?'YYYY-MM-DD':date?'OTHER_DELIVERED_FORMAT':'NOT_REPORTED';group.dateFormats[dateFormat]=(group.dateFormats[dateFormat]??0)+1;
   if(scalar(raw.REFERENCE))group.referencePresent++;if(scalar(raw.NARRATION))group.narrationPresent++;if(group.evidenceIds.length<20)group.evidenceIds.push(row.record_id);voucherGroups.set(key,group);
   for(const tag of ['DATE','VOUCHERTYPENAME','VOUCHERNUMBER','PARTYLEDGERNAME','REFERENCE','NARRATION','ISOPTIONAL'])if(Object.hasOwn(raw,tag))observe(tag,row.record_id);
   for(const container of ['ALLINVENTORYENTRIES.LIST','INVENTORYENTRIES.LIST','ALLLEDGERENTRIES.LIST','LEDGERENTRIES.LIST'])if(Object.hasOwn(raw,container)){
    observe(container,row.record_id);for(const line of values(raw[container]))if(line&&typeof line==='object'){
     for(const tag of ['STOCKITEMNAME','ACTUALQTY','BILLEDQTY','RATE','AMOUNT','DISCOUNT','LEDGERNAME','ISPARTYLEDGER'])if(Object.hasOwn(line,tag))observe(`${container}/${tag}`,row.record_id);
     for(const batch of values(line['BATCHALLOCATIONS.LIST']))if(batch&&typeof batch==='object')for(const tag of ['GODOWNNAME','ACTUALQTY','BILLEDQTY','AMOUNT'])if(Object.hasOwn(batch,tag))observe(`${container}/BATCHALLOCATIONS.LIST/${tag}`,row.record_id);
    }
   }
  }
 }
 const coverage=MAPPING_ENTITIES.map(entity=>{const scoped=records.filter(row=>row.entity===entity),total=Number(counts.find(row=>row.entity===entity)?.count??0),inspected=scoped.length;return {entity,total,inspected,truncated:total>inspected,oversized:scoped.filter(row=>row.source_content_available===false).length};});
 const proof={generatorVersion:MAPPING_GENERATOR_VERSION,companyId:company.id,companyGuid:company.guid,category,coverage,records:evidence,receipts};
 return {company,category,generatorVersion:MAPPING_GENERATOR_VERSION,sourceFingerprint:fingerprint(proof),coverage,sources,vouchers:[...voucherGroups.values()],fieldCandidates:[...fields].map(([path,ids])=>({path,count:ids.size,evidenceIds:[...ids].slice(0,20)})),evidence:proof,
  unresolved:['Voucher numbering authority','Tax components and posting signs','Idempotency reference and read-back methods','CRM field mapping and approved item/party bindings','Owner and named Tally expert approval'],
  note:'Counts are retained observations, not a live Tally check. Voucher counts are reported separately by entity; a voucher may appear in both entities. Source bodies above 64 KiB are omitted from field inspection and labelled; their immutable identities/hashes remain evidence. Names and observed tags are candidates only. Missing identities, mappings and business decisions stay unresolved.'};
}
