import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {Readable} from 'node:stream';
import {withAuthorizedRdsRollbackVerification} from '../test-support/transaction.js';import {getConfig} from '../src/config.js';import {createApp} from '../src/app.js';import {tokenDigest} from '../src/security.js';import {connectPostgres} from '../src/postgres.js';import {writeAudit} from '../src/db.js';import {calculateQuotation} from '../public/quotation-math.js';
const out='verification-output/customer-po-comparison/2026-11-19';fs.mkdirSync(out,{recursive:true});let orderId,evidence;
try{
 await withAuthorizedRdsRollbackVerification(async db=>{
  const users={};for(const [key,role]of [['owner','OWNER'],['sales','EXECUTIVE'],['restricted','STORE_STAFF']]){users[key]=await db.prepare("SELECT id,role FROM users WHERE role=? AND status='ACTIVE' ORDER BY id LIMIT 1").get(role);assert.ok(users[key]);}
  const sessions={};for(const [key,u]of Object.entries(users)){const token=randomUUID(),csrf=randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${u.id},${tokenDigest(token)},${csrf},now()+interval '1 hour')`;sessions[key]={token,csrf};}
  const app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false,schedulerEnabled:false})});
  try{
   await app.modules.ready();console.log('Customer PO comparison rollback verification ready.');
   const customer=await db.prepare("SELECT id,name FROM customers WHERE status='ACTIVE' ORDER BY id LIMIT 1").get();assert.ok(customer);
   const line={itemId:null,partCode:'ZZTEST_COMPARISON',description:'ZZTEST_ fictional component',uom:'NOS',quantity:'2',unitPrice:'100',discountPercent:'60',taxPercent:'18'};
   const quote={id:null,quotation_number:'ZZTEST_QUOTE',version:1,total:'94.40',sellerState:'33',placeOfSupply:'33',lines:[line]};
   const po={customerId:customer.id,customer_name:customer.name,quotationId:null,poNumber:'ZZTEST_COMPARISON_PO',poDate:'2026-11-19',promisedDate:null,sellerState:'33',placeOfSupply:'33',supplyType:'DOMESTIC_STANDARD',notes:'ZZTEST_ rollback only',poTotal:'94.40',...calculateQuotation([line],'33','33')};
   await db.prepare("SELECT set_config('mehta.actor_id',?,true),set_config('mehta.audit_reason','ZZTEST_ comparison verification',true),set_config('mehta.order_write','authorized',true)").get(String(users.owner.id));
   const created=await db.prepare('INSERT INTO sales_orders(order_number,customer_id,customer_po_number,customer_po_date,created_by,updated_by) VALUES(?,?,?,?,?,?)').run('ZZTEST_COMPARISON_SO',customer.id,po.poNumber,po.poDate,users.owner.id,users.owner.id);orderId=created.insertedId;po.order_number='ZZTEST_COMPARISON_SO';
   await db.prepare('INSERT INTO crm_order_workflows(sales_order_id,customer_id,po_key,source_quote_version,source_quote_snapshot,public_snapshot,private_snapshot,created_by) VALUES(?,?,?,1,?::text::jsonb,?::text::jsonb,?::text::jsonb,?)').run(orderId,customer.id,po.poNumber,JSON.stringify(quote),JSON.stringify(po),'{}',users.owner.id);
   await writeAudit(db,{userId:users.owner.id,entity:'SALES_ORDER_WORKFLOW',recordId:orderId,action:'TEST_FIXTURE',reason:'ZZTEST_ comparison verification'});
   async function call(who){const s=sessions[who],req=Readable.from([]);Object.assign(req,{method:'GET',url:`/api/crm/orders/${orderId}`,headers:{host:'localhost',cookie:`crm_session=${s.token}`},socket:{remoteAddress:'127.0.0.1'}});const res={headersSent:false,setHeader(){},writeHead(status){this.status=status;this.headersSent=true;},end(data){this.body=String(data||'');}};await app(req,res);return res;}
   const equal=await call('sales');assert.equal(equal.status,200);const initial=JSON.parse(equal.body).data;assert.deepEqual(initial.verification.comparison.flags,[]);assert.equal(initial.verification.pricing,undefined);
   assert.equal((await call('restricted')).status,403);
   po.lines=[{...line,quantity:'3',unitPrice:'101'}];Object.assign(po,calculateQuotation(po.lines,'33','33'));po.poTotal=po.total;
   await db.prepare("UPDATE crm_order_workflows SET public_snapshot=?::text::jsonb,version=version+1 WHERE sales_order_id=?").run(JSON.stringify(po),orderId);
   await writeAudit(db,{userId:users.owner.id,entity:'SALES_ORDER_WORKFLOW',recordId:orderId,action:'TEST_REVISE',reason:'ZZTEST_ comparison verification'});
   const changed=await call('sales');assert.equal(changed.status,200);const detail=JSON.parse(changed.body).data,c=detail.verification.comparison;
   for(const flag of ['RATE_DIFFERENCE','QUANTITY_DIFFERENCE','NET_RATE_DIFFERENCE'])assert.ok(detail.verification.flags.includes(flag));
   assert.equal(c.comparisons[0].differences.find(d=>d.field==='quantity').delta,'1.000000');assert.equal(c.comparisons[0].differences.find(d=>d.field==='unitPrice').delta,'1.000000');
   assert.equal(detail.verification.pricing,undefined);assert.equal(c.quoteNumber,'ZZTEST_QUOTE');
   evidence={at:new Date().toISOString(),status:'PASS',matchingApi:200,differencesApi:200,restrictedApi:403,quantityDelta:'1.000000',unitRateDelta:'1.000000',salesCostRedacted:true,scope:'Real authenticated read handlers and saved CRM snapshot fixtures in authorised RDS rollback. No Tally rows changed. Fixture snapshots isolate comparison; normal order creation, stock/credit approval and production MFA are not certified by this check.'};
  }finally{await app.close();}
 });
 const sql=connectPostgres(getConfig().databaseUrl);try{assert.equal((await sql`SELECT id FROM sales_orders WHERE id=${orderId}`).length,0);}finally{await sql.end({timeout:5});}
 fs.writeFileSync(out+'/rds-verification.json',JSON.stringify({...evidence,cleanup:'PASS: temporary order and all transaction changes rolled back'},null,2));console.log('PASS: saved customer PO comparison API, restricted access, exact deltas, cost redaction and rollback cleanup.');
}catch(e){console.error('Comparison RDS verification failed:',e.name,e.message?.slice(0,350));process.exitCode=1;}
