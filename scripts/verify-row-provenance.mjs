import fs from 'node:fs';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';
import {readSchema} from './lib/schema-audit.mjs';
const directory=new URL('../output/schema-audit/',import.meta.url);
const manifest=new URL('row-provenance-before.json',directory),after=process.argv.includes('--after');
const policy=JSON.parse(fs.readFileSync(new URL('../docs/schema-policy.json',import.meta.url),'utf8'));
const quote=value=>{if(!/^[a-z_][a-z0-9_]*$/.test(value))throw new Error('Invalid schema identifier');return `"${value}"`;};
const sql=connectPostgres(getConfig().databaseUrl);
try{
  await sql.ready();
  const report=await sql.begin('read only',async tx=>{
    if(!after){
      const schema=await readSchema(tx),unknown=[];
      for(const table of policy.businessTables)for(const column of ['created_at','created_by']){
        if(!schema.columns.some(c=>c.table===table&&c.name===column)){
          const [row]=await tx.unsafe(`SELECT count(*) AS n FROM ${quote(table)}`);
          unknown.push({table,column,rowsBefore:row.n});
        }
      }
      return {database:'mehta_electronics_local',checkedAt:new Date().toISOString(),unknown};
    }
    const before=JSON.parse(fs.readFileSync(manifest,'utf8')),checks=[];
    for(const entry of before.unknown){
      const [row]=await tx.unsafe(`SELECT count(*) FILTER(WHERE row_metadata_version=0) AS legacy_rows,count(*) FILTER(WHERE row_metadata_version=0 AND ${quote(entry.column)} IS NOT NULL) AS invented FROM ${quote(entry.table)}`);
      checks.push({...entry,legacyRows:row.legacy_rows,inventedCreationValues:row.invented});
      if(row.invented)throw new Error('Legacy creation provenance was unexpectedly populated.');
    }
    return {database:'mehta_electronics_local',checkedAt:new Date().toISOString(),checks,pass:true};
  });
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(after?new URL('row-provenance-after.json',directory):manifest,JSON.stringify(report,null,2)+'\n');
  console.log(after?'PASS: new creation columns remain unknown for legacy records; no historical creator/time was invented.':`PASS: read-only provenance baseline recorded for ${report.unknown.length} missing creation columns.`);
}catch(error){console.error(`Provenance verification failed (${error.code||error.name}): ${error.message}`);process.exitCode=1;}
finally{await sql.end({timeout:5});}
