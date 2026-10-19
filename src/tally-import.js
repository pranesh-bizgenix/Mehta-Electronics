import crypto from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const parser = new XMLParser({ ignoreAttributes:false, parseTagValue:false, parseAttributeValue:false, trimValues:false, alwaysCreateTextNode:true });
export const scalar = value => value == null ? null : typeof value === 'object' ? scalar(value['#text']) : String(value);
const field = (record, name) => scalar(record[name]);
const first = (record, names) => names.map(name=>field(record,name)).find(value=>value!=null && value.trim()!=='') || null;
const exactName = record => scalar(record['@_NAME']) ?? first(record,['NAME','PARTNO']);
const matching = value => value.toUpperCase().replace(/[^A-Z0-9]/g,'');
const arrays = value => value==null?[]:Array.isArray(value)?value:[value];
const cleanXml = xml => xml.replace(/&#(?:0*[0-8]|0*11|0*12|0*1[4-9]|0*2[0-9]|0*3[01]);/g,'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');

export function parseCollection(xml, kind) {
  const cleaned=cleanXml(xml);
  const validation=XMLValidator.validate(cleaned);
  if(validation!==true) throw new Error(`Malformed XML: ${validation.err.msg.slice(0,160)}`);
  const document=parser.parse(cleaned);
  if(!Object.hasOwn(document,'ENVELOPE'))throw new Error('Missing Tally ENVELOPE.');
  const envelope=document.ENVELOPE || {};
  const lineError=scalar(envelope.BODY?.DATA?.LINEERROR) || scalar(envelope.LINEERROR);
  if(lineError)throw new Error('Tally returned LINEERROR; inspect retained raw payload.');
  const collections=arrays(envelope.BODY?.DATA?.COLLECTION);
  return collections.flatMap(collection=>arrays(collection?.[kind])).filter(record=>record && typeof record==='object');
}

export function parseStructuredVouchers(xml) {
  const cleaned=cleanXml(xml);
  if(XMLValidator.validate(cleaned)!==true)throw new Error('Malformed voucher XML.');
  const envelope=parser.parse(cleaned).ENVELOPE;
  return arrays(envelope?.BODY?.DATA?.COLLECTION).flatMap(collection=>arrays(collection?.VOUCHER))
    .filter(record=>record && (first(record,['GUID','MASTERID','DATE','VOUCHERTYPENAME']) || record['ALLLEDGERENTRIES.LIST']));
}

export function moneyValue(value) {
  if(value==null || value.trim()==='')return null;
  const plain=value.trim().replaceAll(',','').replace(/\s*(Dr|Cr)\s*$/i,'').trim();
  if(!/^[+-]?\d{1,16}(?:\.\d+)?$/.test(plain))throw new Error('Invalid delivered money value; original retained in quarantine.');
  // Pass decimal text to PostgreSQL NUMERIC. Do not convert money through Number.
  return plain;
}
const drCr=value=>value?.match(/\b(Dr|Cr)\s*$/i)?.[1]?.replace(/^dr$/i,'Dr').replace(/^cr$/i,'Cr') || null;
const address = record => {
  const lines=arrays(record['ADDRESS.LIST']).flatMap(list=>arrays(list?.ADDRESS)).map(scalar).filter(Boolean);
  return lines.length?lines.join('\n'):field(record,'ADDRESS');
};

export function prepareMasterRecords(records, kind, companyId, sessionId) {
  const seen=new Map(), normalized=new Map(), warnings=[], bad=[], good=[];
  records.forEach((raw,index)=>{
    try {
      const name=exactName(raw);
      if(!name || !name.trim())throw new Error('Record has no original Tally name.');
      const base=kind==='items'?`name:${name}`:`${field(raw,'GUID')?'guid:'+field(raw,'GUID'):field(raw,'MASTERID')?'master:'+field(raw,'MASTERID'):'name:'+name}`;
      const duplicate=seen.get(base)||0;seen.set(base,duplicate+1);
      const sourceKey=duplicate?`${base}\u001fduplicate:${digest(JSON.stringify(raw))}:${duplicate}`:base;
      if(duplicate)warnings.push({key:`duplicate:${sourceKey}`,message:'Repeated source identity retained as a separate record.',names:[name]});
      const row={id:digest(`${companyId}\u0000${sourceKey}`),company_id:companyId,source_key:sourceKey,name,
        parent_name:field(raw,'PARENT'),raw_record:raw,session_id:sessionId};
      if(kind==='items') {
        Object.assign(row,{normalized_part_number:matching(name),base_unit:field(raw,'BASEUNITS'),description:first(raw,['DESCRIPTION','BASICUSERDESCRIPTION']),hsn:first(raw,['HSNCODE','GSTHSNCODE']),
          closing_quantity_text:field(raw,'CLOSINGBALANCE'),closing_rate_text:field(raw,'CLOSINGRATE'),closing_value:moneyValue(field(raw,'CLOSINGVALUE')),dr_cr:drCr(field(raw,'CLOSINGVALUE'))});
        const names=normalized.get(row.normalized_part_number)||[];names.push(name);normalized.set(row.normalized_part_number,names);
      } else {
        Object.assign(row,{tally_guid:field(raw,'GUID'),master_id:field(raw,'MASTERID'),alter_id:field(raw,'ALTERID'),opening_balance:moneyValue(field(raw,'OPENINGBALANCE')),closing_balance:moneyValue(field(raw,'CLOSINGBALANCE')),dr_cr:drCr(field(raw,'CLOSINGBALANCE'))});
        if(kind==='ledgers')Object.assign(row,{gstin:first(raw,['PARTYGSTIN','GSTIN']),pan:first(raw,['INCOMETAXNUMBER','PAN']),phone:first(raw,['LEDGERMOBILE','LEDGERPHONE','PHONE']),email:first(raw,['EMAIL','EMAILID']),address:address(raw),contact_person:first(raw,['LEDGERCONTACT','CONTACTPERSON'])});
      }
      good.push({row,index,raw});
    }catch(error){bad.push({index,raw,reason:error.message});}
  });
  for(const [key,names] of normalized)if(new Set(names).size>1)warnings.push({key:`matching:${key}`,message:'Distinct original names share a normalized part number; all retained.',names:[...new Set(names)]});
  return {good,bad,warnings};
}

async function audit(tx, id, action, value) {
  await tx`INSERT INTO audit_logs(entity,record_id,action,new_value) VALUES('TALLY_CONNECTOR',${id},${action},${JSON.stringify(value)})`;
}

async function upsertRecords(tx,table,records,quarantine) {
  const write=async rows=>{
    const columns=Object.keys(rows[0]);
    const update=columns.filter(name=>!['id','company_id','source_key'].includes(name));
    await tx`INSERT INTO ${tx(table)} ${tx(rows,columns)} ON CONFLICT(company_id,source_key) DO UPDATE SET ${tx.unsafe(update.map(name=>`"${name}"=EXCLUDED."${name}"`).join(','))},fetched_at=now()`;
  };
  let count=0;
  for(let start=0;start<records.length;start+=250){
    const batch=records.slice(start,start+250);
    await tx`SAVEPOINT master_batch`;
    try{await write(batch.map(item=>item.row));count+=batch.length;await tx`RELEASE SAVEPOINT master_batch`;}
    catch {
      await tx`ROLLBACK TO SAVEPOINT master_batch`;
      for(const item of batch){
        await tx`SAVEPOINT master_row`;
        try{await write([item.row]);count++;await tx`RELEASE SAVEPOINT master_row`;}
        catch(error){await tx`ROLLBACK TO SAVEPOINT master_row`;await quarantine({...item,reason:`Database rejected record (${error.code||'unknown'}); original retained.`});}
      }
      await tx`RELEASE SAVEPOINT master_batch`;
    }
  }
  return count;
}

export async function importTallySession(db,sessionId,{replay=false}={}) {
  try {
    return await db.sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`;
      const [session]=await tx`SELECT * FROM tally_upload_sessions WHERE id=${sessionId} FOR UPDATE`;
      if(!session)throw new Error('Upload session not found.');
      if(session.status==='stored' && session.import_summary && !replay)return session.import_summary;
      const [company]=await tx`INSERT INTO tally_companies(id,name,tally_guid) VALUES(${crypto.randomUUID()},${session.company_name},${session.company_guid})
        ON CONFLICT(name) DO UPDATE SET tally_guid=COALESCE(EXCLUDED.tally_guid,tally_companies.tally_guid) RETURNING id`;
      const datasets=await tx`SELECT field_name,string_agg(content,'' ORDER BY sequence) AS content,count(*)::integer AS chunks,min(sequence) AS first,max(sequence) AS last
        FROM tally_upload_chunks WHERE session_id=${sessionId} GROUP BY field_name`;
      const summary={companyId:company.id,sessionId,datasets:{},customers:0,items:0,groups:0,vouchers:0,warnings:0,quarantined:0};
      for(const dataset of datasets){
        await tx`INSERT INTO tally_raw_payloads(id,company_id,session_id,run_id,dataset,content_hash,content)
          VALUES(${crypto.randomUUID()},${company.id},${sessionId},${session.sync_job_id},${dataset.field_name},${digest(dataset.content)},${dataset.content}) ON CONFLICT DO NOTHING`;
        let payloadCount=0,imported=0,quarantined=0,error=null,state='retained';
        try{
          if(dataset.first!==0 || dataset.last+1!==dataset.chunks)throw new Error('Missing chunk sequence; raw content retained.');
          const definition={ledgersXml:['ledgers','LEDGER','tally_ledgers'],stockXml:['items','STOCKITEM','tally_stock_items'],groupsXml:['groups','GROUP','tally_groups']}[dataset.field_name];
          if(definition){
            const [kind,element,table]=definition;
            const records=parseCollection(dataset.content,element);payloadCount=records.length;
            const prepared=prepareMasterRecords(records,kind,company.id,sessionId);
            const quarantine=async item=>{
              quarantined++;
              await tx`INSERT INTO tally_import_quarantine(id,company_id,session_id,dataset,record_index,reason,raw_record)
                VALUES(${crypto.randomUUID()},${company.id},${sessionId},${dataset.field_name},${item.index},${item.reason},${tx.json(item.raw)})
                ON CONFLICT(session_id,dataset,record_index) DO UPDATE SET reason=EXCLUDED.reason,raw_record=EXCLUDED.raw_record`;
            };
            for(const item of prepared.bad)await quarantine(item);
            imported=await upsertRecords(tx,table,prepared.good,quarantine);
            for(const warning of prepared.warnings)await tx`INSERT INTO tally_import_warnings(id,company_id,session_id,dataset,warning_key,message,details)
              VALUES(${crypto.randomUUID()},${company.id},${sessionId},${dataset.field_name},${warning.key},${warning.message},${tx.json(warning.names)}) ON CONFLICT(session_id,dataset,warning_key) DO UPDATE SET details=EXCLUDED.details`;
            summary.warnings+=prepared.warnings.length;
            summary[kind==='ledgers'?'customers':kind]=imported;
            state=quarantined?'partial':'imported';
          } else if(dataset.field_name==='vouchersXml') {
            payloadCount=parseStructuredVouchers(dataset.content).length;summary.vouchers=payloadCount;
            state=payloadCount?'retained':'awaiting_data';
          }
        }catch(failure){error=failure.message;state='failed';}
        await tx`INSERT INTO tally_run_datasets(company_id,session_id,dataset,status,payload_count,imported_count,quarantined_count,error,processed_at)
          VALUES(${company.id},${sessionId},${dataset.field_name},${state},${payloadCount},${imported},${quarantined},${error},now())
          ON CONFLICT(session_id,dataset) DO UPDATE SET status=EXCLUDED.status,payload_count=EXCLUDED.payload_count,imported_count=EXCLUDED.imported_count,quarantined_count=EXCLUDED.quarantined_count,error=EXCLUDED.error,processed_at=now()`;
        summary.datasets[dataset.field_name]={status:state,payloadCount,imported,quarantined,error};summary.quarantined+=quarantined;
      }
      for(const required of ['ledgersXml','stockXml','groupsXml','vouchersXml','balanceSheetXml','profitAndLossXml','billsReceivableXml','billsPayableXml'])if(!summary.datasets[required])summary.datasets[required]={status:'failed',error:'Required dataset has not arrived.'};
      const failures=Object.values(summary.datasets).filter(item=>item.status==='failed');
      summary.status=failures.length?'failed':summary.quarantined?'partial':'stored';
      const message=failures.length?failures.map(item=>item.error).join('; ').slice(0,1000):`Imported ${summary.customers} ledgers, ${summary.items} items, ${summary.groups} groups; ${summary.vouchers} structured vouchers. ${summary.quarantined} quarantined.`;
      await tx`UPDATE tally_upload_sessions SET status=${failures.length?'failed':'stored'},completed_at=now(),import_summary=${tx.json(summary)} WHERE id=${sessionId}`;
      if(session.sync_job_id)await tx`UPDATE tally_sync_jobs SET status=${summary.status},message=${message},record_count=${summary.customers+summary.items+summary.groups+summary.vouchers},last_progress_at=now(),completed_at=now() WHERE id=${session.sync_job_id}`;
      if(!failures.length)await tx`UPDATE tally_connectors SET last_seen_at=now(),last_sync_at=now() WHERE id=${session.connector_id}`;
      await audit(tx,sessionId,failures.length?'IMPORT_FAILED':'IMPORT_COMPLETED',{...summary,datasets:summary.datasets});
      if(summary.quarantined)await audit(tx,sessionId,'RECORDS_QUARANTINED',{count:summary.quarantined});
      return summary;
    });
  } catch(error) {
    await markFinalizeFailed(db,sessionId,error);
    throw error;
  }
}

export async function markFinalizeFailed(db,sessionId,error) {
  await db.sql.begin(async tx=>{
    const message=error.code?`Finalize failed (${error.code}); raw upload retained.`:String(error.message).slice(0,1000);
    await tx`UPDATE tally_upload_sessions SET status='failed',completed_at=now() WHERE id=${sessionId}`;
    await tx`UPDATE tally_sync_jobs SET status='failed',message=${message},completed_at=now() WHERE id=(SELECT sync_job_id FROM tally_upload_sessions WHERE id=${sessionId})`;
    await audit(tx,sessionId,'FINALIZE_FAILED',{message});
  });
}

export async function markStalledRuns(sql,timeoutMinutes=30) {
  return sql.begin(async tx=>{
    const stalled=await tx`UPDATE tally_sync_jobs SET status='stalled',completed_at=now(),message='No upload or progress received within the configured timeout. Raw data retained for replay.'
      WHERE status='running' AND last_progress_at < now()-(${timeoutMinutes}::integer * interval '1 minute') RETURNING id`;
    for(const job of stalled)await audit(tx,job.id,'SYNC_STALLED',{timeoutMinutes});
    return stalled.length;
  });
}
