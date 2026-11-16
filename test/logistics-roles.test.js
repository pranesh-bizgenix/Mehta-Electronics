import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { withTestTransaction } from '../test-support/transaction.js';
import { procurementFixture } from '../test-support/procurement-fixture.js';
import { logisticsPermissions } from '../src/logistics-policy.js';
import { hasPermission,permissionsFor,installPermissionProvider } from '../src/rbac.js';
import { AccessService } from '../src/modules/access/access-service.js';
import { AccessRepository } from '../src/modules/access/access-repository.js';
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config.js';
import { tokenDigest } from '../src/security.js';
import * as l from '../src/logistics.js';
import * as p from '../src/procurement.js';
import { dispatchOrder,markDelivered,uploadOriginal,orderDetail,downloadOriginal } from '../src/sales-orders.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFTsAAAAASUVORK5CYII=','base64');
const image={name:'VERIFY-photo.png',base64:png.toString('base64')};
function noFinancial(value) {
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)) {
    assert.ok(!/cost|margin|price|total|balance|credit|discount|tax|payload|snapshot/i.test(key),`financial key leaked: ${key}`);
    noFinancial(item);
  }
}
async function user(db,role,suffix=role) {
  const row=(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(${`VERIFY-${suffix}`},${`VERIFY-${suffix}@example.test`},${role},'not-a-login',0) RETURNING id`)[0];
  return {id:row.id,role};
}
async function issuedPo(f) {
  const {db,manager,owner,item,order}=f;
  const vendor=await p.saveVendor(db,null,{name:'VERIFY-logistics vendor',stateCode:'27',reason:'VERIFY- vendor fixture'},manager);
  const request=await p.saveRequest(db,null,{salesOrderId:order.id,subject:'VERIFY-receiving',requiredBy:'2099-11-01',lines:[{itemId:item.id,quantity:'10'}],reason:'VERIFY- request'},manager);
  let rfq=await p.createRfq(db,{requestId:request.id,requestVersion:request.version,vendorIds:[vendor.id],replyBy:'2099-10-30',reason:'VERIFY- RFQ'},manager);
  const reply=await p.saveReply(db,rfq.id,{rfqVersion:1,vendorId:vendor.id,validUntil:'2099-12-31',lines:[{itemId:item.id,quantity:'10',unitPrice:'70',taxPercent:'18'}],reason:'VERIFY- offer'},manager);
  rfq=await p.selectWinner(db,rfq.id,{version:1,replyId:reply.id,replyVersion:reply.version,reason:'VERIFY- winner'},manager);
  let po=await p.saveSupplierPo(db,null,{rfqId:rfq.id,deliveryBy:'2099-11-15',reason:'VERIFY- purchase'},manager);
  const check=await p.supplierPoCheck(db,po.id,owner);
  po=await p.supplierPoAction(db,po.id,{action:'SUBMIT',version:po.version,reason:'VERIFY- submit'},manager);
  po=await p.supplierPoAction(db,po.id,{action:'APPROVE',version:po.version,fingerprint:check.fingerprint,reason:'VERIFY- independent approval'},owner);
  return p.supplierPoAction(db,po.id,{action:'ISSUE',version:po.version,reason:'VERIFY- issue externally'},manager);
}

test('new logistics roles have only the operational matrix, even with a hostile provider',()=>{
  for(const role of Object.keys(logisticsPermissions)) {
    assert.deepEqual(permissionsFor(role),logisticsPermissions[role]);
    for(const key of ['quotations.cost.read','quotations.cost.manage','purchasing.read','purchasing.write','orders.review','orders.create','tally.read','customers.dues.read','access.manage'])assert.equal(hasPermission({role},key),false);
  }
  installPermissionProvider({permissionsFor:()=>['*','logistics.read','tally.read','quotations.cost.read'],requiresMfa:()=>false});
  try { for(const role of Object.keys(logisticsPermissions))assert.deepEqual(permissionsFor(role),['logistics.read']); }
  finally { installPermissionProvider(null); }
  assert.equal(hasPermission({role:'MANAGER'},'orders.dispatch'),true);
  assert.equal(hasPermission({role:'EXECUTIVE'},'orders.dispatch'),false);
  assert.equal(hasPermission({role:'ACCOUNTS'},'tally.read'),true);
});

test('logistics: assignment scope, narrow evidence writes, GRN review and dispatch preserve financial and approval boundaries',()=>withTestTransaction(async db=>{
  const f=await procurementFixture(db),lead=await user(db,'LOGISTICS_LEAD'),checker=await user(db,'LOGISTICS_LEAD','checker'),store=await user(db,'STORE_STAFF'),other=await user(db,'STORE_STAFF','other');
  const po=await issuedPo(f),oid=f.order.id;
  assert.equal((await l.logisticsOrders(db,new URL('http://test/'),store)).pagination.total,0);
  await assert.rejects(l.logisticsOrderDetail(db,oid,store),{status:404});
  await l.assignStore(db,oid,{userId:store.id,active:true,reason:'VERIFY- store assignment'},lead);
  assert.ok((await l.logisticsOrders(db,new URL('http://test/'),store)).data.some(o=>o.id===oid));
  noFinancial(await l.logisticsOrderDetail(db,oid,store));noFinancial(await orderDetail(db,oid,lead));
  await assert.rejects(l.assignStore(db,oid,{userId:other.id,active:true,reason:'VERIFY- escalation'},store),{status:403});
  const body={version:f.order.version,lineRef:String(f.order.lines[0].id),itemCode:'VERIFY-observed part',photo:image,reason:'VERIFY- photo and item code'};
  const evidence=await l.appendEvidence(db,'DISPATCH',oid,body,store);
  assert.deepEqual((await l.evidencePhoto(db,evidence.id,store)).photo_bytes,png);
  await assert.rejects(l.evidencePhoto(db,evidence.id,other),{status:404});
  for(const key of ['quantity','received','accepted','unitPrice','cost','margin','status','approved_by','total','lines','userId'])await assert.rejects(l.appendEvidence(db,'DISPATCH',oid,{...body,[key]:'forbidden'},store),{status:422});
  await assert.rejects(l.appendEvidence(db,'DISPATCH',oid,{...body,lineRef:'999999'},store),{status:422});
  await assert.rejects(l.appendEvidence(db,'DISPATCH',oid,{...body,version:0},store),{status:409});
  await assert.rejects(l.appendEvidence(db,'DISPATCH',oid,{...body,photo:{name:'VERIFY-pdf.pdf',base64:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')}},store),{status:422});
  assert.equal((await db.sql`SELECT count(*) AS n FROM logistics_evidence WHERE sales_order_id=${oid}`)[0].n,1);
  await assert.rejects(p.purchaseRecord(db,'pos',po.id,lead),{status:403});
  noFinancial(await l.receivingPo(db,po.id,lead));
  const receipt={requestKey:crypto.randomUUID(),receivedDate:'2026-11-03',lines:[{poLineKey:po.payload.lines[0].lineKey,received:'2',accepted:'2',rejected:'0'}],reason:'VERIFY- goods received'};
  await assert.rejects(p.createGrn(db,po.id,receipt,store),{status:403});
  await assert.rejects(p.createGrn(db,po.id,{...receipt,lines:[{...receipt.lines[0],unitPrice:'0'}]},lead),{status:422});
  await assert.rejects(p.createGrn(db,po.id,{...receipt,lines:[null]},lead),{status:422});
  let grn=await p.createGrn(db,po.id,receipt,lead);noFinancial(grn);
  noFinancial(await l.logisticsGrn(db,grn.id,store));
  const observation={version:grn.version,lineRef:receipt.lines[0].poLineKey,itemCode:'VERIFY-received-code',photo:image,reason:'VERIFY- receiving evidence'};
  await l.appendEvidence(db,'GRN',grn.id,observation,store);
  grn=await l.logisticsGrn(db,grn.id,store);
  assert.equal(grn.version,2);assert.equal(grn.lines[0].actualPartCode,'VERIFY-received-code');
  const storedLine=(await db.sql`SELECT payload FROM crm_grns WHERE id=${grn.id}`)[0].payload.lines[0];
  assert.equal(storedLine.received,'2');assert.equal(storedLine.accepted,'2');assert.equal(storedLine.unitPrice,'70');
  await assert.rejects(p.grnCheck(db,grn.id,store),{status:403});
  const review=await p.grnCheck(db,grn.id,lead);noFinancial(review);
  assert.ok(review.alerts.some(a=>a.code==='RECEIVED_PART_DIFFERENCE'));
  await assert.rejects(p.postGrn(db,grn.id,{version:grn.version,fingerprint:review.fingerprint,reason:'VERIFY- self review'},lead),{status:403});
  await assert.rejects(p.postGrn(db,grn.id,{version:grn.version,fingerprint:review.fingerprint,reason:'VERIFY- staff review'},store),{status:403});
  await assert.rejects(p.postGrn(db,grn.id,{version:grn.version,fingerprint:review.fingerprint,reason:'VERIFY- no exception acknowledgement'},checker),{status:422});
  noFinancial(await p.postGrn(db,grn.id,{version:grn.version,fingerprint:review.fingerprint,acceptExceptions:true,reason:'VERIFY- independent receiving exception review'},checker));
  await assert.rejects(l.appendEvidence(db,'GRN',grn.id,observation,store),{status:409});
  const commercial=await p.createGrn(db,po.id,{...receipt,requestKey:crypto.randomUUID(),lines:[{...receipt.lines[0],received:'1',accepted:'1',unitPrice:'71'}]},f.manager);
  const commercialReview=await p.grnCheck(db,commercial.id,lead);noFinancial(commercialReview);
  assert.ok(commercialReview.alerts.some(a=>a.code==='COMMERCIAL_REVIEW_REQUIRED'));
  await assert.rejects(p.postGrn(db,commercial.id,{version:commercial.version,fingerprint:commercialReview.fingerprint,acceptExceptions:true,reason:'VERIFY- logistics cannot approve commercial exceptions'},lead),{status:409});
  const send={requestKey:crypto.randomUUID(),version:f.order.version,vehicleNumber:'VERIFY-VEHICLE',lrNumber:'VERIFY-LR',transporter:'VERIFY-transporter',lines:[{lineId:f.order.lines[0].id,quantity:'1'}],reason:'VERIFY- dispatch'};
  await assert.rejects(dispatchOrder(db,oid,send,store),{status:403});
  await assert.rejects(dispatchOrder(db,oid,{...send,version:0},lead),{status:409});
  const shipment=await dispatchOrder(db,oid,send,lead);noFinancial(shipment);
  await assert.rejects(markDelivered(db,shipment.shipmentId,{version:f.order.version,reason:'VERIFY- missing proof'},lead),{status:422});
  await uploadOriginal(db,oid,{...image,version:f.order.version,reason:'VERIFY- retained delivery proof'},lead,shipment.shipmentId);
  noFinancial(await markDelivered(db,shipment.shipmentId,{version:f.order.version,reason:'VERIFY- proof checked'},lead));
  await assert.rejects(downloadOriginal(db,1,lead),{status:403});
  await l.assignStore(db,oid,{userId:store.id,active:false,reason:'VERIFY- access revoked'},lead);
  await assert.rejects(l.logisticsOrderDetail(db,oid,store),{status:404});
  await assert.rejects(l.evidencePhoto(db,evidence.id,store),{status:404});
  await assert.rejects(l.appendEvidence(db,'DISPATCH',oid,body,store),{status:404});
  assert.equal((await db.sql`SELECT count(*) AS n FROM audit_logs WHERE entity IN ('LOGISTICS_ASSIGNMENT','LOGISTICS_EVIDENCE') AND user_id IN (${lead.id},${store.id})`)[0].n,4);
}));

test('role administration refuses financial escalation and undefined Admin; HTTP handler enforces session, CSRF and role checks without a listener',()=>withTestTransaction(async db=>{
  const owner=await user(db,'OWNER','http_owner'),lead=await user(db,'LOGISTICS_LEAD','http_lead'),store=await user(db,'STORE_STAFF','http_store');
  const access=await new AccessService({repository:new AccessRepository(db),transactions:{run:(_u,_r,fn)=>fn()},audit:{record:async()=>{}}}).load();
  for(const role of ['LOGISTICS_LEAD','STORE_STAFF'])for(const permission of ['tally.read','quotations.cost.read','orders.review','purchasing.read','users.update'])await assert.rejects(access.setGrant(owner,{role,permission,granted:true,reason:'VERIFY- forbidden escalation'}),{status:403});
  await assert.rejects(access.createRole(owner,{key:'ADMIN',name:'Admin',reason:'VERIFY- undefined role'}),{status:422});
  assert.equal(access.roleExists('LOGISTICS_LEAD'),true);assert.equal(access.roleExists('STORE_STAFF'),true);assert.equal(access.roleExists('ADMIN'),false);
  const matrix=await access.matrixView(owner);
  assert.equal(matrix.roles.find(r=>r.key==='STORE_STAFF').allowedPermissions.includes('tally.read'),false);
  const tokens=new Map();
  for(const actor of [owner,lead,store]) {
    const token=crypto.randomUUID();tokens.set(actor.id,token);
    await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${actor.id},${tokenDigest(token)},'VERIFY-csrf',now()+interval '1 hour')`;
  }
  const app=createApp({db,config:getConfig({mfaEnabled:false})});
  async function request(method,url,actor,body={},csrf=true) {
    const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,url,headers:{host:'localhost','content-type':'application/json',...(actor?{cookie:`crm_session=${tokens.get(actor.id)}`}:{}),...(csrf?{'x-csrf-token':'VERIFY-csrf'}:{})},socket:{remoteAddress:'test'}});
    const response={status:0,headersSent:false,setHeader(){},writeHead(status){this.status=status;this.headersSent=true;},end(data){this.body=data?JSON.parse(String(data)):null;}};
    await app(req,response);return response;
  }
  try {
    assert.equal((await request('GET','/api/crm/logistics/orders')).status,401);
    assert.equal((await request('GET','/api/crm/logistics/orders',store)).status,200);
    assert.equal((await request('POST','/api/crm/logistics/orders/1/evidence',store,{},false)).status,403);
    for(const url of ['/api/crm/orders','/api/crm/purchasing/pos','/api/tally/items','/api/crm/quotation-policy'])assert.equal((await request('GET',url,lead)).status,403,url);
    assert.equal((await request('POST','/api/crm/logistics/orders/1/dispatch',store)).status,403);
    assert.equal((await request('POST','/api/crm/logistics/pos/1/grns',store)).status,403);
    assert.equal((await request('PATCH',`/api/v1/users/${store.id}`,owner,{role:'LOGISTICS_LEAD',reason:'VERIFY- owner changes role'})).status,200);
    assert.equal((await db.sql`SELECT role FROM users WHERE id=${store.id}`)[0].role,'LOGISTICS_LEAD');
    assert.equal((await request('POST','/api/users',owner,{name:'VERIFY-Created Store',email:'VERIFY-created_store@example.test',role:'STORE_STAFF',ownerUserId:owner.id,backupUserId:lead.id,password:'VERIFY-StorePass123!',reason:'VERIFY- owner creates Store staff'})).status,201);
  } finally { await app.close();installPermissionProvider(null); }
}));
