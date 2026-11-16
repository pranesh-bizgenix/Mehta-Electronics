import {randomUUID} from 'node:crypto';
export class PriceImportRepository {
 constructor(db){this.db=db;}
 async items(lock=false){return this.db.prepare(`SELECT id,part_code,uom,status,updated_at::text AS updated_at FROM items WHERE NOT is_deleted ORDER BY id${lock?' FOR SHARE':''}`).all();}
 async lock(hash){await this.db.prepare('SELECT pg_advisory_xact_lock(hashtextextended(?,73429947))').get(hash);}
 async named(name){return this.db.prepare('SELECT id FROM crm_price_lists WHERE name=?').get(name);}
 async same(hash,plan){return this.db.prepare('SELECT id,status,plan_hash FROM crm_price_import_workflows WHERE file_sha256=? AND plan_hash=?').get(hash,plan);}
 async latest(hash){return this.db.prepare('SELECT id,status,source_revision FROM crm_price_import_workflows WHERE file_sha256=? ORDER BY source_revision DESC LIMIT 1 FOR UPDATE').get(hash);}
 async record(id){return this.db.prepare('SELECT * FROM crm_price_import_workflows WHERE id=? AND NOT is_deleted FOR UPDATE').get(id);}
 async list(){return this.db.prepare('SELECT id,status,source_revision,row_count,metadata,plan_hash,created_by,created_at,target_list_id FROM crm_price_import_workflows WHERE NOT is_deleted ORDER BY created_at DESC,id LIMIT 100').all();}
 async detail(id,page){
  const row=await this.db.prepare('SELECT id,status,source_revision,row_count,metadata,mapping,plan_hash,file_sha256,created_by,created_at,approved_by,approved_at,target_list_id FROM crm_price_import_workflows WHERE id=? AND NOT is_deleted').get(id);
  if(!row)return null;
  return {...row,entries:await this.db.prepare('SELECT source_row_number,part_code,uom,min_quantity::text AS min_quantity,unit_price::text AS unit_price,discount_percent::text AS discount_percent,edition,source_level FROM crm_price_import_entries WHERE import_id=? ORDER BY source_row_number LIMIT 100 OFFSET ?').all(id,(page-1)*100),events:await this.db.prepare('SELECT action,reason,actor_id,created_at FROM crm_price_import_events WHERE import_id=? ORDER BY created_at,id').all(id)};
 }
 async entries(id){return this.db.prepare('SELECT *,min_quantity::text AS min_quantity,unit_price::text AS unit_price,discount_percent::text AS discount_percent FROM crm_price_import_entries WHERE import_id=? ORDER BY source_row_number').all(id);}
 async create(upload,metadata,mapping,plan,actor,revision,replacesId){
  const sql=this.db.sql;
  let [source]=await sql`SELECT id FROM source_documents WHERE content_sha256=${plan.fileSha256} AND document_type='PRICE_LIST'`;
  if(!source){const sourceId=randomUUID();[source]=await sql`INSERT INTO source_documents(id,content_sha256,document_type,original_name,mime_type,byte_count,storage_reference,ingestion_source,created_by)
   VALUES(${sourceId},${plan.fileSha256},'PRICE_LIST',${upload.filename},${upload.format==='CSV'?'text/csv':upload.format==='PDF_TABLE'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},${upload.bytes.length},${'db:source_documents/'+sourceId},'MANUAL_REVIEW',${actor.id}) RETURNING id`;}
  const [imported]=await sql`INSERT INTO price_list_imports(source_document_id,source_format,parser_name,parser_version,status,created_by)
   VALUES(${source.id},${upload.format},'CRM_EXPLICIT_MAPPING','1','PENDING_REVIEW',${actor.id}) RETURNING id`;
  await sql`INSERT INTO crm_price_import_workflows(id,file_sha256,original_bytes,source_format,source_revision,replaces_id,mapping,metadata,plan_hash,row_count,created_by)
   VALUES(${imported.id},${plan.fileSha256},${upload.bytes},${upload.format},${revision},${replacesId},${sql.json({...mapping,sheet:upload.sheet??null})},${sql.json(metadata)},${plan.previewFingerprint},${plan.rows.length},${actor.id})`;
  // One bulk statement, not a database round trip for each source row.
  await sql`INSERT INTO crm_price_import_entries(import_id,source_row_number,raw_row,item_id,item_revision,part_code,uom,min_quantity,unit_price,discount_percent,edition,source_level,created_by)
   SELECT ${imported.id},r."sourceRow",to_jsonb(r),r."itemId",r."itemRevision",r."partCode",r.uom,r."minQuantity"::numeric,r."unitPrice"::numeric,r."discountPercent"::numeric,r.edition,r.level,${actor.id}
   FROM jsonb_to_recordset(${sql.json(plan.rows)}) AS r("sourceRow" integer,"itemId" integer,"itemRevision" text,"partCode" text,uom text,"minQuantity" text,"unitPrice" text,"discountPercent" text,edition text,level text)`;
  return {id:imported.id,status:'PENDING_REVIEW',plan_hash:plan.previewFingerprint};
 }
 async event(row,action,actor,reason){await this.db.sql`INSERT INTO crm_price_import_events(import_id,action,actor_id,reason,plan_hash) VALUES(${row.id},${action},${actor.id},${reason},${row.plan_hash})`;}
 async submit(row,version){await this.db.sql`UPDATE crm_price_import_workflows SET status='PENDING_APPROVAL',approval_rule_key='price_lists.approval_policy',approval_rule_version=${version} WHERE id=${row.id}`;}
 async approve(row,actor,reason){await this.db.sql`UPDATE crm_price_import_workflows SET status='APPROVED',approved_by=${actor.id},approved_at=now(),approved_hash=plan_hash,decision_reason=${reason} WHERE id=${row.id}`;}
 async reject(row,reason){await this.db.sql`UPDATE crm_price_import_workflows SET status='REJECTED',decision_reason=${reason} WHERE id=${row.id}`;}
 async activate(row,actor){
  const sql=this.db.sql,m=row.metadata;
  const [list]=await sql`INSERT INTO crm_price_lists(name,currency,effective_from,effective_to,discount_percent,created_by,status) VALUES(${m.name},${m.currency},${m.effectiveFrom},${m.effectiveTo},${m.discountPercent},${actor.id},'INACTIVE') RETURNING id`;
  await sql`UPDATE crm_price_import_workflows SET target_list_id=${list.id} WHERE id=${row.id}`;
  await sql`INSERT INTO crm_price_list_items(price_list_id,item_id,unit_price,discount_percent,min_quantity,created_by,status)
   SELECT ${list.id},item_id,unit_price,discount_percent,min_quantity,${actor.id},'ACTIVE' FROM crm_price_import_entries WHERE import_id=${row.id}`;
  await sql`UPDATE crm_price_import_entries r SET activated_entry_id=e.id FROM crm_price_list_items e WHERE r.import_id=${row.id} AND e.price_list_id=${list.id} AND e.item_id=r.item_id AND e.min_quantity=r.min_quantity`;
  await sql`UPDATE crm_price_lists SET status='ACTIVE' WHERE id=${list.id}`;
  await sql`UPDATE crm_price_import_workflows SET status='ACTIVATED' WHERE id=${row.id}`;
  await sql`UPDATE price_list_imports SET status='APPROVED',reviewed_by=${row.approved_by},reviewed_at=${row.approved_at},review_reason=${row.decision_reason} WHERE id=${row.id}`;
  return list.id;
 }
}
