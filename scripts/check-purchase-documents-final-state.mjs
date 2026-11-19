import fs from 'node:fs';import assert from 'node:assert/strict';import {getConfig} from '../src/config.js';import {connectPostgres} from '../src/postgres.js';
const sql=connectPostgres(getConfig().databaseUrl);try{await sql.ready();const result=await sql.begin('read only',async tx=>{
 const [settings]=await tx`SELECT version,value FROM company_document_settings WHERE id=1`;
 const [documents]=await tx`SELECT count(*) AS n FROM purchase_documents WHERE payload::text LIKE '%ZZTEST_%'`;
 const [vendors]=await tx`SELECT count(*) AS n FROM crm_procurement_vendors WHERE payload->>'name' LIKE 'ZZTEST_ document supplier %'`;
 assert.equal(documents.n,0);assert.equal(vendors.n,0);
 return {at:new Date().toISOString(),status:'PASS',temporaryDocuments:documents.n,temporaryVendors:vendors.n,companySettingsVersion:settings.version,configurationPresent:Object.keys(settings.value).length>0,defaultDraftDownloadsOff:settings.value.documents?.RFQ?.allowDraftDownload!==true&&settings.value.documents?.PO?.allowDraftDownload!==true,scope:'Independent read-only post-rollback check; no settings changed'};
 });fs.writeFileSync('verification-output/purchase-documents/2026-11-18/final-state.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}finally{await sql.end({timeout:5});}
