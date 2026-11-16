import fs from 'node:fs';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';

const policy=JSON.parse(fs.readFileSync(new URL('../docs/workflow-integrity-policy.json',import.meta.url),'utf8'));
const identifier=value=>{if(!/^[a-z_][a-z0-9_]*$/.test(value))throw new Error('Invalid schema identifier.');return `"${value}"`;};
const sql=connectPostgres(getConfig().databaseUrl);
try{
  await sql.ready();
  const findings=await sql.begin('read only',async tx=>{
    const result=[];
    for(const check of policy.newChecks){
      const [row]=await tx.unsafe(`SELECT count(*) AS n FROM ${identifier(check.table)} WHERE ${identifier(check.column)} < 0`);
      if(row.n)result.push({table:check.table,column:check.column,invalidRows:row.n});
    }
    const [row]=await tx`SELECT count(*) AS n FROM goods_receipt_lines WHERE accepted_quantity + rejected_quantity > received_quantity`;
    if(row.n)result.push({table:'goods_receipt_lines',constraint:'s0_received_disposition',invalidRows:row.n});
    return result;
  });
  console.log(JSON.stringify({database:'mehta_electronics_local',readOnly:true,checks:policy.newChecks.length+1,findings}));
  if(findings.length)process.exitCode=1;
}catch(error){console.error(`Quantity preflight failed (${error.code||error.name}). No rows changed.`);process.exitCode=1;}
finally{await sql.end({timeout:5});}
