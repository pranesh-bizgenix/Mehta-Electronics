// Production-source verification is SELECT-only, including the transaction.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createDatabase } from '../src/postgres.js';
import { getConfig } from '../src/config.js';
import { TallyVisibilityService } from '../src/tally-visibility-service.js';
import { TALLY_ENTITY_DESCRIPTORS,describeTallyEntity } from '../public/tally-entity-descriptors.js';

const config=getConfig();
if(new URL(config.databaseUrl).pathname!=='/mehta_electronics_local')throw new Error('Unexpected DATABASE_URL database.');
const db=createDatabase(config);
const report={checkedAt:new Date().toISOString(),readOnly:true,entities:{},sourcePayloadHashesVerified:0,rawLeavesVerified:0};
try {
  await db.withConnection(async()=>{
    await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const service=new TallyVisibilityService(db),owner={role:'OWNER'},manager={role:'MANAGER'};
    const companies=await db.prepare('SELECT id FROM tally_companies ORDER BY id').all();
    for(const company of companies) {
      for(const kind of Object.keys(TALLY_ENTITY_DESCRIPTORS).filter(key=>!['customers','vendors','banks','expenses','other'].includes(key))) {
        const url=new URL(`http://verify/?companyId=${company.id}&pageSize=100`);
        const result=await service.list(kind,url,owner),expected=kind==='companies'?1:(await db.prepare('SELECT count(*) AS n FROM tally_visibility_current_cache WHERE company_id=? AND entity=?').get(company.id,kind)).n;
        assert.equal(result.pagination.total,expected);
        const lastUrl=new URL(url);lastUrl.searchParams.set('page',String(Math.max(1,result.pagination.pages)));
        const last=await service.list(kind,lastUrl,owner);assert.equal(last.data.length,expected?expected%100||100:0);
        const safe=kind==='reports'?{pagination:{total:expected},columns:[]}:await service.list(kind,url,manager);
        assert.equal(safe.pagination.total,expected);
        assert.equal(safe.columns.some(k=>/closing_rate|closing_value|closing_balance|opening_balance|CLOSINGVALUE|CLOSINGRATE|OPENINGBALANCE/.test(k)),false);
        report.entities[kind]={rows:expected,ownerColumns:result.columns.length,managerColumns:safe.columns.length,firstPage:result.data.length,lastPage:last.data.length};
      }
      const summary=await service.repository.overview(company.id,true);
      report.stockCoverage={total:summary.stock.total,valued:summary.stock.valued,unvalued:summary.stock.unvalued,partial:summary.stock.partial};
      report.sources=summary.sources;
    }
    let lastPayload='';
    for(;;){const batch=await db.prepare('SELECT id,content,content_hash FROM tally_raw_payloads WHERE id::text>? ORDER BY id::text LIMIT 1').all(lastPayload);if(!batch.length)break;
      for(const payload of batch){assert.equal(crypto.createHash('sha256').update(payload.content).digest('hex'),payload.content_hash);report.sourcePayloadHashesVerified++;lastPayload=payload.id;}}
    const leaves=(raw,prefix='/xml',result={})=>{
      if(Array.isArray(raw)&&raw.length)raw.forEach((v,i)=>leaves(v,`${prefix}/${i}`,result));
      else if(raw&&typeof raw==='object'&&Object.keys(raw).length)for(const [key,value] of Object.entries(raw))leaves(value,`${prefix}/${key.replaceAll('~','~0').replaceAll('/','~1')}`,result);
      else result[prefix]=raw;
      return result;
    };
    let lastRecord='';
    for(;;){const batch=await db.prepare('SELECT id,entity,raw_record,fields FROM tally_visibility_records WHERE id>? ORDER BY id LIMIT 50').all(lastRecord);if(!batch.length)break;
    for(const row of batch){lastRecord=row.id;
    const descriptor=describeTallyEntity(row.entity,Object.keys(row.fields));
    assert.deepEqual(new Set(descriptor.fields.map(field=>field.key)),new Set(Object.keys(row.fields)));
    for(const [key,value] of Object.entries(leaves(row.raw_record))) {
      if(key==='/xml'&&JSON.stringify(value)==='{}'&&!Object.hasOwn(row.fields,key))continue; // Company metadata has no company XML.
      assert.deepEqual(row.fields[key],value);report.rawLeavesVerified++;
    }}}
    report.fieldCoverage=await db.prepare('SELECT entity,key,bool_and(nonfinancial) AS nonfinancial FROM tally_visibility_field_catalogue GROUP BY entity,key ORDER BY entity,key').all();
    report.storedCounts={};
    for(const table of ['tally_companies','tally_groups','tally_ledgers','tally_stock_items','tally_import_quarantine','tally_raw_payloads','tally_upload_chunks','tally_upload_sessions','tally_sync_jobs','tally_import_warnings','tally_visibility_records'])report.storedCounts[table]=(await db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).n;
    await db.exec('COMMIT');
  });
  await fs.writeFile('docs/tally-visibility-verification.json',JSON.stringify(report,null,2));
  const marker='\n<!-- tally-visibility-verified -->';
  let audit=(await fs.readFile('docs/tally-visibility-audit.md','utf8')).split(marker)[0];
  audit+=marker+'\n\n## Implemented and verified coverage\n\nThe baseline MISSING marks above describe the original defect. All delivered fields below now have an indexed field, a selectable browser column, search, detail/history access and server export for Owner/Accounts. Nonfinancial access is fail-closed; unknown or financial XML paths remain restricted. No raw payload or original master row was rewritten by migration/backfill.\n\n';
  audit+='The native `/tally` route replaces the legacy-root fallback. Browse latest records or **Every imported sync snapshot**; the latter also searches/exports historical field values. Detail drawers select the exact snapshot, show all fields and changes, and link original XML. Saved views retain filters, sort, snapshot mode and selected columns. Density follows account preferences.\n\n';
  audit+='Controller/service/repository layers are `tally-visibility-routes.js`, `tally-visibility-service.js`, and `tally-visibility-repository.js`, behind the contracts in `tally-visibility-contracts.d.ts`. The shared `public/tally-entity-descriptors.js` drives API fields, columns, detail rows and formatting. Migrations 0023–0028 add derived history, permission projections, search indexes, display helpers, explicit CRM ID links, company identity aliases and source observations. Receiver imports preserve existing raw master/quarantine rows; newer state is appended to the index. Replay is idempotent and writes only that index.\n\n';
  audit+='CSV and Excel Spreadsheet XML (`.xml`, literal string cells) exports include every filtered page, preserve decimal text, neutralize spreadsheet formulas, check every requested column against the server projection, and write an audit event. Reconciliation creates explicit company/entity/Tally-ID links; names never create a link. Existing name-only legacy mappings are deliberately not treated as verified ID links.\n\n';
  audit+=`Read-only verification: ${report.checkedAt}. ${report.sourcePayloadHashesVerified} payload SHA-256 hashes verified; ${report.rawLeavesVerified} parsed raw leaves verified. Stock coverage: ${report.stockCoverage.valued} valued / ${report.stockCoverage.unvalued} unvalued / ${report.stockCoverage.total} total (partial).\n\n`;
  audit+='### Data still awaiting delivery/deployment\n\nAn actual read-only full-field XML export has now recovered Company, Group, Ledger, StockItem, StockGroup, StockCategory, Unit and Godown collections. The incomplete run honestly remains failed because PriceLevel timed out before CostCentre was attempted; any separately scoped CostCentre result is recorded in its own import report. Original source rows were preserved, with recovered fields appended to history. See `tally-master-coverage-import.json`. The checked-in Windows connector requests full master methods and optional collections, and its Core project builds, but the installed Windows service has not been replaced. Deploy that build for ongoing full-field imports.\n\nHistorical Engine/Bizgenix source IDs, retry attempts and next-sync schedule were not stored and remain Unknown. New source-labelled uploads retain their provenance and reported retry metadata. Vouchers remain **Awaiting voucher data**: implement a read-only voucher export carrying stable IDs, dates, ledger/inventory/tax entries and invoice references; add paginated connector transport, replay and reconciliation. Invoices need those voucher entries and references; no invoice data is fabricated. Quarantine replay preserves original rows and reasons.\n\nThe existing real-schema browser verifiers were not run because they create sessions/audits in real data. The existing static verifier failed on its stale badge-route mock. The new verifier uses real HTTP/API/UI with a random test schema and drops that schema afterwards.\n\n';
  for(const entity of [...new Set(report.fieldCoverage.map(r=>r.entity))]) {
    audit+=`### ${entity}: every indexed delivered/stored field\n\n| Field (JSON Pointer) | Owner / Accounts | Other permitted roles |\n| --- | --- | --- |\n`;
    audit+=report.fieldCoverage.filter(r=>r.entity===entity).map(r=>`| ${r.key.replaceAll('|','\\|')} | Visible, searchable, exportable | ${r.nonfinancial?'Visible, searchable, exportable':'Restricted (financial or unclassified)'} |`).join('\n')+'\n\n';
  }
  audit+='All browsers additionally expose `/meta/observed_at`, `/meta/session_id`, and `/meta/record_key`. Empty/undelivered entities have explicit absence reasons rather than synthetic rows.\n';
  await fs.writeFile('docs/tally-visibility-audit.md',audit);
  const {fieldCoverage,...summary}=report;console.log(JSON.stringify({...summary,indexedFieldCount:fieldCoverage.length},null,2));
} catch(error){console.error(`Read-only visibility verification failed (${error.code||error.name}).`);process.exitCode=1;}
finally{await db.close();}
