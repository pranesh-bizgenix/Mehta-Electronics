import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {withTestTransaction} from '../test-support/transaction.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {logisticsDocument,readTallyLogistics} from '../src/tally-logistics.js';
import {collectionMetadata} from '../src/tally-collection-metadata.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';
import {importTallySession} from '../src/tally-import.js';
import {replayVisibilityPayload} from '../src/tally-visibility-replay.js';

test('logistics projection preserves exact quantity strings and only explicit operational fields',()=>{
 const raw={VOUCHERNUMBER:'VERIFY-note',AMOUNT:'VERIFY-SECRET',BASICSHIPPEDBY:'VERIFY-carrier',BASICSHIPDOCUMENTNO:'VERIFY-LR',
  'INVENTORYENTRIESIN.LIST':{STOCKITEMNAME:'VERIFY-part',ACTUALQTY:'9007199254740993.123 Nos',RATE:'VERIFY-SECRET','BATCHALLOCATIONS.LIST':{GODOWNNAME:'VERIFY-store',DESTINATIONGODOWNNAME:'VERIFY-dest',BATCHNAME:'VERIFY-batch',AMOUNT:'VERIFY-SECRET',ACTUALQTY:'1.000 Nos'}}};
 const result=logisticsDocument({record_key:'VERIFY-id',raw_record:raw});
 assert.equal(result.lines[0].actualQuantity,'9007199254740993.123 Nos');assert.equal(result.lines[0].billedQuantity,null);
 assert.equal(result.lines[0].allocations[0].godown,'VERIFY-store');assert.equal(result.lines[0].allocations[0].destinationGodown,'VERIFY-dest');
 assert.equal(result.dispatch.documentNumber,'VERIFY-LR');assert.ok(!JSON.stringify(result).includes('SECRET'));
 assert.equal(result.lines[0].collection,'INVENTORYENTRIESIN.LIST');
});

test('logistics collection accepts explicit date-window metadata without inventing source time',()=>{
 const result=collectionMetadata({logisticsDocumentsXml:{mode:'DATE_WINDOW',from:'2026-01-01',to:'2026-11-04'}});
 assert.equal(result.logisticsDocumentsXml.sourceTimestamp,null);
});

test('real logistics APIs isolate companies, reject Store staff, hide financial values and require authentication',()=>withTestTransaction(async db=>{
 const a=await tallyFixture(db,'VERIFY-Logistics A'),b=await tallyFixture(db,'VERIFY-Logistics B');
 for(const source of [a,b]){
  const fields={'/stored/voucher_type':'Delivery Note','/stored/voucher_number':'VERIFY-note','/stored/party_name':source===a?'VERIFY-A_party':'VERIFY-B_party','/stored/voucher_status':'RECORDED'};
  const raw={GUID:'VERIFY-guid',VOUCHERTYPENAME:'Delivery Note',VOUCHERNUMBER:'VERIFY-note',AMOUNT:'VERIFY-SECRET','ALLINVENTORYENTRIES.LIST':{STOCKITEMNAME:'VERIFY-part',ACTUALQTY:'2.345 Nos',AMOUNT:'VERIFY-SECRET','BATCHALLOCATIONS.LIST':{GODOWNNAME:'VERIFY-store',TRACKINGNUMBER:'VERIFY-track'}}};
  await db.sql`INSERT INTO tally_visibility_records(id,company_id,entity,record_key,session_id,name,raw_record,fields,content_hash,observed_at) VALUES(${source.company+':VERIFY-note'},${source.company},'vouchers','VERIFY-note',${source.session},'VERIFY-note',${db.sql.json(raw)},${db.sql.json(fields)},'VERIFY-hash',now())`;
  await db.sql`UPDATE tally_visibility_current_cache SET summary_fields=${db.sql.json(fields)} WHERE company_id=${source.company} AND record_key='VERIFY-note'`;
  await db.sql`INSERT INTO tally_visibility_current_cache(company_id,entity,record_key,record_id,name,session_id,observed_at,summary_fields,public_summary,financial_search,public_search,has_raw) VALUES(${source.company},'godowns','VERIFY-store','VERIFY-store','VERIFY-store',${source.session},now(),'{}','{}','VERIFY-SECRET','VERIFY-store',false)`;
 }
 const actors=[];
 for(const role of ['OWNER','LOGISTICS_LEAD','STORE_STAFF']){
  const id=(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(${`VERIFY-logistics_${role}`},${`VERIFY-logistics_${role}@example.test`},${role},'not-a-login',0) RETURNING id`)[0].id;
  const token=crypto.randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${id},${tokenDigest(token)},'VERIFY-csrf',now()+interval '1 hour')`;actors.push({id,role,token});
 }
 const app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false})});
 const call=async(path,actor=actors[1])=>{
  const req=Readable.from([]);Object.assign(req,{method:'GET',url:path,headers:{host:'localhost',...(actor?{cookie:`crm_session=${actor.token}`}:{})},socket:{remoteAddress:'test'}});
  const res={headersSent:false,setHeader(){},writeHead(status){this.status=status;this.headersSent=true;},end(body){this.body=JSON.parse(String(body));}};await app(req,res);return res;
 };
 const path='/api/crm/logistics/tally';
 try{
  assert.equal((await call(path,null)).status,401);assert.equal((await call(`${path}?companyId=${a.company}`,actors[2])).status,403);
  assert.equal((await call('/api/tally/read-companies')).status,200);
  for(const query of ['',`?companyId=${a.company}&companyId=${b.company}`,'?companyId=all'])assert.equal((await call(path+query)).status,422);
  for(const source of [a,b]){
   const result=await call(`${path}?companyId=${source.company}`);assert.equal(result.status,200);assert.equal(result.body.pagination.total,1);assert.equal(result.body.company.id,source.company);
   assert.equal(result.body.data[0].party,source===a?'VERIFY-A_party':'VERIFY-B_party');assert.ok(!JSON.stringify(result.body).includes('SECRET'));
   const detail=await call(`${path}/VERIFY-note?companyId=${source.company}`);assert.equal(detail.status,200);assert.equal(detail.body.data.lines[0].actualQuantity,'2.345 Nos');assert.ok(!JSON.stringify(detail.body).includes('SECRET'));
   const godowns=await call(`${path}?companyId=${source.company}&kind=godowns`);assert.equal(godowns.body.data[0].name,'VERIFY-store');assert.ok(!JSON.stringify(godowns.body).includes('SECRET'));
  }
  assert.equal((await call(`${path}?companyId=${a.company}&search=VERIFY-B_party`)).body.pagination.total,0);
  assert.equal((await call(`${path}?companyId=${a.company}&type=Sales`)).status,422);
  assert.equal((await call(`${path}/VERIFY-missing?companyId=${a.company}`)).status,404);
  await assert.rejects(readTallyLogistics(db,new URL(`http://localhost/?companyId=${a.company}`),actors[2]),{status:403});
 }finally{await app.close();installPermissionProvider(null);}
}));

test('new logistics dataset imports through the existing pipeline and retains its source identity',()=>withTestTransaction(async db=>{
 const f=await tallyFixture(db,'VERIFY-Logistics import');
 const xml='<ENVELOPE><BODY><DATA><COLLECTION><VOUCHER><GUID>VERIFY-logistics_guid</GUID><VOUCHERTYPENAME>Receipt Note</VOUCHERTYPENAME><VOUCHERNUMBER>VERIFY-receipt</VOUCHERNUMBER><DATE>20261104</DATE><ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>VERIFY-part</STOCKITEMNAME><ACTUALQTY>2 Nos</ACTUALQTY></ALLINVENTORYENTRIES.LIST></VOUCHER></COLLECTION></DATA></BODY></ENVELOPE>';
 // Session dataset rows follow the same receipt contract as connector uploads.
 await db.sql`INSERT INTO tally_upload_chunks(session_id,field_name,sequence,content) VALUES(${f.session},'logisticsDocumentsXml',0,${xml})`;
 await importTallySession(db,f.session,{requiredDatasets:['logisticsDocumentsXml']});
 const rows=await db.sql`SELECT record_key,summary_fields FROM tally_visibility_current_cache WHERE company_id=${f.company} AND entity='vouchers'`;
 assert.equal(rows.length,1);assert.equal(rows[0].summary_fields['/stored/voucher_type'],'Receipt Note');
 const receipt=await db.sql`SELECT status FROM tally_run_datasets WHERE company_id=${f.company} AND dataset='logisticsDocumentsXml'`;assert.equal(receipt[0].status,'imported');
 const invalid=await replayVisibilityPayload(db.sql,{id:crypto.randomUUID(),company_id:f.company,session_id:f.session,dataset:'logisticsDocumentsXml',content:xml.replace('<GUID>VERIFY-logistics_guid</GUID>','')});
 assert.equal(invalid.quarantined,1);
 assert.equal((await db.sql`SELECT count(*) AS n FROM tally_visibility_current_cache WHERE company_id=${f.company} AND entity='vouchers'`)[0].n,1);
}));
