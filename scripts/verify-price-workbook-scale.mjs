// Read-only source verification. Never publishes a list or changes item prices.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';
import {readPriceWorkbook} from '../src/modules/pricing/tabular.js';
import {levelWorkbookPreset} from '../src/modules/pricing/workbook-preset.js';
import {planPriceImport,priceFileHash} from '../src/modules/pricing/import-plan.js';

const filename=process.argv[2];if(!filename)throw new Error('Usage: node scripts/verify-price-workbook-scale.mjs <existing.xlsx>');
const bytes=await fs.readFile(filename),fileSha256=priceFileHash(bytes),sheets=readPriceWorkbook(bytes).sheets;
const url=getConfig().databaseUrl,target=new URL(url);
assert.equal(target.hostname,'mehta-controldesk-db01.chs2eymsy2ec.ap-southeast-2.rds.amazonaws.com');assert.equal(decodeURIComponent(target.pathname.slice(1)),'postgres');
const sql=connectPostgres(url),report={source:path.basename(filename),fileSha256,bytes:bytes.length,mode:'READ_ONLY_PREVIEW_NO_PUBLICATION',sheets:[]};
try{
 const items=await sql.begin('read only',tx=>tx`SELECT id,part_code,uom,status,updated_at FROM items WHERE NOT is_deleted`);
 for(const sheet of sheets){const started=performance.now(),table=readPriceWorkbook(bytes,sheet),header=table.rows.find(row=>row.number===1)?.cells.map(cell=>cell?.text||''),mapping=levelWorkbookPreset(header,sheet);assert.ok(mapping,'Unrecognized workbook header: '+sheet);
  const options={fileSha256,metadata:{sourceSheet:sheet}},first=planPriceImport(table,mapping,items,options),again=planPriceImport(table,mapping,items,options);assert.equal(first.previewFingerprint,again.previewFingerprint,'Repeat preview changed');
  const issues={};for(const row of first.rows)for(const issue of row.issues)issues[issue]=(issues[issue]||0)+1;
  report.sheets.push({sheet,sourceRows:table.rows.length,dataRows:first.rows.length,validRows:first.validRows,reviewRows:first.invalidRows,canSave:first.canSave,repeatStable:true,previewFingerprint:first.previewFingerprint,elapsedMilliseconds:Math.round(performance.now()-started),issues});
 }
 report.status='PREVIEW_VERIFIED';await fs.mkdir('verification-output/crm-completion',{recursive:true});await fs.writeFile('verification-output/crm-completion/workbook-scale.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await sql.end({timeout:5});}
