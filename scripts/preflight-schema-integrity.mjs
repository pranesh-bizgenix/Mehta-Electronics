import fs from 'node:fs';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';
const policy=JSON.parse(fs.readFileSync(new URL('../docs/schema-policy.json',import.meta.url),'utf8'));
const sql=connectPostgres(getConfig().databaseUrl),findings=[];
const identifier=value=>{if(!/^[a-z_][a-z0-9_]*$/.test(value))throw new Error('Invalid schema identifier.');return `"${value}"`;};
try{
  await sql.ready();
  await sql.begin('read only',async tx=>{
    for(const [key,values]of Object.entries(policy.statusDomains)){
      const [table,column]=key.split('.'),params=values.map((_,i)=>`$${i+1}`).join(',');
      const [row]=await tx.unsafe(`SELECT count(*) AS n FROM ${identifier(table)} WHERE ${identifier(column)} IS NOT NULL AND ${identifier(column)} NOT IN (${params})`,values);
      if(row.n)findings.push({check:key,invalidRows:row.n});
    }
    const [orphan]=await tx`SELECT count(*) AS n FROM tally_visibility_current_cache c LEFT JOIN tally_upload_sessions s ON s.id=c.session_id WHERE c.session_id IS NOT NULL AND s.id IS NULL`;
    if(orphan.n)findings.push({check:'cache session FK',invalidRows:orphan.n});
    const [duplicates]=await tx`SELECT count(*) AS n FROM (SELECT content_sha256,document_type FROM source_documents GROUP BY content_sha256,document_type HAVING count(*)>1) d`;
    if(duplicates.n)findings.push({check:'source document identity',duplicateGroups:duplicates.n});
  });
  console.log(JSON.stringify({readOnly:true,database:'mehta_electronics_local',checks:Object.keys(policy.statusDomains).length+2,findings}));
  if(findings.length)process.exitCode=1;
}catch(error){console.error(`Schema preflight failed (${error.code||error.name}). No rows changed.`);process.exitCode=1;}
finally{await sql.end({timeout:5});}
