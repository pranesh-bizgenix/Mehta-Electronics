import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {withAuthorizedRdsRollbackVerification} from '../test-support/transaction.js';import {reportCatalogue,reportXlsx} from '../src/modules/billing/reports.js';import {readPriceWorkbook} from '../src/modules/pricing/tabular.js';
const checks=[],out='verification-output/report-exports';await fs.mkdir(out,{recursive:true});
await withAuthorizedRdsRollbackVerification(async db=>{
 const actor=await db.prepare("SELECT id,role FROM users WHERE email='owner@test.local' AND status='ACTIVE' AND role='OWNER'").get();assert.ok(actor);
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),body={from:date,to:date,status:'',reason:'Verify exact Excel report export; rollback access audit; no business record import'};
 for(const report of reportCatalogue(actor)){
  const file=await reportXlsx(db,actor,report.key,body),data=readPriceWorkbook(file.bytes,'CRM register'),details=readPriceWorkbook(file.bytes,'Report details'),count=details.rows.find(r=>r.cells[0]?.text==='Records')?.cells[1]?.text;
  assert.equal(data.rows.length,Number(count)+1);assert.ok(data.rows.every(r=>r.cells.every(c=>!c?.formula)));assert.ok(file.filename.endsWith('.xlsx'));await fs.writeFile(`${out}/rds-${report.key}.xlsx`,file.bytes);checks.push(report.key+' exports all selected rows with scope metadata and literal values');console.log('PASS',report.key,'Excel export');
 }
 await assert.rejects(reportXlsx(db,{...actor,role:'EXECUTIVE'},'invoices',body),{status:403});checks.push('Restricted staff cannot export financial invoice data');
 for(const key of ['not-a-report','constructor','toString','__proto__']){await assert.rejects(reportXlsx(db,actor,key,body),{status:422});checks.push('Unknown or inherited report key is rejected: '+key);}
 const audit=await db.prepare("SELECT count(*)::integer AS n FROM audit_logs WHERE entity='CRM_REPORT' AND action='XLSX_DOWNLOAD' AND reason=?").get(body.reason);assert.equal(audit.n,reportCatalogue(actor).length);checks.push('Every successful export uses the existing audit log');
},{productionTransactions:true});
await fs.writeFile(`${out}/rds-report.json`,JSON.stringify({passed:checks.length,checks,scope:'Existing CRM data read only; generated files local/private; all access-audit writes rolled back. No business import or financial posting.'},null,2));
