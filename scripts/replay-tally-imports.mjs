import { getConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { importTallySession } from '../src/tally-import.js';

const db=await openDatabase(getConfig());
try {
  const sessions=await db.prepare('SELECT id FROM tally_upload_sessions ORDER BY created_at').all();
  for(const session of sessions){
    const summary=await importTallySession(db,session.id,{replay:process.argv.includes('--reprocess')});
    console.log(JSON.stringify(summary));
  }
  const warnings=await db.prepare("SELECT DISTINCT details::text AS names FROM tally_import_warnings WHERE warning_key LIKE 'matching:%' ORDER BY names").all();
  console.log('Distinct names that collided under the old punctuation-stripped identity:');
  for(const warning of warnings)console.log(warning.names);
} finally { await db.close(); }
