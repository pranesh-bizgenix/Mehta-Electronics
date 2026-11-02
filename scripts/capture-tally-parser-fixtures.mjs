// Development fixture capture: SELECT-only source access, every value anonymized.
import fs from 'node:fs/promises';
import { XMLBuilder } from 'fast-xml-parser';
import { getConfig } from '../src/config.js';
import { connectPostgres } from '../src/postgres.js';
import { TALLY_ENTITY_DESCRIPTORS } from '../public/tally-entity-descriptors.js';
const sql=connectPostgres(getConfig().databaseUrl,{postgresOptions:{max:1,connection:{default_transaction_read_only:'on'}}});
const builder=new XMLBuilder({ignoreAttributes:false,format:true});
const report={source:'Anonymized real exported record structures; lists capped at two elements; no source values retained.',entities:[],unavailable:[],companyPricePaths:[]};
try {
 await fs.mkdir('test/fixtures/tally-real-anonymized',{recursive:true});
 for(const entity of Object.values(TALLY_ENTITY_DESCRIPTORS).filter(e=>e.id===e.baseEntity&&e.xmlTag)) {
  const rows=await sql`SELECT raw_record,fields FROM tally_visibility_records WHERE entity=${entity.id} AND raw_record<>'{}'::jsonb ORDER BY observed_at DESC LIMIT 1`;
  if(!rows.length){report.unavailable.push(entity.id);continue;}
  if(entity.id==='companies')report.companyPricePaths=Object.keys(rows[0].fields).filter(key=>/price/i.test(key));
  const scrub=(value,tag='')=>{
   if(Array.isArray(value))return value.slice(0,2).map(child=>scrub(child,tag));
   if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,key==='@_TYPE'&&['String','Number','Amount','Date','Logical','Quantity','Rate'].includes(child)?child:scrub(child,key==='#text'?tag:key)]));
   if(value==null||value==='')return value;
   if(tag==='@_NAME')return entity.id==='ledgers'?'CafÃƒÂ©':`Fixture ${entity.id}`;
   if(/GUID/.test(tag))return '11111111-1111-4111-8111-111111111111';
   if(/MASTERID|ALTERID/.test(tag))return '101';
   if(/DATE|ALTEREDON/.test(tag))return '20260401';
   if(/BALANCE|VALUE|AMOUNT|LIMIT|PRICE|COST|RATE/.test(tag))return entity.id==='items'&&tag==='CLOSINGBALANCE'?'2 NOS':'1234.56';
   if(/GSTIN/.test(tag))return '33AAACX1234X1Z5';
   if(/HSNCODE/.test(tag))return '8536';
   if(/PAN|INCOMETAXNUMBER/.test(tag))return 'AAACX1234X';
   if(/EMAIL/.test(tag))return 'fixture@example.invalid';
   if(/PHONE|MOBILE/.test(tag))return '9000000000';
   if(/PARENT/.test(tag))return entity.id==='ledgers'?'Sundry Debtors':'Primary';
   if(/UNITS/.test(tag))return 'NOS';
   if(/STATE/.test(tag))return 'Tamil Nadu';
   if(/^(IS|HAS|CAN|USE)/.test(tag))return 'No';
   return 'Fixture';
  };
  const raw=scrub(rows[0].raw_record);
  const xml=builder.build({ENVELOPE:{BODY:{DATA:{COLLECTION:{[entity.xmlTag]:raw}}}}});
  await fs.writeFile(`test/fixtures/tally-real-anonymized/${entity.id}.xml`,'<!-- Anonymized real export structure. Test data only. -->\n'+xml);
  report.entities.push(entity.id);
 }
 await fs.writeFile('test/fixtures/tally-real-anonymized/provenance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await sql.end();}
