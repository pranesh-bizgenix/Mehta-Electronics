import fs from 'node:fs/promises';
import { getConfig } from '../src/config.js';
import { createDatabase } from '../src/postgres.js';
import { importTallySession } from '../src/tally-import.js';
const config=getConfig();
if(new URL(config.databaseUrl).pathname!=='/mehta_electronics_local')throw new Error('Unexpected database.');
const db=createDatabase(config);
try {
 const session=await db.prepare("SELECT s.id FROM tally_upload_sessions s JOIN tally_connectors c ON c.id=s.connector_id WHERE c.profile_name='Local XML master export' ORDER BY s.created_at DESC LIMIT 1").get();
 if(!session)throw new Error('No retained master export.');
 const result=await importTallySession(db,session.id,{requiredDatasets:['companiesXml','groupsXml','ledgersXml','stockXml','stockGroupsXml','stockCategoriesXml','unitsXml','godownsXml','priceLevelsXml','costCentresXml']});
 const report={checkedAt:new Date().toISOString(),source:'direct_xml',sessionId:session.id,status:result.status,quarantined:result.quarantined,datasets:result.datasets,
  note:'PriceLevel export timed out before CostCentre was attempted. Valid received collections are indexed; the incomplete run remains failed.'};
 await fs.writeFile('docs/tally-master-coverage-import.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){console.error(`Retained master indexing failed (${error.code||error.name}).`);process.exitCode=1;}
finally{await db.close();}
