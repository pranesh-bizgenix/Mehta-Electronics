import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config.js';
import { assembleChunkFields } from '../src/connector-store.js';
import {openTestTransactionScope} from '../test-support/transaction.js';
import {testFetch} from '../test-support/http-client.js';
import {hashPassword} from '../src/security.js';
import {connectPostgres} from '../src/postgres.js';
import {confirmFixturePricing} from '../test-support/business-rule-fixture.js';
import {transaction} from '../src/crm-modules.js';
import crypto from 'node:crypto';
import { mfaHelper, TEST_ENCRYPTION_KEY } from '../test-support/mfa.js';

const mfa = mfaHelper();

let db, base, app, temporary, fetch, customerId, itemId, importedCompanyId, fixtureConnectorId;
const owner = { cookie: '', csrf: '' };
const executive = { cookie: '', csrf: '' };

const customersXml = `<ENVELOPE><BODY><DATA><COLLECTION><LEDGER><GUID>tc-1</GUID><NAME>Acme Industries</NAME><PARTYGSTIN>27ABCDE1234F1Z5</PARTYGSTIN><INCOMETAXNUMBER>ABCDE1234F</INCOMETAXNUMBER><LEDGERPHONE>9876543210</LEDGERPHONE><EMAIL>buy@acme.test</EMAIL></LEDGER></COLLECTION></DATA></BODY></ENVELOPE>`;
const itemsXml = `<ENVELOPE><BODY><DATA><COLLECTION><STOCKITEM><GUID>ti-1</GUID><NAME>3RT1016</NAME><DESCRIPTION>Contactor</DESCRIPTION><BRAND>Siemens</BRAND><HSNCODE>8536</HSNCODE><BASEUNITS>NOS</BASEUNITS></STOCKITEM></COLLECTION></DATA></BODY></ENVELOPE>`;
let tallyCall = 0;
const sentMail=[];

describe('Windows connector upload contract',()=>{
  const required=['vouchersXml','stockXml','balanceSheetXml','profitAndLossXml','billsReceivableXml','billsPayableXml','ledgersXml','groupsXml'];
  test('reassembles uploaded fields in sequence order',()=>{
    const rows=required.flatMap(field=>[{field_name:field,sequence:1,content:'second'},{field_name:field,sequence:0,content:'first'}]);
    const fields=assembleChunkFields(rows);
    assert.equal(fields.ledgersXml,'firstsecond');
  });
  test('rejects incomplete uploads and missing chunk sequences',()=>{
    assert.throws(()=>assembleChunkFields([]),/Snapshot is incomplete/);
    const rows=required.map(field=>({field_name:field,sequence:0,content:'ok'}));
    rows.push({field_name:'vouchersXml',sequence:2,content:'gap'});
    assert.throws(()=>assembleChunkFields(rows),/missing or duplicate chunks/);
  });
  test('exposes health, pairing, refresh, and bearer-auth connector routes',async()=>{
    const health=await request('/api/health');
    assert.equal(health.response.status,200);
    assert.equal(health.data.status,'ok');
    for(const path of ['/api/connectors/pair','/api/connectors/refresh']){
      const result=await request(path,{method:'POST',body:{}});
      assert.equal(result.response.status,401,path);
      assert.deepEqual(Object.keys(result.data),['error'],'connector error contract is unchanged');
    }
    const authenticated=await fetch(`${base}/api/connectors/heartbeat`,{method:'POST',headers:{authorization:'Bearer test'}});
    assert.equal(authenticated.status,401);
  });
});

async function request(path, { method='GET', body, auth, csrf=true } = {}) {
  if(path==='/api/users'&&method==='POST'){const {status,...fields}=body;body={...fields,ownerUserId:owner.id,reason:'ZZTEST provisioning regression'};}
  const headers = {};
  if (body !== undefined) headers['content-type']='application/json';
  if (auth?.cookie) headers.cookie=auth.cookie;
  if (auth?.csrf && csrf) headers['x-csrf-token']=auth.csrf;
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  return { response, data };
}

async function login(email,password,target) {
  const {response,data}=await request('/api/auth/login',{method:'POST',body:{email,password}});
  assert.equal(response.status,200);
  target.cookie=(await response.headers.get('set-cookie')).split(';')[0];target.csrf=data.csrfToken;
  target.id=data.user.id;
  await mfa.complete(request,target,email,data);
  if(data.user.mustChangePassword){const changed=await request('/api/auth/change-password',{method:'POST',auth:target,body:{currentPassword:password,newPassword:'Changed#'+password}});assert.equal(changed.response.status,200,JSON.stringify(changed.data));}
  return data;
}

before(async()=>{
  temporary=await openTestTransactionScope();db=temporary.db;
  const config=getConfig({localReviewAccess:false,seedOwnerEmail:'owner@test.local',seedOwnerPassword:'OwnerPass123!',tallyUrl:'http://tally.test',tallyMaxRetries:2,tallyTimeoutMs:1000,appEncryptionKey:TEST_ENCRYPTION_KEY});
  await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('ZZTEST_CRM Owner','owner@test.local','OWNER',${hashPassword('OwnerPass123!')},0)`;
  importedCompanyId=crypto.randomUUID();await db.sql`INSERT INTO tally_companies(id,name) VALUES(${importedCompanyId},'ZZTEST_CRM scope')`;
  const fetchImpl=async(_url,options)=>{assert.match(options.body,/<TALLYREQUEST>Export<\/TALLYREQUEST>/);assert.doesNotMatch(options.body,/Import|Voucher|Create/i);tallyCall+=1;return new Response(tallyCall%2===1?customersXml:itemsXml,{status:200});};
  const sendMailImpl=async(_config,payload)=>{sentMail.push(payload);return {messageId:'test-message'}};
  app=createApp({db,config,fetchImpl,sendMailImpl,clock:mfa.clock});fetch=testFetch(app);base='http://127.0.0.1:3000';
  await login('owner@test.local','OwnerPass123!',owner);
});
after(async()=>{
  try{if(app)await app.close();}finally{if(temporary)await temporary.close();}
  if(fixtureConnectorId){
    const sql=connectPostgres(getConfig().databaseUrl);
    try{
      assert.equal((await sql`SELECT count(*) AS n FROM tally_connectors WHERE id=${fixtureConnectorId}`)[0].n,0,'Connector handler writes must roll back with the supplied database.');
      assert.equal((await sql`SELECT count(*) AS n FROM tally_sync_jobs WHERE connector_id=${fixtureConnectorId}`)[0].n,0,'Connector staging jobs must not escape the fixture transaction.');
    }finally{await sql.end({timeout:5});}
  }
});

describe('authentication and session security',()=>{
  test('rejects incorrect credentials',async()=>{const {response}=await request('/api/auth/login',{method:'POST',body:{email:'owner@test.local',password:'wrong'}});assert.equal(response.status,401)});
  test('requires authentication',async()=>{const {response}=await request('/api/customers');assert.equal(response.status,401)});
  test('requires CSRF for mutations',async()=>{const {response}=await request('/api/items',{method:'POST',auth:owner,csrf:false,body:{}});assert.equal(response.status,403)});
});

describe('users and RBAC',()=>{
  test('matches login email without case sensitivity',async()=>{const result=await request('/api/auth/login',{method:'POST',body:{email:'OWNER@TEST.LOCAL',password:'OwnerPass123!'}});assert.equal(result.response.status,200)});
  test('owner creates an individual executive account',async()=>{const {response}=await request('/api/users',{method:'POST',auth:owner,body:{name:'Sales Executive',email:'exec@test.local',phone:'9999999999',role:'EXECUTIVE',status:'ACTIVE',password:'ExecPassword1!'}});assert.equal(response.status,201);await login('exec@test.local','ExecPassword1!',executive)});
  test('backend denies unauthorized user administration',async()=>{const {response}=await request('/api/users',{auth:executive});assert.equal(response.status,403)});
  test('backend denies executive item creation even with direct API call',async()=>{const {response}=await request('/api/items',{method:'POST',auth:executive,body:{partCode:'X',description:'X',uom:'NOS',packSize:1,alternateCodes:[],supersededCodes:[]}});assert.equal(response.status,403)});
});

describe('customer master and duplicate detection',()=>{
  test('creates and retrieves customer',async()=>{const body={customerCode:'C001',name:'Acme Industries',gstin:'27ABCDE1234F1Z5',pan:'ABCDE1234F',creditLimit:100000,creditDays:30,status:'ACTIVE',billingAddress:'Mumbai',contacts:[{name:'Buyer',phone:'9876543210',email:'buy@acme.test',isPrimary:true}]};const {response,data}=await request('/api/customers',{method:'POST',auth:executive,body});assert.equal(response.status,201);customerId=data.data.id;const read=await request(`/api/customers/${data.data.id}`,{auth:executive});assert.equal(read.response.status,200);assert.equal(read.data.data.contacts.length,1)});
  test('blocks potential duplicate without explicit reason',async()=>{const {response,data}=await request('/api/customers',{method:'POST',auth:executive,body:{name:'Acme Industries Duplicate',gstin:'27ABCDE1234F1Z5',pan:'ZZZZZ9999Z',creditLimit:0,creditDays:0,status:'ACTIVE',contacts:[]}});assert.equal(response.status,409);assert.ok(data.details.duplicates.length)});
  test('has no hard delete route',async()=>{const {response}=await request('/api/customers/1',{method:'DELETE',auth:owner});assert.equal(response.status,405)});
  test('rejects IDOR-shaped invalid identifier',async()=>{const {response}=await request('/api/customers/1%20OR%201=1',{auth:owner});assert.equal(response.status,400)});
});

describe('item master',()=>{
  test('creates, searches, and updates an item',async()=>{const created=await request('/api/items',{method:'POST',auth:owner,body:{partCode:'3RT1016',description:'Contactor',brand:'Siemens',hsn:'8536',uom:'NOS',packSize:1,alternateCodes:['3RT-1016'],supersededCodes:[],status:'ACTIVE'}});assert.equal(created.response.status,201);const id=Number(created.data.data.id);itemId=id;const list=await request('/api/items?search=3RT',{auth:owner});assert.equal(list.data.pagination.total,1);const updated=await request(`/api/items/${id}`,{method:'PATCH',auth:owner,body:{description:'Power contactor',reason:'Description correction'}});assert.equal(updated.response.status,200);assert.equal(updated.data.data.description,'Power contactor')});
  test('returns a conflict for case-insensitive duplicate part codes',async()=>{
    const result=await request('/api/items',{method:'POST',auth:owner,body:{partCode:'3rt1016',description:'Duplicate',uom:'NOS',packSize:1,alternateCodes:[],supersededCodes:[]}});
    assert.equal(result.response.status,409);
    assert.equal(result.data.error,'Part code already exists.');
  });
});

describe('phase 2 sales pipeline',()=>{
  // Legacy /api/quotations routes are adapters onto the managed quotation workflow (migration 0012):
  // creation needs owner policy and costs, and email/order conversion need an independent approval.
  let enquiryId,quotationId,orderId;
  const action=async(auth,name,reason)=>{const current=await request(`/api/crm/quotations/${quotationId}`,{auth:owner});return request(`/api/crm/quotations/${quotationId}/actions`,{method:'POST',auth,body:{action:name,version:current.data.data.version,reason}});};
  test('executive creates a multi-line-ready enquiry',async()=>{const created=await request('/api/enquiries',{method:'POST',auth:executive,body:{customerId,subject:'MCC panel requirement',source:'Direct',expectedBy:'2099-12-20',lines:[{itemId,description:'Power contactor',quantity:4,targetPrice:1250}]}});assert.equal(created.response.status,201);enquiryId=Number(created.data.data.id);assert.match(created.data.data.enquiry_number,/^ENQ-\d{4}-\d{5}$/);assert.equal(created.data.data.lines.length,1)});
  test('blocks quotations until the owner configures policy and item cost',async()=>{
    const quoteBody={customerId,enquiryId,validUntil:'2099-12-31',terms:'Net 30',lines:[{itemId,description:'Power contactor',uom:'NOS',quantity:4,unitPrice:1500,discountPercent:10,taxPercent:18}]};
    const blocked=await request('/api/quotations',{method:'POST',auth:executive,body:quoteBody});assert.equal(blocked.response.status,409);
    const policyBody={floorPercent:'10',marginBasis:'LINE_AND_TOTAL',sellerState:'27',letterhead:{name:'Mehta Electronics'},reason:'Initial policy'};
    const policyDenied=await request('/api/crm/quotation-policy',{method:'PUT',auth:executive,body:policyBody});assert.equal(policyDenied.response.status,403);
    const policy=await request('/api/crm/quotation-policy',{method:'PUT',auth:owner,body:policyBody});assert.equal(policy.response.status,200,JSON.stringify(policy.data));
    const cost=await request(`/api/crm/quotation-costs/${itemId}`,{method:'PUT',auth:owner,body:{unitCost:'1000',reason:'Owner-entered cost'}});assert.equal(cost.response.status,200,JSON.stringify(cost.data));
    await confirmFixturePricing(db,{id:owner.id,role:'OWNER'});
  });
  test('executive creates a quotation linked to the enquiry',async()=>{const created=await request('/api/quotations',{method:'POST',auth:executive,body:{customerId,enquiryId,validUntil:'2099-12-31',terms:'Net 30',lines:[{itemId,description:'Power contactor',uom:'NOS',quantity:4,unitPrice:1500,discountPercent:10,taxPercent:18}]}});assert.equal(created.response.status,201,JSON.stringify(created.data));quotationId=Number(created.data.data.id);assert.equal(created.data.data.workflowStatus,'DRAFT');assert.equal(Number(created.data.data.subtotal),5400);assert.equal(Number(created.data.data.total),6372)});
  test('revises editable documents with immutable numbered history',async()=>{const enquiry=await request(`/api/enquiries/${enquiryId}`,{method:'PUT',auth:executive,body:{customerId,subject:'MCC panel components - revised',source:'Direct',expectedBy:'2099-12-21',reason:'Customer added technical clarification',lines:[{itemId,description:'Power contactor',quantity:4,targetPrice:1250}]}});assert.equal(enquiry.response.status,200);assert.equal(enquiry.data.revision,2);const quote=await request(`/api/quotations/${quotationId}`,{method:'PUT',auth:executive,body:{customerId,enquiryId,validUntil:'2099-12-31',terms:'Net 30',reason:'Updated negotiated unit price',lines:[{itemId,description:'Power contactor',uom:'NOS',quantity:4,unitPrice:1600,discountPercent:10,taxPercent:18}]}});assert.equal(quote.response.status,200,JSON.stringify(quote.data));assert.equal(Number(quote.data.data.total),6796.8);const history=await request(`/api/crm/quotations/${quotationId}/history`,{auth:owner});assert.equal(history.response.status,200);assert.equal(history.data.data.versions.length,2);await assert.rejects(async()=>db.prepare('UPDATE crm_quotation_versions SET created_at=now() WHERE quotation_id=?').run(quotationId))});
  test('legacy enquiry revisions retain line makers and the actual archive reason',async()=>{
    const lines=await db.prepare('SELECT created_by,updated_by,is_deleted,deleted_by,delete_reason FROM enquiry_lines WHERE enquiry_id=? ORDER BY id').all(enquiryId);
    assert.equal(lines.length,2);
    for(const line of lines){assert.equal(line.created_by,executive.id);assert.equal(line.updated_by,executive.id);}
    assert.equal(lines[0].is_deleted,true);assert.equal(lines[0].deleted_by,executive.id);
    assert.equal(lines[0].delete_reason,'Customer added technical clarification');assert.equal(lines[1].is_deleted,false);
  });
  test('generates a valid quotation PDF',async()=>{const response=await fetch(`${base}/api/quotations/${quotationId}/pdf`,{headers:{cookie:owner.cookie}});assert.equal(response.status,200);assert.match((await response.headers.get('content-type')),/application\/pdf/);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,4).toString(),'%PDF');assert.ok(bytes.length>1500)});
  test('emails the PDF only after independent approval, under permission control',async()=>{
    const denied=await request(`/api/quotations/${quotationId}/send-email`,{method:'POST',auth:executive,body:{to:'buyer@example.com'}});assert.equal(denied.response.status,403);
    const unapproved=await request(`/api/quotations/${quotationId}/send-email`,{method:'POST',auth:owner,body:{to:'buyer@example.com'}});assert.equal(unapproved.response.status,409);assert.equal(sentMail.length,0);
    const submitted=await action(executive,'SUBMIT','Ready for review');assert.equal(submitted.response.status,200,JSON.stringify(submitted.data));
    assert.equal((await action(executive,'APPROVE','Self approval attempt')).response.status,403);
    const approved=await action(owner,'APPROVE','Independent review');assert.equal(approved.response.status,200,JSON.stringify(approved.data));
    const wrongRecipient=await request(`/api/quotations/${quotationId}/send-email`,{method:'POST',auth:owner,body:{to:'buyer@example.com'}});assert.equal(wrongRecipient.response.status,422);assert.equal(sentMail.length,0);
    const sent=await request(`/api/quotations/${quotationId}/send-email`,{method:'POST',auth:owner,body:{to:'buy@acme.test',subject:'Test quotation',message:'Attached'}});assert.equal(sent.response.status,200,JSON.stringify(sent.data));assert.equal(sentMail.length,1);assert.match(sentMail[0].pdf.subarray(0,4).toString(),/%PDF/);
    const enquiry=await request(`/api/enquiries/${enquiryId}`,{auth:owner});assert.equal(enquiry.data.data.status,'QUOTED');
    const accepted=await request(`/api/quotations/${quotationId}/status`,{method:'PATCH',auth:owner,body:{status:'ACCEPTED',reason:'Customer accepted'}});assert.equal(accepted.response.status,200,JSON.stringify(accepted.data));
  });
  test('converts an accepted quotation into one company-bound order snapshot',async()=>{const created=await request(`/api/quotations/${quotationId}/convert-to-order`,{method:'POST',auth:owner,body:{companyId:importedCompanyId,customerPoNumber:'PO-1001',customerPoDate:'2099-12-01',promisedDate:'2099-12-20'}});assert.equal(created.response.status,201,JSON.stringify(created.data));orderId=Number(created.data.data.id);assert.equal(created.data.data.companyId,importedCompanyId);assert.equal(Number(created.data.data.lines[0].ordered_quantity),4);assert.equal(Number(created.data.data.total),6796.8);const duplicate=await request(`/api/quotations/${quotationId}/convert-to-order`,{method:'POST',auth:owner,body:{companyId:importedCompanyId,customerPoNumber:'PO-1002',customerPoDate:'2099-12-01'}});assert.equal(duplicate.response.status,409)});
  test('protects the managed sales-order workflow from legacy status bypass',async()=>{const executiveBypass=await request(`/api/orders/${orderId}/status`,{method:'PATCH',auth:executive,body:{status:'PROCESSING'}});assert.equal(executiveBypass.response.status,409);const bypass=await request(`/api/orders/${orderId}/status`,{method:'PATCH',auth:owner,body:{status:'PROCESSING'}});assert.ok([409,422].includes(bypass.response.status),String(bypass.response.status))});
  test('surfaces pipeline and order metrics on the dashboard',async()=>{const dashboard=await request(`/api/dashboard?companyId=${importedCompanyId}`,{auth:owner});assert.equal(dashboard.data.stats.enquiries,1);assert.equal(dashboard.data.stats.orders,1);assert.equal(Number(dashboard.data.stats.orderValue),6796.8)});
  test('lists quotation and order totals with PostgreSQL grouping',async()=>{
    for(const path of ['/api/quotations?search=acme','/api/orders?search=acme']){
      const result=await request(path,{auth:owner});
      assert.equal(result.response.status,200);
      assert.equal(result.data.data.length,1);
      assert.equal(Number(result.data.data[0].total),6796.8);
    }
  });
});

describe('audit and Tally read integration',()=>{
  test('records change audits and exposes no mutation route',async()=>{const logs=await request('/api/audit-logs?entity=ITEM',{auth:owner});assert.ok(logs.data.data.some(x=>x.action==='UPDATE'));const mutate=await request('/api/audit-logs/1',{method:'PATCH',auth:owner,body:{action:'HIDDEN'}});assert.ok([404,405].includes(mutate.response.status));assert.equal((await db.prepare("SELECT action FROM audit_logs WHERE entity='ITEM' ORDER BY id DESC LIMIT 1").get()).action,'UPDATE')});
  test('syncs only through export requests and reconciles records',async()=>{const sync=await request('/api/tally/sync',{method:'POST',auth:owner,body:{}});assert.equal(sync.response.status,200);assert.equal(sync.data.customers,1);assert.equal(sync.data.items,1);const rec=await request('/api/reconciliation',{auth:owner});assert.equal(rec.response.status,200);assert.equal(rec.data.data.summary.customerMatches,1);assert.equal(rec.data.data.summary.itemMatches,1)});
});

describe('Windows connector PostgreSQL lifecycle',()=>{
  test('pairs, rotates credentials, stores a snapshot, and revokes access',async()=>{
    const created=await request('/api/tally-connector/pairing',{method:'POST',auth:owner,body:{profileName:'ZZTEST_CRM PC',companyName:'Mehta Electronics',apiBaseUrl:base}});
    assert.equal(created.response.status,201);
    const pairing=created.data.pairing;fixtureConnectorId=pairing.id;
    const pending=await request('/api/tally-connector/status',{auth:owner});
    assert.equal(pending.data.connectors.find(row=>row.id===pairing.id).connection_state,'awaiting_pairing');
    const paired=await request('/api/connectors/pair',{method:'POST',body:{pairingCode:pairing.pairingCode,installationId:crypto.randomUUID(),machineName:'ZZTEST_CRM-PC',agentVersion:'1.0.0'}});
    assert.equal(paired.response.status,200);
    const refreshed=await request('/api/connectors/refresh',{method:'POST',body:{refreshToken:paired.data.refreshToken}});
    assert.equal(refreshed.response.status,200);
    const replay=await request('/api/connectors/refresh',{method:'POST',body:{refreshToken:paired.data.refreshToken}});
    assert.equal(replay.response.status,401);
    const post=async(path,body)=>{
      const response=await fetch(`${base}${path}`,{method:'POST',headers:{authorization:`Bearer ${refreshed.data.accessToken}`,'content-type':'application/json','content-encoding':'gzip'},body:gzipSync(JSON.stringify(body))});
      return {status:response.status,data:await response.json()};
    };
    const heartbeat=await post('/api/connectors/heartbeat',{machineName:'TEST-PC',agentVersion:'1.0.0',tallyAvailable:true,selectedCompany:'Mehta Electronics',openCompanies:['Mehta Electronics']});
    assert.equal(heartbeat.status,200);
    const started=await post('/api/ingest/tally/chunks',{action:'start',companyName:'Mehta Electronics',syncFrom:'2026-04-01',syncTo:'2026-10-19'});
    assert.equal(started.status,200);
    const sessionId=started.data.sessionId;
    for(const field of ['vouchersXml','stockXml','balanceSheetXml','profitAndLossXml','billsReceivableXml','billsPayableXml','ledgersXml','groupsXml','salesRegisterXml','purchaseRegisterXml','dayBookReportXml','trialBalanceXml','cashBankControlXml','stockSummaryReportXml']){
      const content=field==='ledgersXml'?customersXml:field==='stockXml'?itemsXml:'<ENVELOPE></ENVELOPE>';
      const result=await post('/api/ingest/tally/chunks',{action:'append',sessionId,field,sequence:0,content});
      assert.equal(result.status,200);
    }
    const finalized=await post('/api/ingest/tally/chunks',{action:'finalize',sessionId});
    assert.equal(finalized.status,200,JSON.stringify(finalized.data));importedCompanyId=finalized.data.companyId;
    assert.equal(finalized.data.customers,1);
    assert.ok((await db.prepare('SELECT last_sync_at FROM tally_connectors WHERE id=?').get(pairing.id)).last_sync_at,'Finalized import must record its connector sync time.');
    const status=await request('/api/tally-connector/status',{auth:owner});
    assert.equal(status.response.status,200);
    assert.equal(status.data.connectors.find(row=>row.id===pairing.id).agent_version,'1.0.0');
    assert.equal(status.data.connectors.find(row=>row.id===pairing.id).connection_state,'connected');
    assert.equal(status.data.jobs.find(row=>row.connector_id===pairing.id).status,'stored');
    const storedFields=await db.prepare('SELECT field_name FROM tally_upload_chunks WHERE session_id=?').all(sessionId);
    assert.equal(storedFields.length,14);
    const ledgerList=await request(`/api/tally/masters/ledgers?companyId=${importedCompanyId}&pageSize=1`,{auth:executive});
    assert.equal(ledgerList.response.status,200);
    assert.equal(ledgerList.data.pagination.total,1);
    assert.equal(ledgerList.data.financial,false);
    assert.equal(Object.hasOwn(ledgerList.data.data[0],'closing_balance'),false);
    const deniedFields=await request(`/api/tally/masters/ledgers/${ledgerList.data.data[0].id}`,{auth:executive});
    assert.equal(deniedFields.response.status,403);
    const anonymous=await request('/api/tally/masters/items');
    assert.equal(anonymous.response.status,401);
    const deniedOverview=await request('/api/dashboard/tally',{auth:executive});
    assert.equal(deniedOverview.response.status,403);
    const deniedQuality=await request('/api/dashboard/quality',{auth:executive});
    assert.equal(deniedQuality.response.status,403);
    const workflowOnly=await request(`/api/dashboard?companyId=${importedCompanyId}`,{auth:executive});
    assert.equal(workflowOnly.response.status,200);
    assert.equal(workflowOnly.data.access.financial,false);
    assert.equal(Object.hasOwn(workflowOnly.data,'reconciliation'),false);
    assert.ok(workflowOnly.data.workflow);
    assert.equal(Object.hasOwn(workflowOnly.data,'stock'),false);
    assert.equal(Object.hasOwn(workflowOnly.data,'banks'),false);
    const ownerOverview=await request(`/api/dashboard/tally?companyId=${importedCompanyId}`,{auth:owner});
    assert.equal(ownerOverview.response.status,200);
    assert.equal(ownerOverview.data.counts.items,1);
    const compatibleOverview=await request(`/api/dashboard?companyId=${importedCompanyId}`,{auth:owner});
    assert.equal(compatibleOverview.response.status,200);
    assert.equal(typeof compatibleOverview.data.reconciliation.customerConflicts,'number');
    assert.equal(typeof compatibleOverview.data.reconciliation.itemConflicts,'number');
    const retriedFinalize=await post('/api/ingest/tally/chunks',{action:'finalize',sessionId});
    assert.equal(retriedFinalize.status,200);
    assert.equal(retriedFinalize.data.items,1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM crm_tally_sync_jobs WHERE started_by=?').get(owner.id)).n,1);
    const revoked=await request(`/api/tally-connector/${pairing.id}/revoke`,{method:'POST',auth:owner});
    assert.equal(revoked.response.status,200);
    assert.equal((await post('/api/connectors/heartbeat',{})).status,401);
  });
});

test('Accounts can read the financial overview without gaining connector administration',async()=>{
  const created=await request('/api/users',{method:'POST',auth:owner,body:{name:'Accounts viewer',email:'overview-accounts@test.local',role:'ACCOUNTS',password:'AccountsPass123!',status:'ACTIVE'}});
  assert.equal(created.response.status,201);
  const accounts={cookie:'',csrf:''};await login('overview-accounts@test.local','AccountsPass123!',accounts);
  assert.equal((await request(`/api/dashboard/tally?companyId=${importedCompanyId}`,{auth:accounts})).response.status,200);
  assert.equal((await request(`/api/dashboard?companyId=${importedCompanyId}`,{auth:accounts})).data.access.financial,true);
  assert.equal((await request('/api/tally-connector/pairing',{method:'POST',auth:accounts,body:{}})).response.status,403);
});

test('legacy quote edits keep exact financial strings, explicit tax and actual line archive provenance',async()=>{
  let quoteId;
  await transaction(db,owner,'ZZTEST exact legacy quote fixture',async()=>{
    quoteId=(await db.sql`INSERT INTO quotations(quotation_number,customer_id,valid_until,created_by,updated_by)
      VALUES('ZZTEST_EXACT_LEGACY',${customerId},'2099-12-31',${owner.id},${owner.id}) RETURNING id`)[0].id;
    await db.sql`INSERT INTO quotation_lines(quotation_id,item_id,description,uom,quantity,unit_price,discount_percent,tax_percent)
      VALUES(${quoteId},${itemId},'ZZTEST legacy line','NOS',1,1.005,0,0)`;
  });
  const body={customerId,validUntil:'2099-12-31',reason:'ZZTEST exact legacy price correction',lines:[{itemId,description:'ZZTEST revised line',uom:'NOS',quantity:'1',unitPrice:'99999999.123456',discountPercent:'0',taxPercent:'0'}]};
  const missingTax={...body,lines:[{...body.lines[0],taxPercent:undefined}]};
  assert.equal((await request(`/api/quotations/${quoteId}`,{method:'PUT',auth:executive,body:missingTax})).response.status,422);
  const revised=await request(`/api/quotations/${quoteId}`,{method:'PUT',auth:executive,body});
  assert.equal(revised.response.status,200,JSON.stringify(revised.data));
  assert.equal(revised.data.data.total,'99999999.12');assert.equal(revised.data.data.lines[0].unit_price,'99999999.123456');
  const [old]=await db.sql`SELECT created_by,deleted_by,delete_reason FROM quotation_lines WHERE quotation_id=${quoteId} AND is_deleted`;
  assert.equal(old.created_by,owner.id);assert.equal(old.deleted_by,executive.id);assert.equal(old.delete_reason,body.reason);
  const pdf=await fetch(`${base}/api/quotations/${quoteId}/pdf`,{headers:{cookie:owner.cookie}});
  assert.equal(pdf.status,200);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
});
