import {normalizeIntake,missingBusinessFields} from './contract.js';
import {validateSalesIntakePolicy,tierResult,quotationValidityDate} from './policy.js';
import {salesWork,intakeEvent,notifySales,permission,uuid,why} from './shared.js';
import {conflict,forbidden,notFound,validationFailed} from '../../core/errors.js';
import {hasPermission} from '../../rbac.js';
import {createEnquiry} from '../../enquiry-service.js';
import {saveQuote,quotePolicy,previewQuoteDraft,requireQuotationApproval,quoteAction} from '../../quotation-workflow.js';
import {canonicalParty,canonicalPart} from '../../sales-orders.js';
import {calculateQuotation} from '../../../public/quotation-math.js';
import {compare,decimal,mul,div,format} from '../../../public/money.js';
import {requestAvailability} from './availability.js';
import {quotationDiscount} from './discount.js';
import {requireCustomerHandler} from '../operations/customer-gates.js';
import {changeEnquiryStatus} from '../../crm-modules.js';
import {validateReviewCommand,mergeReviewResolutions} from './review.js';

const json=JSON.stringify;
const preparedData=row=>{
 const n=row.normalized,r=row.resolutions;
 return normalizeIntake({schemaVersion:n.schemaVersion,eventId:n.eventId,companyId:n.companyId,messageType:n.messageType,source:n.source,provenance:n.provenance,header:{...n.header,...r.header},items:r.items??n.items,reviewIssues:n.reviewIssues});
};
export class SalesIntakeService{
 constructor({db,work,clock}){this.db=db;this.work=work;this.clock=clock??{now:()=>new Date()};}
 one(sql,...v){return this.db.prepare(sql).get(...v);}
 many(sql,...v){return this.db.prepare(sql).all(...v);}
 async policy(companyId){return await this.one('SELECT * FROM crm_sales_intake_policies WHERE company_id=?',uuid(companyId))??{company_id:companyId,version:0,value:{}};}
 async settings(user,companyId){permission(user,'rules.manage');return {...await this.policy(companyId),history:await this.many('SELECT version,value,created_by,reason,created_at FROM crm_sales_intake_policy_versions WHERE company_id=? ORDER BY version DESC LIMIT 50',uuid(companyId))};}
 async metrics(user,companyId){
  permission(user,'sales_intake.read');const policy=await this.policy(uuid(companyId)),k=policy.value.kpi;
  if(!k)return {state:'NOT_CONFIGURED',score:null};
  const owner=user.role==='OWNER'||hasPermission(user,'work.reassign')?null:user.id;
  const rows=await this.many("SELECT i.id,i.first_response_at,i.response_policy,w.due_at FROM crm_sales_intakes i LEFT JOIN work_items w ON w.entity_type='SALES_INTAKE' AND w.entity_id=i.id::text WHERE i.company_id=? AND (?::integer IS NULL OR (CASE WHEN i.response_policy->'value'->>'reassignmentAttribution'='FIRST_ASSIGNEE' THEN (i.response_policy->>'firstAssigneeId')::integer ELSE coalesce((i.response_policy->>'firstResponderId')::integer,i.assigned_to) END)=?) AND i.first_assigned_at>=(?::date::timestamp AT TIME ZONE 'Asia/Kolkata') AND i.first_assigned_at<((?::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata') AND (?::boolean IS NOT TRUE OR i.status<>'CANCELLED')",companyId,owner,owner,k.periodFrom,k.periodTo,k.excludeCancelled);
  const eligible=rows.filter(r=>r.response_policy?.version===policy.version&&(k.denominator==='ASSIGNED'||r.first_response_at));
  if(eligible.some(r=>!r.due_at))return {state:'SLA_NOT_CONFIGURED',score:null,policyVersion:policy.version,denominator:eligible.length};
  const numerator=eligible.filter(r=>r.first_response_at&&new Date(r.first_response_at)<=new Date(r.due_at)).length;
  return {state:eligible.length?'CONFIGURED':'NO_QUALIFYING_RECORDS',score:eligible.length?format(mul(div(decimal(String(numerator)),decimal(String(eligible.length))),decimal(k.weight)),6):null,numerator,denominator:eligible.length,policyVersion:policy.version,definition:k,recordIds:eligible.map(r=>r.id)};
 }
 async savePolicy(user,companyId,b){
  permission(user,'rules.manage');if(user.role!=='OWNER')throw forbidden('Only Owner may configure sales intake.');
  const value=validateSalesIntakePolicy(b.value),reason=why(b.reason);uuid(companyId);
  return salesWork(this.db,user,reason,async()=>{
   await this.one('SELECT pg_advisory_xact_lock(hashtextextended(?,0))','sales-intake-policy:'+companyId);
   if(!await this.one("SELECT id FROM users WHERE id=? AND role='OWNER' AND status='ACTIVE'",user.id))throw forbidden();
   if(!await this.one('SELECT id FROM tally_companies WHERE id=?',companyId))throw validationFailed('Select an imported selling company.');
   const old=await this.policy(companyId);if(b.version!==old.version)throw conflict('Policy changed. Reload.');
   for(const id of [value.assignment?.userId,value.assignment?.fallbackUserId].filter(Boolean))if(!await this.one("SELECT id FROM users WHERE id=? AND status='ACTIVE'",id))throw validationFailed('Choose an active salesperson.');
   await this.one('INSERT INTO crm_sales_intake_policies(company_id,value,updated_by) VALUES(?,?::text::jsonb,?) ON CONFLICT(company_id) DO UPDATE SET value=EXCLUDED.value,version=crm_sales_intake_policies.version+1,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING company_id',companyId,json(value),user.id);
   await this.one('INSERT INTO crm_sales_intake_policy_versions(company_id,version,value,created_by,reason) VALUES(?,?,?::text::jsonb,?,?) RETURNING version',companyId,old.version+1,json(value),user.id,reason);
   await intakeEvent(this.db,{company_id:companyId},user,'POLICY_CHANGED',reason,{version:old.version+1});return this.policy(companyId);
  });
 }
 async userAccess(user,row){
  permission(user,'sales_intake.read');
  if(row.assigned_to!==user.id&&!hasPermission(user,'work.reassign')&&user.role!=='OWNER')throw notFound('Assigned intake not found.');
 }
 async list(user,params){
  permission(user,'sales_intake.read');const companyId=uuid(params.get('companyId')),page=Number(params.get('page')??1);
  if(!Number.isSafeInteger(page)||page<1||page>100000)throw validationFailed('Invalid page.');
  const type=params.get('messageType')??'',status=params.get('status')??'',search=params.get('search')??'';
  if(type&&!['CUSTOMER_PO','QUOTATION_REQUEST','LEAD_ENQUIRY'].includes(type)||status&&!['NEEDS_REVIEW','PREPARED','CANCELLED'].includes(status)||search.length>200)throw validationFailed('Invalid request filters.');
  const owner=user.role==='OWNER'||hasPermission(user,'work.reassign')?null:user.id;
  const args=[companyId,owner,owner,type,type,status,status,'%'+search.replace(/[\\%_]/g,'\\$&')+'%'];
  const where="WHERE i.company_id=? AND (?::integer IS NULL OR i.assigned_to=?) AND (?='' OR i.message_type=?) AND (?='' OR i.status=?) AND (coalesce(i.normalized->'header'->>'buyerName','')||' '||coalesce(i.normalized->'header'->>'poNumber','')||' '||i.mailbox) ILIKE ? ESCAPE '\\'";
  const total=(await this.one('SELECT count(*)::integer AS n FROM crm_sales_intakes i '+where,...args)).n;
  const data=await this.many('SELECT i.id,i.message_type,i.source_received_at,i.received_at,i.status,i.classification,i.relationship,i.tier,i.blockers,i.assigned_to,i.first_assigned_at,i.first_response_at,i.enquiry_id,i.quotation_id,i.sales_order_id,i.version,i.normalized->\'header\'->>\'buyerName\' AS buyer_name,i.normalized->\'header\'->>\'poNumber\' AS po_number,i.normalized#>>\'{source,attachments,0,name}\' AS source_name,u.name AS assigned_name FROM crm_sales_intakes i LEFT JOIN users u ON u.id=i.assigned_to '+where+' ORDER BY i.received_at DESC,i.id LIMIT 25 OFFSET ?',...args,(page-1)*25);
  const policy=await this.policy(companyId);return {data,pagination:{page,pageSize:25,total,pages:Math.ceil(total/25)},ingestionEnabled:policy.value.ingestionEnabled===true};
 }
 async detail(user,id,companyId){
  const row=await this.one("SELECT i.*,u.name AS assigned_name,i.normalized->'header'->>'buyerName' AS buyer_name,i.normalized->'header'->>'poNumber' AS po_number FROM crm_sales_intakes i LEFT JOIN users u ON u.id=i.assigned_to WHERE i.id=? AND i.company_id=?",uuid(id),uuid(companyId));if(!row)throw notFound();await this.userAccess(user,row);
  const events=await this.many('SELECT action,actor_id,reason,detail,created_at FROM crm_sales_intake_events WHERE intake_id=? ORDER BY id',row.id);
  const documents=await this.many('SELECT d.attachment_id,s.id,s.original_name,s.mime_type,s.byte_count::text,s.content_sha256,s.storage_reference FROM crm_sales_intake_documents d JOIN source_documents s ON s.id=d.source_document_id WHERE d.intake_id=?',row.id);
  const deliveries=await this.many('SELECT id,event_id,source,provenance,created_at FROM crm_sales_intake_deliveries WHERE intake_id=? ORDER BY created_at,id',row.id);
  const stoppedAt=row.first_response_at??(row.status==='CANCELLED'?events.find(e=>e.action==='CANCELLED')?.created_at:null);
  const measuredAt=stoppedAt?new Date(stoppedAt):this.clock.now();
  const seconds=row.first_assigned_at?Math.max(0,Math.floor((measuredAt-new Date(row.first_assigned_at))/1000)):null;
  const work=await this.one("SELECT id,due_at,sla_rule_version FROM work_items WHERE entity_type='SALES_INTAKE' AND entity_id=?",row.id);
  const remaining=work?.due_at?Math.floor((new Date(work.due_at)-measuredAt)/1000):null;
  const currentPolicy=await this.policy(companyId),kpi=!currentPolicy.value.kpi?'NOT_CONFIGURED':currentPolicy.version===row.response_policy?.version?'AGGREGATE_REPORT_CONFIGURED':'HISTORICAL_POLICY';
  return {...row,events,documents,deliveries,timing:{elapsedSeconds:seconds,firstAssignedAt:row.first_assigned_at,firstResponseAt:row.first_response_at,dueAt:work?.due_at??null,sla:remaining===null?'NOT_CONFIGURED':row.status==='CANCELLED'?'CANCELLED':row.first_response_at?(remaining<0?'BREACHED':'MET'):(remaining<0?'BREACHED':'RUNNING'),remainingSeconds:remaining,slaPolicyVersion:work?.sla_rule_version??null,kpi,timezone:'Asia/Kolkata'}};
 }
 async receive(principal,input){
  if(principal?.kind!=='AUTOMATION_SERVICE'||principal.scope!=='automation.write.intake')throw forbidden('Scoped intake credential required.');
  const n=normalizeIntake(input);if(n.companyId!==principal.companyId)throw forbidden('Payload and credential company differ.');
  const actor=await this.one("SELECT id,role FROM users WHERE id=? AND status='ACTIVE'",principal.ownerId);if(!actor)throw forbidden('Integration owner is inactive.');
  return salesWork(this.db,actor,'Structured Make sales intake',async()=>{
   await this.one('SELECT pg_advisory_xact_lock(hashtextextended(?,0))','sales-intake:'+n.companyId);
   const policy=await this.policy(n.companyId);
   if(policy.value.ingestionEnabled!==true)throw conflict('Sales intake is disabled. Owner must explicitly configure ingestionEnabled; no automation switch was changed.','INTAKE_DISABLED');
   if(!policy.value.mailboxes?.map(v=>v.toLowerCase()).includes(n.source.mailbox))throw forbidden('Source mailbox is not configured for this selling company.');
   if(new Date(n.source.receivedAt)>this.clock.now())throw validationFailed('Source received timestamp cannot be in the future.');
   const delivery=await this.one('SELECT d.*,i.status FROM crm_sales_intake_deliveries d JOIN crm_sales_intakes i ON i.id=d.intake_id WHERE d.company_id=? AND d.event_id=?',n.companyId,n.eventId);
   if(delivery){if(delivery.business_hash!==n.businessHash)throw conflict('Delivery identity has a different business payload.','INTAKE_IDEMPOTENCY_CONFLICT');return {id:delivery.intake_id,status:delivery.status,duplicate:true};}
   let previous=await this.one('SELECT * FROM crm_sales_intakes WHERE company_id=? AND source_system=? AND mailbox=? AND message_id=?',n.companyId,n.source.system,n.source.mailbox,n.source.messageId);
   if(previous&&previous.business_hash!==n.businessHash)throw conflict('This source message was already retained with different content. Deliver an explicit new revision for review.','INTAKE_SOURCE_CONFLICT');
   if(!previous&&n.source.attachments.length)previous=await this.one('SELECT i.* FROM crm_sales_intakes i JOIN crm_sales_intake_documents a ON a.intake_id=i.id JOIN source_documents s ON s.id=a.source_document_id WHERE i.company_id=? AND i.business_hash=? AND s.content_sha256=ANY(?::text[]) ORDER BY i.received_at LIMIT 1',n.companyId,n.businessHash,n.source.attachments.map(a=>a.sha256));
   if(!previous&&n.messageType==='CUSTOMER_PO'&&n.header.poNumber)previous=await this.one("SELECT * FROM crm_sales_intakes WHERE company_id=? AND message_type='CUSTOMER_PO' AND upper(normalized->'header'->>'poNumber')=upper(?) AND business_hash=? LIMIT 1",n.companyId,n.header.poNumber,n.businessHash);
   if(previous){await this.delivery(previous,n,principal,input,actor);return {id:previous.id,status:previous.status,duplicate:true};}
   const row=await this.one('INSERT INTO crm_sales_intakes(company_id,credential_id,message_type,source_system,mailbox,message_id,thread_id,source_received_at,original_payload,normalized,business_hash,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?::text::jsonb,?::text::jsonb,?,?,?) RETURNING *',n.companyId,principal.credentialId,n.messageType,n.source.system,n.source.mailbox,n.source.messageId,n.source.threadId,n.source.receivedAt,json(input),json(n),n.businessHash,actor.id,actor.id);
   await this.delivery(row,n,principal,input,actor);
   await intakeEvent(this.db,row,actor,'RECEIVED','Authenticated structured delivery retained',{messageType:n.messageType},principal.credentialId);
   await this.prepare(row,actor,policy);
   const current=await this.one('SELECT id,status,blockers,enquiry_id,quotation_id FROM crm_sales_intakes WHERE id=?',row.id);return {...current,duplicate:false};
  });
 }
 async delivery(row,n,p,raw,actor){
  const delivery=await this.one('INSERT INTO crm_sales_intake_deliveries(company_id,event_id,intake_id,business_hash,credential_id,source,provenance,original_payload) VALUES(?,?,?,?,?,?::text::jsonb,?::text::jsonb,?::text::jsonb) RETURNING id',n.companyId,n.eventId,row.id,n.businessHash,p.credentialId,json(n.source),json(n.provenance),json(raw));
  for(const a of n.source.attachments){
   const old=await this.one('SELECT s.content_sha256 FROM crm_sales_intake_documents d JOIN source_documents s ON s.id=d.source_document_id WHERE d.intake_id=? AND d.attachment_id=?',row.id,a.id);
   if(old){if(old.content_sha256!==a.sha256)throw conflict('Attachment identity has changed content. Retain an explicit revision.','INTAKE_ATTACHMENT_CONFLICT');continue;}
   const document=await this.one('INSERT INTO source_documents(content_sha256,document_type,original_name,mime_type,byte_count,storage_reference,ingestion_source,ingestion_reference,created_by) VALUES(?,?,?,?,?,?,?,?,?) RETURNING id',a.sha256,n.messageType,a.name,a.mimeType,a.bytes,a.storageReference,n.source.system,a.id,actor.id);await this.one('INSERT INTO crm_sales_intake_documents(intake_id,source_document_id,attachment_id) VALUES(?,?,?) RETURNING id',row.id,document.id,a.id);
  }
  await intakeEvent(this.db,row,actor,'DELIVERY_RETAINED','Source delivery references retained',{deliveryId:delivery.id},p.credentialId);
 }
 async resolve(user,id,companyId,b){
  permission(user,'sales_intake.review');validateReviewCommand(b);why(b.reason);
  return salesWork(this.db,user,b.reason,async()=>{
   const row=await this.one('SELECT * FROM crm_sales_intakes WHERE id=? AND company_id=? FOR UPDATE',uuid(id),uuid(companyId));if(!row)throw notFound();await this.userAccess(user,row);
   if(row.version!==b.version||row.status==='CANCELLED')throw conflict('Intake changed or is cancelled. Reload.');
   const resolutions=mergeReviewResolutions(row,b.resolutions);
   if(b.resolutions?.assignedTo!=null&&b.resolutions.assignedTo!==row.assigned_to)permission(user,'work.reassign');
   if(row.quotation_id&&(b.resolutions?.header||b.resolutions?.items||b.resolutions?.customerId))throw conflict('This request already has a quotation. Revise it in Quotations; the original extraction remains linked.','USE_QUOTATION_REVISION');
   row.resolutions=resolutions;
   await this.one('UPDATE crm_sales_intakes SET resolutions=?::text::jsonb,version=version+1,updated_by=?,updated_at=now() WHERE id=? RETURNING id',json(row.resolutions),user.id,row.id);
   await intakeEvent(this.db,row,user,'REVIEWED',b.reason,{version:row.version+1,correctedFields:Object.keys(b.resolutions??{})});await this.prepare({...row,version:row.version+1},user,await this.policy(companyId));return this.detail(user,id,companyId);
  });
 }
 async customer(row,n){
  const explicit=row.resolutions.customerId??n.header.customerId;
  let candidates=explicit?await this.many("SELECT c.*,p.company_id FROM customers c LEFT JOIN crm_customer_profiles p ON p.customer_id=c.id WHERE c.id=? AND NOT c.is_deleted",explicit):n.header.gstin?await this.many("SELECT c.*,p.company_id FROM customers c LEFT JOIN crm_customer_profiles p ON p.customer_id=c.id WHERE upper(c.gstin)=? AND NOT c.is_deleted",n.header.gstin):[];
  candidates=candidates.filter(c=>!c.company_id||c.company_id===row.company_id);
  if(candidates.length!==1)return {customer:null,blocker:candidates.length?'CUSTOMER_MATCH_AMBIGUOUS':'CUSTOMER_ONBOARDING_REQUIRED'};
  const c=candidates[0];if(n.header.gstin&&c.gstin?.toUpperCase()!==n.header.gstin)return {customer:null,blocker:'CUSTOMER_IDENTIFIER_CONFLICT'};
  const link=await this.one("SELECT id FROM tally_visibility_crm_links WHERE company_id=? AND crm_kind='customer' AND crm_id=? LIMIT 1",row.company_id,c.id);
  if(!row.resolutions.customerId&&c.company_id!==row.company_id&&!link)return {customer:null,blocker:'CUSTOMER_COMPANY_REVIEW_REQUIRED'};
  return {customer:c,...(c.status==='ACTIVE'?{}:{blocker:'CUSTOMER_NOT_ACTIVE'})};
 }
 async prepare(row,actor,policy){
  const n=preparedData(row),blockers=missingBusinessFields(n).map(path=>'MISSING:'+path);
  for(const [index]of (n.reviewIssues??[]).entries())if(!row.resolutions.reviewedSourceIssues?.includes(index))blockers.push('SOURCE_REVIEW:'+index);
  const {customer,blocker}=await this.customer(row,n);if(blocker)blockers.push(blocker);
  let handlerAllowed=true;
  if(customer)try{await requireCustomerHandler(this.db,customer.id,actor);}catch(error){if(error.status!==403)throw error;handlerAllowed=false;blockers.push('CUSTOMER_HANDLER_REVIEW_REQUIRED');}
  const controls=customer?await this.one('SELECT classification FROM crm_customer_controls WHERE customer_id=?',customer.id):null;
  const relationship=customer&&new Date(customer.created_at)<=new Date(row.received_at)?'EXISTING':'NEW',classification=controls?.classification==='DO_NOT_QUOTE'?'DO_NOT_QUOTE':relationship;
  if(classification==='DO_NOT_QUOTE')blockers.push('DO_NOT_QUOTE');
  const onboarding=customer?await this.one('SELECT status FROM crm_customer_onboarding WHERE customer_id=?',customer.id):null;if(customer&&onboarding?.status!=='APPROVED')blockers.push('CUSTOMER_APPROVAL_REQUIRED');
  let assigned=row.resolutions.assignedTo??row.assigned_to;
  if(!assigned&&policy.value.assignment?.mode==='FIXED')assigned=policy.value.assignment.userId;
  if(!assigned&&policy.value.assignment?.mode==='CUSTOMER_OWNER')assigned=customer?.owner_id??policy.value.assignment.fallbackUserId;
  if(assigned){const u=await this.one("SELECT id,role FROM users WHERE id=? AND status='ACTIVE'",assigned);if(!u||!hasPermission(u,'enquiries.read')||!hasPermission(u,'sales_intake.read')){assigned=null;blockers.push('SALESPERSON_REVIEW_REQUIRED');}}
  const lines=[];
  for(const line of n.items){
   let matches=line.itemId?await this.many("SELECT id,part_code,uom,hsn FROM items WHERE id=? AND status='ACTIVE' AND NOT is_deleted",line.itemId):line.productCode?await this.many("SELECT DISTINCT i.id,i.part_code,i.uom,i.hsn FROM items i LEFT JOIN crm_customer_part_mappings m ON m.item_id=i.id AND m.customer_id=? AND m.status='ACTIVE' AND NOT m.is_deleted WHERE i.status='ACTIVE' AND NOT i.is_deleted AND (lower(i.part_code)=lower(?) OR lower(m.customer_part_number)=lower(?))",customer?.id??null,line.productCode,line.productCode):[];
   if(matches.length!==1){blockers.push('ITEM_REVIEW:'+line.lineId);lines.push({...line,itemId:null});continue;}
   const item=matches[0];if(line.uom!==item.uom)blockers.push('UNIT_REVIEW:'+line.lineId);
   if(line.hsn&&line.hsn!==item.hsn)blockers.push('HSN_REVIEW:'+line.lineId);
   lines.push({...line,itemId:item.id,partCode:item.part_code});
  }
  if(handlerAllowed&&customer?.status==='ACTIVE'&&!row.enquiry_id&&n.messageType!=='CUSTOMER_PO'&&n.items.length&&n.items.every(l=>l.description&&l.quantity)){
   try{
    const enquiry=await createEnquiry(this.db,{customerId:customer.id,subject:n.header.buyerName+' — '+(n.messageType==='LEAD_ENQUIRY'?'Enquiry':'Quotation request'),source:'MAKE:'+row.id,assignedTo:assigned??null,notes:n.header.otherTerms,lines:lines.map(l=>({itemId:l.itemId,description:l.description,quantity:l.quantity,targetPrice:l.unitPrice})),reason:'Structured intake '+row.id},actor);
    row.enquiry_id=enquiry.id;await this.one('UPDATE crm_sales_intakes SET enquiry_id=? WHERE id=? RETURNING id',enquiry.id,row.id);
   }catch(error){if([403,422].includes(error.status))blockers.push('ENQUIRY_PREPARATION_BLOCKED:'+error.message);else throw error;}
  }
  let math=null;const quoteConfig=await quotePolicy(this.db);
  for(const l of lines){for(const k of ['unitPrice','gstRate','discount'])if(l[k]==null)blockers.push('QUOTE_PREPARATION:'+l.lineId+':'+k);const discount=quotationDiscount(l);l.effectiveDiscount=discount.percent;if(discount.blocker)blockers.push(discount.blocker+':'+l.lineId);if(l.itemId&&!await this.one('SELECT item_id FROM crm_quotation_costs WHERE item_id=?',l.itemId))blockers.push('ITEM_COST_REQUIRED:'+l.lineId);}
  const place=n.header.placeOfSupply??n.header.deliveryAddress?.stateCode??n.header.gstin?.slice(0,2);
  const supply=n.header.supplyType??policy.value.taxTreatment;
  if(supply!=='DOMESTIC_STANDARD')blockers.push('TAX_TREATMENT_REVIEW_REQUIRED');
  if(!policy.value.sellerState||quoteConfig&&policy.value.sellerState!==quoteConfig.seller_state)blockers.push('SELLER_STATE_CONFIRMATION_REQUIRED');
  if(!quoteConfig)blockers.push('QUOTATION_POLICY_REQUIRED');if(!place)blockers.push('PLACE_OF_SUPPLY_REQUIRED');
  if(quoteConfig&&policy.value.sellerState===quoteConfig.seller_state&&place&&supply==='DOMESTIC_STANDARD'&&lines.length&&lines.every(l=>l.itemId&&l.quantity&&l.uom&&l.unitPrice!=null&&l.gstRate!=null&&l.effectiveDiscount!=null)){
   try{math=calculateQuotation(lines.map(l=>({sourceLineId:l.lineId,itemId:l.itemId,partCode:l.partCode,description:l.description,uom:l.uom,quantity:l.quantity,unitPrice:l.unitPrice,discountPercent:l.effectiveDiscount,taxPercent:l.gstRate,...(l.pricingSelection?{pricingSelection:l.pricingSelection}:{})})),quoteConfig.seller_state,place);}catch{blockers.push('QUOTATION_DECIMAL_LIMIT_REVIEW_REQUIRED');}
   if(math){
   if(n.header.totalPoValue!=null&&compare(decimal(n.header.totalPoValue),decimal(math.total))!==0)blockers.push('DECLARED_TOTAL_MISMATCH');
   for(const [index,l]of lines.entries())if(l.taxableAmount!=null&&compare(decimal(l.taxableAmount),decimal(math.lines[index].net))!==0)blockers.push('TAXABLE_AMOUNT_MISMATCH:'+l.lineId);
   }
  }
  if(handlerAllowed&&customer&&n.messageType==='CUSTOMER_PO'&&n.header.poNumber){
   const existing=await this.one("SELECT i.id FROM crm_sales_intakes i WHERE i.id<>? AND i.company_id=? AND i.customer_id=? AND upper(i.normalized->'header'->>'poNumber')=upper(?) LIMIT 1",row.id,row.company_id,customer.id,n.header.poNumber);
   if(existing)blockers.push('PO_REVISION_REVIEW_REQUIRED:'+existing.id);
   const order=await this.one("SELECT w.sales_order_id,w.public_snapshot FROM crm_order_workflows w WHERE w.customer_id=? AND w.po_key=upper(?) AND w.public_snapshot->>'companyId'=? LIMIT 1",customer.id,n.header.poNumber,row.company_id);
   if(order){row.sales_order_id=order.sales_order_id;row.quotation_id=order.public_snapshot.quotationId??row.quotation_id;blockers.push('PO_ALREADY_HAS_SALES_ORDER');}
   if(!row.customer_po_id&&math&&n.header.poDate&&n.header.totalPoValue!=null&&!blockers.some(b=>b.startsWith('PO_REVISION')||b==='PO_ALREADY_HAS_SALES_ORDER')&&lines.every(l=>l.productCode&&l.description&&l.uom)){
    const party=await canonicalParty(this.db,customer.id,actor.id),old=await this.one('SELECT id FROM customer_pos WHERE customer_party_id=? AND po_number_key=?',party,n.header.poNumber.toUpperCase());
    if(old)blockers.push('EXISTING_PO_REVIEW_REQUIRED:'+old.id);
    else{
     const po=await this.one('INSERT INTO customer_pos(customer_party_id,legacy_customer_id,po_number,po_number_key,po_date,source_total,calculated_total,place_of_supply,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING id',party,customer.id,n.header.poNumber,n.header.poNumber.toUpperCase(),n.header.poDate,n.header.totalPoValue,math.total,place,actor.id,actor.id);
     for(const [position,l]of lines.entries())await this.one('INSERT INTO customer_po_lines(customer_po_id,part_id,line_number,original_part_number,description,quantity,uom,unit_price,discount_percent,tax_percent,source_row_reference,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id',po.id,await canonicalPart(this.db,l.itemId,actor.id),position+1,l.productCode,l.description,l.quantity,l.uom,l.unitPrice,l.effectiveDiscount,l.gstRate,l.lineId,actor.id);
     await this.one('INSERT INTO customer_po_versions(customer_po_id,version,snapshot,reason,created_by) VALUES(?,1,?::text::jsonb,?,?) RETURNING id',po.id,json({intakeId:row.id,header:n.header,lines:n.items,calculatedTotal:math.total}),'Customer PO retained from structured extraction',actor.id);
     row.customer_po_id=po.id;await this.one('UPDATE crm_sales_intakes SET customer_po_id=? WHERE id=? RETURNING id',po.id,row.id);
    }
   }
  }
  let validUntil=n.header.validUntil;
  if(!validUntil&&policy.value.quotationValidityDays)validUntil=quotationValidityDate(this.clock.now(),policy.value.quotationValidityDays);
  if(!validUntil)blockers.push('QUOTATION_VALIDITY_REQUIRED');
  if(handlerAllowed&&n.header.quotationId&&!row.quotation_id&&customer){
   const linked=await this.one('SELECT id FROM crm_sales_intakes WHERE quotation_id=? AND id<>?',n.header.quotationId,row.id);
   const q=await this.one('SELECT * FROM crm_quotation_workflows WHERE quotation_id=?',n.header.quotationId);
   if(linked)blockers.push('QUOTATION_ALREADY_LINKED:'+linked.id);
   else if(!q||q.public_snapshot.customerId!==customer.id||q.public_snapshot.companyId!==row.company_id)blockers.push('QUOTATION_MATCH_REVIEW_REQUIRED');
   else{try{await requireQuotationApproval(this.db,q.quotation_id);row.quotation_id=q.quotation_id;await requestAvailability(this.db,q.quotation_id,row.id,actor);}catch(error){if([403,409,422].includes(error.status))blockers.push('QUOTATION_MATCH_NOT_CURRENTLY_APPROVED');else throw error;}}
  }
  if(!blockers.length&&!row.quotation_id&&math){
   const body={companyId:row.company_id,customerId:customer.id,enquiryId:row.enquiry_id,validUntil,placeOfSupply:place,supplyType:supply,terms:[n.header.paymentTerms,n.header.otherTerms].filter(Boolean).join('\n'),lines:math.lines.map(l=>({...l,discountPercent:l.discountPercent,taxPercent:l.taxPercent})),reason:'Prepare draft from structured sales intake '+row.id};
   try{await previewQuoteDraft(this.db,body,actor);}catch(error){if([403,409,422].includes(error.status))blockers.push('DRAFT_PREPARATION_BLOCKED:'+error.message);else throw error;}
   if(!blockers.length){const q=await saveQuote(this.db,null,body,actor);row.quotation_id=q.id;await this.one('UPDATE crm_sales_intakes SET quotation_id=? WHERE id=? RETURNING id',q.id,row.id);await requestAvailability(this.db,q.id,row.id,actor);}
  }
  const tier=customer&&relationship==='EXISTING'?await this.classify(row,customer,n,policy):{tier:null,state:'NEW_CUSTOMER',count:null,policyVersion:policy.version};
  const assignment=await this.one('UPDATE crm_sales_intakes SET customer_id=?,relationship=?,classification=?,tier=?::text::jsonb,status=?,blockers=?::text::jsonb,enquiry_id=?,quotation_id=?,sales_order_id=?,assigned_to=?,first_assigned_at=CASE WHEN ?::integer IS NOT NULL THEN coalesce(first_assigned_at,clock_timestamp()) ELSE first_assigned_at END,response_policy=CASE WHEN ?::integer IS NOT NULL THEN coalesce(response_policy,?::text::jsonb) ELSE response_policy END,updated_by=?,updated_at=now() WHERE id=? RETURNING id,first_assigned_at',customer?.id??null,relationship,classification,json(tier),row.quotation_id?'PREPARED':'NEEDS_REVIEW',json([...new Set(blockers)]),row.enquiry_id??null,row.quotation_id??null,row.sales_order_id??null,assigned??null,assigned??null,assigned??null,policy.value.response?json({value:policy.value.response,version:policy.version,firstAssigneeId:assigned??null}):null,actor.id,row.id);
  if(assigned&&row.enquiry_id)await this.one('UPDATE enquiries SET assigned_to=?,updated_by=?,updated_at=now() WHERE id=? RETURNING id',assigned,actor.id,row.enquiry_id);
  if(assigned){const existing=await this.one("SELECT id,owner_user_id,status FROM work_items WHERE entity_type='SALES_INTAKE' AND entity_id=?",row.id);
   if(!existing)await this.work.open(actor,{entityType:'SALES_INTAKE',entityId:row.id,title:'Sales intake: '+n.messageType,department:'SALES',ownerUserId:assigned,assignmentReason:'First sales intake assignment',startedAt:assignment.first_assigned_at});
   else if(existing.owner_user_id!==assigned&&['OPEN','IN_PROGRESS','WAITING'].includes(existing.status))await this.work.reassign(actor,existing.id,{ownerUserId:assigned,reason:'Sales intake reviewed assignment'});
  }
  if(assigned!==row.assigned_to)await intakeEvent(this.db,row,actor,'SALESPERSON_ASSIGNED','Sales preparation assignment recorded',{fromUserId:row.assigned_to??null,toUserId:assigned??null});
  await intakeEvent(this.db,row,actor,'PREPARATION_REVIEWED','Structured preparation completed without approval or sending',{blockers:[...new Set(blockers)],enquiryId:row.enquiry_id??null,quotationId:row.quotation_id??null});
  await notifySales(this.db,row.id,blockers.length?'INTAKE_REQUIRES_ATTENTION':'NEW_SALES_REQUEST','preparation:'+row.version);
 }
 async classify(row,customer,n,policy){
  const definition=n.messageType==='CUSTOMER_PO'?policy.value.tiers?.po:policy.value.tiers?.enquiry;if(!definition)return {...tierResult(null,null),policyVersion:policy.version};
  const records=definition.basis==='PO'?await this.many("SELECT DISTINCT p.id FROM customer_pos p WHERE p.legacy_customer_id=? AND p.status=ANY(?::text[]) AND (EXISTS(SELECT 1 FROM crm_sales_intakes i WHERE i.customer_po_id=p.id AND i.company_id=?) OR EXISTS(SELECT 1 FROM sales_orders o JOIN crm_order_workflows w ON w.sales_order_id=o.id WHERE o.customer_po_id=p.id AND w.public_snapshot->>'companyId'=?))",customer.id,definition.statuses,row.company_id,row.company_id):await this.many('SELECT DISTINCT e.id FROM enquiries e JOIN crm_sales_intakes i ON i.enquiry_id=e.id WHERE e.customer_id=? AND i.company_id=? AND e.status=ANY(?::text[])',customer.id,row.company_id,definition.statuses);
  const current=definition.basis==='PO'?row.customer_po_id:row.enquiry_id;const count=records.filter(r=>definition.includeCurrent||r.id!==current).length;
  const unscoped=definition.basis==='ENQUIRY'?await this.one('SELECT count(*)::integer AS n FROM enquiries e WHERE e.customer_id=? AND e.status=ANY(?::text[]) AND NOT EXISTS(SELECT 1 FROM crm_sales_intakes i WHERE i.enquiry_id=e.id)',customer.id,definition.statuses):await this.one("SELECT count(*)::integer AS n FROM customer_pos p WHERE p.legacy_customer_id=? AND p.status=ANY(?::text[]) AND NOT EXISTS(SELECT 1 FROM crm_sales_intakes i WHERE i.customer_po_id=p.id) AND NOT EXISTS(SELECT 1 FROM sales_orders o JOIN crm_order_workflows w ON w.sales_order_id=o.id WHERE o.customer_po_id=p.id AND w.public_snapshot->>'companyId' IS NOT NULL)",customer.id,definition.statuses);
  return {...tierResult(count,definition),...(unscoped.n?{tier:null,state:'TIER_COMPANY_SCOPE_REVIEW_REQUIRED',unscopedRecords:unscoped.n}:{}),policyVersion:policy.version,recordIds:records.map(r=>r.id),currentIncluded:Boolean(current&&definition.includeCurrent&&records.some(r=>r.id===current))};
 }
 async respond(user,id,companyId,b){
  permission(user,'sales_intake.review');why(b.reason);
  return salesWork(this.db,user,b.reason,async()=>{
   const row=await this.one('SELECT * FROM crm_sales_intakes WHERE id=? AND company_id=? FOR UPDATE',uuid(id),uuid(companyId));if(!row)throw notFound();await this.userAccess(user,row);
   if(row.status==='CANCELLED')throw conflict('Cancelled requests cannot record a new response.');
   if(row.version!==b.version)throw conflict('Intake changed. Reload.');if(row.assigned_to!==user.id)throw forbidden('Only the assigned salesperson may record their response.');
   if(!row.response_policy?.value.qualifyingActions.includes(b.responseAction))throw conflict('Response policy is not configured for this action.','RESPONSE_POLICY_REQUIRED');
   if(!row.first_assigned_at||typeof b.evidence!=='string'||b.evidence.trim().length<3||b.evidence.length>500)throw validationFailed('Assignment and a customer-response evidence reference of 3 to 500 characters are required.');
   if(row.first_response_at)return this.detail(user,id,companyId);
   const answered=await this.one("UPDATE crm_sales_intakes SET first_response_at=clock_timestamp(),response_policy=jsonb_set(response_policy,'{firstResponderId}',to_jsonb(?::integer)),version=version+1,updated_by=?,updated_at=now() WHERE id=? RETURNING id,first_response_at",user.id,user.id,row.id);
   const work=await this.work.repository.findByEntity('SALES_INTAKE',row.id);
   if(work?.due_at)await this.work.repository.update(work.id,{sla_state:new Date(answered.first_response_at)<=new Date(work.due_at)?'RUNNING':'BREACHED'},user.id);
   await this.work.closeForEntity(user,'SALES_INTAKE',row.id,'DONE',b.reason);
   await intakeEvent(this.db,row,user,'FIRST_RESPONSE_RECORDED',b.reason,{responseAction:b.responseAction,policyVersion:row.response_policy.version,evidenceReference:b.evidence.slice(0,500)});return this.detail(user,id,companyId);
  });
 }
 async cancel(user,id,companyId,b){
  permission(user,'sales_intake.review');why(b.reason);return salesWork(this.db,user,b.reason,async()=>{
   const row=await this.one('SELECT * FROM crm_sales_intakes WHERE id=? AND company_id=? FOR UPDATE',uuid(id),uuid(companyId));if(!row)throw notFound();await this.userAccess(user,row);if(row.version!==b.version||row.status==='CANCELLED')throw conflict('Request changed or was already cancelled.');
   const linkedOrder=row.sales_order_id||await this.one('SELECT id FROM sales_orders WHERE customer_po_id=? OR quotation_id=? LIMIT 1',row.customer_po_id,row.quotation_id);
   if(linkedOrder)throw conflict('This PO belongs to an order. Resolve cancellation in the existing order workflow.');
   if(row.enquiry_id){permission(user,'enquiries.update');const enquiry=await this.one('SELECT status FROM enquiries WHERE id=?',row.enquiry_id);if(enquiry.status==='WON')throw conflict('A won enquiry must be resolved in its existing order workflow.');if(!['LOST','CANCELLED'].includes(enquiry.status))await changeEnquiryStatus(this.db,row.enquiry_id,{status:'CANCELLED',reason:b.reason},user);}
   if(row.quotation_id){const q=await this.one('SELECT version FROM crm_quotation_workflows WHERE quotation_id=?',row.quotation_id);await quoteAction(this.db,row.quotation_id,{action:'CANCEL',version:q.version,reason:b.reason},user);}
   await this.one("UPDATE crm_sales_intakes SET status='CANCELLED',version=version+1,updated_by=?,updated_at=now() WHERE id=? RETURNING id",user.id,row.id);
   if(row.customer_po_id){await this.one("UPDATE customer_pos SET status='ARCHIVED',version=version+1,updated_by=?,updated_at=now() WHERE id=? RETURNING id",user.id,row.customer_po_id);await this.one("INSERT INTO customer_po_versions(customer_po_id,version,snapshot,reason,created_by) SELECT id,version,to_jsonb(p),?,? FROM customer_pos p WHERE id=? RETURNING id",b.reason,user.id,row.customer_po_id);}
   await this.work.closeForEntity(user,'SALES_INTAKE',row.id,'CANCELLED',b.reason);
   await intakeEvent(this.db,row,user,'CANCELLED',b.reason,{customerPoId:row.customer_po_id??null,enquiryId:row.enquiry_id??null,quotationId:row.quotation_id??null});return this.detail(user,id,companyId);
  });
 }
}
