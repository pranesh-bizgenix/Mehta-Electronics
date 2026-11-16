import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {fixtureRuleService} from '../test-support/business-rule-fixture.js';
import {StockCheckRepository} from '../src/modules/stock/repository.js';
import {StockCheckService} from '../src/modules/stock/service.js';
import {TransactionRunner,AuditRepository,FixedClock} from '../src/core/runtime.js';
import {hasPermission,installPermissionProvider} from '../src/rbac.js';
import {forbidden} from '../src/core/errors.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {testFetch} from '../test-support/http-client.js';
const reason='ZZTEST reviewed stock source evidence';
const policy={maximumSourceAgeMinutes:10,reservedQuantityPointer:'/RESERVEDQTY',reservationsPointer:'/ORDERALLOCATIONS.LIST',reservationShape:'ARRAY',reservationQuantityPointer:'/ACTUALQTY',reservationKeyPointer:'/ORDERGUID',instructions:'ZZTEST explicit quantities and reservation identity'};
async function fixture(db){
 const f=await quotationFixture(db),a=await tallyFixture(db,'ZZTEST stock A'),b=await tallyFixture(db,'ZZTEST stock B'),clock=new FixedClock(new Date());
 await new TransactionRunner(db).run(f.owner,reason,async()=>{
  for(const [source,id,quantity] of [[a,'ZZTEST_stock_a','9007199254740993.123456'],[b,'ZZTEST_stock_b','7']]){
   await source.insert('tally_stock_items',{id,name:'ZZTEST linked stock',base_unit:'NOS',closing_quantity_text:`${quantity} NOS`,raw_record:{GUID:'ZZTEST_stock_guid',RESERVEDQTY:'3.123456 NOS','ORDERALLOCATIONS.LIST':[{ORDERGUID:'ZZTEST_reserved_order',ACTUALQTY:'3.123456 NOS',AMOUNT:'ZZTEST_financial_secret'}]}});
   await db.sql`UPDATE tally_upload_sessions SET collection_metadata=${db.sql.json({stockXml:{sourceTimestamp:clock.now().toISOString()}})} WHERE id=${source.session}`;
   await db.sql`INSERT INTO tally_run_datasets(company_id,session_id,dataset,status,processed_at) VALUES(${source.company},${source.session},'stockXml','imported',now())`;
   await db.sql`INSERT INTO crm_tally_item_links(company_id,item_id,tally_name,tally_record_key,tally_guid,created_by) VALUES(${source.company},${f.item.id},'ZZTEST linked stock',${id},'ZZTEST_stock_guid',${f.owner.id})`;
  }
 });
 const service=new StockCheckService({db,repository:new StockCheckRepository(db),transactions:new TransactionRunner(db),audit:new AuditRepository(db),clock,access:{require(actor,key){if(!hasPermission(actor,key))throw forbidden();}}});
 const input={itemId:f.item.id,requestedQuantity:'10',basis:'FREE_STOCK'},company={id:a.company,name:'ZZTEST stock A'};
 return {...f,a,b,clock,service,input,company};
}
test('stock checks isolate companies, preserve exact evidence, audit once on retry and append immutable history',()=>withTestTransaction(async db=>{
 const f=await fixture(db),{service,input,company}=f;
 await fixtureRuleService(db).clear(f.owner,'stock.availability',reason);
 assert.equal((await service.preview(f.owner,company,input)).status,'UNVERIFIED');
 await fixtureRuleService(db).set(f.owner,'stock.availability',policy,reason);
 const preview=await service.preview(f.owner,company,input);assert.equal(preview.status,'VERIFIED');assert.equal(preview.freeQuantity,'9007199254740990.000000');assert.equal(preview.available,true);assert.equal(JSON.stringify(preview).includes('financial_secret'),false);
 const other=await service.preview(f.owner,{id:f.b.company},input);assert.equal(other.freeQuantity,'3.876544');assert.equal(other.available,false);
 const command={...input,reason,requestId:randomUUID(),previewFingerprint:preview.previewFingerprint},saved=await service.record(f.owner,company,command);
 assert.equal(saved.status,'VERIFIED');assert.equal((await service.record(f.owner,company,command)).replayed,true);
 await assert.rejects(()=>service.record(f.owner,{id:f.b.company},command),{status:409});
 assert.equal((await db.sql`SELECT * FROM audit_logs WHERE entity='STOCK_CHECK' AND record_id=${saved.id}`).length,1);
 const history=await service.history(f.owner,company,1);assert.equal(history.length,1);assert.equal(history[0].free_quantity,preview.freeQuantity);assert.equal(JSON.stringify(history).includes('financial_secret'),false);
 assert.equal((await service.history(f.owner,{id:f.b.company},1)).length,0);assert.equal((await service.history(f.executive,company,1)).length,0);
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 assert.equal((await service.daily(f.owner,company,day))[0].check_count,'1');
 const failedId=randomUUID(),originalAudit=service.audit;service.audit={record:async()=>{throw new Error('ZZTEST audit unavailable');}};
 await assert.rejects(()=>service.record(f.owner,company,{...command,requestId:failedId}),/ZZTEST audit unavailable/);service.audit=originalAudit;
 assert.equal((await db.sql`SELECT id FROM stock_check_log WHERE id=${failedId}`).length,0);
 await assert.rejects(db.sql`UPDATE stock_check_log SET reason='ZZTEST overwrite' WHERE id=${saved.id}`,/append.only/i);
 f.clock.advance(11*60000);await assert.rejects(()=>service.record(f.owner,company,{...command,requestId:randomUUID()}),{status:409});
 assert.equal((await service.preview(f.owner,company,input)).status,'STALE');
}));
test('stock HTTP requires a session, selected company, permission and CSRF; restricted staff cannot access stock analysis',()=>withTestTransaction(async db=>{
 const f=await fixture(db),app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false})}),fetch=testFetch(app);
 async function headers(actor){const token=randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${actor.id},${tokenDigest(token)},'ZZTEST_stock_csrf',now()+interval '1 hour')`;return {cookie:`crm_session=${token}`,'x-csrf-token':'ZZTEST_stock_csrf','content-type':'application/json'};}
 try{
  const owner=await headers(f.owner),executive=await headers(f.executive),url=`http://localhost/api/crm/stock-checks?companyId=${f.a.company}`;
  assert.equal((await fetch(url)).status,401);assert.equal((await fetch('http://localhost/api/crm/stock-checks',{headers:owner})).status,422);
  const body=JSON.stringify(f.input),previewUrl=`http://localhost/api/crm/stock-checks/preview?companyId=${f.a.company}`;
  assert.equal((await fetch(previewUrl,{method:'POST',headers:{cookie:owner.cookie,'content-type':'application/json'},body})).status,403);
  assert.equal((await fetch(previewUrl,{method:'POST',headers:owner,body})).status,200);
  assert.equal((await fetch(`http://localhost/api/crm/stock-checks/daily?companyId=${f.a.company}&day=2026-11-06`,{headers:executive})).status,403);
  for(const role of ['STORE_STAFF','LOGISTICS_LEAD']){const [user]=await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(${`ZZTEST stock ${role}`},${`ZZTEST_stock_${role}@example.test`},${role},'not-a-login',0) RETURNING id`;const h=await headers(user);assert.equal((await fetch(url,{headers:h})).status,403);}
 }finally{await app.close();installPermissionProvider(null);}
}));
