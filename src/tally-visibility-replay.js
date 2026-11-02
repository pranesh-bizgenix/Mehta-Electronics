import crypto from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { parseCollection, prepareMasterRecords, scalar, cleanXml } from './tally-import.js';
import { tallySalesDocumentKind, tallyVoucherMetadata } from './tally-sales-documents.js';

const entityTags = {COMPANY:'companies',GROUP:'groups',LEDGER:'ledgers',STOCKITEM:'items',STOCKGROUP:'stock_groups',STOCKCATEGORY:'categories',UNIT:'units',GODOWN:'godowns',PRICELEVEL:'price_levels',COSTCENTRE:'cost_centres',VOUCHER:'vouchers',VOUCHERTYPE:'voucher_types'};
const array = v => v == null ? [] : Array.isArray(v) ? v : [v];
const parser = new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,alwaysCreateTextNode:true});
const keyHash = text => crypto.createHash('sha256').update(text).digest('hex');

export async function indexCompanyMetadata(sql,companyId,sessionId,at) {
  // These are stored metadata columns, not fabricated company XML.
  return sql`INSERT INTO tally_visibility_records(id,company_id,entity,record_key,session_id,name,raw_record,fields,content_hash,observed_at)
    SELECT md5('companies' || c.id::text || ${sessionId} || md5(to_jsonb(c)::text)),c.id,'companies',c.id::text,${sessionId},c.name,'{}'::jsonb,
      tally_flatten_fields(to_jsonb(c),'/stored'),md5(to_jsonb(c)::text),${at}
    FROM tally_companies c WHERE c.id=${companyId} ON CONFLICT DO NOTHING RETURNING id`;
}

/** Replays immutable payloads into the additive index ONLY; no source-table writes. */
export async function replayVisibilityPayload(sql,payload) {
  const xml=cleanXml(payload.content);
  const validation = XMLValidator.validate(xml);
  if (validation !== true) return {payloadId:payload.id,indexed:0,error:'Malformed XML retained; field indexing skipped.'};
  const document = parser.parse(xml), records = [], invalid = [];
  let voucherIndex = 0;
  if(scalar(document.ENVELOPE?.BODY?.DATA?.LINEERROR)||scalar(document.ENVELOPE?.LINEERROR))return {payloadId:payload.id,indexed:0,error:'Tally returned LINEERROR; original payload retained.'};
  const sourceCompany=payload.dataset==='companiesXml' ? (await sql`SELECT id,name,tally_guid,created_at FROM tally_companies WHERE id=${payload.company_id}`)[0] : null;
  const definition={ledgersXml:['ledgers','LEDGER'],stockXml:['items','STOCKITEM'],groupsXml:['groups','GROUP']}[payload.dataset];
  if (definition) {
    const [kind,tag]=definition;
    const prepared=prepareMasterRecords(parseCollection(payload.content,tag),kind,payload.company_id,payload.session_id);
    for(const {row} of prepared.good) records.push({entity:kind,key:row.id,name:row.name,parent:row.parent_name,raw:row.raw_record,stored:row});
    // Even rows whose financial normalization failed remain discoverable in quarantine.
    for(const {raw,index} of prepared.bad)records.push({entity:'quarantined',key:`${payload.id}:${index}`,name:scalar(raw['@_NAME']) || `Quarantined row ${index}`,raw,stored:{dataset:payload.dataset,record_index:index}});
  }
  const walk=(value)=>{
    if(Array.isArray(value)) { value.forEach(walk); return; }
    if(!value || typeof value!=='object')return;
    for(const [tag,child] of Object.entries(value)) {
      const entity=entityTags[tag];
      if(entity && !definition)for(const raw of array(child)) {
        if(!raw || typeof raw!=='object')continue;
        if(entity==='vouchers') {
          const index=voucherIndex++;
          if(tallySalesDocumentKind(raw)&&!scalar(raw.GUID)&&!scalar(raw.MASTERID)) {
            invalid.push({raw,index,reason:'Quotation/enquiry has no stable Tally GUID or Master ID; original retained for review.'});continue;
          }
        }
        const name=scalar(raw['@_NAME']) || scalar(raw.NAME) || scalar(raw.VOUCHERNUMBER) || scalar(raw.GUID) || scalar(raw.MASTERID);
        if(!name)continue;
        const identity=scalar(raw.GUID) || scalar(raw.MASTERID) || (entity==='vouchers' ? `${scalar(raw.VOUCHERTYPENAME)}\0${scalar(raw.DATE)}\0${name}` : name);
        const sameCompany=entity==='companies' && sourceCompany && (sourceCompany.tally_guid
          ? scalar(raw.GUID)===sourceCompany.tally_guid : name===sourceCompany.name);
        records.push({entity,key:sameCompany?sourceCompany.id:keyHash(`${payload.company_id}\0${entity}\0${identity}`),name,parent:scalar(raw.PARENT),raw,
          stored:{...(sameCompany?sourceCompany:{}),...(entity==='vouchers'?tallyVoucherMetadata(raw):{}),name,parent_name:scalar(raw.PARENT)}});
        if(entity==='vouchers') {
          const kind=tallySalesDocumentKind(raw);
          if(kind)records.push({entity:kind,key:keyHash(`${payload.company_id}\0vouchers\0${identity}`),name,parent:scalar(raw.VOUCHERTYPENAME),raw,
            stored:{name,parent_name:scalar(raw.VOUCHERTYPENAME),...tallyVoucherMetadata(raw)}});
        }
      }
      if(!entity)walk(child);
    }
  };
  walk(document);
  // Report payloads themselves are records too: every parsed field is indexed.
  // Voucher payloads are already indexed per source document. Flattening the complete
  // multi-megabyte envelope again duplicates every item and makes full imports unbounded.
  // Exact original XML remains in tally_raw_payloads.
  if(!definition&&!['vouchersXml','salesDocumentsXml'].includes(payload.dataset))records.push({entity:'reports',key:payload.dataset,name:payload.dataset,raw:document,stored:{name:payload.dataset,dataset:payload.dataset}});
  const seen=new Map();
  for(const row of records){const identity=`${row.entity}:${row.key}`,count=seen.get(identity)||0;seen.set(identity,count+1);if(count)row.key+=`\u001fduplicate:${keyHash(JSON.stringify(row.raw))}:${count}`;}
  let indexed=0;
  for(const row of invalid)await sql`INSERT INTO tally_import_quarantine(id,company_id,session_id,dataset,record_index,reason,raw_record)
    VALUES(${crypto.randomUUID()},${payload.company_id},${payload.session_id},${payload.dataset},${row.index},${row.reason},${sql.json(row.raw)}) ON CONFLICT(session_id,dataset,record_index) DO NOTHING`;
  for(const row of records) {
    const raw=sql.json(row.raw),stored=sql.json({...row.stored,raw_record:undefined,session_id:payload.session_id,company_id:payload.company_id});
    const inserted=await sql`INSERT INTO tally_visibility_records(id,company_id,entity,record_key,session_id,payload_id,name,parent_name,raw_record,fields,content_hash,observed_at)
      SELECT md5(${row.entity} || ${row.key} || ${payload.session_id} || md5(${raw}::jsonb::text)),${payload.company_id},${row.entity},${row.key},${payload.session_id},${payload.id},${row.name},${row.parent || null},${raw},
        tally_flatten_fields(${stored}::jsonb - 'raw_record' - 'fetched_at','/stored') || tally_flatten_fields(${raw}::jsonb,'/xml'),md5(${raw}::jsonb::text),${payload.received_at}
      ON CONFLICT DO NOTHING RETURNING id`;
    indexed+=inserted.length;
  }
  return {payloadId:payload.id,indexed,quarantined:invalid.length,entityRows:records.filter(row=>!['reports','quarantined'].includes(row.entity)).length,error:null};
}

export async function replayVisibility(db,{companyId,sessionId}={}) {
  const payloads = await db.prepare(`SELECT * FROM tally_raw_payloads WHERE (?::uuid IS NULL OR company_id=?::uuid) AND (?::uuid IS NULL OR session_id=?::uuid) ORDER BY received_at,id`).all(companyId||null,companyId||null,sessionId||null,sessionId||null);
  const results=[];
  // One payload per transaction: bounded work; retries are idempotent.
  for(const payload of payloads)results.push(await db.sql.begin(async tx=>{
    await indexCompanyMetadata(tx,payload.company_id,payload.session_id,payload.received_at);
    return replayVisibilityPayload(tx,payload);
  }));
  return {payloads:results.length,indexed:results.reduce((sum,r)=>sum+r.indexed,0),errors:results.filter(r=>r.error).length,results};
}
