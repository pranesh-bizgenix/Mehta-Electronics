import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {fixtureRuleService} from '../test-support/business-rule-fixture.js';
import {TransactionRunner,AuditRepository} from '../src/core/runtime.js';
import {forbidden} from '../src/core/errors.js';
import {hasPermission} from '../src/rbac.js';
import {PriceImportRepository} from '../src/modules/pricing/repository.js';
import {PriceImportService} from '../src/modules/pricing/service.js';
import {savePriceList} from '../src/crm-modules.js';
import {importMetadata,importUpload} from '../src/modules/pricing/contracts.js';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {testFetch} from '../test-support/http-client.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';
import {pricePdfFixture} from '../test-support/price-pdf-fixture.js';
const reason='VERIFY- reviewed literal source';
function service(db){return new PriceImportService({db,repository:new PriceImportRepository(db),transactions:new TransactionRunner(db),audit:new AuditRepository(db),access:{require(actor,key){if(!actor?.id||!hasPermission(actor,key))throw forbidden();}}});}
function input(){return {format:'CSV',filename:'VERIFY-prices.csv',contentBase64:Buffer.from('Part,Unit,Price,MOQ,Discount\nVERIFY-QUOTE-PART,NOS,12345678901234.123456,1,0').toString('base64'),mapping:{dataStartRow:2,columns:{partCode:0,uom:1,unitPrice:2,minQuantity:3,discountPercent:4}},metadata:{name:'VERIFY- reviewed list',currency:'INR',effectiveFrom:'2026-11-01',effectiveTo:'2026-12-31',discountPercent:'0'},reason};}
const confirm=(db,owner)=>fixtureRuleService(db).set(owner,'price_lists.approval_policy',{reviewerPermission:'items.update',instructions:'VERIFY- independent review of all literal prices'},reason);
test('price upload and metadata reject missing decisions, malformed encoding and unsupported formats',()=>{
 assert.throws(()=>importMetadata({}),{status:422});assert.throws(()=>importMetadata({...input().metadata,discountPercent:0}),{status:422});
 assert.throws(()=>importMetadata({...input().metadata,effectiveTo:'2026-10-01'}),{status:422});
 assert.throws(()=>importUpload({...input(),contentBase64:'??=='}),{status:422});assert.throws(()=>importUpload({...input(),filename:'../file.csv'}),{status:422});
 assert.throws(()=>importUpload({...input(),format:'UNKNOWN'}),{status:422});
});
test('price drafts preserve originals, replay idempotently, remain inactive and block missing policy',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),s=service(db),b=input();b.previewFingerprint=(await s.preview(f.owner,b)).previewFingerprint;
 const saved=await s.save(f.owner,b),replay=await s.save(f.owner,b);assert.equal(saved.id,replay.id);assert.equal(replay.replayed,true);
 const [row]=await db.sql`SELECT original_bytes,status FROM crm_price_import_workflows WHERE id=${saved.id}`;
 assert.equal(Buffer.from(row.original_bytes).toString('base64'),b.contentBase64);assert.equal(row.status,'PENDING_REVIEW');
 assert.equal((await db.sql`SELECT id FROM crm_price_lists WHERE name=${b.metadata.name}`).length,0);
 await fixtureRuleService(db).clear(f.owner,'price_lists.approval_policy',reason);
 await assert.rejects(()=>s.decide(f.owner,saved.id,{action:'SUBMIT',reason}),/Not set: price_lists.approval_policy/);
 for(const role of ['ACCOUNTS','EXECUTIVE','LOGISTICS_LEAD','STORE_STAFF'])await assert.rejects(()=>s.preview({...f.owner,role},b),{status:403});
 await assert.rejects(()=>s.save(f.owner,{...b,metadata:{...b.metadata,name:'VERIFY- changed'}}),/fresh preview/);
}));
test('price activation needs a current independent approval; exact prices and evidence cannot be edited later',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),s=service(db),b=input();b.previewFingerprint=(await s.preview(f.owner,b)).previewFingerprint;const saved=await s.save(f.owner,b);
 await confirm(db,f.owner);await s.decide(f.owner,saved.id,{action:'SUBMIT',reason});
 await assert.rejects(()=>s.decide(f.owner,saved.id,{action:'APPROVE',reason}),{status:403});
 await assert.rejects(()=>s.decide(f.manager,saved.id,{action:'ACTIVATE',reason}),/APPROVED/);
 await s.decide(f.manager,saved.id,{action:'APPROVE',reason});await s.decide(f.manager,saved.id,{action:'ACTIVATE',reason});
 const [price]=await db.sql`SELECT p.unit_price::text AS amount,w.target_list_id,w.status FROM crm_price_import_workflows w JOIN crm_price_list_items p ON p.price_list_id=w.target_list_id WHERE w.id=${saved.id}`;
 assert.equal(price.amount,'12345678901234.123456');assert.equal(price.status,'ACTIVATED');
 await assert.rejects(()=>savePriceList(db,price.target_list_id,{reason},f.owner),/immutable/);
 await assert.rejects(()=>s.decide(f.manager,saved.id,{action:'ACTIVATE',reason}),/APPROVED/);
 const events=await db.sql`SELECT action FROM crm_price_import_events WHERE import_id=${saved.id} ORDER BY created_at,id`;assert.equal(events.length,4);
 await new TransactionRunner(db).run(f.manager,reason,async()=>{
  await assert.rejects(()=>db.sql`UPDATE crm_price_import_workflows SET mapping='{}'::jsonb WHERE id=${saved.id}`,/immutable/);
  await assert.rejects(()=>db.sql`DELETE FROM crm_price_import_events WHERE import_id=${saved.id}`,/append|immutable|deleted/i);
 });
}));
test('stale products and changed approval rules hold price imports without activating any prices',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),s=service(db),b=input();b.previewFingerprint=(await s.preview(f.owner,b)).previewFingerprint;const saved=await s.save(f.owner,b);
 await confirm(db,f.owner);await s.decide(f.owner,saved.id,{action:'SUBMIT',reason});await confirm(db,f.owner);
 await assert.rejects(()=>s.decide(f.manager,saved.id,{action:'APPROVE',reason}),/policy changed/);
 await new TransactionRunner(db).run(f.owner,reason,()=>db.sql`UPDATE items SET uom='BOX' WHERE id=${f.item.id}`);
 const other={...b,metadata:{...b.metadata,name:'VERIFY- second list'}};other.previewFingerprint=(await s.preview(f.owner,other)).previewFingerprint;
 await assert.rejects(()=>s.save(f.owner,other),/row error/);
 assert.equal((await db.sql`SELECT id FROM crm_price_lists WHERE name=${b.metadata.name}`).length,0);
}));
test('price import HTTP routes enforce session, CSRF, financial access and an explicit review before saving',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false})}),fetch=testFetch(app);
 async function headers(user){const token=randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${user.id},${tokenDigest(token)},'VERIFY-price_csrf',now()+interval '1 hour')`;return {cookie:`crm_session=${token}`,'x-csrf-token':'VERIFY-price_csrf','content-type':'application/json'};}
 try{
  const owner=await headers(f.owner),accounts=await headers(f.accounts),b=input();
  assert.equal((await fetch('http://localhost/api/crm/price-imports')).status,401);
  assert.equal((await fetch('http://localhost/api/crm/price-imports',{headers:accounts})).status,403);
  assert.equal((await fetch('http://localhost/api/crm/price-imports/preview',{method:'POST',headers:{cookie:owner.cookie,'content-type':'application/json'},body:JSON.stringify(b)})).status,403);
  const preview=await fetch('http://localhost/api/crm/price-imports/preview',{method:'POST',headers:owner,body:JSON.stringify(b)});assert.equal(preview.status,200);b.previewFingerprint=(await preview.json()).data.previewFingerprint;
  const saved=await fetch('http://localhost/api/crm/price-imports',{method:'POST',headers:owner,body:JSON.stringify(b)});assert.equal(saved.status,200);const id=(await saved.json()).data.id;
  const detail=await fetch(`http://localhost/api/crm/price-imports/${id}`,{headers:owner});assert.equal(detail.status,200);const data=(await detail.json()).data;assert.equal(data.status,'PENDING_REVIEW');assert.equal(data.entries.length,1);assert.equal('original_bytes' in data,false);
 }finally{await app.close();installPermissionProvider(null);}
}));
test('text PDF source goes through the same exact, independently approved retained import lifecycle',()=>withTestTransaction(async db=>{
 const f=await quotationFixture(db),s=service(db),b=input();
 b.format='PDF_TABLE';b.filename='VERIFY-table.pdf';b.metadata.name='VERIFY- reviewed PDF list';
 b.contentBase64=(await pricePdfFixture(['Part                Unit      Price','VERIFY-QUOTE-PART   NOS       88.123456'])).toString('base64');
 const inspected=await s.inspect(f.owner,b),line=inspected.rows.find(r=>r.sourceText.includes('VERIFY-QUOTE-PART'));
 assert.ok(line);const unitStart=line.sourceText.indexOf('NOS'),priceStart=line.sourceText.indexOf('88.123456');
 b.mapping={dataStartRow:line.number,pdfColumns:[{start:0,end:unitStart},{start:unitStart,end:priceStart},{start:priceStart,end:priceStart+9}],columns:{partCode:0,uom:1,unitPrice:2},constants:{minQuantity:'1',discountPercent:'0'}};
 const unmapped={...b,mapping:{...b.mapping,pdfColumns:undefined}};await assert.rejects(()=>s.preview(f.owner,unmapped),/Not set: price_import.mapping.pdfColumns/);
 const preview=await s.preview(f.owner,b);assert.equal(preview.canSave,true);assert.equal(preview.rows[0].unitPrice,'88.123456');b.previewFingerprint=preview.previewFingerprint;
 const saved=await s.save(f.owner,b);await confirm(db,f.owner);await s.decide(f.owner,saved.id,{action:'SUBMIT',reason});await s.decide(f.manager,saved.id,{action:'APPROVE',reason});await s.decide(f.manager,saved.id,{action:'ACTIVATE',reason});
 const [price]=await db.sql`SELECT p.unit_price::text AS amount FROM crm_price_import_workflows w JOIN crm_price_list_items p ON p.price_list_id=w.target_list_id WHERE w.id=${saved.id}`;assert.equal(price.amount,'88.123456');
}));
