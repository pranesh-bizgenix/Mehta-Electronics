import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {fixtureRuleService} from '../test-support/business-rule-fixture.js';
import {TransactionRunner,AuditRepository} from '../src/core/runtime.js';
import {hasPermission,installPermissionProvider} from '../src/rbac.js';
import {forbidden} from '../src/core/errors.js';
import {PriceImportService} from '../src/modules/pricing/service.js';
import {PriceImportRepository} from '../src/modules/pricing/repository.js';
import {ManualPriceService} from '../src/modules/pricing/manual.js';
import {savePriceList,itemDetail,priceListDetail} from '../src/crm-modules.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {testFetch} from '../test-support/http-client.js';
const reason='VERIFY- manually reviewed literal prices';
function services(db){const imports=new PriceImportService({db,repository:new PriceImportRepository(db),transactions:new TransactionRunner(db),audit:new AuditRepository(db),access:{require(actor,p){if(!hasPermission(actor,p))throw forbidden();}}});return {imports,manual:new ManualPriceService(imports)};}
const body=itemId=>({metadata:{name:'VERIFY- manual version',currency:'INR',effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31',discountPercent:'0'},entries:[{itemId,minQuantity:'1',unitPrice:'99999999999999.123456',discountPercent:'0'}],reason});
test('manual prices use the same retained, idempotent, inactive and independent approval workflow as files',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),{imports,manual}=services(db),input=body(f.item.id);
 await assert.rejects(()=>manual.preview(f.owner,{...input,metadata:{...input.metadata,currency:undefined}}),{status:422});
 await assert.rejects(()=>manual.preview(f.owner,{...input,entries:[{...input.entries[0],minQuantity:undefined}]}),{status:422});
 await assert.rejects(()=>manual.preview(f.owner,{...input,entries:[{...input.entries[0],unitPrice:0}]}),{status:422});
 const plan=await manual.preview(f.owner,input);assert.equal(plan.canSave,true);assert.equal(plan.rows[0].unitPrice,'99999999999999.123456');input.previewFingerprint=plan.previewFingerprint;
 const saved=await manual.save(f.owner,input),again=await manual.save(f.owner,input);assert.equal(saved.id,again.id);assert.equal(again.replayed,true);
 assert.equal((await db.sql`SELECT id FROM crm_price_lists WHERE name=${input.metadata.name}`).length,0);
 await fixtureRuleService(db).clear(f.owner,'price_lists.approval_policy',reason);await assert.rejects(()=>imports.decide(f.owner,saved.id,{action:'SUBMIT',reason}),/Not set/);
 await fixtureRuleService(db).set(f.owner,'price_lists.approval_policy',{reviewerPermission:'items.update',instructions:'VERIFY- independently inspect all manual price rows'},reason);
 await imports.decide(f.owner,saved.id,{action:'SUBMIT',reason});await assert.rejects(()=>imports.decide(f.owner,saved.id,{action:'APPROVE',reason}),{status:403});await imports.decide(f.manager,saved.id,{action:'APPROVE',reason});await imports.decide(f.manager,saved.id,{action:'ACTIVATE',reason});
 const [row]=await db.sql`SELECT l.id,e.unit_price::text AS unit_price FROM crm_price_lists l JOIN crm_price_list_items e ON e.price_list_id=l.id WHERE l.name=${input.metadata.name}`;assert.equal(row.unit_price,'99999999999999.123456');const detail=await priceListDetail(db,row.id);assert.equal(detail.effective_from,'2026-01-01');assert.equal(detail.effective_to,'2026-12-31');assert.equal(detail.review_status,'ACTIVATED');
 await assert.rejects(()=>savePriceList(db,row.id,{reason},f.owner),/immutable/);await assert.rejects(()=>savePriceList(db,null,input,f.owner),{status:409});
 assert.equal((await itemDetail(db,f.item.id)).prices.length,0);assert.equal(Object.hasOwn((await itemDetail(db,f.item.id)).profile,'list_price'),false);
 assert.equal((await itemDetail(db,f.item.id,{listPrices:true})).prices[0].unit_price,row.unit_price);
 const [retained]=await db.sql`SELECT original_bytes,mapping FROM crm_price_import_workflows WHERE id=${saved.id}`;assert.equal(retained.mapping.entryMethod,'MANUAL_FORM');assert.ok(Buffer.from(retained.original_bytes).toString().includes('99999999999999.123456'));
}));
test('manual preview reports duplicate tiers and changed inputs cannot reuse an earlier preview',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),{manual}=services(db),input=body(f.item.id);
 const duplicate=await manual.preview(f.owner,{...input,entries:[input.entries[0],{...input.entries[0],minQuantity:'1.000000'}]});assert.equal(duplicate.invalidRows,2);
 const plan=await manual.preview(f.owner,input);await assert.rejects(()=>manual.save(f.owner,{...input,previewFingerprint:plan.previewFingerprint,entries:[{...input.entries[0],unitPrice:'1'}]}),/fresh preview/);
}));
test('list-price APIs and item projections enforce financial permission while manual HTTP still requires CSRF',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false})}),fetch=testFetch(app);
 async function headers(actor){const token=randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${actor.id},${tokenDigest(token)},'VERIFY-manual_csrf',now()+interval '1 hour')`;return {cookie:`crm_session=${token}`,'x-csrf-token':'VERIFY-manual_csrf','content-type':'application/json'};}
 try{
  const owner=await headers(f.owner),executive=await headers(f.executive),accounts=await headers(f.accounts);
  for(const h of [executive,accounts]){assert.equal((await fetch('http://localhost/api/crm/price-lists',{headers:h})).status,403);assert.equal((await fetch('http://localhost/api/crm/price-lists/1',{headers:h})).status,403);}
  const detail=await fetch(`http://localhost/api/crm/items/${f.item.id}`,{headers:executive});assert.equal(detail.status,200);const data=(await detail.json()).data;assert.equal(data.prices.length,0);assert.equal('list_price' in data.profile,false);assert.equal('discount_percent' in data.profile,false);
  const payload=JSON.stringify(body(f.item.id));assert.equal((await fetch('http://localhost/api/crm/price-imports/manual/preview',{method:'POST',headers:{cookie:owner.cookie,'content-type':'application/json'},body:payload})).status,403);
  const preview=await fetch('http://localhost/api/crm/price-imports/manual/preview',{method:'POST',headers:owner,body:payload});assert.equal(preview.status,200);assert.equal((await preview.json()).data.canSave,true);
  assert.equal((await fetch('http://localhost/api/crm/price-lists',{method:'POST',headers:owner,body:payload})).status,409);
 }finally{await app.close();installPermissionProvider(null);}
}));
