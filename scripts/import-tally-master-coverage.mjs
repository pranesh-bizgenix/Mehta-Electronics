// Operator-triggered, actual Tally Export -> immutable chunks/payloads -> append-only index.
// No Tally Import request, no source-row updates, no credentials in output.
import fs from 'node:fs/promises';
import { getConfig } from '../src/config.js';
import { createDatabase } from '../src/postgres.js';
import { createConnectorStore } from '../src/connector-store.js';
import { importTallySession,parseCollection,markFinalizeFailed } from '../src/tally-import.js';

const config=getConfig();
if(new URL(config.databaseUrl).pathname!=='/mehta_electronics_local')throw new Error('Unexpected DATABASE_URL database.');
const db=createDatabase(config),store=createConnectorStore(config);
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const definitions=[['companiesXml','Company','COMPANY'],['groupsXml','Group','GROUP'],['ledgersXml','Ledger','LEDGER'],['stockXml','StockItem','STOCKITEM'],['stockGroupsXml','StockGroup','STOCKGROUP'],['stockCategoriesXml','StockCategory','STOCKCATEGORY'],['unitsXml','Unit','UNIT'],['godownsXml','Godown','GODOWN'],['priceLevelsXml','PriceLevel','PRICELEVEL'],['costCentresXml','CostCentre','COSTCENTRE']];
const requested=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7);
if(requested&&!definitions.some(([field])=>field===requested))throw new Error('Unknown collection');
const selected=requested?definitions.filter(([field])=>field===requested):definitions;
const report={checkedAt:new Date().toISOString(),source:'direct_xml',tallyReadOnly:true,collections:[]};
let session;
try {
  const company=await db.prepare('SELECT id,name,tally_guid FROM tally_companies ORDER BY name,id LIMIT 1').get();
  if(!company)throw new Error('No imported company is available.');
  const previous=await db.prepare('SELECT min(sync_from)::text AS from_date FROM tally_upload_sessions WHERE company_name=?').get(company.name);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const from=previous.from_date||`${today.slice(0,4)}-04-01`;
  let connector=await db.prepare("SELECT id,expected_company_name FROM tally_connectors WHERE profile_name='Local XML master export' AND expected_company_name=? AND status='active' ORDER BY created_at LIMIT 1").get(company.name);
  if(!connector){const created=await store.setup({profileName:'Local XML master export',companyName:company.name});connector={id:created.id,expected_company_name:company.name};}
  session=await store.start(connector,{companyName:company.name,companyGuid:company.tally_guid,syncFrom:from,syncTo:today,sourceSystem:'direct_xml',retryCount:0});
  for(const [field,type,tag] of selected) {
    const computed=field==='stockXml'?',NAME,GUID,MASTERID,ALTERID,PARENT,BASEUNITS,OPENINGBALANCE,OPENINGRATE,OPENINGVALUE,CLOSINGBALANCE,CLOSINGRATE,CLOSINGVALUE':field==='ledgersXml'||field==='groupsXml'?',NAME,GUID,MASTERID,ALTERID,PARENT,OPENINGBALANCE,CLOSINGBALANCE':'';
    await db.prepare("UPDATE tally_sync_jobs SET last_progress_at=now(),message=? WHERE id=?").run(`Reading ${type} (read-only full-field export)`,session.syncJobId);
    const body=`<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CRMFullMasterCoverage</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${escape(company.name)}</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">${from.replaceAll('-','')}</SVFROMDATE><SVTODATE TYPE="Date">${today.replaceAll('-','')}</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="CRMFullMasterCoverage" ISMODIFY="No" ISINITIALIZE="Yes"><TYPE>${type}</TYPE><FETCH>*${computed}</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
    const response=await fetch(config.tallyUrl,{method:'POST',headers:{'content-type':'application/xml; charset=utf-8'},body,signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw Object.assign(new Error('Tally HTTP export failed.'),{code:`HTTP_${response.status}`});
    const content=await response.text();let sequence=0;
    for(let offset=0;offset<content.length;) {
      let end=Math.min(offset+512000,content.length);
      if(end<content.length&&content.charCodeAt(end-1)>=0xd800&&content.charCodeAt(end-1)<=0xdbff)end--;
      await store.append(connector,{sessionId:session.sessionId,field,sequence:sequence++,content:content.slice(offset,end)});offset=end;
    }
    let count=null,status='received';
    try{count=parseCollection(content,tag).length;}catch{status='retained_with_parse_error';}
    report.collections.push({entity:type,records:count,status,bytes:Buffer.byteLength(content),chunks:sequence});
    console.log(JSON.stringify(report.collections.at(-1)));
  }
  console.log('Indexing retained master exports; imported source rows remain unchanged.');
  const result=await importTallySession(db,session.sessionId,{requiredDatasets:selected.map(([field])=>field)});
  report.status=result.status;report.quarantined=result.quarantined;report.sessionId=session.sessionId;
  await fs.writeFile(`docs/tally-master-coverage${requested?'-'+requested:''}-import.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:result.status,ledgers:result.customers,items:result.items,groups:result.groups,quarantined:result.quarantined}));
  if(result.status==='failed')process.exitCode=1;
}catch(error){
  if(session)await markFinalizeFailed(db,session.sessionId,{message:'Read-only master export failed; received chunks retained.'});
  report.status='failed';report.sessionId=session?.sessionId;report.errorCode=String(error.code||error.name);
  report.requested=selected.map(([field])=>field);
  await fs.writeFile(`docs/tally-master-coverage${requested?'-'+requested:''}-attempt.json`,JSON.stringify(report,null,2));
  console.error(`Read-only master import failed (${error.code||error.name}); received source data retained.`);process.exitCode=1;
}finally{await store.close();await db.close();}
