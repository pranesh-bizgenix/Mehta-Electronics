// Forward-only migrations, with a before/after fingerprint of imported Tally data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';
import {applyMigrations} from '../src/migrations.js';
const sql=connectPostgres(getConfig().databaseUrl);
try{
 const database=(await sql`SELECT current_database() AS name`)[0].name;assert.equal(database,'mehta_electronics_local');
 const tables=await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'tally_%' OR tablename='connector_upload_chunks') ORDER BY tablename`;
 const snapshot=async()=>{const out={};for(const {tablename} of tables){assert.match(tablename,/^[a-z0-9_]+$/);const rowHash=tablename==='tally_upload_chunks'?"md5(json_build_array(session_id,field_name,sequence,md5(content),created_at)::text)":'md5(row_to_json(t)::text)';out[tablename]=(await sql.unsafe(`SELECT count(*) AS count,md5(COALESCE(string_agg(hash,'' ORDER BY hash),'')) AS fingerprint FROM (SELECT ${rowHash} AS hash FROM public."${tablename}" t) rows`))[0];console.log('Verified retained table: '+tablename);}return out;};
 const before=await snapshot();const migrations=await applyMigrations(sql);const after=await snapshot();const operationalTables=['tally_connectors','tally_connector_heartbeats'];const imported=snapshot=>Object.fromEntries(Object.entries(snapshot).filter(([key])=>!operationalTables.includes(key)));assert.deepEqual(imported(after),imported(before),'Imported Tally tables must not change during additive CRM migrations');
 const switches=await sql`SELECT workflow_key,enabled FROM automation_switches WHERE workflow_key IN ('payment_reminders','supplier_reminders','delivery_follow_up','material_delivered','warranty_follow_up') ORDER BY workflow_key`;
 assert.ok(switches.every(row=>!row.enabled),'New communication switches remain OFF');
 const report={checkedAt:new Date().toISOString(),database,migrations,importedTablesUnchanged:true,operationalMetadataChanged:operationalTables.filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key])),counts:Object.fromEntries(Object.entries(after).map(([key,value])=>[key,value.count])),switches};
 await fs.writeFile('docs/client-plan-migration-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await sql.end();}
