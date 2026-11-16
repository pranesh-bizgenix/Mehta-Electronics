import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {transaction} from '../src/crm-modules.js';
import {searchLinkedTally} from '../src/tally-global-search.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';

test('linked Tally search scopes stable identities, excludes unlinked/financial values and applies category permissions',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),a=await tallyFixture(db,'VERIFY- Search A'),b=await tallyFixture(db,'VERIFY- Search B');
 const source=async(company,entity,key,guid,name)=>{
  const id=`${company.company}:${key}`,fields={'/stored/tally_guid':guid,'/stored/name':name,'/stored/description':'VERIFY- source item','/stored/base_unit':'Nos','/stored/closing_value':'VERIFY-SECRET_FINANCIAL_999','/xml/GUID':guid};
  await db.sql`INSERT INTO tally_visibility_records(id,company_id,entity,record_key,session_id,name,raw_record,fields,content_hash,observed_at) VALUES(${id},${company.company},${entity},${key},${company.session},${name},'{}',${db.sql.json(fields)},'VERIFY-hash',now())`;
  await db.sql`INSERT INTO tally_visibility_current_cache(company_id,entity,record_key,record_id,name,session_id,observed_at,summary_fields,public_summary,financial_search,public_search,has_raw) VALUES(${company.company},${entity},${key},${id},${name},${company.session},now(),${db.sql.json(fields)},'{}','VERIFY-SECRET_FINANCIAL_999','VERIFY-',true) ON CONFLICT(company_id,entity,record_key) DO UPDATE SET summary_fields=EXCLUDED.summary_fields,financial_search=EXCLUDED.financial_search,public_search=EXCLUDED.public_search`;
 };
 for(const company of [a,b]){
  await source(company,'ledgers','VERIFY-customer','VERIFY-customer_guid',company===a?'VERIFY- A customer':'VERIFY- B customer');
  await source(company,'items','VERIFY-item','VERIFY-item_guid',company===a?'VERIFY- A item':'VERIFY- B item');
  await db.sql`INSERT INTO tally_visibility_crm_links(company_id,entity,record_key,crm_kind,crm_id,created_by) VALUES(${company.company},'ledgers','VERIFY-customer','customer',${f.customer.id},${f.owner.id})`;
  await transaction(db,f.owner,'VERIFY- link search fixture',async()=>db.sql`INSERT INTO crm_tally_item_links(company_id,item_id,tally_name,tally_record_key,tally_guid,created_by) VALUES(${company.company},${f.item.id},'VERIFY- item','VERIFY-item','VERIFY-item_guid',${f.owner.id})`);
 }
 await source(a,'ledgers','VERIFY-unlinked','VERIFY-unlinked_guid','VERIFY- Unlinked ledger');
 await source(a,'items','VERIFY-missing_id',null,'VERIFY- No source identity');
 const url=(company=a.company,search='VERIFY-')=>new URL(`http://localhost/api/crm/search/tally?companyId=${company}&search=${encodeURIComponent(search)}`);
 try{
  const all=await searchLinkedTally(db,url(),f.executive);assert.equal(all.data.length,2);assert.ok(all.data.every(row=>row.companyId===a.company&&row.source==='Tally'));assert.ok(!JSON.stringify(all).includes('VERIFY-SECRET'));assert.ok(!JSON.stringify(all).includes('VERIFY- B'));assert.ok(!JSON.stringify(all).includes('Unlinked'));
  const other=await searchLinkedTally(db,url(b.company),f.owner);assert.equal(other.data.length,2);assert.ok(other.data.every(row=>row.label.includes('VERIFY- B')));
  for(const row of all.data){const href=new URL(row.href,'http://localhost');assert.equal(href.searchParams.get('companyId'),a.company);assert.equal(href.searchParams.get('recordKey'),row.recordKey);assert.equal(row.crmId,row.kind==='customer'?f.customer.id:f.item.id);}
  assert.deepEqual((await searchLinkedTally(db,url(a.company,'SECRET_FINANCIAL_999'),f.owner)).data,[]);
  assert.deepEqual((await searchLinkedTally(db,url(a.company,'%'),f.owner)).data,[]);
  await assert.rejects(searchLinkedTally(db,new URL('http://localhost/?search=VERIFY-'),f.owner),{status:422});
  await assert.rejects(searchLinkedTally(db,new URL(`http://localhost/?companyId=${a.company}&companyId=${b.company}&search=VERIFY-`),f.owner),{status:422});
  await assert.rejects(searchLinkedTally(db,url(),{role:'STORE_STAFF'}),{status:403});
  installPermissionProvider({permissionsFor:()=>['customers.read'],requiresMfa:()=>false});assert.deepEqual((await searchLinkedTally(db,url(),f.executive)).data.map(row=>row.kind),['customer']);
  installPermissionProvider({permissionsFor:()=>['items.read'],requiresMfa:()=>false});assert.deepEqual((await searchLinkedTally(db,url(),f.executive)).data.map(row=>row.kind),['item']);
  installPermissionProvider(null);
  const app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false})}),token=crypto.randomUUID();
  await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${f.executive.id},${tokenDigest(token)},'VERIFY-csrf',now()+interval '1 hour')`;
  const call=async(auth)=>{const req=Readable.from([]);Object.assign(req,{method:'GET',url:url().pathname+url().search,headers:{host:'localhost',...(auth?{cookie:`crm_session=${token}`}:{})},socket:{remoteAddress:'test'}});const res={headersSent:false,setHeader(){},writeHead(status){this.status=status;this.headersSent=true;},end(body){this.body=JSON.parse(String(body));}};await app(req,res);return res;};
  try{assert.equal((await call(false)).status,401);const allowed=await call(true);assert.equal(allowed.status,200);assert.equal(allowed.body.data.length,2);assert.ok(!JSON.stringify(allowed.body).includes('SECRET'));}finally{await app.close();}
 }finally{await f.close();installPermissionProvider(null);}
}));
