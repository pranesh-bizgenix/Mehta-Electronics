import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {fixtureRuleService} from '../test-support/business-rule-fixture.js';
import {TransactionRunner,AuditRepository} from '../src/core/runtime.js';
import {hasPermission,installPermissionProvider} from '../src/rbac.js';
import {forbidden} from '../src/core/errors.js';
import {PriceImportRepository} from '../src/modules/pricing/repository.js';
import {PriceImportService} from '../src/modules/pricing/service.js';
import {ManualPriceService} from '../src/modules/pricing/manual.js';
import {PriceDispositionRepository,PriceDispositionService} from '../src/modules/pricing/disposition.js';
import {PriceLevelRepository,PriceLevelService} from '../src/modules/pricing/levels.js';
import {bindQuotationLevel} from '../src/modules/pricing/quotation-source.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {testFetch} from '../test-support/http-client.js';
const reason='ZZTEST reviewed retirement impact',access={require(actor,key){if(!actor?.id||!hasPermission(actor,key))throw forbidden();}};
async function fixture(db){
 const f=await quotationFixture(db),common={db,transactions:new TransactionRunner(db),audit:new AuditRepository(db),access},imports=new PriceImportService({...common,repository:new PriceImportRepository(db)}),manual=new ManualPriceService(imports),service=new PriceDispositionService({...common,repository:new PriceDispositionRepository(db)}),levels=new PriceLevelService({...common,repository:new PriceLevelRepository(db)}),rules=fixtureRuleService(db);
 await rules.set(f.owner,'price_lists.approval_policy',{reviewerPermission:'items.update',instructions:'ZZTEST inspect exact source prices'},reason);
 async function add(name,price){const input={metadata:{name,currency:'INR',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',discountPercent:'0'},entries:[{itemId:f.item.id,minQuantity:'1',unitPrice:price,discountPercent:'0'}],reason};input.previewFingerprint=(await manual.preview(f.owner,input)).previewFingerprint;const review=await manual.save(f.owner,input);for(const [actor,action]of [[f.owner,'SUBMIT'],[f.manager,'APPROVE'],[f.manager,'ACTIVATE']])await imports.decide(actor,review.id,{action,reason});return {reviewId:review.id,id:(await db.sql`SELECT target_list_id FROM crm_price_import_workflows WHERE id=${review.id}`)[0].target_list_id};}
 const old=await add('ZZTEST old source','90071992547409.123456'),replacement=await add('ZZTEST new source','90071992547409.123457');
 return {...f,service,levels,rules,old,replacement};
}
const policy={reviewerPermission:'items.update',instructions:'ZZTEST independently review retirement and blocked level impact'};
test('retirement requires an explicit policy and independent preview-bound approval, retaining source history and blocking linked quote prices',()=>withTestTransaction(async db=>{
 const f=await fixture(db),command={action:'SUPERSEDE',listId:f.old.id,replacementId:f.replacement.id};
 await f.rules.clear(f.owner,'price_lists.retirement_policy',reason);await assert.rejects(()=>f.service.preview(f.owner,command),/Not set/);
 await f.rules.set(f.owner,'price_lists.retirement_policy',policy,reason);
 const current=(await f.levels.list(f.owner)).levels[0];await f.levels.save(f.owner,1,{label:'ZZTEST linked level',instructions:'ZZTEST explicit retained source',priceListId:f.old.id,calculation:'LIST_ONLY',expectedRevision:current.revision,reason});
 const price=await f.levels.resolve(1,f.item.id,'1','2026-11-06'),selection={level:1,fingerprint:price.fingerprint};
 const originals=await db.sql`SELECT id,unit_price::text,discount_percent::text,min_quantity::text FROM crm_price_list_items WHERE price_list_id=${f.old.id} ORDER BY id`;
 const preview=await f.service.preview(f.owner,command);assert.equal(preview.affectedLevels.length,1);assert.equal(preview.uncoveredTierCount,0);
 const body={...command,reason,previewFingerprint:preview.previewFingerprint,requestId:randomUUID()},saved=await f.service.request(f.owner,body);assert.equal(saved.status,'PENDING');assert.equal((await f.service.request(f.owner,body)).replayed,true);
 assert.equal((await db.sql`SELECT status FROM crm_price_lists WHERE id=${f.old.id}`)[0].status,'ACTIVE');
 await assert.rejects(()=>f.service.decide(f.owner,saved.id,{decision:'APPROVED',reason}),{status:403});
 const decision=await f.service.decide(f.manager,saved.id,{decision:'APPROVED',reason});assert.equal(decision.status,'APPROVED');
 assert.equal((await f.service.request(f.owner,body)).status,'APPROVED');
 assert.equal((await db.sql`SELECT status FROM crm_price_lists WHERE id=${f.old.id}`)[0].status,'ARCHIVED');assert.equal((await db.sql`SELECT status FROM crm_price_lists WHERE id=${f.replacement.id}`)[0].status,'ACTIVE');
 assert.equal((await db.sql`SELECT status FROM crm_price_import_workflows WHERE id=${f.old.reviewId}`)[0].status,'ARCHIVED');
 assert.deepEqual(await db.sql`SELECT id,unit_price::text,discount_percent::text,min_quantity::text FROM crm_price_list_items WHERE price_list_id=${f.old.id} ORDER BY id`,originals);
 assert.equal((await f.levels.list(f.owner)).levels[0].configuration.priceListId,f.old.id);
 await assert.rejects(()=>bindQuotationLevel(db,{itemId:f.item.id,quantity:'1',unitPrice:price.unitPrice,discountPercent:'0'},selection),/inactive/);
 const detail=await f.service.detail(f.owner,saved.id);assert.equal(detail.decisions.length,1);assert.equal(detail.payload_snapshot.preview.replacement.id,f.replacement.id);
 assert.equal((await f.service.list(f.owner))[0].id,saved.id);await assert.rejects(()=>f.service.decide(f.manager,saved.id,{decision:'APPROVED',reason}),{status:409});
 await assert.rejects(()=>f.service.request(f.owner,{...body,action:'RETIRE',replacementId:undefined}),{status:409});
 assert.equal((await db.sql`SELECT id FROM audit_logs WHERE entity='PRICE_LIST_DISPOSITION' AND record_id=${saved.id}`).length,2);
}));
test('changed policy or source impact blocks approval; rejection retains active prices and audit failure rolls back retirement',()=>withTestTransaction(async db=>{
 const f=await fixture(db);await f.rules.set(f.owner,'price_lists.retirement_policy',policy,reason);
 const command={action:'RETIRE',listId:f.old.id},preview=await f.service.preview(f.owner,command),body={...command,reason,requestId:randomUUID(),previewFingerprint:preview.previewFingerprint};
 await assert.rejects(()=>f.service.preview(f.owner,{...command,replacementId:f.replacement.id}),{status:422});await assert.rejects(()=>f.service.preview(f.owner,{action:'SUPERSEDE',listId:f.old.id,replacementId:f.old.id}),{status:422});
 const saved=await f.service.request(f.owner,body);await f.rules.set(f.owner,'price_lists.retirement_policy',{...policy,instructions:'ZZTEST changed review instructions'},reason);
 await assert.rejects(()=>f.service.decide(f.manager,saved.id,{decision:'APPROVED',reason}),/changed/);
 await f.service.decide(f.manager,saved.id,{decision:'REJECTED',reason});assert.equal((await db.sql`SELECT status FROM crm_price_lists WHERE id=${f.old.id}`)[0].status,'ACTIVE');
 const fresh=await f.service.preview(f.owner,command),changed=await f.service.request(f.owner,{...body,requestId:randomUUID(),previewFingerprint:fresh.previewFingerprint});
 const level=(await f.levels.list(f.owner)).levels[0];await f.levels.save(f.owner,1,{label:'ZZTEST new affected level',instructions:'ZZTEST changed retirement impact',priceListId:f.old.id,calculation:'LIST_ONLY',expectedRevision:level.revision,reason});
 await assert.rejects(()=>f.service.decide(f.manager,changed.id,{decision:'APPROVED',reason}),/changed/);await f.service.decide(f.manager,changed.id,{decision:'REJECTED',reason});
 const latest=await f.service.preview(f.owner,command),next=await f.service.request(f.owner,{...body,requestId:randomUUID(),previewFingerprint:latest.previewFingerprint});
 f.service.audit={record:async()=>{throw new Error('ZZTEST audit unavailable');}};
 await assert.rejects(()=>f.service.decide(f.manager,next.id,{decision:'APPROVED',reason}),/ZZTEST audit unavailable/);
 assert.equal((await db.sql`SELECT status FROM crm_price_lists WHERE id=${f.old.id}`)[0].status,'ACTIVE');assert.equal((await db.sql`SELECT status FROM approval_requests WHERE id=${next.id}`)[0].status,'PENDING');assert.equal((await db.sql`SELECT id FROM approval_decisions WHERE approval_request_id=${next.id}`).length,0);
 await new TransactionRunner(db).run(f.owner,reason,()=>db.prepare("UPDATE items SET uom='BOX' WHERE id=?").run(f.item.id));
 await assert.rejects(()=>f.service.preview(f.owner,{action:'SUPERSEDE',listId:f.old.id,replacementId:f.replacement.id}),/Replacement products or units changed/);
}));
test('price retirement HTTP keeps session, CSRF, permission and financial boundaries',()=>withTestTransaction(async db=>{
 const f=await fixture(db),app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false})}),fetch=testFetch(app);
 async function headers(actor){const token=randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${actor.id},${tokenDigest(token)},'ZZTEST_retire_csrf',now()+interval '1 hour')`;return {cookie:`crm_session=${token}`,'x-csrf-token':'ZZTEST_retire_csrf','content-type':'application/json'};}
 try{const owner=await headers(f.owner),accounts=await headers(f.accounts),url='http://localhost/api/crm/price-dispositions';assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:accounts})).status,403);const body=JSON.stringify({action:'RETIRE',listId:f.old.id});assert.equal((await fetch(url+'/preview',{method:'POST',headers:{cookie:owner.cookie,'content-type':'application/json'},body})).status,403);await f.rules.set(f.owner,'price_lists.retirement_policy',policy,reason);assert.equal((await fetch(url+'/preview',{method:'POST',headers:owner,body})).status,200);
 }finally{await app.close();installPermissionProvider(null);}
}));
