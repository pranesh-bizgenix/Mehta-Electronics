import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {getConfig} from '../src/config.js';
import {createDatabase} from '../src/postgres.js';
import {temporarySchema,shadowPublicRelations} from './postgres.js';
export async function crmFixture(){
  // Temporary schema inside the configured database; dropped by close().
  const temporary=await temporarySchema('crm'),name=temporary.schema;
  const config=getConfig({databaseUrl:temporary.databaseUrl}),db=createDatabase(config);
  await db.sql.unsafe(await fs.readFile(new URL('../database/postgres/migrations/0004_crm_core.sql',import.meta.url),'utf8'));
  await db.sql.unsafe(`CREATE TABLE tally_companies(id uuid PRIMARY KEY,name text);
    CREATE TABLE tally_groups(id text,company_id uuid,name text,parent_name text,fetched_at timestamptz);
    CREATE TABLE tally_ledgers(id text,company_id uuid,name text,parent_name text,phone text,email text,gstin text,pan text,address text,contact_person text,closing_balance numeric(18,2),opening_balance numeric(18,2),dr_cr text,fetched_at timestamptz);
    CREATE TABLE tally_stock_items(id text,company_id uuid,name text,parent_name text,description text,hsn text,base_unit text,normalized_part_number text,closing_quantity_text text,closing_rate_text text,closing_value numeric(18,2),fetched_at timestamptz);
    CREATE TABLE tally_sync_jobs(id uuid PRIMARY KEY,company_name text,status text,started_at timestamptz,completed_at timestamptz,last_progress_at timestamptz,message text);`);
  for(const file of ['0006_stored_tally_read_layer.sql','0007_stored_tally_audit_guards.sql','0008_crm_master_extensions.sql','0009_crm_child_archival.sql','0010_crm_quotation_line_archival.sql','0011_crm_hard_delete_guards.sql','0012_quotation_workflow.sql','0013_sales_orders_dispatch.sql','0014_dispatch_retry_guard.sql','0015_procurement.sql','0016_procurement_guard_fix.sql','0017_customer_po_normalization.sql','0018_target_domain_schema.sql','0019_target_schema_integrity.sql','0020_automation_approval_guards.sql','0021_platform_foundation.sql'])await db.sql.unsafe(await fs.readFile(new URL(`../database/postgres/migrations/${file}`,import.meta.url),'utf8'));
  await shadowPublicRelations(db.sql,name);
  const company=crypto.randomUUID();
  await db.sql`INSERT INTO tally_companies VALUES(${company},'Synthetic Mehta company')`;
  await db.sql`INSERT INTO tally_groups(id,company_id,name,parent_name) VALUES('g1',${company},'Retail','Sundry Debtors')`;
  await db.sql`INSERT INTO tally_ledgers(id,company_id,name,parent_name,closing_balance,dr_cr,fetched_at) VALUES('l1',${company},'Exact customer','Retail',12500.25,'Dr',now())`;
  await db.sql`INSERT INTO tally_stock_items(id,company_id,name,parent_name,base_unit,closing_quantity_text,closing_rate_text,closing_value,fetched_at) VALUES('s1',${company},'Exact stock','Switchgear','NOS','24 NOS','125 / NOS',3000,now())`;
  const owner=(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('Review Owner','owner@example.test','OWNER','not-a-login',0) RETURNING id`)[0].id;
  const accounts=(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('Review Accounts','accounts@example.test','ACCOUNTS','not-a-login',0) RETURNING id`)[0].id;
  return {db,config,company,owner,accounts,name,close:async()=>{try{await db.close();}finally{await temporary.close();}}};
}
