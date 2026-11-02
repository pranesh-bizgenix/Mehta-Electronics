import fs from 'node:fs/promises';
import {getConfig} from '../src/config.js';
import {createDatabase} from '../src/postgres.js';
import {createConnectorStore} from '../src/connector-store.js';
import {importTallySession,parseCollection,scalar,markFinalizeFailed} from '../src/tally-import.js';
import {tallySalesDocumentKind} from '../src/tally-sales-documents.js';
const config=getConfig(),db=createDatabase(config),store=createConnectorStore(config);
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const report={at:new Date().toISOString(),source:'direct_xml',tallyReadOnly:true};let session;
try{
 const companyId=process.argv.find(a=>a.startsWith('--company='))?.slice(10);
 const companies=await db.prepare('SELECT id,name,tally_guid FROM tally_companies ORDER BY name,id').all();
 const company=companyId?companies.find(c=>c.id===companyId):companies.length===1?companies[0]:null;
 if(!company)throw Error('Specify --company=<imported company UUID> when multiple companies exist.');
 const previous=await db.prepare('SELECT min(sync_from)::text AS from_date FROM tally_upload_sessions WHERE company_name=?').get(company.name);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const from=previous.from_date||'1900-01-01';
 report.companyId=company.id;report.from=from;report.to=today;
 const filter='$VoucherTypeName = "Sales Quotation" OR $VoucherTypeName = "Quotation1" OR $VoucherTypeName = "Quotation" OR $VoucherTypeName = "Enquiry" OR $VoucherTypeName = "Inquiry" OR ($VoucherTypeName = "Sales Order" AND $IsOptional)';
 const body=`<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CRMSalesDocuments</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${escape(company.name)}</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">${from.replaceAll('-','')}</SVFROMDATE><SVTODATE TYPE="Date">${today.replaceAll('-','')}</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="CRMSalesDocuments" ISMODIFY="No" ISINITIALIZE="Yes"><TYPE>Voucher</TYPE><FETCH>*,GUID,MASTERID,ALTERID,DATE,VOUCHERNUMBER,VOUCHERTYPENAME,PARTYLEDGERNAME,ISOPTIONAL,ISCANCELLED,ISDELETED,ALLINVENTORYENTRIES.LIST,ALLLEDGERENTRIES.LIST</FETCH><FILTER>CRMSalesDocumentFilter</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="CRMSalesDocumentFilter">${escape(filter)}</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
 const response=await fetch(config.tallyUrl,{method:'POST',body,headers:{'content-type':'application/xml; charset=utf-8'},signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error('Tally HTTP export failed.');
 const content=await response.text(),records=parseCollection(content,'VOUCHER');
 report.fetched=records.length;report.types={};report.cancelled=0;report.identified=0;
 for(const raw of records){const type=scalar(raw.VOUCHERTYPENAME)||scalar(raw['@_VCHTYPE'])||'Unknown';report.types[type]=(report.types[type]||0)+1;if(/^yes$/i.test(scalar(raw.ISCANCELLED)||''))report.cancelled++;if(tallySalesDocumentKind(raw))report.identified++;}
 console.log(JSON.stringify({fetched:report.fetched,types:report.types,cancelled:report.cancelled,bytes:Buffer.byteLength(content),sampleFieldCount:records[0]?Object.keys(records[0]).length:0}));
 if(process.argv.includes('--probe')){console.log('Probe only; no source data stored.');process.exitCode=0;}
 else{
 let connector=await db.prepare("SELECT id,expected_company_name FROM tally_connectors WHERE profile_name='Local XML sales document export' AND expected_company_name=? AND status='active' ORDER BY created_at LIMIT 1").get(company.name);
 if(!connector){const created=await store.setup({profileName:'Local XML sales document export',companyName:company.name});connector={id:created.id,expected_company_name:company.name};}
 session=await store.start(connector,{companyName:company.name,companyGuid:company.tally_guid,syncFrom:from,syncTo:today,sourceSystem:'direct_xml',retryCount:0});
 let sequence=0;
 for(let offset=0;offset<content.length;){let end=Math.min(offset+512000,content.length);if(end<content.length&&content.charCodeAt(end-1)>=0xd800&&content.charCodeAt(end-1)<=0xdbff)end--;await store.append(connector,{sessionId:session.sessionId,field:'salesDocumentsXml',sequence:sequence++,content:content.slice(offset,end)});offset=end;}
 const result=await importTallySession(db,session.sessionId,{requiredDatasets:['salesDocumentsXml']});
 report.status=result.status;report.sessionId=session.sessionId;report.datasets=result.datasets;
 report.persisted=await db.prepare("SELECT entity,count(DISTINCT record_key) AS records FROM tally_visibility_records WHERE session_id=? AND entity IN ('quotations','enquiries','vouchers') GROUP BY entity").all(session.sessionId);
 await fs.writeFile('docs/tally-sales-document-import.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(result.status!=='stored'||report.persisted.find(r=>r.entity==='vouchers')?.records!==records.length&&records.length>0)throw Error('Source count and persisted count did not reconcile; inspect retained payload.');
 }
}catch(error){if(session)await markFinalizeFailed(db,session.sessionId,error);console.error(error.code||error.cause?.code||error.message);process.exitCode=1;}finally{await store.close();await db.close();}
