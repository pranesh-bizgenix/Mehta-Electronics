import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withTestTransaction} from '../test-support/transaction.js';
import {salesOrderFixture,sampleOriginal} from '../test-support/sales-order-fixture.js';
import {orderStockReceipt} from '../test-support/order-stock-fixture.js';
import {fixtureRuleService} from '../test-support/business-rule-fixture.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {saveOrder,orderDetail,orderAction,uploadOriginal,dispatchOrder} from '../src/sales-orders.js';
import {bindOrderStock,orderStockEvidence,checkDispatchStock,StockConsumptionService} from '../src/modules/stock/fulfillment.js';
import {TransactionRunner} from '../src/core/runtime.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {testFetch} from '../test-support/http-client.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';

const reason='VERIFY- reviewed operational stock evidence';
const workflow=(db,id)=>db.prepare('SELECT * FROM crm_order_workflows WHERE sales_order_id=?').get(id);
async function approved(f,body=f.body){
 let order=await saveOrder(f.db,null,body,f.executive);
 await uploadOriginal(f.db,order.id,{name:'VERIFY-po.pdf',base64:sampleOriginal.toString('base64'),version:order.version,reason},f.executive);
 order=await orderDetail(f.db,order.id,f.executive);
 await orderAction(f.db,order.id,{action:'VERIFY',version:order.version,reason},f.executive);
 return orderAction(f.db,order.id,{action:'APPROVE',version:order.version,reason,acceptExceptions:true},f.manager);
}
const pick=(order,quantity='1')=>({requestKey:randomUUID(),version:order.version,reason,vehicleNumber:'VERIFY-vehicle',lrNumber:'VERIFY-lr',transporter:'VERIFY-carrier',lines:[{lineId:order.lines[0].id,quantity}]});

test('order stock binds a saved company, rejects rebinding, and aggregates repeated item demand exactly',()=>withTestTransaction(async db=>{
 const f=await salesOrderFixture(db),other=await tallyFixture(db,'VERIFY-other_stock_company');
 await assert.rejects(()=>saveOrder(db,null,{...f.body,companyId:undefined},f.executive),{status:422});
 const order=await saveOrder(db,null,{...f.body,quotationId:null,poTotal:'0',lines:[{...f.body.lines[0],quantity:'12.000001'},{...f.body.lines[0],quantity:'12.000001'}]},f.executive);
 assert.equal(order.companyId,f.company);assert.equal(order.verification.stock.length,1);assert.equal(order.verification.stock[0].requestedQuantity,'24.000002');assert.ok(order.verification.flags.includes('STOCK_SHORT'));
 await assert.rejects(()=>saveOrder(db,order.id,{...f.body,companyId:other.company,version:order.version},f.executive),{code:'ORDER_COMPANY_IMMUTABLE'});
 const raw=await workflow(db,order.id),unbound={...raw,public_snapshot:{...raw.public_snapshot,companyId:null}};
 assert.deepEqual((await orderStockEvidence(db,unbound)).flags,['ORDER_COMPANY_NOT_CONFIRMED']);
 const snapshot={...raw.public_snapshot,lines:raw.public_snapshot.lines.map(line=>({...line}))};
 await bindOrderStock(db,{...f.body,companyId:undefined,lines:snapshot.lines},snapshot,{companyId:f.company},order.id);assert.equal(snapshot.companyId,f.company);
 await assert.rejects(()=>bindOrderStock(db,{...f.body,lines:[null]},snapshot,{companyId:f.company},order.id),{status:422});
 const missingBasis=await saveOrder(db,null,{...f.body,quotationId:null,poNumber:'VERIFY-no_basis',lines:[{...f.body.lines[0],stockBasis:null}]},f.executive);
 assert.ok(missingBasis.verification.flags.includes('LINE_STOCK_BASIS_NOT_CONFIRMED'));
}));

test('reserved stock requires the unique successful company-native association to this CRM order',()=>withTestTransaction(async db=>{
 const f=await salesOrderFixture(db),a=await saveOrder(db,null,{...f.body,quotationId:null},f.executive),b=await saveOrder(db,null,{...f.body,quotationId:null,poNumber:'VERIFY-other_order'},f.executive);
 const source=await db.prepare('SELECT connector_id,id FROM tally_upload_sessions WHERE company_name=(SELECT name FROM tally_companies WHERE id=?) ORDER BY id LIMIT 1').get(f.company),guid='VERIFY-reserved_order_guid',key='VERIFY-reserved_order_key',job=randomUUID();
 const fields={'/stored/guid':guid,'/stored/voucher_type':'Sales Order'};
 await db.sql`INSERT INTO tally_visibility_current_cache(company_id,entity,record_key,record_id,name,session_id,observed_at,summary_fields,public_summary,financial_search,public_search,has_raw) VALUES(${f.company},'vouchers',${key},'VERIFY-reserved_record','VERIFY-native_order',${source.id},clock_timestamp(),${db.sql.json(fields)},'{}','VERIFY-','VERIFY-',false)`;
 await db.sql`INSERT INTO tally_sync_jobs(id,connector_id,company_name,status) VALUES(${job},${source.connector_id},'VERIFY-reserved_order_job','stored')`;
 const reserved={...f.body.lines[0],stockBasis:'RESERVED_STOCK',stockReservationKey:guid,stockTallyOrderKey:key};
 await db.sql`INSERT INTO tally_sync_job_items(id,job_id,company_id,entity_kind,external_id,idempotency_key,status,crm_sales_order_id) VALUES(${randomUUID()},${job},${f.company},'purchase_order',${guid},${`VERIFY-${randomUUID()}`},'SUCCEEDED',${a.id})`;
 await assert.rejects(()=>saveOrder(db,a.id,{...f.body,quotationId:null,version:a.version,lines:[reserved]},f.executive),{code:'RESERVATION_OWNERSHIP_UNVERIFIED'});
 assert.equal((await db.prepare('SELECT crm_stock_reserved_owner(?,?,?) AS allowed').get(f.company,a.id,guid)).allowed,false,'A successful different entity kind cannot establish reservation ownership.');
 await db.sql`INSERT INTO tally_sync_job_items(id,job_id,company_id,entity_kind,external_id,idempotency_key,status,crm_sales_order_id) VALUES(${randomUUID()},${job},${f.company},'sales_order',${guid},${`VERIFY-${randomUUID()}`},'SUCCEEDED',${a.id})`;
 await assert.rejects(()=>saveOrder(db,b.id,{...f.body,quotationId:null,poNumber:'VERIFY-other_order',version:b.version,lines:[reserved]},f.executive),{code:'RESERVATION_OWNERSHIP_UNVERIFIED'});
 await assert.rejects(()=>saveOrder(db,null,{...f.body,quotationId:null,poNumber:'VERIFY-new_reserved_order',lines:[reserved]},f.executive),{code:'RESERVATION_OWNERSHIP_UNVERIFIED'});
 await orderStockReceipt(db,f,{reserved:'10',reservations:[{ORDERGUID:guid,ACTUALQTY:'10 NOS'}]});
 const own=await saveOrder(db,a.id,{...f.body,quotationId:null,version:a.version,lines:[reserved]},f.executive);assert.equal(own.verification.stock[0].ownershipVerified,true);assert.equal(own.verification.stock[0].selectedReservedQuantity,'10.000000');
 assert.equal((await db.prepare('SELECT crm_stock_reserved_owner(?,?,?) AS allowed').get(f.company,a.id,guid)).allowed,true);
 await db.sql`INSERT INTO tally_sync_job_items(id,job_id,company_id,entity_kind,external_id,idempotency_key,status,crm_sales_order_id) VALUES(${randomUUID()},${job},${f.company},'purchase_order',${`guid:${guid}`},${`VERIFY-${randomUUID()}`},'SUCCEEDED',${b.id})`;
 assert.equal((await db.prepare('SELECT crm_stock_reserved_owner(?,?,?) AS allowed').get(f.company,a.id,guid)).allowed,true,'Another entity kind must not impersonate or invalidate the actual Sales Order binding.');
 assert.equal((await orderDetail(db,a.id,f.executive)).verification.stock[0].ownershipVerified,true);
 await db.sql`INSERT INTO tally_sync_job_items(id,job_id,company_id,entity_kind,external_id,idempotency_key,status,crm_sales_order_id) VALUES(${randomUUID()},${job},${f.company},'sales_order',${`guid:${guid}`},${`VERIFY-${randomUUID()}`},'SUCCEEDED',${b.id})`;
 assert.equal((await db.prepare('SELECT crm_stock_reserved_owner(?,?,?) AS allowed').get(f.company,a.id,guid)).allowed,false);
 assert.ok((await orderStockEvidence(db,await workflow(db,a.id))).flags.includes('RESERVATION_OWNERSHIP_UNVERIFIED'));
 await db.sql`INSERT INTO tally_visibility_current_cache(company_id,entity,record_key,record_id,name,session_id,observed_at,summary_fields,public_summary,financial_search,public_search,has_raw) VALUES(${f.company},'vouchers','VERIFY-duplicate_reserved','VERIFY-duplicate_record','VERIFY-native_duplicate',${source.id},clock_timestamp(),${db.sql.json(fields)},'{}','VERIFY-','VERIFY-',false)`;
 assert.equal((await db.prepare('SELECT crm_stock_reserved_owner(?,?,?) AS allowed').get(f.company,a.id,guid)).allowed,false);
}));

test('dispatch rechecks confirmed fresh evidence and never allows exception acceptance to override stock holds',()=>withTestTransaction(async db=>{
 const f=await salesOrderFixture(db),order=await approved(f),command=pick(order);
 await orderStockReceipt(db,f,{sourceTimestamp:new Date(Date.now()-61*60000).toISOString()});
 let current=await orderDetail(db,order.id,f.manager);assert.ok(current.verification.flags.includes('STOCK_SOURCE_STALE'));
 await orderAction(db,order.id,{action:'VERIFY',version:order.version,reason},f.executive);await orderAction(db,order.id,{action:'APPROVE',version:order.version,reason,acceptExceptions:true},f.manager);
 await assert.rejects(()=>dispatchOrder(db,order.id,command,f.manager),{code:'STOCK_FULFILLMENT_BLOCKED'});
 await orderStockReceipt(db,f,{onHand:'0'});await orderAction(db,order.id,{action:'VERIFY',version:order.version,reason},f.executive);await orderAction(db,order.id,{action:'APPROVE',version:order.version,reason,acceptExceptions:true},f.manager);
 await assert.rejects(()=>dispatchOrder(db,order.id,command,f.manager),{code:'STOCK_FULFILLMENT_BLOCKED'});
 await fixtureRuleService(db).clear(f.owner,'stock.availability',reason);assert.ok((await orderDetail(db,order.id,f.manager)).verification.flags.includes('STOCK_EVIDENCE_UNVERIFIED'));
 await assert.rejects(async()=>checkDispatchStock(db,await workflow(db,order.id),[{id:order.lines[0].id,quantity:'1'}]),{code:'STOCK_FULFILLMENT_BLOCKED'});
 assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM crm_shipments WHERE sales_order_id=?').get(order.id)).count,0);
}));

test('dispatch consumption is immutable, survives imports, replays once, and needs a different Owner on later evidence',()=>withTestTransaction(async db=>{
 const f=await salesOrderFixture(db),order=await approved(f),command=pick(order,'4'),sent=await dispatchOrder(db,order.id,command,f.owner),service=new StockConsumptionService({db});
 const [movement]=await service.list(f.owner,f.company);assert.ok(movement);assert.equal(movement.quantity,'4.000000');
 assert.equal((await service.preview(f.owner,movement.id)).canReview,false);await assert.rejects(()=>service.preview(f.manager,movement.id),{status:403});
 const secondOwner={id:(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('VERIFY-Stock reviewer','VERIFY-stock_reviewer@example.test','OWNER','not-a-login',0) RETURNING id`)[0].id,role:'OWNER'};
 assert.equal((await service.preview(secondOwner,movement.id)).canReview,false);
 await orderStockReceipt(db,f,{onHand:'20'});assert.equal((await service.list(f.owner,f.company)).length,1,'A new import never silently resets consumption.');
 const plan=await service.preview(secondOwner,movement.id);assert.equal(plan.canReview,true);
 const body={requestKey:randomUUID(),reason,evidenceReference:'VERIFY-exact retained Tally movement independently checked',attestedInTally:true,sourceFingerprint:plan.fingerprint};
 await assert.rejects(()=>service.review(secondOwner,movement.id,{...body,sourceFingerprint:'0'.repeat(64)}),{status:409});
 const originalAudit=service.audit;service.audit={record:async()=>{throw new Error('VERIFY-review_audit_failure');}};
 await assert.rejects(()=>service.review(secondOwner,movement.id,body),/VERIFY-review_audit_failure/);service.audit=originalAudit;
 assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM crm_stock_consumption_reviews WHERE consumption_id=?').get(movement.id)).count,0);
 const saved=await service.review(secondOwner,movement.id,body);assert.equal(saved.replayed,false);assert.equal((await service.review(secondOwner,movement.id,body)).replayed,true);
 await assert.rejects(()=>service.review(secondOwner,movement.id,{...body,reason:'VERIFY-changed_retry'}),{code:'IDEMPOTENCY_KEY_REUSED'});
 assert.equal((await service.list(f.owner,f.company)).length,0);assert.equal((await dispatchOrder(db,order.id,command,f.owner)).shipmentId,sent.shipmentId,'Dispatch replay happens before changed source/review checks.');
 assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM crm_stock_consumptions WHERE shipment_id=?').get(sent.shipmentId)).count,1);
 await assert.rejects(db.sql`UPDATE crm_stock_consumptions SET reason='VERIFY-overwrite' WHERE id=${movement.id}`,/append.only/i);
 await assert.rejects(db.sql`UPDATE crm_stock_consumption_reviews SET reason='VERIFY-overwrite' WHERE id=${saved.id}`,/append.only/i);
}));

test('dispatch audit failure rolls back shipment, quantities, checks and consumption; historical untracked shipments remain held',()=>withTestTransaction(async db=>{
 const f=await salesOrderFixture(db),order=await approved(f),command=pick(order),failing=new Proxy(db,{get(target,key){if(key==='prepare')return statement=>{const prepared=target.prepare(statement);if(!statement.startsWith('INSERT INTO audit_logs('))return prepared;return {...prepared,run:async(...values)=>{if(values[1]==='STOCK_CONSUMPTION')throw new Error('VERIFY-dispatch_audit_failure');return prepared.run(...values);}};};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 await assert.rejects(()=>dispatchOrder(failing,order.id,command,f.manager),/VERIFY-dispatch_audit_failure/);
 for(const table of ['crm_shipments','crm_stock_consumptions'])assert.equal((await db.prepare(`SELECT count(*)::integer AS count FROM ${table} WHERE sales_order_id=?`).get(order.id)).count,0);
 assert.equal((await db.prepare('SELECT count(*)::integer AS count FROM stock_check_log WHERE sales_order_id=?').get(order.id)).count,0);assert.equal((await orderDetail(db,order.id,f.manager)).lines[0].fulfilledQuantity,'0.000000');
 await new TransactionRunner(db).run(f.manager,reason,async()=>{await db.prepare("SELECT set_config('mehta.order_write','authorized',true)").get();const shipment=await db.prepare("INSERT INTO crm_shipments(sales_order_id,vehicle_number,lr_number,transporter,created_by) VALUES(?,'VERIFY-legacy','VERIFY-legacy_lr','VERIFY-legacy_carrier',?) RETURNING id").get(order.id,f.manager.id);await db.prepare('INSERT INTO crm_shipment_items(shipment_id,order_line_id,quantity,created_by) VALUES(?,?,?,?)').run(shipment.id,order.lines[0].id,'1',f.manager.id);});
 assert.ok((await orderDetail(db,order.id,f.manager)).verification.flags.includes('LEGACY_STOCK_REVIEW_REQUIRED'));
 await assert.rejects(async()=>checkDispatchStock(db,await workflow(db,order.id),[{id:order.lines[0].id,quantity:'1'}]),{code:'STOCK_FULFILLMENT_BLOCKED'});
}));

test('stock fulfillment HTTP guards sessions, Owner status, CSRF and selected company without granting logistics financial access',()=>withTestTransaction(async db=>{
 const f=await salesOrderFixture(db),app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false})}),fetch=testFetch(app);
 async function headers(actor){const token=randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${actor.id},${tokenDigest(token)},'VERIFY-stock_csrf',now()+interval '1 hour')`;return {cookie:`crm_session=${token}`,'content-type':'application/json','x-csrf-token':'VERIFY-stock_csrf'};}
 try{const owner=await headers(f.owner),manager=await headers(f.manager),url=`http://localhost/api/crm/stock-consumptions?companyId=${f.company}`;
 assert.equal((await fetch(url)).status,401);assert.equal((await fetch('http://localhost/api/crm/stock-consumptions',{headers:owner})).status,422);assert.equal((await fetch(url,{headers:manager})).status,403);assert.equal((await fetch(url,{headers:owner})).status,200);
 const review=`http://localhost/api/crm/stock-consumptions/${randomUUID()}/review`;assert.equal((await fetch(review,{method:'POST',headers:{cookie:owner.cookie,'content-type':'application/json'},body:'{}'})).status,403);
 for(const role of ['LOGISTICS_LEAD','STORE_STAFF']){const actor={id:(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(${`VERIFY-stock_${role}`},${`VERIFY-stock_${role}@example.test`},${role},'not-a-login',0) RETURNING id`)[0].id,role};const h=await headers(actor);assert.equal((await fetch(url,{headers:h})).status,403);assert.equal((await fetch(`http://localhost/api/crm/order-stock-sources?companyId=${f.company}`,{headers:h})).status,403);}
 }finally{await app.close();installPermissionProvider(null);}
}));
