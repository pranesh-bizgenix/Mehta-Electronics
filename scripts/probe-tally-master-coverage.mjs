// Read-only Tally Export smoke check. Does not import or persist the response.
import fs from 'node:fs/promises';
import { getConfig } from '../src/config.js';
import { connectPostgres } from '../src/postgres.js';
import { parseCollection } from '../src/tally-import.js';
const config=getConfig(),sql=connectPostgres(config.databaseUrl,{postgresOptions:{max:1,connection:{default_transaction_read_only:'on'}}});
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const report={checkedAt:new Date().toISOString(),tallyReadOnly:true,collections:[]};
try {
  const company=(await sql`SELECT name FROM tally_companies ORDER BY name LIMIT 1`)[0];
  if(!company)throw new Error('No imported company available for coverage probe.');
  for(const [type,tag] of [['Group','GROUP'],['Unit','UNIT'],['Godown','GODOWN']]) {
    const body=`<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CRMVisibilityProbe</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${escape(company.name)}</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="CRMVisibilityProbe" ISMODIFY="No" ISINITIALIZE="Yes"><TYPE>${type}</TYPE><FETCH>*</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
    try {
      const response=await fetch(config.tallyUrl,{method:'POST',headers:{'content-type':'application/xml; charset=utf-8'},body,signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error('Tally HTTP response failed.');
      const xml=await response.text(),records=parseCollection(xml,tag),fields=new Set(records.flatMap(record=>Object.keys(record)));
      report.collections.push({entity:type,status:'exported',records:records.length,topLevelFields:fields.size,responseBytes:Buffer.byteLength(xml)});
    }catch(error){report.collections.push({entity:type,status:'unavailable',error:error.cause?.code||error.code||error.name});}
  }
  await fs.writeFile('docs/tally-master-coverage-probe.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await sql.end();}
