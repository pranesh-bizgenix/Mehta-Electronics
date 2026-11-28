import {s,validate} from '../../core/schema.js';
import {fingerprint} from '../../core/runtime.js';
import {hasPermission} from '../../rbac.js';
import {forbidden,conflict,notFound,validationFailed} from '../../core/errors.js';
import {supplierOfferSchema,SourcingService} from '../sourcing/service.js';
import {NotificationService,NotificationRepository} from '../notifications/notification-service.js';

const complaintSchema=s.object({title:s.string({min:3,max:200}),complaint:s.text({min:3,max:10000}),orderReference:s.string({max:200}).default('')});
const keySchema=s.object({requestKey:s.uuid(),kind:s.enum(['COMPLAINT','RFQ_REPLY']),rfqId:s.id().optional(),payload:s.json()});
export class PortalRequests{
 constructor({access,records,operations,work}){this.access=access;this.records=records;this.operations=operations;this.work=work;this.db=access.db;this.sourcing=new SourcingService({db:this.db});this.notifications=new NotificationService({repository:new NotificationRepository(this.db)});}
 one(sql,...args){return this.db.prepare(sql).get(...args);}all(sql,...args){return this.db.prepare(sql).all(...args);}
 staff(actor,kind,write=false){if(!hasPermission(actor,`${kind==='COMPLAINT'?'operations':'purchasing'}.${write?'write':'read'}`))throw forbidden();}
 workKind(kind){return kind==='COMPLAINT'?'PORTAL_COMPLAINT':'PORTAL_RFQ_REPLY';}
 async task(row,{lock=false}={}){return this.one('SELECT w.*,o.name AS owner_name,b.name AS backup_name FROM work_items w LEFT JOIN users o ON o.id=w.owner_user_id LEFT JOIN users b ON b.id=w.backup_user_id WHERE w.entity_type=? AND w.entity_id=? AND NOT w.is_deleted'+(lock?' FOR UPDATE OF w':''),this.workKind(row.kind),row.id);}
 canReview(actor,task){return hasPermission(actor,'work.reassign')||Boolean(task&&[task.owner_user_id,task.backup_user_id].includes(actor.id));}
 async registerWork(actor,row,member){
  let ids;
  if(row.kind==='COMPLAINT')ids=[member.support_owner_id,member.support_backup_id];
  else{const source=await this.one('SELECT r.created_by AS maker,p.created_by AS publisher FROM crm_portal_rfq_publications p JOIN crm_rfqs r ON r.id=p.rfq_id WHERE p.rfq_id=? AND p.vendor_id=? AND p.rfq_version=? AND p.company_id=?',row.rfq_id,member.vendor_id,row.payload.rfqVersion,member.company_id);ids=[source?.maker,source?.publisher];}
  const staff=await this.all("SELECT id,role FROM users WHERE id=ANY(?::integer[]) AND status='ACTIVE' AND NOT on_leave",ids.filter(Boolean)),permission=row.kind==='COMPLAINT'?'operations.write':'purchasing.write';
  const eligible=ids.filter((id,index)=>id&&ids.indexOf(id)===index&&staff.some(u=>u.id===id&&hasPermission(u,permission)&&hasPermission(u,row.kind==='COMPLAINT'?'operations.read':'purchasing.read')&&hasPermission(u,'work.read')));
  const item=await this.work.open(actor,{entityType:this.workKind(row.kind),entityId:row.id,title:`${row.kind==='COMPLAINT'?'Portal support':'Supplier offer'} | ${member.party.name} | ${row.id.slice(0,8)}`.slice(0,200),department:row.kind==='COMPLAINT'?'CUSTOMER_SUPPORT':'OPERATIONS',ownerUserId:eligible[0]??null,backupUserId:eligible[1]??null,assignmentReason:eligible.length===2?'Partner request routed to source owner and independent backup':'Partner request retained; staff routing requires review',startedAt:row.created_at});
  return {item,recipients:eligible};
 }
 publicRequest(r){return {id:r.id,kind:r.kind,status:r.status,version:r.version,rfqId:r.rfq_id,submitted:r.payload,publicMessage:r.public_message,createdAt:r.created_at,updatedAt:r.updated_at};}
 async mine(actor,query={}){const m=await this.access.member(actor),page=validate(s.int({min:1,max:100000}),query.page??1),total=(await this.one('SELECT count(*)::integer AS n FROM crm_portal_requests WHERE membership_id=?',m.id)).n;return {data:(await this.all('SELECT * FROM crm_portal_requests WHERE membership_id=? ORDER BY created_at DESC,id LIMIT 25 OFFSET ?',m.id,(page-1)*25)).map(r=>this.publicRequest(r)),pagination:{page,pageSize:25,total,pages:Math.ceil(total/25)}};}
 async submit(actor,body){const b=validate(keySchema,body);return this.access.write(actor,'Partner request submitted for staff review',async()=>{
  const m=await this.access.member(actor,{write:true,lock:true});
  if(b.kind!==(m.kind==='CUSTOMER'?'COMPLAINT':'RFQ_REPLY')||b.kind==='COMPLAINT'&&b.rfqId)throw forbidden('Choose a request appropriate to this partner account.');
  let payload;
  if(b.kind==='COMPLAINT'){payload=validate(complaintSchema,b.payload);if(payload.complaint.length<3)throw validationFailed('Describe the complaint in at least three characters.');}
  else{
   if(!b.rfqId)throw validationFailed('Choose a published RFQ.');
   // The server forces the bound supplier, never a submitted customer/vendor ID.
   payload=validate(supplierOfferSchema,{...b.payload,vendorId:m.vendor_id});
  }
  const hash=fingerprint({member:m.id,kind:b.kind,rfqId:b.rfqId??null,payload});
  await this.one('SELECT pg_advisory_xact_lock(hashtextextended(?,0))',b.requestKey);
  const previous=await this.one('SELECT * FROM crm_portal_requests WHERE request_key=?',b.requestKey);
  if(previous){if(previous.membership_id!==m.id||previous.request_hash!==hash)throw conflict('This submission key already belongs to different content.');return {...this.publicRequest(previous),duplicate:true};}
  await this.one('SELECT pg_advisory_xact_lock(hashtextextended(?,1))',m.id+':'+hash);
  const duplicate=await this.one('SELECT * FROM crm_portal_requests WHERE membership_id=? AND request_hash=?',m.id,hash);if(duplicate)return {...this.publicRequest(duplicate),duplicate:true};
  if(b.kind==='RFQ_REPLY'){
   const {row:r}=await this.records.source(actor,'RFQS',b.rfqId,{version:payload.rfqVersion,lock:true});
   if(r.version!==r.current_version||r.status!=='OPEN')throw conflict('This RFQ is no longer open at that version.');
   this.sourcing.date(payload.validUntil);if(payload.validUntil<this.sourcing.today())throw validationFailed('Offer validity must not be in the past.');if(payload.promisedOn)this.sourcing.date(payload.promisedOn);
   const wanted=new Set(r.payload.lines.map(l=>l.itemId));if(new Set(payload.lines.map(l=>l.itemId)).size!==payload.lines.length||payload.lines.some(l=>!wanted.has(l.itemId)))throw validationFailed('Offer each published item at most once.');
  }
  const saved=await this.one('INSERT INTO crm_portal_requests(membership_id,request_key,request_hash,kind,rfq_id,payload,created_by,updated_by) VALUES(?,?,?,?,?,?::text::jsonb,?,?) RETURNING *',m.id,b.requestKey,hash,b.kind,b.rfqId??null,JSON.stringify(payload),actor.id,actor.id);
  await this.access.audit.record({actorId:actor.id,entity:'PORTAL_REQUEST',recordId:saved.id,action:'SUBMIT',reason:'Partner request submitted for staff review',newValue:{kind:b.kind,membershipId:m.id}});
  const {recipients}=await this.registerWork(actor,saved,m);
  if(!recipients.length)recipients.push(...(await this.all("SELECT id FROM users WHERE role='OWNER' AND status='ACTIVE' AND NOT on_leave")).map(u=>u.id));
  for(const id of new Set(recipients)){const u=await this.one("SELECT id,role FROM users WHERE id=? AND status='ACTIVE'",id);if(u&&hasPermission(u,b.kind==='COMPLAINT'?'operations.read':'purchasing.read'))await this.notifications.notify(id,{type:'PORTAL_REQUEST',title:b.kind==='COMPLAINT'?'New customer support request':'New supplier offer for review',message:'Open the partner request review queue. No business approval has been applied.',entityType:b.kind==='COMPLAINT'?'CUSTOMER_PORTAL_REQUEST':'SUPPLIER_PORTAL_REQUEST',entityId:saved.id},`portal:${saved.id}:${id}`);}
  return {...this.publicRequest(saved),duplicate:false};
 });}
 async queue(actor,kind,query={}){
  validate(s.enum(['COMPLAINT','RFQ_REPLY']),kind);this.staff(actor,kind);const page=validate(s.int({min:1,max:100000}),query.page??1);
  const from="FROM crm_portal_requests r JOIN crm_portal_memberships m ON m.id=r.membership_id LEFT JOIN work_items w ON w.entity_type=CASE WHEN r.kind='COMPLAINT' THEN 'PORTAL_COMPLAINT' ELSE 'PORTAL_RFQ_REPLY' END AND w.entity_id=r.id::text AND NOT w.is_deleted";
  const where='WHERE r.kind=? AND (?::boolean OR w.owner_user_id=? OR w.backup_user_id=?)',args=[kind,hasPermission(actor,'work.reassign'),actor.id,actor.id];
  const total=(await this.one('SELECT count(*)::integer AS n '+from+' '+where,...args)).n;
  const data=await this.all("SELECT r.id,r.kind,r.status,r.version,r.rfq_id,r.created_at,r.public_message,m.customer_id,m.vendor_id,m.company_id,c.name AS customer_name,v.payload->>'name' AS vendor_name,u.name AS submitted_by,o.name AS owner_name,b.name AS backup_name,w.due_at,w.sla_state "+from+' JOIN users u ON u.id=r.created_by LEFT JOIN customers c ON c.id=m.customer_id LEFT JOIN crm_procurement_vendors v ON v.id=m.vendor_id LEFT JOIN users o ON o.id=w.owner_user_id LEFT JOIN users b ON b.id=w.backup_user_id '+where+' ORDER BY r.created_at DESC,r.id LIMIT 25 OFFSET ?',...args,(page-1)*25);
  return {pagination:{page,pageSize:25,total,pages:Math.ceil(total/25)},data};
 }
 async detail(actor,id){const r=await this.one('SELECT r.*,m.customer_id,m.vendor_id,m.company_id,m.support_owner_id,m.support_backup_id FROM crm_portal_requests r JOIN crm_portal_memberships m ON m.id=r.membership_id WHERE r.id=?',validate(s.uuid(),id));if(!r)throw notFound();this.staff(actor,r.kind);const task=await this.task(r);if(!this.canReview(actor,task))throw notFound('Assigned partner request not found.');return {...r,can_review:this.canReview(actor,task),work:task?{id:task.id,ownerId:task.owner_user_id,backupId:task.backup_user_id,ownerName:task.owner_name,backupName:task.backup_name,dueAt:task.due_at,slaState:task.sla_state}:null};}
 async review(actor,id,body){const b=validate(s.object({version:s.int({min:1}),decision:s.enum(['CREATE_COMPLAINT','LINK_COMPLAINT','RECORD_OFFER','REJECT']),operationId:s.uuid().optional(),sourceChecked:s.bool(),publicMessage:s.string({min:3,max:2000}),reason:s.reason()}),body);if(!b.sourceChecked)throw validationFailed('Review the original request and linked record before continuing.');
  return this.access.write(actor,b.reason,async()=>{
   const r=await this.one('SELECT r.*,m.customer_id,m.vendor_id,m.company_id,m.support_owner_id,m.support_backup_id FROM crm_portal_requests r JOIN crm_portal_memberships m ON m.id=r.membership_id WHERE r.id=? FOR UPDATE OF r',validate(s.uuid(),id));if(!r)throw notFound();this.staff(actor,r.kind);this.staff(actor,r.kind,true);
   if(r.created_by===actor.id)throw forbidden('Partner requests require a different staff reviewer.');
   const reviewTask=await this.task(r,{lock:true});if(!this.canReview(actor,reviewTask))throw forbidden('Only the assigned reviewer, backup or an authorised manager may resolve this partner request.');
   if(r.status!=='PENDING_REVIEW'||r.version!==b.version)throw conflict('This request changed. Reload before reviewing.');
   let operationId=null,replyId=null,replyVersion=null;
   if(b.decision!=='REJECT'){
    if(r.kind==='COMPLAINT'){
     if(b.decision==='CREATE_COMPLAINT'){
      if(b.operationId)throw validationFailed('Choose create or link, not both.');
      const ownerId=reviewTask?.owner_user_id??r.support_owner_id,backupId=reviewTask?.backup_user_id??r.support_backup_id;
      const staff=await this.all("SELECT id,role FROM users WHERE id=ANY(?::integer[]) AND status='ACTIVE' AND NOT on_leave",[ownerId,backupId]);
      if(staff.length!==2||staff.some(u=>!hasPermission(u,'operations.write')||!hasPermission(u,'operations.read')||!hasPermission(u,'work.read')))throw conflict('The bound Support assignment changed. Create a complaint with current authorised owners in Support, then link it here.');
      const created=await this.operations.create(actor,'SUPPORT',{title:r.payload.title,customerId:r.customer_id,ownerId,backupId,payload:{complaint:r.payload.complaint,...(r.payload.orderReference?{orderReference:r.payload.orderReference}:{})},reason:b.reason});operationId=created.record.id;
     }else if(b.decision==='LINK_COMPLAINT'){
      const op=await this.one("SELECT id FROM crm_operations WHERE id=? AND customer_id=? AND kind='SUPPORT' AND status NOT IN ('RESOLVED','CANCELLED') FOR SHARE",b.operationId??null,r.customer_id);if(!op)throw validationFailed('Choose an open complaint for this exact customer.');operationId=op.id;
     }else throw validationFailed('Choose create, link or reject for a complaint.');
    }else{
     if(b.decision!=='RECORD_OFFER'||b.operationId)throw validationFailed('Choose record offer or reject for a supplier reply.');
     const source=await this.one("SELECT pub.id FROM crm_portal_rfq_publications pub JOIN crm_rfqs f ON f.id=pub.rfq_id JOIN crm_rfq_vendors v ON v.rfq_id=f.id AND v.vendor_id=pub.vendor_id WHERE pub.rfq_id=? AND pub.vendor_id=? AND pub.company_id=? AND pub.rfq_version=? AND f.version=pub.rfq_version AND f.status='OPEN' AND NOT f.is_deleted AND NOT v.is_deleted AND v.status IN ('INVITED','REPLIED') FOR SHARE OF pub,f,v",r.rfq_id,r.vendor_id,r.company_id,r.payload.rfqVersion);if(!source)throw conflict('The published invitation changed. Review a new supplier submission.');
     const saved=await this.sourcing.recordOffer(actor,r.rfq_id,{...r.payload,vendorId:r.vendor_id,reason:b.reason,evidence:`Partner submission ${r.id}; independently reviewed`});replyId=saved.id;replyVersion=saved.version;
    }
   }
   const status=b.decision==='REJECT'?'REJECTED':'LINKED';
   await this.db.prepare('UPDATE crm_portal_requests SET status=?,operation_id=?,reply_id=?,reply_version=?,public_message=?,review_reason=?,version=version+1,updated_by=? WHERE id=?').run(status,operationId,replyId,replyVersion,b.publicMessage,b.reason,actor.id,r.id);
   await this.work.closeForEntity(actor,this.workKind(r.kind),r.id,'DONE',b.reason);
   await this.access.audit.record({actorId:actor.id,entity:'PORTAL_REQUEST',recordId:r.id,action:b.decision,reason:b.reason,newValue:{status,operationId,replyId,replyVersion}});return {id:r.id,status,version:r.version+1};
  },{review:true});
 }
 async acknowledgements(actor,query={}){const m=await this.access.member(actor),page=validate(s.int({min:1,max:100000}),query.page??1),total=(await this.one('SELECT count(*)::integer AS n FROM crm_portal_acknowledgements WHERE membership_id=?',m.id)).n;return {pagination:{page,pageSize:25,total,pages:Math.ceil(total/25)},data:await this.all('SELECT id,entity_kind,entity_id,entity_version,decision,message,created_at FROM crm_portal_acknowledgements WHERE membership_id=? ORDER BY created_at DESC,id LIMIT 25 OFFSET ?',m.id,(page-1)*25)};}
 async staffAcknowledgements(actor,query={}){
  const kinds=[...(hasPermission(actor,'quotations.read')?['QUOTATION']:[]),...(hasPermission(actor,'orders.read')?['ORDER']:[])];if(!kinds.length)throw forbidden();
  const page=validate(s.int({min:1,max:100000}),query.page??1),from="FROM crm_portal_acknowledgements a JOIN crm_portal_memberships m ON m.id=a.membership_id JOIN customers c ON c.id=m.customer_id WHERE a.entity_kind=ANY(?::text[]) AND (?::text<>'EXECUTIVE' OR c.owner_id IS NULL OR c.owner_id=?)",args=[kinds,actor.role,actor.id],total=(await this.one('SELECT count(*)::integer AS n '+from,...args)).n;
  return {pagination:{page,pageSize:25,total,pages:Math.ceil(total/25)},data:await this.all('SELECT a.id,a.entity_kind,a.entity_id,a.entity_version,a.decision,a.message,a.created_at,m.customer_id,c.name AS customer_name '+from+' ORDER BY a.created_at DESC,a.id LIMIT 25 OFFSET ?',...args,(page-1)*25)};
 }
 async acknowledge(actor,body){const b=validate(s.object({requestKey:s.uuid(),entityKind:s.enum(['QUOTATION','ORDER']),entityId:s.id(),version:s.int({min:1}),sourceHash:s.string({pattern:/^[0-9a-f]{64}$/}),decision:s.enum(['ACCEPT','CHANGE_REQUEST']),message:s.string({max:2000}).default('')}),body);if(b.decision==='CHANGE_REQUEST'&&b.message.trim().length<3)throw validationFailed('Describe the requested change.');
  return this.access.write(actor,'Customer acknowledgement recorded',async()=>{
   const m=await this.access.member(actor,{write:true,lock:true});if(m.kind!=='CUSTOMER')throw forbidden();const hash=fingerprint({membership:m.id,...b});
   await this.one('SELECT pg_advisory_xact_lock(hashtextextended(?,0))',b.requestKey);const old=await this.one('SELECT * FROM crm_portal_acknowledgements WHERE request_key=?',b.requestKey);if(old){if(old.membership_id!==m.id||old.request_hash!==hash)throw conflict('This acknowledgement key has different content.');return {id:old.id,duplicate:true};}
   const type=b.entityKind==='QUOTATION'?'QUOTATIONS':'ORDERS';await this.records.source(actor,type,b.entityId,{version:b.version,lock:true});const detail=await this.records.detail(actor,type,b.entityId,{version:b.version});if(!detail.canAcknowledge||detail.version!==b.version||detail.sourceHash!==b.sourceHash)throw conflict('The published record changed or is not available for acknowledgement. Reload.');
   await this.one('SELECT pg_advisory_xact_lock(812742,?)',b.entityId);if(await this.one('SELECT id FROM crm_portal_acknowledgements WHERE membership_id=? AND entity_kind=? AND entity_id=? AND entity_version=?',m.id,b.entityKind,b.entityId,b.version))throw conflict('An acknowledgement is already recorded for this version. Contact staff for further changes.');
   const saved=await this.one('INSERT INTO crm_portal_acknowledgements(membership_id,request_key,request_hash,entity_kind,entity_id,entity_version,source_hash,decision,message,created_by) VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING id',m.id,b.requestKey,hash,b.entityKind,b.entityId,b.version,b.sourceHash,b.decision,b.message,actor.id);await this.access.audit.record({actorId:actor.id,entity:'PORTAL_ACKNOWLEDGEMENT',recordId:saved.id,action:b.decision,reason:'Customer acknowledgement recorded',newValue:{entityKind:b.entityKind,entityId:b.entityId,version:b.version}});const source=await this.one(b.entityKind==='QUOTATION'?'SELECT created_by FROM crm_quotation_workflows WHERE quotation_id=?':'SELECT created_by FROM crm_order_workflows WHERE sales_order_id=?',b.entityId),customer=await this.one('SELECT owner_id FROM customers WHERE id=?',m.customer_id);
   for(const staffId of new Set([source?.created_by,customer?.owner_id].filter(Boolean))){const u=await this.one("SELECT id,role FROM users WHERE id=? AND status='ACTIVE'",staffId);if(u&&hasPermission(u,b.entityKind==='QUOTATION'?'quotations.read':'orders.read'))await this.notifications.notify(staffId,{type:'PORTAL_ACKNOWLEDGEMENT',title:'Customer document response received',message:'Review the customer response in partner request history. Existing approval and fulfilment checks still apply.',entityType:'CUSTOMER_PORTAL_RESPONSE',entityId:saved.id},`portal-ack:${saved.id}:${staffId}`);}
   return {...saved,note:'Acknowledgement recorded. Existing staff approval, credit, stock and invoice controls still apply.'};
  });
 }
}
