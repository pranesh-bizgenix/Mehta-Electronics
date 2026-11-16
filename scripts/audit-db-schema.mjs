import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';
import {readSchema,structuralFindings,businessMetadataFindings,schemaMarkdown} from './lib/schema-audit.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sql=connectPostgres(getConfig().databaseUrl);
try{
  await sql.ready();
  const schema=await sql.begin('read only',readSchema);
  const policyPath=path.join(root,'docs/schema-policy.json');
  const policy=fs.existsSync(policyPath)?JSON.parse(fs.readFileSync(policyPath,'utf8')):{};
  const findings=[...structuralFindings(schema,policy.exceptions),...businessMetadataFindings(schema,policy.businessTables)];
  fs.mkdirSync(path.join(root,'output/schema-audit'),{recursive:true});
  fs.writeFileSync(path.join(root,'output/schema-audit/schema-snapshot.json'),JSON.stringify({...schema,findings},null,2)+'\n');
  fs.writeFileSync(path.join(root,'docs/db-schema-reference.md'),schemaMarkdown(schema,policy));
  console.log(JSON.stringify({database:schema.database,tables:schema.tables.length,columns:schema.columns.length,findings:findings.length,open:findings.filter(f=>!f.exception).length,byKind:Object.fromEntries([...new Set(findings.map(f=>f.kind))].map(kind=>[kind,findings.filter(f=>f.kind===kind).length])),report:'docs/db-schema-reference.md'}));
}catch(error){console.error(`Schema audit failed (${error.code||error.name}): ${error.message}`);process.exitCode=1;}
finally{await sql.end({timeout:5});}
