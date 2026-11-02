const fail=(status,message)=>Object.assign(new Error(message),{status});
import { escapeLike } from './security.js';
import { writeAudit } from './db.js';
import { replayVisibility } from './tally-visibility-replay.js';
const catalogues=new WeakMap();

/** @implements {import('./tally-visibility-contracts').TallyRepository} */
export class TallyVisibilityRepository {
  constructor(db) { this.db = db; }
  async receipt(companyId,dataset) {
    return this.db.prepare('SELECT status,error FROM tally_run_datasets WHERE company_id=? AND dataset=? ORDER BY processed_at DESC LIMIT 1').get(companyId,dataset);
  }
  async links(companyId,entity,key) {
    return this.db.prepare(`SELECT record_key,crm_kind,crm_id FROM tally_visibility_crm_links WHERE company_id=? AND entity=?${key===undefined?'':' AND record_key=?'}`).all(companyId,entity,...(key===undefined?[]:[key]));
  }
  async crmRecord(kind,id) {
    const table={customer:'customers',vendor:'crm_parties',item:'items'}[kind];
    if(!table)throw new Error('Unknown CRM kind');
    return this.db.prepare(`SELECT id,${kind==='item'?'part_code AS name,hsn,uom':'name,gstin'} FROM ${table} WHERE id=?`).get(id);
  }
  async salesRelationships(companyId,document) {
    const requested=[{role:'customer',entity:'ledgers',name:document.party_name,id:document.partyLedgerId},
      ...document.lines.map(line=>({role:'item',entity:'items',name:line.stockItemName,id:line.stockItemId}))];
    const resolved=[];
    for(const source of requested) {
      const matches=source.id ? await this.db.prepare(`SELECT record_key,name FROM tally_visibility_current_cache WHERE company_id=? AND entity=?
        AND (summary_fields->>'/stored/tally_guid'=? OR summary_fields->>'/stored/master_id'=? OR summary_fields->>'/xml/GUID/#text'=?)`).all(companyId,source.entity,source.id,source.id,source.id)
        : source.name ? await this.db.prepare('SELECT record_key,name FROM tally_visibility_current_cache WHERE company_id=? AND entity=? AND name=?').all(companyId,source.entity,source.name) : [];
      const match=matches.length===1?matches[0]:null;
      const links=match?await this.links(companyId,source.entity,match.record_key):[];
      resolved.push({...source,match,matchedBy:match?(source.id?'tally_id':'unique_exact_source_name'):null,status:match?'matched':matches.length?'ambiguous':'unresolved',crmLinks:links});
    }
    return resolved;
  }
  async payloads(companyId,sessionId) {
    return this.db.prepare(`SELECT id,dataset,session_id,run_id,received_at,length(content) AS bytes FROM tally_raw_payloads WHERE company_id=?${sessionId?' AND session_id=?':''} ORDER BY received_at DESC,id`).all(companyId,...(sessionId?[sessionId]:[]));
  }
  async payload(companyId,id) {
    return this.db.prepare('SELECT id,dataset,session_id,received_at,content FROM tally_raw_payloads WHERE id=? AND company_id=?').get(id,companyId);
  }
  async quarantined(companyId,{page,pageSize},financial) {
    const total=companyId?(await this.db.prepare('SELECT count(*) AS n FROM tally_import_quarantine WHERE company_id=?').get(companyId)).n:0;
    const data=companyId?await this.db.prepare(`SELECT q.id,q.dataset,q.session_id,q.record_index,q.reason,s.created_at AS received_at,
     tally_serialized_fields(tally_visible_fields_v2(tally_flatten_fields(q.raw_record,'/xml'),?::boolean)) AS permitted_fields
     ${financial?',q.raw_record':''} FROM tally_import_quarantine q JOIN tally_upload_sessions s ON s.id=q.session_id
     WHERE q.company_id=? ORDER BY s.created_at DESC,q.id LIMIT ? OFFSET ?`).all(financial,companyId,pageSize,(page-1)*pageSize):[];
    return {data,pagination:{page,pageSize,total,pages:Math.ceil(total/pageSize)}};
  }
  async replay(sessionId) { return replayVisibility(this.db,{sessionId}); }
  async salesSummary(companyId,kind) {
    const current=await this.db.prepare(`SELECT count(*) AS imported,
      count(*) FILTER(WHERE summary_fields->>'/stored/voucher_status'='CANCELLED') AS cancelled,
      max(observed_at) AS last_observed FROM tally_visibility_current_cache WHERE company_id=? AND entity=?`).get(companyId,kind);
    const types=await this.db.prepare(`SELECT summary_fields->>'/stored/voucher_type' AS type,count(*) AS count,
      count(*) FILTER(WHERE summary_fields->>'/stored/is_optional'='Yes') AS optional,
      count(*) FILTER(WHERE summary_fields->>'/stored/is_optional'='No') AS non_optional,
      count(*) FILTER(WHERE summary_fields->>'/stored/voucher_status'='CANCELLED') AS cancelled,
      min(summary_fields->>'/stored/date') AS earliest,max(summary_fields->>'/stored/date') AS latest
      FROM tally_visibility_current_cache WHERE company_id=? AND entity=? GROUP BY 1 ORDER BY 1`).all(companyId,kind);
    const periods=await this.db.prepare(`SELECT substring(summary_fields->>'/stored/date',1,4) AS year,count(*) AS count
      FROM tally_visibility_current_cache WHERE company_id=? AND entity=? GROUP BY 1 ORDER BY 1`).all(companyId,kind);
    const updated=(await this.db.prepare(`SELECT count(*) AS n FROM (SELECT record_key FROM tally_visibility_records
      WHERE company_id=? AND entity=? GROUP BY record_key HAVING count(DISTINCT content_hash)>1) changes`).get(companyId,kind)).n;
    const receipt=await this.db.prepare(`SELECT d.status,d.session_id,d.payload_count,d.quarantined_count,d.error,d.processed_at,s.import_summary,s.sync_from,s.sync_to
      FROM tally_run_datasets d JOIN tally_upload_sessions s ON s.id=d.session_id WHERE d.company_id=? AND d.dataset='salesDocumentsXml' ORDER BY d.processed_at DESC LIMIT 1`).get(companyId);
    const sourceCount=receipt?.import_summary?.salesDocuments?.[kind] ?? null;
    const latestPersisted=receipt ? (await this.db.prepare('SELECT count(DISTINCT record_key) AS n FROM tally_visibility_records WHERE company_id=? AND entity=? AND session_id=?').get(companyId,kind,receipt.session_id)).n : null;
    const missing=['imported','received_empty'].includes(receipt?.status) ? (await this.db.prepare(`SELECT count(*) AS n FROM tally_visibility_current_cache c WHERE c.company_id=? AND c.entity=?
      AND NOT EXISTS(SELECT 1 FROM tally_visibility_records r WHERE r.company_id=c.company_id AND r.entity=c.entity AND r.record_key=c.record_key AND r.session_id=?)`).get(companyId,kind,receipt.session_id)).n : null;
    return {...current,types,periods,updated,sourceCount,latestPersisted,pending:sourceCount===null?null:Math.max(0,sourceCount-(latestPersisted||0)),
      failed:receipt?.status==='failed'?null:receipt?.quarantined_count??null,notSeenInLatest:missing,receipt:receipt?{status:receipt.status,error:receipt.error,sessionId:receipt.session_id,processedAt:receipt.processed_at,from:receipt.sync_from,to:receipt.sync_to}:null,
      note:'Counts cover stored source documents across all imported dates. Updated counts distinct source IDs with changed content. Records missing from a later snapshot remain in history; absence alone does not prove deletion.'};
  }
  async audit(event) { return writeAudit(this.db,event); }
  async transaction(callback,{readOnly=false}={}) {
    return this.db.withConnection(async()=>{
      await this.db.exec(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
      try {const result=await callback();await this.db.exec('COMMIT');return result;}
      catch(error){await this.db.exec('ROLLBACK');throw error;}
    });
  }
  async groupCounts(scope) {
    return this.db.prepare(`${scope.cte} SELECT parent_name,count(*) AS count FROM visible GROUP BY parent_name`).all(...scope.args);
  }
  async groupBalance(scope,parents) {
    if(!parents.length)return null;
    return (await this.db.prepare(`${scope.cte} SELECT sum((fields->>'/stored/closing_balance')::numeric)::text AS balance FROM visible WHERE parent_name IN (${parents.map(()=>'?').join(',')})`).get(...scope.args,...parents)).balance;
  }
  async unlinkedCrm(kind,companyId,{page,pageSize}) {
    const table={customer:'customers',vendor:'crm_parties',item:'items'}[kind];
    if(!table)throw new Error('Unknown CRM kind');
    return this.db.prepare(`SELECT id,${kind==='item'?'part_code AS name':'name'} FROM ${table} c
     WHERE ${kind==='vendor'?"c.company_id=? AND c.party_role='VENDOR' AND NOT c.is_deleted AND":''}
     NOT EXISTS(SELECT 1 FROM tally_visibility_crm_links l WHERE l.crm_id=c.id AND l.crm_kind=? AND l.company_id=?)
     ORDER BY c.id LIMIT ? OFFSET ?`).all(...(kind==='vendor'?[companyId]:[]),kind,companyId,pageSize,(page-1)*pageSize);
  }
  async createLinkedCrm({ctx,source,key,crmKind,user,ip}) {
    const field=k=>source.fields[`/stored/${k}`] ?? null;
    return this.db.withConnection(async()=>{
      await this.db.exec('BEGIN');
      try {
        await this.db.prepare('SELECT pg_advisory_xact_lock(?)').get(73429924);
        const existing=await this.db.prepare('SELECT crm_kind,crm_id FROM tally_visibility_crm_links WHERE company_id=? AND entity=? AND record_key=?').get(ctx.company.id,ctx.entity,key);
        if(existing){await this.db.exec('COMMIT');return {created:false,...existing};}
        await this.db.prepare("SELECT set_config('mehta.actor_id',?,true),set_config('mehta.audit_reason',?,true)").get(String(user.id),'Create CRM record from imported Tally ID');
        let id;
        if(crmKind==='item') {
          if(!field('base_unit'))throw fail(422,'No unit delivered. Complete the item manually.');
          id=(await this.db.prepare('INSERT INTO items(part_code,description,hsn,uom,created_by,updated_by) VALUES(?,?,?,?,?,?)').run(source.name,field('description')||source.name,field('hsn'),field('base_unit'),user.id,user.id)).insertedId;
        } else if(crmKind==='customer') {
          id=(await this.db.prepare('INSERT INTO customers(name,normalized_name,gstin,pan,billing_address,created_by,updated_by) VALUES(?,?,?,?,?,?,?)').run(source.name,source.name.toLowerCase(),field('gstin'),field('pan'),field('address'),user.id,user.id)).insertedId;
          if(field('phone') || field('email'))await this.db.prepare('INSERT INTO customer_contacts(customer_id,name,phone,email,is_primary) VALUES(?,?,?,?,1)').run(id,field('contact_person')||source.name,field('phone'),field('email'));
        } else id=(await this.db.prepare("INSERT INTO crm_parties(company_id,name,party_role,phone,email,gstin,address,created_by) VALUES(?,?,'VENDOR',?,?,?,?,?)").run(ctx.company.id,source.name,field('phone'),field('email'),field('gstin'),field('address'),user.id)).insertedId;
        await this.db.prepare('INSERT INTO tally_visibility_crm_links(company_id,entity,record_key,crm_kind,crm_id,created_by) VALUES(?,?,?,?,?,?)').run(ctx.company.id,ctx.entity,key,crmKind,id,user.id);
        await writeAudit(this.db,{userId:user.id,entity:'TALLY_CRM_LINK',recordId:key,action:'CREATE_FROM_TALLY_ID',newValue:{companyId:ctx.company.id,entity:ctx.entity,crmKind,crmId:id},ipAddress:ip});
        await this.db.exec('COMMIT');return {created:true,crm_kind:crmKind,crm_id:id};
      } catch(error){await this.db.exec('ROLLBACK');if(error.code==='23505')throw fail(409,'A CRM name, code or GSTIN already exists. Review the conflict; records are never linked by name.');throw error;}
    });
  }
  async company(id) {
    return id ? this.db.prepare('SELECT * FROM tally_companies WHERE id=?').get(id)
      : this.db.prepare('SELECT * FROM tally_companies ORDER BY name,id LIMIT 1').get();
  }
  async groups(companyId) {
    return this.db.prepare(`SELECT DISTINCT ON (record_key) record_key AS id,name,parent_name FROM tally_visibility_records r
      WHERE company_id=? AND entity='groups' ORDER BY record_key,observed_at DESC,r.id DESC`).all(companyId);
  }
  async parents(companyId) {
    return this.db.prepare("SELECT DISTINCT parent_name FROM tally_visibility_records WHERE company_id=? AND entity='ledgers'").all(companyId);
  }
  scope(companyId, entity, financial, parents, snapshots=false) {
    const args = [companyId, entity];
    let condition = '';
    if (parents) {
      const named=parents.filter(p=>p!=null);
      condition=` WHERE (${named.length ? `parent_name IN (${named.map(()=>'?').join(',')})` : 'false'}${parents.includes(null)?' OR parent_name IS NULL':''})`;
      args.push(...named);
    }
    const fullCte=`WITH latest AS (
      SELECT ${snapshots?'':'DISTINCT ON (record_key)'} * FROM tally_visibility_records WHERE company_id=? AND entity=?
      ORDER BY record_key,observed_at DESC,(raw_record<>'{}'::jsonb) DESC,id DESC
    ), visible AS (SELECT id,record_key,entity,name,parent_name,session_id,observed_at,
      (SELECT source_system FROM tally_source_observations WHERE session_id=latest.session_id ORDER BY recorded_at DESC,id DESC LIMIT 1) AS source_system,
      (${financial ? 'fields' : 'COALESCE(public_fields,tally_visible_fields_v2(fields,false))'}) || jsonb_build_object('/meta/observed_at',observed_at,'/meta/session_id',session_id,'/meta/record_key',record_key) AS fields
      FROM latest LEFT JOIN tally_visibility_public_fields p ON p.record_id=latest.id${condition})`;
    const currentRelation=entity==='companies'?`(SELECT DISTINCT ON (COALESCE(a.canonical_key,c.record_key)) c.*,COALESCE(a.canonical_key,c.record_key) AS canonical_key
      FROM tally_visibility_current_cache c LEFT JOIN tally_visibility_company_aliases a ON a.company_id=c.company_id AND a.record_key=c.record_key
      WHERE c.entity='companies' ORDER BY COALESCE(a.canonical_key,c.record_key),c.observed_at DESC,c.has_raw DESC,c.record_id DESC)`:'tally_visibility_current_cache';
    const cte=snapshots?fullCte:`WITH visible AS (SELECT c.record_id AS id,${entity==='companies'?'c.canonical_key':'c.record_key'} AS record_key,c.entity,c.name,c.parent_name,c.session_id,c.observed_at,c.source_system,
      ${financial?'c.summary_fields':'c.public_summary'} AS fields,${financial?'c.financial_search':'c.public_search'} AS search_text
      FROM ${currentRelation} c WHERE c.company_id=? AND c.entity=?${condition.replace(/^ WHERE /,' AND ')})`;
    const currentFullCte=`WITH selected_current AS (${cte} SELECT * FROM visible), visible AS (
      SELECT r.id,c.record_key,c.entity,c.name,c.parent_name,c.session_id,c.observed_at,c.source_system,
       ${financial?'r.fields':'COALESCE(p.public_fields,tally_visible_fields_v2(r.fields,false))'} || jsonb_build_object('/meta/observed_at',c.observed_at,'/meta/session_id',c.session_id,'/meta/record_key',c.record_key) AS fields
      FROM selected_current c JOIN tally_visibility_records r ON r.id=c.id LEFT JOIN tally_visibility_public_fields p ON p.record_id=r.id)`;
    return {args,companyId,entity,financial,parents,snapshots,fast:!snapshots,cte,fullCte:snapshots?fullCte:currentFullCte};
  }
  async catalogue(scope) {
    const revision=await this.db.prepare('SELECT count(*) AS n,max(observed_at) AS latest,max(id) AS last_id FROM tally_visibility_records WHERE company_id=? AND entity=?').get(scope.companyId,scope.entity);
    let cache=catalogues.get(this.db);if(!cache){cache=new Map();catalogues.set(this.db,cache);}
    const key=JSON.stringify([scope.cte,scope.args]),version=JSON.stringify(revision),entry=cache.get(key);
    if(entry?.version===version)return entry.columns;
    const columns=(await this.db.prepare(`SELECT key FROM tally_visibility_field_catalogue WHERE company_id=? AND entity=? ${scope.financial?'':'AND nonfinancial'} ORDER BY key`).all(scope.companyId,scope.entity)).map(r=>r.key);
    columns.push('/meta/observed_at','/meta/session_id','/meta/record_key');
    if(cache.size>=100)cache.clear();cache.set(key,{version,columns});return columns;
  }
  async metadata(scope) {
    return this.db.prepare(`${scope.cte} SELECT max(observed_at) AS last_updated FROM visible`).get(...scope.args);
  }
  filtered(scope, query) {
    const args = [...scope.args], where = ['true'];
    if (query.search) {
      // Search values only, after financial projection. Excludes financial side channels.
      where.push(scope.fast?"search_text ILIKE ? ESCAPE '\\'":"EXISTS (SELECT 1 FROM jsonb_each_text(fields) f WHERE f.value ILIKE ? ESCAPE '\\' OR tally_display_text(f.value) ILIKE ? ESCAPE '\\')");
      args.push(`%${escapeLike(query.search)}%`);if(!scope.fast)args.push(`%${escapeLike(query.search)}%`);
    }
    if (query.group) { where.push('parent_name=?'); args.push(query.group); }
    if (query.fromDate) { where.push("fields->>'/stored/date'>=?"); args.push(query.fromDate.replaceAll('-','')); }
    if (query.toDate) { where.push("fields->>'/stored/date'<=?"); args.push(query.toDate.replaceAll('-','')); }
    if (query.customer) { where.push("fields->>'/stored/party_name' ILIKE ? ESCAPE '\\'"); args.push(`%${escapeLike(query.customer)}%`); }
    if (query.voucherStatus) { where.push("fields->>'/stored/voucher_status'=?"); args.push(query.voucherStatus); }
    if (query.optional) { where.push("fields->>'/stored/is_optional'=?"); args.push(query.optional); }
    if (query.state) { where.push(scope.fast?"fields->>'/derived/state'=?":"fields->>'/xml/STATENAME/#text'=?"); args.push(query.state); }
    const gst = scope.fast?"COALESCE(NULLIF(fields->>'/stored/gstin',''),fields->>'/derived/gstin')":"COALESCE(NULLIF(fields->>'/stored/gstin',''),NULLIF(fields->>'/xml/PARTYGSTIN/#text',''),NULLIF(fields->>'/xml/GSTIN/#text',''))";
    const hsn = scope.fast?"COALESCE(NULLIF(fields->>'/stored/hsn',''),fields->>'/derived/hsn')":"COALESCE(NULLIF(fields->>'/stored/hsn',''),NULLIF(fields->>'/xml/HSNCODE/#text',''),NULLIF(fields->>'/xml/GSTHSNCODE/#text',''))";
    const balance = "fields->>'/stored/closing_balance'";
    const filters = {
      missing_gstin: `${gst} IS NULL`, has_gstin: `${gst} IS NOT NULL`,
      invalid_gstin: `${gst} IS NOT NULL AND ${gst} !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
      missing_hsn: `${hsn} IS NULL`, missing_state: scope.fast?"NULLIF(fields->>'/derived/state','') IS NULL":"NULLIF(fields->>'/xml/STATENAME/#text','') IS NULL",
      negative_stock: "fields->>'/stored/closing_quantity_text' ~ '^\\s*-'",
      zero_stock: "fields->>'/stored/closing_quantity_text' ~ '^\\s*[+]?0([.]0+)?(\\s|$)'",
      has_balance: `${balance} IS NOT NULL AND ${balance} !~ '^[+-]?0([.]0+)?$'`,
      zero_value: "fields->>'/stored/closing_value' ~ '^[+-]?0([.]0+)?$'",
      encoding: "EXISTS (SELECT 1 FROM jsonb_each_text(fields) f WHERE f.value ~ '[ÃÂ�]')",
      duplicates: 'name IN (SELECT name FROM visible GROUP BY name HAVING count(*)>1)'
    };
    if (query.quality && filters[query.quality]) where.push(filters[query.quality]);
    return { args, sql: `${scope.cte} SELECT * FROM visible WHERE ${where.join(' AND ')}` };
  }
  async list(scope, query) {
    const directSort={'/stored/name':'name','/stored/parent_name':'parent_name','/meta/observed_at':'observed_at','/meta/session_id':'session_id','/meta/record_key':'record_key'}[query.sort];
    if(scope.fast&&!directSort&&!query.sort.startsWith('/stored/'))scope={...scope,fast:false,cte:scope.fullCte};
    const filtered = this.filtered(scope, query);
    const total = (await this.db.prepare(`SELECT count(*) AS n FROM (${filtered.sql}) filtered`).get(...filtered.args)).n;
    const direction=query.direction === 'desc' ? 'DESC' : 'ASC';
    const order=directSort?`${directSort} ${direction},record_key`:`CASE WHEN fields->>? ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN (fields->>?)::numeric END ${direction} NULLS LAST,fields->>? ${direction} NULLS LAST,record_key`;
    const pageArgs=[...filtered.args,...(directSort?[]:[query.sort,query.sort,query.sort]),query.pageSize,(query.page-1)*query.pageSize];
    if(scope.fast){
      const selected=`${filtered.sql.replace('SELECT * FROM visible',`SELECT *,row_number() OVER (ORDER BY ${order}) AS page_order FROM visible`)} ORDER BY page_order LIMIT ? OFFSET ?`;
      const data=await this.db.prepare(`SELECT selected.id,selected.record_key,selected.entity,selected.name,selected.parent_name,selected.session_id,selected.observed_at,selected.source_system,
        tally_serialized_fields(${scope.financial?'r.fields':'COALESCE(p.public_fields,tally_visible_fields_v2(r.fields,false))'}) || jsonb_build_object('/meta/observed_at',selected.observed_at,'/meta/session_id',selected.session_id,'/meta/record_key',selected.record_key) AS fields
        FROM (${selected}) selected JOIN tally_visibility_records r ON r.id=selected.id LEFT JOIN tally_visibility_public_fields p ON p.record_id=selected.id
        ORDER BY selected.page_order`).all(...pageArgs);
      return {data,pagination:{page:query.page,pageSize:query.pageSize,total,pages:Math.ceil(total/query.pageSize)}};
    }
    const data = await this.db.prepare(`SELECT selected.id,record_key,entity,name,parent_name,session_id,observed_at,source_system,
      tally_serialized_fields(selected.fields) AS fields FROM (${filtered.sql}) selected
      ORDER BY CASE WHEN selected.fields->>? ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN (selected.fields->>?)::numeric END ${direction} NULLS LAST,
      selected.fields->>? ${direction} NULLS LAST,record_key LIMIT ? OFFSET ?`)
      .all(...filtered.args,query.sort,query.sort,query.sort,query.pageSize,(query.page - 1) * query.pageSize);
    return { data, pagination: { page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) } };
  }
  async history(companyId, entity, key, financial) {
    return this.db.prepare(`SELECT id,record_key,entity,name,parent_name,session_id,payload_id,observed_at,
      (SELECT source_system FROM tally_source_observations o WHERE o.session_id=r.session_id ORDER BY o.recorded_at DESC,o.id DESC LIMIT 1) AS source_system,
      tally_serialized_fields(tally_visible_fields_v2(fields,?::boolean)) || jsonb_build_object('/meta/observed_at',observed_at,'/meta/session_id',session_id,'/meta/record_key',record_key) fields ${financial ? ',raw_record' : ''}
      FROM tally_visibility_records r WHERE company_id=? AND entity=? AND (record_key=? OR (entity='companies' AND record_key IN
       (SELECT record_key FROM tally_visibility_company_aliases WHERE company_id=? AND canonical_key=?)))
      ORDER BY observed_at DESC,(raw_record<>'{}'::jsonb) DESC,id DESC`).all(financial,companyId,entity,key,companyId,key);
  }
  async overview(companyId, financial) {
    const counts = await this.db.prepare(`SELECT entity,count(DISTINCT COALESCE(a.canonical_key,r.record_key)) AS count,max(observed_at) AS last_updated
      FROM tally_visibility_records r LEFT JOIN tally_visibility_company_aliases a ON r.entity='companies' AND a.company_id=r.company_id AND a.record_key=r.record_key
      WHERE r.company_id=? GROUP BY entity ORDER BY entity`).all(companyId);
    const datasets = await this.db.prepare('SELECT dataset,status,payload_count,imported_count,quarantined_count,error,processed_at FROM tally_run_datasets WHERE company_id=? ORDER BY processed_at DESC,dataset').all(companyId);
    const sync = await this.db.prepare(`SELECT j.id,j.status,j.started_at,j.completed_at,j.last_progress_at FROM tally_sync_jobs j
      JOIN tally_companies c ON c.name=j.company_name WHERE c.id=? ORDER BY j.started_at DESC LIMIT 20`).all(companyId);
    const quarantine = (await this.db.prepare('SELECT count(*) AS n FROM tally_import_quarantine WHERE company_id=?').get(companyId)).n;
    const warnings = (await this.db.prepare('SELECT count(*) AS n FROM tally_import_warnings WHERE company_id=?').get(companyId)).n;
    const stockScope=this.scope(companyId,'items',true);
    const stock = financial ? await this.db.prepare(`${stockScope.cte} SELECT count(*) AS total,count(fields->>'/stored/closing_value') AS valued,
      count(*)-count(fields->>'/stored/closing_value') AS unvalued,sum((fields->>'/stored/closing_value')::numeric)::text AS known_value FROM visible`).get(...stockScope.args) : null;
    const errors=(await this.db.prepare(`SELECT count(*) AS n FROM tally_sync_jobs j JOIN tally_companies c ON c.name=j.company_name
      WHERE c.id=? AND j.status IN ('failed','stalled','partial','quarantined')`).get(companyId)).n;
    const sources=[];
    for(const [key,label] of [['direct_xml','Direct XML'],['tally_engine','Tally Engine'],['bizgenix','Bizgenix']]) {
      const latest=await this.db.prepare(`SELECT j.status,j.completed_at,o.retry_count,o.next_sync_at,o.recorded_at FROM tally_source_observations o
        JOIN tally_sync_jobs j ON j.id=o.job_id JOIN tally_companies c ON c.name=j.company_name
        WHERE c.id=? AND o.source_system=? ORDER BY o.recorded_at DESC,o.id DESC LIMIT 1`).get(companyId,key);
      const totals=await this.db.prepare(`SELECT count(DISTINCT j.id) FILTER(WHERE j.status IN ('failed','stalled','partial','quarantined')) AS errors,
        max(j.completed_at) FILTER(WHERE j.status='stored') AS last_sync FROM tally_source_observations o JOIN tally_sync_jobs j ON j.id=o.job_id
        JOIN tally_companies c ON c.name=j.company_name WHERE c.id=? AND o.source_system=?`).get(companyId,key);
      sources.push({source:label,observed:!!latest,status:latest?.status||'Unknown: no source-labelled sync',lastSync:totals.last_sync,errorCount:latest?totals.errors:null,retryCount:latest?.retry_count??null,nextSync:latest?.next_sync_at||null});
    }
    const direct=await this.db.prepare('SELECT status,completed_at,next_retry_at,attempt FROM crm_tally_sync_jobs ORDER BY created_at DESC,id DESC LIMIT 1').get();
    if(!sources[0].observed) {
      const errors=(await this.db.prepare("SELECT count(*) AS n FROM crm_tally_sync_jobs WHERE status IN ('FAILED','RETRY_SCHEDULED')").get()).n;
      sources[0]={source:'Direct XML',status:direct?.status||'No direct XML sync yet',lastSync:direct?.completed_at||null,errorCount:errors,retryCount:direct?Math.max(0,direct.attempt-1):0,nextSync:direct?.next_retry_at||null,note:'Legacy direct XML jobs have no company/source discriminator; this status is global.'};
    }
    return { counts, datasets, sync, quarantine, warnings, stock: stock && {...stock,partial: stock.unvalued > 0},
      errorCount: errors,
      errorCountScope: 'All recorded connector jobs', nextSync: null, retryCount: null,
      sources };
  }
}
