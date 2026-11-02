import fs from 'node:fs/promises';
import { getConfig } from '../src/config.js';
import { connectPostgres } from '../src/postgres.js';

const config = getConfig();
if (new URL(config.databaseUrl).pathname !== '/mehta_electronics_local') throw new Error('Unexpected DATABASE_URL database.');
const sql = connectPostgres(config.databaseUrl, { postgresOptions: { max: 1, connection: { default_transaction_read_only: 'on' } } });
try {
  const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name LIKE 'tally_%' OR table_name LIKE 'bizgenix%') ORDER BY table_name`;
  const counts = {};
  const fields = {};
  for (const { table_name: table } of tables) {
    counts[table] = (await sql`SELECT count(*) AS n FROM ${sql(table)}`)[0].n;
    const columns = await sql`SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=${table} ORDER BY ordinal_position`;
    fields[table] = { columns, rawPaths: [] };
    if (columns.some(c => c.column_name === 'raw_record')) {
      const paths = new Set();
      const walk = (v, prefix = '') => {
        if (Array.isArray(v)) { for (const item of v) walk(item, `${prefix}[]`); }
        else if (v && typeof v === 'object') for (const [k, child] of Object.entries(v)) { const p = prefix ? `${prefix}.${k}` : k; paths.add(p); walk(child, p); }
      };
      for (const row of await sql`SELECT raw_record FROM ${sql(table)}`) walk(row.raw_record);
      fields[table].rawPaths = [...paths].sort();
    }
  }
  const jobs = await sql`SELECT status,count(*) AS count,max(started_at) AS latest FROM tally_sync_jobs GROUP BY status ORDER BY status`;
  const datasets = await sql`SELECT dataset,status,count(*) AS count,sum(imported_count) AS imported,sum(quarantined_count) AS quarantined FROM tally_run_datasets GROUP BY dataset,status ORDER BY dataset,status`;
  const connectors = await sql`SELECT profile_name,status,last_seen_at,last_sync_at FROM tally_connectors ORDER BY created_at DESC`;
  const legacy = {};
  for (const table of ['crm_tally_sync_jobs','crm_tally_sync_logs']) {
    if ((await sql`SELECT to_regclass(${`public.${table}`}) AS name`)[0].name) {
      legacy[table] = await sql`SELECT to_jsonb(t)->>'status' AS status,count(*) AS count,max(to_jsonb(t)->>'completed_at') AS last_completed,max(to_jsonb(t)->>'next_retry_at') AS next_retry FROM ${sql(table)} t GROUP BY to_jsonb(t)->>'status'`;
    }
  }
  const coverage = await sql`SELECT count(*) AS total,count(closing_value) AS valued,count(*)-count(closing_value) AS unvalued FROM tally_stock_items`;
  const report = { checkedAt: new Date().toISOString(), counts, jobs, datasets, connectors, legacy, coverage, fields };
  await fs.mkdir('docs', { recursive: true });
  await fs.writeFile('docs/tally-visibility-inventory.json', JSON.stringify(report, null, 2));
  const shown = { tally_companies:['id','name'],tally_groups:['id','name','parent_name'],tally_ledgers:['id','name','parent_name','gstin','pan','phone','email','contact_person','opening_balance','closing_balance','dr_cr'],tally_stock_items:['id','name','parent_name','normalized_part_number','base_unit','closing_quantity_text','closing_rate_text','closing_value'] };
  let markdown = `# Tally visibility audit\n\nRead-only inventory: ${report.checkedAt}. Database: mehta_electronics_local. No raw data values or credentials are included.\n\n## Diagnosis before UI changes\n\n- Direct XML is reachable and returned one open company on 30 October 2026. This proves connectivity, not a completed import.\n- Connector imports populate tally_ledgers and tally_stock_items, while legacy tally_customers and tally_items are empty. The native ControlDesk Tally link falls back to the legacy app root.\n- Master API searches only name/parent and projects a small subset of stored columns. Stored raw_record JSONB already preserves all parsed fields for groups, ledgers and stock items.\n- Item closing_rate_text is exposed without financial authorization in both master and stored APIs.\n- Latest connector job stalled; two prior jobs stored. Zero quarantined rows. No structured vouchers delivered. Report XML is retained without normalized report rows.\n- No durable source discriminator distinguishes Tally Engine from Bizgenix. Their individual last-sync status cannot be inferred from connector profile names. Show Unknown, not a fabricated source or successful sync.\n- Next scheduled connector sync and connector retry attempts are not recorded. Unknown is different from zero. Direct XML job states, where present, appear below.\n- Existing browser verification scripts write real-schema sessions/audits; they must be moved to random test schemas before execution.\n\n## Counts\n\n| Table | Rows |\n| --- | ---: |\n${Object.entries(counts).map(([t,n])=>`| ${t} | ${n} |`).join('\n')}\n\nStock coverage: ${coverage[0].valued} valued, ${coverage[0].unvalued} unvalued, ${coverage[0].total} total.\n\n## Sync and retry evidence\n\n\`\`\`json\n${JSON.stringify({jobs,datasets,legacy},null,2)}\n\`\`\`\n\n## Field matrix (baseline)\n\nThe following is exhaustive for stored columns and parsed XML paths actually found in the database. XML attributes and #text nodes are listed. A field absent from delivered payloads is not claimed to be imported. The inventory JSON is the machine-readable companion.\n`;
  for (const [table, definition] of Object.entries(fields)) {
    markdown += `\n### ${table}\n\n| Stored column | Type | Baseline master UI/API |\n| --- | --- | --- |\n${definition.columns.map(c=>`| ${c.column_name} | ${c.data_type} | ${(shown[table]||[]).includes(c.column_name)?'Shown (financial restrictions apply)':'MISSING from browser columns'} |`).join('\n')}\n`;
    if (definition.rawPaths.length) markdown += `\n| Parsed raw XML path | Storage | Baseline UI |\n| --- | --- | --- |\n${definition.rawPaths.map(p=>`| ${p} | raw_record JSONB | MISSING as selectable field; financial-only JSON modal |`).join('\n')}\n`;
  }
  markdown += '\n## Delivery gaps and implementation plan\n\nCompany metadata beyond name/GUID is not imported. Stock groups, categories, units, godowns, price levels and cost centres need connector export collections; none has a dedicated imported table. Ledger registration/state/credit/bank fields and item HSN/GST/alternate-unit/price-list/godown fields can only be shown when present in raw data. Preserve and index unknown fields automatically.\n\nVouchers: Awaiting voucher data. Request structured VOUCHER records with date, GUID/master ID, voucher type/number, ledger entries, inventory entries, amounts and taxes. Do not substitute report totals for vouchers.\n\nUse an additive append-only field index and replay immutable stored payloads into that index, never overwrite imported rows. Capture subsequent master imports into the same index. Separate financial and nonfinancial projections before search, sorting, counts, details or export. Nonfinancial unknown tags fail closed. Native browsers must use stored Tally IDs and show source, timestamps and incomplete coverage. Reconciliation by exact name in the existing service is not identity-safe and requires replacement with durable ID links.\n';
  await fs.writeFile('docs/tally-visibility-audit.md', markdown);
  console.log(JSON.stringify({ checkedAt: report.checkedAt, counts, jobs, datasets, connectors }, null, 2));
} catch (error) { console.error(`Read-only inventory failed (${error.code || error.name}).`); process.exitCode = 1; }
finally { await sql.end(); }
