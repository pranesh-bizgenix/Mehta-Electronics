import { getConfig } from '../src/config.js';
import { createDatabase } from '../src/postgres.js';
import { replayVisibility } from '../src/tally-visibility-replay.js';

const config=getConfig();
if(new URL(config.databaseUrl).pathname!=='/mehta_electronics_local')throw new Error('Unexpected DATABASE_URL database.');
const db=createDatabase(config);
try { const result=await replayVisibility(db);console.log(JSON.stringify({payloads:result.payloads,indexed:result.indexed,errors:result.errors})); }
catch(error){console.error(`Field-index replay failed (${error.code || error.name}); source data is unchanged.`);process.exitCode=1;}
finally{await db.close();}
