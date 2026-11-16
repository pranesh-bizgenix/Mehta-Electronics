/** Metadata only: never reads business row values or performs schema changes. */
export async function readSchema(sql) {
  const tables=await sql`SELECT t.table_name AS name,t.table_type AS type,
    COALESCE(c.reltuples,0)::text AS estimated_rows
    FROM information_schema.tables t JOIN pg_namespace n ON n.nspname=t.table_schema
    JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=t.table_name
    WHERE t.table_schema='public' ORDER BY t.table_name`;
  const columns=await sql`SELECT table_name AS table,column_name AS name,ordinal_position AS position,
    data_type AS type,udt_name,is_nullable='YES' AS nullable,column_default AS default,
    numeric_precision AS precision,numeric_scale AS scale,is_identity='YES' AS identity
    FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`;
  const constraints=await sql`SELECT r.relname AS table,c.conname AS name,c.contype AS type,
    pg_get_constraintdef(c.oid) AS definition,c.convalidated AS validated,
    ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(num,ord)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord) AS columns,
    f.relname AS target,
    ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(num,ord)
      JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.ord) AS target_columns
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=r.relnamespace LEFT JOIN pg_class f ON f.oid=c.confrelid
    WHERE n.nspname='public' ORDER BY r.relname,c.conname`;
  const indexes=await sql`SELECT t.relname AS table,i.relname AS name,pg_get_indexdef(x.indexrelid) AS definition,
    x.indisvalid AS valid,x.indisunique AS unique,pg_get_expr(x.indpred,x.indrelid) AS predicate,
    ARRAY(SELECT a.attname FROM unnest(x.indkey::smallint[]) WITH ORDINALITY k(num,ord)
      LEFT JOIN pg_attribute a ON a.attrelid=x.indrelid AND a.attnum=k.num
      WHERE k.ord<=x.indnkeyatts ORDER BY k.ord) AS columns
    FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' ORDER BY t.relname,i.relname`;
  const triggers=await sql`SELECT t.relname AS table,g.tgname AS name,pg_get_triggerdef(g.oid) AS definition,
    g.tgenabled AS enabled,p.proname AS function,p.prosrc AS body
    FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_proc p ON p.oid=g.tgfoid WHERE n.nspname='public' AND NOT g.tgisinternal ORDER BY t.relname,g.tgname`;
  const extensions=await sql`SELECT extname AS name FROM pg_extension ORDER BY extname`;
  return {checkedAt:new Date().toISOString(),database:'mehta_electronics_local',tables,columns,constraints,indexes,triggers,extensions};
}

export function structuralFindings(schema,exceptions={}) {
  const findings=[];
  const add=(kind,table,column,detail)=>{
    const key=[kind,table,column].filter(Boolean).join(':');
    findings.push({key,kind,table,column,detail,exception:exceptions[key]||null});
  };
  for(const table of schema.tables.filter(t=>t.type==='BASE TABLE')){
    const constraints=schema.constraints.filter(c=>c.table===table.name);
    if(!constraints.some(c=>c.type==='p'))add('primary-key',table.name,null,'No primary key.');
    for(const col of schema.columns.filter(c=>c.table===table.name)){
      if(/_id$/.test(col.name)&&!constraints.some(c=>c.type==='f'&&c.validated&&c.columns.includes(col.name)))
        add('foreign-key',table.name,col.name,'No foreign key; external/polymorphic identifiers need an explicit documented exception.');
      if(/(?:^|_)(status|state)$/.test(col.name)&&!constraints.some(c=>c.type==='c'&&c.validated&&c.columns.includes(col.name)))
        add('status-check',table.name,col.name,'No CHECK constraint limiting this status/state.');
      if(['real','double precision'].includes(col.type)&&/(amount|price|cost|total|balance|margin|tax|value|rate|discount|interest)/i.test(col.name))
        add('float-money',table.name,col.name,'Approximate floating point financial column.');
      if(col.type==='numeric'&&/(amount|price|cost|total|balance|margin|tax|value|rate|discount|interest)/i.test(col.name)&&col.scale==null)
        add('money-scale',table.name,col.name,'Financial NUMERIC has no fixed scale.');
    }
    for(const fk of constraints.filter(c=>c.type==='f')){
      if(!schema.indexes.some(i=>i.table===table.name&&i.valid&&fkIndexPredicate(i.predicate,fk.columns)&&fk.columns.every((name,n)=>i.columns[n]===name)))
        add('foreign-key-index',table.name,fk.columns.join(','),'No valid index covering nonnull FK values with the FK columns as its leading keys.');
    }
    if(/(?:_versions|_events)$/.test(table.name)||/^(audit_logs|audit_log)$/.test(table.name)){
      const guards=schema.triggers.filter(t=>t.table===table.name&&t.enabled!=='D'&&/RAISE\s+EXCEPTION/i.test(t.body));
      for(const event of ['UPDATE','DELETE','TRUNCATE'])if(!guards.some(t=>new RegExp(`\\b${event}\\b`).test(t.definition)))
        add('append-only',table.name,event,`No enabled rejecting ${event} trigger found; inspect function semantics as well as metadata.`);
    }
  }
  return findings;
}

export function fkIndexPredicate(predicate,columns){
  if(!predicate)return true;
  // A nullable FK needs no index entries for rows that cannot reference a parent.
  // Do not accept unrelated partial predicates such as status='OPEN'.
  return predicate.replace(/[()\"]/g,'').trim().split(/\s+AND\s+/i).every(term=>{
    const match=/^(\w+)\s+IS\s+NOT\s+NULL$/i.exec(term.trim());
    return match&&columns.includes(match[1]);
  });
}

export const BUSINESS_METADATA_COLUMNS=Object.freeze(['created_at','updated_at','created_by','updated_by','is_deleted','deleted_at','deleted_by','delete_reason','row_metadata_version']);
export function businessMetadataFindings(schema,businessTables=[]){
  const findings=[];
  for(const table of businessTables){
    for(const column of BUSINESS_METADATA_COLUMNS)if(!schema.columns.some(c=>c.table===table&&c.name===column))
      findings.push({key:`business-metadata:${table}:${column}`,kind:'business-metadata',table,column,detail:'Required row provenance/archive column is absent.',exception:null});
    for(const fn of ['s0_row_metadata_guard','s0_row_metadata_audit'])if(!schema.triggers.some(t=>t.table===table&&t.function===fn&&t.enabled==='O'))
      findings.push({key:`metadata-guard:${table}:${fn}`,kind:'metadata-guard',table,detail:'Required enabled provenance/audit trigger is absent.',exception:null});
  }
  return findings;
}

export function moduleFor(name){
  if(/^(tally_|crm_tally_)/.test(name))return 'Tally';
  if(/^(crm_quotation|quotation|price_|crm_price|customer_rate|crm_customer_contract)/.test(name))return 'Pricing';
  if(/^(customer_po|sales_order|crm_sales_order|crm_dispatch|dispatch|packing|pick_|stock_check|item_pack)/.test(name))return 'Orders and warehouse';
  if(/^(supplier_|vendor_|rfq|crm_supplier|crm_purchase|crm_goods|goods_|purchase_|procurement|supply_|acceptance)/.test(name))return 'Procurement';
  if(/^(invoice|sales_invoice|receivable|payment|receipt|bank_|credit_|debit_|collection)/.test(name))return 'Accounts';
  if(/^(email_|extraction|extracted_|classification|automation_)/.test(name))return 'Automation boundary';
  if(/^(customer|crm_customer|crm_part|part|item|crm_item|brand|unit|enquir)/.test(name))return 'CRM masters';
  if(/^(source_document|document_|field_correction)/.test(name))return 'Documents';
  return 'Platform and operations';
}

const cell=value=>String(value??'—').replaceAll('|','\\|').replaceAll('\n',' ');
export function schemaMarkdown(schema,{classifications={},exceptions={},remainingReview=[],businessTables=[]}={}){
  const findings=[...structuralFindings(schema,exceptions),...businessMetadataFindings(schema,businessTables)],base=schema.tables.filter(t=>t.type==='BASE TABLE');
  const out=['# Database schema reference','',`Generated read-only from information_schema and pg_catalog at ${schema.checkedAt}.`,
    '',`Database: **${schema.database}**. ${base.length} base tables; ${schema.tables.length-base.length} views. No business row contents are included.`,
    '','This is observed schema evidence, not a claim that every workflow is complete. FOUNDATION means reserved and not a delivered feature. LEGACY remains supported for compatibility; no table is deleted.',
    '','## Canonical models','',
    '| Concept | Current canonical model | Compatibility / reserved model |',
    '|---|---|---|',
    '| CRM customer | customers + crm_customer_profiles / crm_customer_controls | parties is the reserved UUID domain; crm_parties and stable Tally links bridge identities. Do not merge by name. |',
    '| CRM product | items + crm_item_profiles + crm_tally_item_links | parts is the reserved UUID domain. Tally owns the external stock master. |',
    '| Current quotation pricing | crm_price_lists / crm_price_list_items; crm_quotation_policy and crm_quotation_costs | price_lists / price_list_items / price_list_imports are reserved domain structures; imports need explicit reviewed translation, never dual writes. |',
    '| Current order execution | sales_orders + sales_order_lines + crm_order_workflows; crm_shipments / crm_shipment_items | customer_pos / customer_po_lines are normalized retained customer PO evidence linked through sales_orders.customer_po_id, not a second order executor. crm_order_versions/events retain reviewed snapshots. |',
    '| Accounting source | selected-company Tally snapshots | CRM invoice/payment references do not assert statutory invoice authority. |',
    '','## Remaining S0 review','',...remainingReview.map(note=>`- ${note}`),
    '','These items remain incomplete even when the narrower structural-finding count is zero.',
    '','## Provenance compatibility','',
    'Business row metadata version 0 marks records that predate the provenance migration. Unknown historical creators/timestamps remain NULL. Version 1 is required for new inserts; a new archive action records its actual actor, reason and time. Existing statuses and source originals are retained. Metadata audit events contain provenance fields, not document bytes, bank payloads or prices.',
    '','## Table classification','', '| Table | Module | Classification | Basis |','|---|---|---|---|'];
  for(const table of schema.tables){const c=classifications[table.name];out.push(`| ${table.name} | ${moduleFor(table.name)} | ${c?.status||'FOUNDATION'} | ${cell(c?.reason||'No runtime SQL reference identified; reserved until reviewed.')} |`);}
  for(const group of [...new Set(base.map(t=>moduleFor(t.name)))]){
    out.push('',`## ${group} relationships`,'','```mermaid','erDiagram');
    const names=new Set(base.filter(t=>moduleFor(t.name)===group).map(t=>t.name));
    for(const name of names)out.push(`  ${name} {`,`    string schema_reference "See column inventory"`,'  }');
    for(const fk of schema.constraints.filter(c=>c.type==='f'&&names.has(c.table)))out.push(`  ${fk.target} ||--o{ ${fk.table} : "${fk.columns.join(',')}"`);
    out.push('```');
  }
  out.push('','## Integrity findings','', '| Finding | Detail | Disposition / exception |','|---|---|---|');
  for(const f of findings)out.push(`| ${cell(f.key)} | ${cell(f.detail)} | ${cell(f.exception||'OPEN: requires migration or an explicitly reviewed semantic exception.')} |`);
  if(!findings.length)out.push('| None | Structural checks passed | Workflow completeness still requires acceptance. |');
  for(const table of schema.tables){
    out.push('',`## ${table.name}`,'', '| Column | Type | Null | Default |','|---|---|---|---|');
    for(const col of schema.columns.filter(c=>c.table===table.name))out.push(`| ${col.name} | ${cell(col.type+(col.type==='numeric'&&col.precision?`(${col.precision},${col.scale})`:''))} | ${col.nullable?'YES':'NO'} | ${cell(col.default||(col.identity?'IDENTITY':null))} |`);
    for(const c of schema.constraints.filter(c=>c.table===table.name))out.push(`- Constraint ${c.name}${c.validated?'':' (NOT VALID)'}: ${cell(c.definition)}`);
    for(const i of schema.indexes.filter(i=>i.table===table.name))out.push(`- Index ${i.name}${i.valid?'':' (INVALID)'}: ${cell(i.definition)}`);
    for(const t of schema.triggers.filter(t=>t.table===table.name))out.push(`- Trigger ${t.name} (${t.enabled}): ${cell(t.definition)}`);
  }
  return out.join('\n')+'\n';
}
