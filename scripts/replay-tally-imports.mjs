import { getConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { importTallySession } from '../src/tally-import.js';

const companyArguments=process.argv.slice(2).filter(value=>value.startsWith('--company-id='));
const allCompanies=process.argv.includes('--all-companies');
const companyId=companyArguments[0]?.slice('--company-id='.length);
if(companyArguments.length>1||allCompanies&&companyId||!allCompanies&&!companyId||companyId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)){
  throw new Error('Replay requires --company-id=<imported company UUID>, or explicit --all-companies for maintenance.');
}
const db=await openDatabase(getConfig());
try {
  if(companyId&&!await db.prepare('SELECT id FROM tally_companies WHERE id=?').get(companyId))throw new Error('Imported company not found.');
  const sessions=await db.prepare(`SELECT s.id FROM tally_upload_sessions s${companyId?' WHERE EXISTS(SELECT 1 FROM tally_raw_payloads p WHERE p.session_id=s.id AND p.company_id=?)':''} ORDER BY s.created_at`).all(...(companyId?[companyId]:[]));
  for(const session of sessions){
    const summary=await importTallySession(db,session.id,{replay:process.argv.includes('--reprocess')});
    console.log(JSON.stringify(summary));
  }
  const warnings=await db.prepare(`SELECT DISTINCT details::text AS names FROM tally_import_warnings WHERE warning_key LIKE 'matching:%'${companyId?' AND company_id=?':''} ORDER BY names`).all(...(companyId?[companyId]:[]));
  console.log('Distinct names that collided under the old punctuation-stripped identity:');
  for(const warning of warnings)console.log(warning.names);
} finally { await db.close(); }
