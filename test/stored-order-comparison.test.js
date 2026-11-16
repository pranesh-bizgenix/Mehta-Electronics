import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID,createHash} from 'node:crypto';
import {withTestTransaction} from '../test-support/transaction.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {testFetch} from '../test-support/http-client.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';
import {compareOrders} from '../src/tally-orders/compare.js';

export async function retainedComparisonFixture(db,companyName='VERIFY-Comparison company'){
 const source=await tallyFixture(db,companyName);
 async function order(key,type,quantity,rate,{cancelled=false,optional=false}={}){
  const raw={GUID:key,VOUCHERTYPENAME:type,VOUCHERNUMBER:key,CURRENCYNAME:'INR',ISCANCELLED:cancelled?'Yes':'No',ISOPTIONAL:optional?'Yes':'No',
   'ALLINVENTORYENTRIES.LIST':[{STOCKITEMGUID:'VERIFY-shared_item',STOCKITEMNAME:'VERIFY-Comparison item',BILLEDQTY:`${quantity} NOS`,RATE:`${rate}/NOS`,DISCOUNT:'0',GSTRATE:'18',HSNCODE:'0012'}]};
  const fields={'/stored/voucher_type':type,'/stored/voucher_number':key,'/stored/voucher_status':cancelled?'CANCELLED':optional?'OPTIONAL':'RECORDED'};
  const id=`VERIFY-${randomUUID()}`;
  await db.sql`INSERT INTO tally_visibility_records(id,company_id,entity,record_key,name,session_id,raw_record,fields,content_hash,observed_at)
   VALUES(${id},${source.company},'vouchers',${key},${key},${source.session},${db.sql.json(raw)},${db.sql.json(fields)},${createHash('sha256').update(JSON.stringify(raw)).digest('hex')},clock_timestamp())`;
  await db.sql`INSERT INTO tally_visibility_current_cache(company_id,entity,record_key,record_id,name,session_id,observed_at,summary_fields,public_summary,financial_search,public_search,has_raw)
   VALUES(${source.company},'vouchers',${key},${id},${key},${source.session},clock_timestamp(),${db.sql.json(fields)},'{}','VERIFY-','VERIFY-',true) ON CONFLICT(company_id,entity,record_key) DO UPDATE SET summary_fields=EXCLUDED.summary_fields,record_id=EXCLUDED.record_id`;
 }
 await order('VERIFY-SO','Sales Order','2','100');await order('VERIFY-PO','Purchase Order','2','60');
 await order('VERIFY-PO-partial','Purchase Order','1','70');await order('VERIFY-PO-cancelled','Purchase Order','2','60',{cancelled:true});
 return {...source,order};
}

test('stored comparison uses actual retained records, configuration, sessions, CSRF, financial roles and company scope',()=>withTestTransaction(async db=>{
 const f=await retainedComparisonFixture(db),foreign=await tallyFixture(db,'VERIFY-foreign_comparison');
 const users=[];
 for(const role of ['OWNER','MANAGER','ACCOUNTS']){
  const actor=(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(${`VERIFY-comparison_${role}`},${`VERIFY-comparison_${role}@example.test`},${role},'not-a-login',0) RETURNING id,role`)[0];
  actor.token=randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${actor.id},${tokenDigest(actor.token)},'VERIFY-csrf',now()+interval '1 hour')`;users.push(actor);
 }
 let app;
 const call=async(body,{actor=users[0],company=f.company,csrf=true,method='POST',path='/api/crm/order-comparison'}={})=>{
  const response=await testFetch(app)(`http://localhost${path}?companyId=${company}`,{method,headers:{'content-type':'application/json',...(actor?{cookie:`crm_session=${actor.token}`} :{}),...(csrf?{'x-csrf-token':'VERIFY-csrf'}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json()};
 };
 const command={mode:'SUPPLIER_PO',salesOrderKey:'VERIFY-SO',purchaseOrderKey:'VERIFY-PO',netExTaxConfirmed:true};
 try{
  app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false,tallyOrderComparisonEnabled:false,schedulerEnabled:false})});
  assert.equal((await call(command)).status,409);await app.close();
  app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false,tallyOrderComparisonEnabled:true,schedulerEnabled:false})});
  assert.equal((await call(command,{actor:null})).status,401);assert.equal((await call(command,{csrf:false})).status,403);
  assert.equal((await call(command,{actor:users[1]})).status,403);
  assert.equal((await call(command,{company:foreign.company})).status,404);
  assert.equal((await call({...command,salesOrder:{lines:[]}})).status,422);
  const result=await call(command,{actor:users[2]});assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.data.estimatedOrderGrossProfit,'80.00');assert.equal(result.body.data.rows[0].differences.find(d=>d.field==='unitPrice').delta,'40.000000');
  assert.ok(result.body.sources.salesOrder.snapshotId);assert.equal(result.body.readOnly,true);
  const partial=await call({...command,purchaseOrderKey:'VERIFY-PO-partial'});assert.equal(partial.status,200);assert.equal(partial.body.data.estimatedOrderGrossProfit,null);assert.equal(partial.body.data.coveredGrossProfit,'30.00');
  assert.ok(partial.body.data.rows[0].issues.includes('QUANTITY_COVERAGE_DIFFERS'));
  const cancelled=await call({...command,purchaseOrderKey:'VERIFY-PO-cancelled'});assert.equal(cancelled.body.data.estimatedOrderGrossProfit,null);
  assert.equal((await call({...command,purchaseOrderKey:'VERIFY-SO'})).status,422);
  assert.equal((await call(command,{method:'GET',path:'/api/tally/order-comparison/preview'})).status,404);
 }finally{await app?.close();installPermissionProvider(null);}
}));

test('unidentified and optional source lines remain visible without reporting a complete margin',()=>{
 const a={id:'VERIFY-so',kind:'sales_orders',companyId:'VERIFY-company',currency:'INR',lines:[{description:'VERIFY-unmapped',quantity:'2',unit:'NOS',unitPrice:'100',discountPercent:'0'}]},b={...a,id:'VERIFY-po',kind:'purchase_orders'};
 const result=compareOrders(a,b,{mode:'SUPPLIER_PO',netExTaxConfirmed:true});
 assert.equal(result.rows.length,2);assert.equal(result.estimatedOrderGrossProfit,null);assert.ok(result.issues.includes('ITEM_IDENTITY_MISSING'));
 const optional=compareOrders({...a,status:'OPTIONAL'},b,{mode:'SUPPLIER_PO',netExTaxConfirmed:true});assert.ok(optional.issues.includes('OPTIONAL_DOCUMENT_REQUIRES_REVIEW'));
});
