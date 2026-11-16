import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {testFetch} from '../test-support/http-client.js';
import {createApp} from '../src/app.js';
import {createConnectorStore} from '../src/connector-store.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';
import {readSchema} from '../scripts/lib/schema-audit.mjs';

const root=new URL('./fixtures/tally-write/',import.meta.url);
function shape(v){if(v===null)return 'null';if(Array.isArray(v))return v.length?[shape(v[0])]:[];if(typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,shape(v[k])]));return typeof v;}
function snapshot(name,value){
  const file=new URL(name,root);
  if(process.env.CAPTURE_TALLY_WRITE_BASELINE==='1'){
    assert.equal(fs.existsSync(file),false,'A baseline must never be overwritten.');
    fs.mkdirSync(root,{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
  }
  assert.deepEqual(value,JSON.parse(fs.readFileSync(file,'utf8')));
}
test('G4 read sync XML, schedule, queues, token handling and DPAPI sources are byte-identical to their pre-write baseline',()=>{
  const baseline=JSON.parse(fs.readFileSync(new URL('read-files-before.json',root),'utf8'));
  for(const [file,digest]of Object.entries(baseline))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex'),digest,file);
});
test('G1/G6 existing schema definitions remain byte-identical after additive write migrations',()=>withTestTransaction(async db=>{
  const s=await readSchema(db.sql);
  // New independent modules may add tables. The original table definitions must
  // still match the immutable pre-write snapshot, including missing objects.
  const before=JSON.parse(fs.readFileSync(new URL('schema-before.json',root),'utf8'));
  const originalTables=new Set(before.columns.map(row=>row.table));
  // Later numbered migrations add columns/indexes to existing CRM tables.
  // Preserve every original object byte-for-byte; the schema audit separately
  // validates the additive objects. Never regenerate the historical snapshot.
  const identity=row=>`${row.table}:${row.name??row.column}`;
  const protectedSchema=Object.fromEntries(['columns','constraints','indexes','triggers'].map(key=>{
    const originals=new Set(before[key].map(identity));
    return [key,s[key].filter(row=>originalTables.has(row.table)&&originals.has(identity(row)))];
  }));
  snapshot('schema-before.json',protectedSchema);
}));
test('G6 existing connector and selected-company read response contracts remain unchanged',()=>withTestTransaction(async db=>{
  const f=await tallyFixture(db,'VERIFY-Write Contract'),config=getConfig({mfaEnabled:false});
  const [owner]=await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('VERIFY-contract_owner','VERIFY-write_contract@example.test','OWNER','not-a-login',0) RETURNING id`;
  const token=crypto.randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${owner.id},${tokenDigest(token)},'VERIFY-csrf',now()+interval '1 hour')`;
  const store=createConnectorStore(config,{database:db.sql}),app=createApp({db,config,connectorStore:store}),fetch=testFetch(app),contracts={};
  const staff={cookie:`crm_session=${token}`,'x-csrf-token':'VERIFY-csrf'};
  async function request(key,path,body,headers={}){
    const r=await fetch(`http://localhost${path}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
    const json=await r.json();assert.equal(r.status,200,`${key}: ${JSON.stringify(json)}`);contracts[key]=shape(json);return json;
  }
  try{
    const setup=await store.createPairingCode({profileName:'VERIFY-Write Contract PC',companyName:'VERIFY-Write Contract',apiBaseUrl:'http://localhost:3000'});
    const pair=await request('pair','/api/connectors/pair',{pairingCode:setup.pairingCode,installationId:crypto.randomUUID(),machineName:'VERIFY-pc',agentVersion:'1.3.0'});
    const refresh=await request('refresh','/api/connectors/refresh',{refreshToken:pair.refreshToken});
    const bearer={authorization:`Bearer ${refresh.accessToken}`};
    await request('heartbeat','/api/connectors/heartbeat',{machineName:'VERIFY-pc',connectorVersion:'1.3.0',tallyAvailable:true,selectedCompany:'VERIFY-Write Contract'},bearer);
    await request('company-config','/api/connectors/company-config',null,bearer);
    await request('sync-job-start','/api/connectors/sync-job',{action:'start',companyName:'VERIFY-Write Contract',syncFrom:'2026-01-01',syncTo:'2026-12-31'},bearer);
    const upload=await request('chunks-start','/api/ingest/tally/chunks',{action:'start',companyName:'VERIFY-Write Contract',syncFrom:'2026-01-01',syncTo:'2026-12-31'},bearer);
    await request('chunks-append','/api/ingest/tally/chunks',{action:'append',sessionId:upload.sessionId,field:'ledgersXml',sequence:0,content:'<ENVELOPE/>'},bearer);
    for(const kind of ['ledgers','items','groups','vouchers'])await request(`visibility-${kind}`,`/api/v1/tally/visibility/${kind}?companyId=${f.company}`,null,staff);
    await request('tally-orders',`/api/crm/tally-orders?companyId=${f.company}`,null,staff);
    snapshot('responses-before.json',contracts);
  }finally{await app.close();installPermissionProvider(null);}
}));
