import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {fixtureRuleService} from '../test-support/business-rule-fixture.js';
import {hasPermission} from '../src/rbac.js';
import {forbidden} from '../src/core/errors.js';
import {TransactionRunner,AuditRepository} from '../src/core/runtime.js';
import {PriceLevelRepository,PriceLevelService} from '../src/modules/pricing/levels.js';
import {PriceImportRepository} from '../src/modules/pricing/repository.js';
import {PriceImportService} from '../src/modules/pricing/service.js';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {testFetch} from '../test-support/http-client.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';
const reason='VERIFY- explicit price level confirmation';
const access={require(actor,key){if(!actor?.id||!hasPermission(actor,key))throw forbidden();}};
function levelService(db){return new PriceLevelService({db,repository:new PriceLevelRepository(db),transactions:new TransactionRunner(db),audit:new AuditRepository(db),access});}
async function importedList(db,f){
 const service=new PriceImportService({db,repository:new PriceImportRepository(db),transactions:new TransactionRunner(db),audit:new AuditRepository(db),access});
 const body={format:'CSV',filename:'VERIFY-level.csv',contentBase64:Buffer.from('Part,Unit,Price,MOQ,Discount\nVERIFY-QUOTE-PART,NOS,100.123456,1,10').toString('base64'),mapping:{dataStartRow:2,columns:{partCode:0,uom:1,unitPrice:2,minQuantity:3,discountPercent:4}},metadata:{name:'VERIFY- level list',currency:'INR',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',discountPercent:'5'},reason};
 body.previewFingerprint=(await service.preview(f.owner,body)).previewFingerprint;const review=await service.save(f.owner,body);
 await fixtureRuleService(db).set(f.owner,'price_lists.approval_policy',{reviewerPermission:'items.update',instructions:'VERIFY- inspect exact prices'},reason);
 for(const [actor,action]of [[f.owner,'SUBMIT'],[f.manager,'APPROVE'],[f.manager,'ACTIVATE']])await service.decide(actor,review.id,{action,reason});
 return (await db.sql`SELECT target_list_id FROM crm_price_import_workflows WHERE id=${review.id}`)[0].target_list_id;
}
test('level calculations require explicit Owner meanings and approved source; no missing level is inferred',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),s=levelService(db);
 // Clear only in this rollback transaction if an operator has since configured level 1.
 const initial=(await s.list(f.owner)).levels[0];if(initial.status!=='NOT_SET')await s.save(f.owner,1,{clear:true,expectedRevision:initial.revision,reason});
 await assert.rejects(()=>s.resolve(1,f.item.id,'1','2026-11-06'),/Not set: crm_price_levels.1/);
 const list=await importedList(db,f),current=(await s.list(f.owner)).levels[0],body={label:'VERIFY- source mapping',instructions:'VERIFY- no inferred business tier',priceListId:list,calculation:'BOTH_DISCOUNTS',expectedRevision:current.revision,reason};
 await assert.rejects(()=>s.save(f.manager,1,body),{status:403});
 await assert.rejects(()=>s.save(f.owner,1,{...body,calculation:undefined}),{status:422});
 const saved=await s.save(f.owner,1,body),value=await s.resolve(1,f.item.id,'1','2026-11-06');assert.equal(value.unitPrice,'85.605555');assert.equal(value.currency,'INR');
 assert.equal((await s.resolve(1,f.item.id,'1.000000','2026-12-31')).fingerprint,value.fingerprint,'Equivalent quantities and a later valid date retain the same source identity.');
 await assert.rejects(()=>s.save(f.owner,1,body),/settings changed/);
 await assert.rejects(()=>s.resolve(1,f.item.id,'1','2027-01-01'),/expired/);await assert.rejects(()=>s.resolve(1,f.item.id,'1','2025-12-31'),/future-dated/);await assert.rejects(()=>s.resolve(1,f.item.id,'0.5','2026-11-06'),/No approved price tier/);
 let latest=saved;for(const [calculation,net]of [['LIST_ONLY','100.123456'],['LINE_DISCOUNT','90.111110'],['LIST_DISCOUNT','95.117283']]){latest=await s.save(f.owner,1,{...body,calculation,expectedRevision:latest.revision});assert.equal((await s.resolve(1,f.item.id,'1','2026-12-31')).unitPrice,net);}
 await s.save(f.owner,1,{clear:true,expectedRevision:latest.revision,reason});await assert.rejects(()=>s.resolve(1,f.item.id,'1','2026-11-06'),/Not set/);
 for(const role of ['EXECUTIVE','ACCOUNTS','LOGISTICS_LEAD','STORE_STAFF'])await assert.rejects(()=>s.list({...f.owner,role}),{status:403});
}));
test('price-level HTTP configuration is session/CSRF guarded, Owner-only and unavailable to financial-restricted roles',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false})}),fetch=testFetch(app);
 async function headers(actor){const token=randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${actor.id},${tokenDigest(token)},'VERIFY-level_csrf',now()+interval '1 hour')`;return {cookie:`crm_session=${token}`,'x-csrf-token':'VERIFY-level_csrf','content-type':'application/json'};}
 try{
  const owner=await headers(f.owner),manager=await headers(f.manager),accounts=await headers(f.accounts);
  assert.equal((await fetch('http://localhost/api/crm/price-levels')).status,401);
  assert.equal((await fetch('http://localhost/api/crm/price-levels',{headers:accounts})).status,403);
  const response=await fetch('http://localhost/api/crm/price-levels',{headers:owner});assert.equal(response.status,200);const current=(await response.json()).data.levels[0];
  const body=JSON.stringify({clear:true,expectedRevision:current.revision,reason});
  assert.equal((await fetch('http://localhost/api/crm/price-levels/1',{method:'PUT',headers:{cookie:owner.cookie,'content-type':'application/json'},body})).status,403);
  assert.equal((await fetch('http://localhost/api/crm/price-levels/1',{method:'PUT',headers:manager,body})).status,403);
  assert.equal((await fetch('http://localhost/api/crm/price-levels/1',{method:'PUT',headers:owner,body})).status,200);
 }finally{await app.close();installPermissionProvider(null);}
}));
test('approved level prices cannot silently move to a changed product or unit',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),service=levelService(db),listId=await importedList(db,f),current=(await service.list(f.owner)).levels[0];
 await service.save(f.owner,1,{label:'VERIFY- fixed source unit',instructions:'VERIFY- bind the approved product revision',priceListId:listId,calculation:'LIST_ONLY',expectedRevision:current.revision,reason});
 assert.equal((await service.resolve(1,f.item.id,'1','2026-11-06')).unitPrice,'100.123456');
 await new TransactionRunner(db).run(f.owner,reason,()=>db.prepare("UPDATE items SET uom='BOX' WHERE id=?").run(f.item.id));
 await assert.rejects(()=>service.resolve(1,f.item.id,'1','2026-11-06'),/product or unit changed/);
}));
