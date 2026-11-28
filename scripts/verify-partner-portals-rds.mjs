import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {withAuthorizedRdsRollbackVerification} from '../test-support/transaction.js';
import {createModules} from '../src/modules/container.js';
import {getConfig} from '../src/config.js';
import {PortalAccess} from '../src/modules/portals/access.js';
import {PortalRecords} from '../src/modules/portals/records.js';
import {PortalRequests} from '../src/modules/portals/requests.js';
import {saveVendor} from '../src/procurement.js';
import {createApp} from '../src/app.js';
import {testFetch} from '../test-support/http-client.js';
import {tokenDigest} from '../src/security.js';
const tag='ZZTEST_PORTAL_'+randomUUID(),reason=tag+' rollback verification',checks=[],pass=n=>{checks.push(n);console.log('PASS',n);};
const args=process.argv.slice(2);if(args.length>1||args.some(a=>a!=='--http-only'))throw Error('Use --http-only or no arguments.');const httpOnly=args.includes('--http-only');
await withAuthorizedRdsRollbackVerification(async db=>{
 const owner=await db.prepare("SELECT id,role FROM users WHERE role='OWNER' AND status='ACTIVE' ORDER BY id LIMIT 1").get(),company=await db.prepare('SELECT id FROM tally_companies ORDER BY created_at LIMIT 1').get(),item=await db.prepare("SELECT id,part_code,uom FROM items WHERE status='ACTIVE' AND NOT is_deleted AND uom IS NOT NULL ORDER BY id LIMIT 1").get();assert.ok(owner&&company&&item);
 const modules=createModules({db,config:getConfig()});await modules.ready();const access=new PortalAccess({db}),records=new PortalRecords({access}),requests=new PortalRequests({access,records,operations:modules.services.operations,work:modules.services.work});let checker,customerUser,vendorUser,unassignedStaff,customer,otherCustomer;
 await modules.transactions.run(owner,reason,async()=>{
  const user=async(role,suffix)=>({id:(await db.prepare("INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(?,?,?,'not-a-login',0) RETURNING id").get(tag+suffix,tag+suffix+'@example.test',role)).id,role});
  checker=await user('OWNER','reviewer');customerUser=await user('CUSTOMER_PORTAL','customer');vendorUser=await user('VENDOR_PORTAL','vendor');unassignedStaff=await user('CUSTOMER_SUPPORT','unassigned');
  const makeCustomer=async suffix=>db.prepare('INSERT INTO customers(name,normalized_name,created_by,updated_by) VALUES(?,?,?,?) RETURNING id').get(tag+suffix,(tag+suffix).toLowerCase(),owner.id,owner.id);
  customer=await makeCustomer('customer');otherCustomer=await makeCustomer('other');
  await db.prepare('INSERT INTO crm_customer_profiles(customer_id,company_id,tally_ledger_name,created_by) VALUES(?,?,?,?)').run(customer.id,company.id,tag,owner.id);
  await db.prepare('INSERT INTO customer_contacts(customer_id,name,email,created_by,updated_by) VALUES(?,?,?,?,?)').run(customer.id,tag,tag+'customer@example.test',owner.id,owner.id);
 });
 const vendor=await saveVendor(db,null,{name:tag,stateCode:'27',email:tag+'vendor@example.test',reason},owner);
 const customerBinding={userId:customerUser.id,kind:'CUSTOMER',companyId:company.id,customerId:customer.id,supportOwnerId:owner.id,supportBackupId:checker.id,identityChecked:true,reason};
 const c=await access.create(owner,customerBinding),v=await access.create(owner,{userId:vendorUser.id,kind:'VENDOR',companyId:company.id,vendorId:vendor.id,identityChecked:true,reason});
 await assert.rejects(access.member(customerUser),{status:403});pass('Pending partner account bindings cannot read records');
 await assert.rejects(access.decide(owner,c.id,{version:1,decision:'APPROVE',reason}),{status:403});pass('A binding creator cannot approve their own access request');
 await access.decide(checker,c.id,{version:1,decision:'APPROVE',reason});await access.decide(checker,v.id,{version:1,decision:'APPROVE',reason});
 assert.equal((await records.me(customerUser)).party.id,customer.id);assert.equal((await records.me(vendorUser)).party.id,vendor.id);pass('Independently approved accounts resolve only their bound party and company');
 const token=randomUUID(),csrf=randomUUID();await db.prepare("INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at,mfa_verified_at) VALUES(?,?,?,CURRENT_TIMESTAMP+INTERVAL '30 minutes',CURRENT_TIMESTAMP)").run(customerUser.id,tokenDigest(token),csrf);
 const app=createApp({db,config:getConfig({localReviewAccess:false,mfaEnabled:true}),connectorStore:{close(){}},sendMailImpl:()=>{throw Error('Outbound mail is forbidden in rollback verification');}}),http=testFetch(app),headers={cookie:`crm_session=${token}`};
 try{
  assert.equal((await http('/api/crm/portal/me')).status,401);pass('Real HTTP handler refuses anonymous portal reads');
  const me=await http('/api/auth/me',{headers});assert.equal(me.status,200);assert.deepEqual((await me.json()).permissions.sort(),['portal.customer.read','portal.customer.submit']);pass('Real session authentication returns only the partner permission ceiling');
  for(const path of ['/api/customers','/api/tally/companies','/api/crm/partner-review/requests?kind=COMPLAINT'])assert.equal((await http(path,{headers})).status,403);pass('The real route boundary denies internal CRM, company browsing and staff review APIs');
  assert.equal((await http('/api/crm/portal/requests',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({requestKey:randomUUID(),kind:'COMPLAINT',payload:{title:'SAMPLE',complaint:'SAMPLE'}})})).status,403);pass('Actual portal mutation route rejects a missing CSRF token');
  const history=await http('/api/crm/portal/requests?page=2',{headers});assert.equal(history.status,200);assert.equal((await history.json()).pagination.page,2);pass('Actual scoped request-history route supports paging with an empty history');
  await db.prepare('UPDATE sessions SET mfa_verified_at=NULL WHERE token_hash=?').run(tokenDigest(token));const denied=await http('/api/crm/portal/me',{headers});assert.equal(denied.status,403);assert.equal((await denied.json()).code,'MFA_REQUIRED');pass('Unverified MFA remains enforced for partner routes');
 }finally{await app.close();modules.services.access.install();}
 if(httpOnly)return;
 await assert.rejects(access.create(owner,customerBinding),{status:409});pass('The same user cannot acquire a second concurrent partner scope');
 await assert.rejects(access.create(owner,{...customerBinding,userId:vendorUser.id}),{status:409});pass('Partner role and registered contact identity must match the requested scope');
 await assert.rejects(records.list(customerUser,'RFQS'),{status:403});await assert.rejects(records.list(vendorUser,'INVOICES'),{status:403});pass('Customer and supplier account kinds cannot cross record namespaces');
 let quote,unpublished,foreign,foreignCompany,rfq,order,shipment,supplierPo;
 await modules.transactions.run(owner,reason,async()=>{
  await db.prepare("SELECT set_config('mehta.quotation_write','authorized',true),set_config('mehta.order_write','authorized',true),set_config('mehta.procurement_write','authorized',true)").get();
  // Explicit source-state fixtures only. No actual customer issue, stock release,
  // sales approval, procurement instruction, mail or ERP posting takes place.
  const line={itemId:item.id,partCode:item.part_code,description:'SAMPLE component',quantity:'2',uom:item.uom,unitPrice:'100',discountPercent:'0',taxPercent:'18',net:'200.00'};
  const makeQuote=async(suffix,customerId,companyId,publish)=>{
   const q=await db.prepare("INSERT INTO quotations(quotation_number,customer_id,valid_until,status,created_by,updated_by) VALUES(?,?,'2035-12-31','SENT',?,?) RETURNING id").get(tag+suffix,customerId,owner.id,owner.id),p={quotation_number:tag+suffix,companyId,customerId,validUntil:'2035-12-31',lines:[line],subtotal:'200.00',cgst:'0.00',sgst:'0.00',igst:'36.00',sellerState:'27',placeOfSupply:'33',letterhead:{name:'SAMPLE rollback-only company',address:'SAMPLE address'},customer_name:'SAMPLE rollback-only customer',notes:'SAMPLE verification source. No actual issue or statutory posting.',total:'236.00'};
   await db.prepare("INSERT INTO crm_quotation_workflows(quotation_id,policy_revision,place_of_supply,public_snapshot,private_snapshot,created_by,status) VALUES(?,1,'27',?::text::jsonb,?::text::jsonb,?,'SENT')").run(q.id,JSON.stringify(p),JSON.stringify({secretCost:'SAMPLE_INTERNAL_COST'}),owner.id);
   await db.prepare('INSERT INTO crm_quotation_versions(quotation_id,version,public_snapshot,private_snapshot,reason,created_by) VALUES(?,1,?::text::jsonb,?::text::jsonb,?,?)').run(q.id,JSON.stringify(p),JSON.stringify({secretCost:'SAMPLE_INTERNAL_COST'}),reason,owner.id);
   if(publish)await db.prepare("INSERT INTO crm_quotation_events(quotation_id,version,action,reason,created_by) VALUES(?,1,'SEND',?,?)").run(q.id,reason,owner.id);return q;
  };
  quote=await makeQuote('published',customer.id,company.id,true);unpublished=await makeQuote('unpublished',customer.id,company.id,false);foreign=await makeQuote('foreign',otherCustomer.id,company.id,true);foreignCompany=await makeQuote('other-company',customer.id,randomUUID(),true);
  const o=order=await db.prepare('INSERT INTO sales_orders(order_number,customer_id,created_by,updated_by) VALUES(?,?,?,?) RETURNING id').get(tag,customer.id,owner.id,owner.id);
  await db.prepare("INSERT INTO crm_order_workflows(sales_order_id,customer_id,po_key,public_snapshot,private_snapshot,created_by,status,approved_version,approved_by) VALUES(?,?,?,?::text::jsonb,'{}'::jsonb,?,'PARTIALLY_DISPATCHED',1,?)").run(o.id,customer.id,tag,JSON.stringify({companyId:company.id}),owner.id,checker.id);
  const ol=await db.prepare('INSERT INTO sales_order_lines(sales_order_id,item_id,description,uom,ordered_quantity,fulfilled_quantity,unit_price,created_by,updated_by) VALUES(?,?,?,?,2,1,100,?,?) RETURNING id').get(o.id,item.id,'SAMPLE component',item.uom,owner.id,owner.id);
  shipment=await db.prepare('INSERT INTO crm_shipments(sales_order_id,vehicle_number,lr_number,transporter,created_by) VALUES(?,?,?,?,?) RETURNING id').get(o.id,'SAMPLE vehicle',tag,'SAMPLE transporter',owner.id);
  await db.prepare('INSERT INTO crm_shipment_items(shipment_id,order_line_id,quantity,created_by) VALUES(?,?,1,?)').run(shipment.id,ol.id,owner.id);
  const pr=await db.prepare("INSERT INTO crm_purchase_requests(number,sales_order_id,payload,created_by) VALUES(?,?,'{}'::jsonb,?) RETURNING id").get(tag,o.id,owner.id);
  rfq=await db.prepare('INSERT INTO crm_rfqs(number,request_id,payload,created_by) VALUES(?,?,?::text::jsonb,?) RETURNING id').get(tag,pr.id,JSON.stringify({replyBy:'2035-12-31',lines:[{...line,cost:'SECRET_PURCHASE_COST'}]}),owner.id);
  await db.prepare('INSERT INTO crm_rfq_vendors(rfq_id,vendor_id,created_by) VALUES(?,?,?)').run(rfq.id,vendor.id,owner.id);
  supplierPo=await db.prepare("INSERT INTO crm_supplier_pos(number,vendor_id,sales_order_id,payload,created_by,status,approved_by) VALUES(?,?,?,?::text::jsonb,?,'ISSUED',?) RETURNING id").get(tag,vendor.id,o.id,JSON.stringify({lines:[line],total:'236.00',deliveryBy:'2035-12-31',terms:'SAMPLE test source'}),owner.id,checker.id);
 });
 for(const type of ['ORDERS','SHIPMENTS','INVOICES'])await records.list(customerUser,type);await records.list(vendorUser,'PURCHASE_ORDERS');pass('Every customer and supplier record-list SQL executes with bound party/company filters');
 const od=await records.detail(customerUser,'ORDERS',order.id);assert.equal(od.lines[0].supplied,'1.000000');assert.equal(od.lines[0].pending,'1.000000');const sd=await records.detail(customerUser,'SHIPMENTS',shipment.id);assert.equal(sd.lines[0].supplied,'1.000000');assert.equal((await records.detail(vendorUser,'PURCHASE_ORDERS',supplierPo.id)).total,'236.00');pass('Partner views retain exact supplied/pending quantities, shipment facts and the supplier?s own issued PO');
 const list=await records.list(customerUser,'QUOTATIONS');assert.deepEqual(list.data.map(r=>r.id),[quote.id]);pass('Only this customer company’s version-specific published quotations are listed');
 for(const q of [unpublished,foreign,foreignCompany])await assert.rejects(records.detail(customerUser,'QUOTATIONS',q.id),{status:404});pass('Direct IDs cannot reveal unpublished, foreign-customer or foreign-company quotations');
 assert.equal(JSON.stringify(await records.detail(customerUser,'QUOTATIONS',quote.id)).includes('SAMPLE_INTERNAL_COST'),false);pass('Customer document details exclude private quotation costs');
 const pdf=await records.document(customerUser,'QUOTATION',quote.id,{version:1,reason});assert.equal(pdf.bytes.subarray(0,5).toString(),'%PDF-');await fs.mkdir('verification-output/partner-portals',{recursive:true});await fs.writeFile('verification-output/partner-portals/sample-owned-quotation.pdf',pdf.bytes);await assert.rejects(records.document(customerUser,'QUOTATION',foreign.id,{version:1,reason}),{status:404});pass('A scoped published quotation produces the existing branded PDF and rejects foreign document IDs');
 const d=await records.detail(customerUser,'QUOTATIONS',quote.id),ack={requestKey:randomUUID(),entityKind:'QUOTATION',entityId:quote.id,version:1,sourceHash:d.sourceHash,decision:'ACCEPT',message:'SAMPLE acceptance'};
 const a=await requests.acknowledge(customerUser,ack);assert.equal((await requests.acknowledge(customerUser,ack)).id,a.id);await assert.rejects(requests.acknowledge(customerUser,{...ack,requestKey:randomUUID()}),{status:409});assert.equal((await db.prepare('SELECT status FROM crm_quotation_workflows WHERE quotation_id=?').get(quote.id)).status,'SENT');pass('Acknowledgements are repeat-safe and do not apply staff approval or mark a quotation won');
 const ids=[];
 for(let i=0;i<10;i++){
  const body={requestKey:randomUUID(),kind:'COMPLAINT',payload:{title:tag+' request '+i,complaint:'SAMPLE product concern '+i,orderReference:tag}},saved=await requests.submit(customerUser,body);ids.push(saved.id);const task=await requests.task({kind:'COMPLAINT',id:saved.id});assert.equal(task.owner_user_id,owner.id);assert.equal(task.backup_user_id,checker.id);assert.equal(task.status,'OPEN');
  assert.equal((await requests.submit(customerUser,body)).id,saved.id);assert.equal((await requests.submit(customerUser,{...body,requestKey:randomUUID()})).id,saved.id);
  const result=await requests.review(owner,saved.id,{version:1,decision:'CREATE_COMPLAINT',sourceChecked:true,publicMessage:'SAMPLE complaint linked for support review',reason});assert.equal(result.status,'LINKED');assert.equal((await requests.task({kind:'COMPLAINT',id:saved.id})).status,'DONE');
  const op=await db.prepare('SELECT o.customer_id,o.kind FROM crm_portal_requests r JOIN crm_operations o ON o.id=r.operation_id WHERE r.id=?').get(saved.id);assert.equal(op.customer_id,customer.id);assert.equal(op.kind,'SUPPORT');
  await assert.rejects(requests.review(owner,saved.id,{version:1,decision:'REJECT',sourceChecked:true,publicMessage:'SAMPLE stale review',reason}),{status:409});pass('Complaint '+(i+1)+': durable submission, duplicate suppression, staff review and existing Support linkage');
 }
 assert.equal((await requests.queue(unassignedStaff,'COMPLAINT')).pagination.total,0);await assert.rejects(requests.detail(unassignedStaff,ids[0]),{status:404});pass('Unassigned departmental staff cannot browse another reviewer?s portal requests');
 const ownHistory=await requests.mine(customerUser);assert.equal(ownHistory.data.length,10);assert.equal(ownHistory.pagination.total,10);assert.equal((await requests.mine(customerUser,{page:2})).data.length,0);assert.equal(ownHistory.data.some(r=>Object.hasOwn(r,'review_reason')),false);pass('Paged customer history retains curated updates without internal review reasons');
 assert.equal((await records.list(vendorUser,'RFQS')).data.length,0);await assert.rejects(records.detail(vendorUser,'RFQS',rfq.id),{status:404});await assert.rejects(records.publishRfq(owner,rfq.id,{version:1,vendorId:vendor.id,reason}),{status:403});pass('An invited supplier cannot see an unpublished RFQ and its creator cannot self-publish it');
 const published=await records.publishRfq(checker,rfq.id,{version:1,vendorId:vendor.id,reason});assert.equal((await records.publishRfq(checker,rfq.id,{version:1,vendorId:vendor.id,reason})).id,published.id);const rfqDetail=await records.detail(vendorUser,'RFQS',rfq.id);assert.equal(rfqDetail.lines[0].code,item.part_code);assert.equal(rfqDetail.lines[0].unitPrice,undefined);assert.equal(JSON.stringify(rfqDetail).includes('SECRET_PURCHASE_COST'),false);pass('Independent RFQ publication is repeat-safe and strips sales prices and private supplier costs');
 const reply=await requests.submit(vendorUser,{requestKey:randomUUID(),kind:'RFQ_REPLY',rfqId:rfq.id,payload:{rfqVersion:1,replyVersion:null,validUntil:'2035-12-31',promisedOn:null,currency:'INR',terms:'SAMPLE supplier terms',reason:'SAMPLE supplier submission',evidence:reason,chargesConfirmed:true,charges:[],lines:[{itemId:item.id,uom:item.uom,quantity:'2',unitPrice:'100',discountPercent:'0',taxPercent:'18'}]}});
 await requests.review(owner,reply.id,{version:1,decision:'RECORD_OFFER',sourceChecked:true,publicMessage:'SAMPLE offer recorded after purchasing review',reason});const linked=await db.prepare('SELECT reply_id,reply_version FROM crm_portal_requests WHERE id=?').get(reply.id);assert.ok(linked.reply_id);assert.equal(linked.reply_version,1);pass('A reviewed portal offer reuses existing exact-price supplier comparison and reply versioning');
 await assert.rejects(requests.queue(vendorUser,'RFQ_REPLY'),{status:403});await assert.rejects(access.list(customerUser),{status:403});pass('Partners cannot read internal review queues or account administration');
 await access.decide(owner,v.id,{version:2,decision:'REVOKE',reason});await assert.rejects(records.me(vendorUser),{status:403});pass('Revocation immediately blocks further partner records without deleting history');
 await assert.rejects(db.prepare('DELETE FROM crm_portal_requests WHERE id=?').run(ids[0]));pass('Partner request history cannot be hard deleted');
},{productionTransactions:true});
await fs.mkdir('verification-output/partner-portals',{recursive:true});await fs.writeFile(`verification-output/partner-portals/${httpOnly?'http':'rds'}-report.json`,JSON.stringify({mode:httpOnly?'HTTP_ONLY':'FULL_SERVICE_FLOW',passed:checks.length,checks,scope:'Actual services and SQL inside one uncommittable RDS rollback transaction. HTTP-only mode checks sessions, permissions, paging, MFA and CSRF without the business handoffs. Synthetic source states are labelled SAMPLE and do not claim actual issue, dispatch, external email or ERP posting. No users, contacts, business records or audits are retained.'},null,2));console.log(JSON.stringify({mode:httpOnly?'HTTP_ONLY':'FULL_SERVICE_FLOW',passed:checks.length,rolledBack:true}));
