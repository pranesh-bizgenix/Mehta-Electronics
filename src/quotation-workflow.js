import crypto from 'node:crypto';
import {sumMoney} from '../public/money.js';
import {bindQuotationLevel} from './modules/pricing/quotation-source.js';
import {bindCustomerPricing} from './modules/customers/commercial.js';
import {transaction,id,validDate,validateTax} from './crm-modules.js';
import {quotationRequest,quotationLineRequest,quotationRequestBlock,quotationPricingDate} from '../public/quotation-request.js';
import {writeAudit,recordQuotationRevision,quotationView} from './db.js';
import {hasPermission} from './rbac.js';
import {calculateQuotation,scaled} from '../public/quotation-math.js';
import {quotationPdf} from './quotation-document.js';
import {costErrors,policyErrors} from '../public/quotation-setup-validation.js';
import {validationFailed,conflict} from './core/errors.js';
import {requestAvailability,requireAvailability,invalidateAvailability} from './modules/sales-intake/availability.js';
import {salesWork} from './modules/sales-intake/shared.js';
import {pricingRuleVersions,requirePricingRules} from './modules/rules/workflow-rules.js';
import {DecisionService,requireSetting} from './modules/decisions/service.js';
import {createQuotationReview,quotationApprovalFingerprint,validateQuotationReview,requireQuotationReviewer,quotationApprovalCommand,requireQuotationStageCommand,quotationApprovalProjection} from './quotation-approvals.js';
const checkSetup=errors=>{if(Object.keys(errors).length)throw validationFailed('Correct the highlighted setup fields.',{fields:Object.entries(errors).map(([path,message])=>({path,message}))});};

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const text=(v,max=2000)=>{if(typeof v!=='string'||v.length>max)fail(422,`Enter text of at most ${max} characters.`);return v.trim();};
const reason=b=>{const r=text(b.reason??'');if(r.length<3)fail(422,'A reason of at least three characters is required.');return r;};
const state=v=>{if(!/^(0[1-9]|[12][0-9]|3[0-8])$/.test(String(v)))fail(422,'Select a valid two-digit state code (01–38).');return String(v);};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const costAccess=user=>hasPermission(user,'quotations.cost.read');
const can=(user,p)=>{if(!hasPermission(user,p))fail(403,'Permission denied.');};
async function work(db,user,why,fn){return transaction(db,user,why,async()=>{
 await db.prepare("SELECT pg_advisory_xact_lock(812731),set_config('mehta.quotation_write','authorized',true)").get();return fn();
});}
async function event(db,user,q,action,why,detail={},privateDetail={}){
 await db.prepare('INSERT INTO crm_quotation_events(quotation_id,version,action,reason,public_detail,private_detail,created_by) VALUES(?,?,?,?,?::text::jsonb,?::text::jsonb,?)').run(q?.quotation_id??null,q?.version??null,action,why,JSON.stringify(detail),JSON.stringify(privateDetail),user.id);
 await writeAudit(db,{userId:user.id,entity:'QUOTATION_WORKFLOW',recordId:q?.quotation_id??'POLICY',action,reason:why,newValue:detail});
}
export async function quotePolicy(db){return await db.prepare('SELECT *,floor_percent::text AS floor_percent FROM crm_quotation_policy WHERE singleton').get()||null;}
export async function saveQuotePolicy(db,b,user){can(user,'quotations.policy.manage');checkSetup(policyErrors(b));const why=reason(b),floor=b.floorPercent,basis=b.marginBasis;
 try{if(scaled(floor)>100000000n)fail(422,'Invalid margin floor.');}catch(e){fail(422,e.message);}
 if(!['LINE_AND_TOTAL','TOTAL'].includes(basis))fail(422,'Select a margin basis.');
 const seller=state(b.sellerState),letterhead={name:text(b.letterhead?.name??'',200),address:text(b.letterhead?.address??'',1000),gstin:text(b.letterhead?.gstin??'',15).toUpperCase(),email:text(b.letterhead?.email??'',200),phone:text(b.letterhead?.phone??'',60)};
 if(!letterhead.name)fail(422,'Company name is required.');validateTax(letterhead.gstin,seller);
 if(Object.hasOwn(b,'expectedRevision')&&b.expectedRevision!==null&&(!Number.isSafeInteger(b.expectedRevision)||b.expectedRevision<1))throw validationFailed('Reload the current quotation policy revision before saving.');
 return work(db,user,why,async()=>{const old=await quotePolicy(db);
 if(Object.hasOwn(b,'expectedRevision')&&b.expectedRevision!==(old?.revision??null))throw conflict('Quotation policy changed. Reload Policy and letterhead before saving.','POLICY_VERSION_CHANGED');
 if(old)await db.prepare('UPDATE crm_quotation_policy SET floor_percent=?,margin_basis=?,seller_state=?,letterhead=?::text::jsonb,revision=revision+1 WHERE id=?').run(floor,basis,seller,JSON.stringify(letterhead),old.id);
 else await db.prepare('INSERT INTO crm_quotation_policy(floor_percent,margin_basis,seller_state,letterhead,created_by) VALUES(?,?,?,?::text::jsonb,?)').run(floor,basis,seller,JSON.stringify(letterhead),user.id);
 const updated=await quotePolicy(db);await event(db,user,null,'POLICY_CHANGED',why,{revision:updated.revision},{before:old,after:updated});
 await new DecisionService({db}).confirmLegacy(user,'margin.floor_percent',updated.floor_percent,why,{withinTransaction:true});
 return updated;
 });
}
export async function quoteCost(db,itemId,user){can(user,'quotations.cost.read');return await db.prepare('SELECT item_id,unit_cost::text AS unit_cost,updated_at FROM crm_quotation_costs WHERE item_id=?').get(id(itemId))||{item_id:id(itemId),unit_cost:null};}
export async function pricingHistory(db,itemId,user){can(user,'quotations.cost.read');
 return db.prepare("SELECT e.*,u.name AS actor FROM crm_quotation_events e JOIN users u ON u.id=e.created_by WHERE e.quotation_id IS NULL AND ((?='' AND e.action='POLICY_CHANGED') OR (e.action='COST_CHANGED' AND e.public_detail->>'itemId'=?)) ORDER BY e.id DESC").all(itemId?String(id(itemId)):'',itemId?String(id(itemId)):'');
}
async function writeCost(db,itemId,cost,why,user,source={}){
 if(!await db.prepare("SELECT id FROM items WHERE id=? AND status='ACTIVE'").get(id(itemId)))fail(422,'Select an active CRM item.');
 const old=await quoteCost(db,itemId,user);
 if(old.unit_cost!==null)await db.prepare('UPDATE crm_quotation_costs SET unit_cost=? WHERE item_id=?').run(cost,id(itemId));
 else await db.prepare('INSERT INTO crm_quotation_costs(item_id,unit_cost,created_by) VALUES(?,?,?)').run(id(itemId),cost,user.id);
 await event(db,user,null,'COST_CHANGED',why,{itemId:id(itemId),...source},{before:old.unit_cost,after:cost});return quoteCost(db,itemId,user);
}
export async function saveQuoteCost(db,itemId,b,user){can(user,'quotations.cost.manage');checkSetup(costErrors(b));
 return work(db,user,reason(b),()=>writeCost(db,itemId,b.unitCost,reason(b),user));
}
// Rebuild the preview under the same lock used by manual cost/policy changes.
export async function importQuoteCosts(db,b,user,preview){can(user,'quotations.cost.manage');can(user,'quotations.cost.read');
 return work(db,user,reason(b),async()=>{
 const plan=await preview(db,b,user,true);
 if(!plan.canSave)fail(422,'Fix every import row before saving.');
 if(typeof b.fingerprint!=='string'||b.fingerprint!==plan.fingerprint)fail(409,'Costs or item details changed after preview. Review the file again.');
 for(const row of plan.rows)await writeCost(db,row.itemId,row.unitCost,reason(b),user,{sourceFile:b.filename});
 return {saved:plan.rows.length};
 });
}
function visible(row,user){const out={...row.public_snapshot,id:row.quotation_id,status:row.status,version:row.version,created_by:row.created_by,updated_at:row.updated_at,duplicateOf:row.duplicate_of,requiresWarehouseReview:row.private_snapshot.availabilityRequired===true};
 if(costAccess(user))out.pricing=row.private_snapshot;return out;
}
async function rowFor(db,quoteId){const row=await db.prepare('SELECT * FROM crm_quotation_workflows WHERE quotation_id=?').get(id(quoteId));if(!row)fail(404,'Workflow quotation not found.');return row;}
export async function managedQuote(db,quoteId){return !!await db.prepare('SELECT id FROM crm_quotation_workflows WHERE quotation_id=?').get(id(quoteId));}
export async function guardLegacyQuote(db,quoteId){if(await managedQuote(db,quoteId))fail(409,'Use the quotation workflow editor and approval actions for this quotation.');}
export async function quotationEnquiry(db,enquiryId,user){can(user,'quotations.create');can(user,'enquiries.read');
 const row=await db.prepare('SELECT id,customer_id,notes FROM enquiries WHERE id=?').get(id(enquiryId));if(!row)fail(404,'Enquiry not found.');
 row.lines=await db.prepare('SELECT l.item_id,l.description,l.quantity::text AS quantity,l.target_price::text AS target_price,i.part_code,i.uom FROM enquiry_lines l LEFT JOIN items i ON i.id=l.item_id WHERE l.enquiry_id=? AND NOT l.is_deleted ORDER BY l.position,l.id').all(row.id);return row;
}
export async function legacyQuoteView(db,quoteId){const q=await quotationView(db,quoteId);if(!q)return q;
 const row=await db.prepare('SELECT public_snapshot,status FROM crm_quotation_workflows WHERE quotation_id=?').get(quoteId);
 if(row){const p=row.public_snapshot;q.subtotal=p.subtotal;q.tax_total=sumMoney([p.cgst,p.sgst,p.igst]);q.total=p.total;q.workflowStatus=row.status;}
 return q;
}
async function visibleWithApproval(db,row,user){
 const out=visible(row,user),approval=await quotationApprovalProjection(db,row,user);
 if(approval){if(['PENDING_APPROVAL','APPROVED'].includes(row.status))try{await ensureCurrent(db,row);}catch{approval.canApprove=false;approval.blocked=true;approval.note='Approval evidence or reviewer eligibility changed. Return to draft and review the current quotation.';}out.approval=approval;}
 return out;
}
export async function quoteDetail(db,quoteId,user){can(user,'quotations.read');return visibleWithApproval(db,await rowFor(db,quoteId),user);}
export async function quoteForDocument(db,quoteId,user){can(user,'quotations.read');const row=await rowFor(db,quoteId),out=visible(row,{role:'EXECUTIVE'});
 if(row.status==='APPROVED')try{await ensureCurrent(db,row);}catch{out.status='DRAFT';}
 return out;
}
export async function quoteList(db,url,user){can(user,'quotations.read');const page=Number(url.searchParams.get('page')||1),pageSize=25;if(!Number.isSafeInteger(page)||page<1||page>1000000)fail(422,'Invalid page number.');
 const search=String(url.searchParams.get('search')||'').slice(0,200),status=url.searchParams.get('status')||'',where="WHERE (?='' OR w.public_snapshot->>'quotation_number' ILIKE ? OR w.public_snapshot->>'customer_name' ILIKE ?) AND (?='' OR w.status=?)",args=[search,'%'+search+'%','%'+search+'%',status,status];
 const count=await db.prepare(`SELECT count(*) AS n FROM crm_quotation_workflows w ${where}`).get(...args);
 const data=await db.prepare(`SELECT w.* FROM crm_quotation_workflows w ${where} ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`).all(...args,pageSize,(page-1)*pageSize);
 const legacy=await db.prepare('SELECT count(*) AS n FROM quotations q WHERE NOT EXISTS(SELECT 1 FROM crm_quotation_workflows w WHERE w.quotation_id=q.id)').get();
 return {data:data.map(r=>visible(r,user)),legacyCount:legacy.n,pagination:{page,pageSize,total:count.n,pages:Math.ceil(count.n/pageSize)}};
}
async function snapshot(db,b,number,enquiryId=null){
 let companyId=null;
 if(b.companyId!=null){if(typeof b.companyId!=='string'||!/^[0-9a-f-]{36}$/i.test(b.companyId)||!await db.prepare('SELECT id FROM tally_companies WHERE id=?').get(b.companyId))fail(422,'Select an imported selling company.');companyId=b.companyId;}
 let request;try{request=quotationRequest(b.request);}catch(error){fail(422,error.message);}
 let pricingDate;try{pricingDate=quotationPricingDate(request,today(),process.env.NODE_ENV==='production');}catch(error){fail(422,error.message);}
 const policy=await quotePolicy(db);if(!policy)fail(409,'Quotation creation is blocked: ask the owner to open Quotations → Policy and letterhead and save the margin floor, margin basis, seller state and company name.');
 await requireSetting(db,'margin.floor_percent');
 const customer=await db.prepare("SELECT c.*,p.state_code FROM customers c LEFT JOIN crm_customer_profiles p ON p.customer_id=c.id WHERE c.id=? AND c.status='ACTIVE'").get(id(b.customerId));
 if(!customer)fail(422,'Select an active customer.');
 const pos=state(b.placeOfSupply||customer.state_code||customer.gstin?.slice(0,2));
 if(b.supplyType!=='DOMESTIC_STANDARD')fail(422,'Confirm a standard domestic supply. SEZ/export/special supplies require a separate reviewed tax treatment.');
 if(!validDate(b.validUntil))fail(422,'A valid quotation validity date is required.');
 if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100)fail(422,'Add between 1 and 100 item lines.');
 if(enquiryId){const e=await db.prepare('SELECT customer_id FROM enquiries WHERE id=?').get(id(enquiryId));if(!e||e.customer_id!==customer.id)fail(422,'The enquiry must belong to this customer.');}
 const lines=[],costs={};
 for(const l of b.lines){const item=await db.prepare("SELECT *,pack_size::text AS pack_size FROM items WHERE id=? AND status='ACTIVE'").get(id(l.itemId));if(!item)fail(422,'Every line must reference an active CRM item.');
 const c=await db.prepare('SELECT unit_cost::text AS value FROM crm_quotation_costs WHERE item_id=?').get(item.id);costs[String(item.id)]=c?.value??null;
 lines.push({itemId:item.id,partCode:item.part_code,hsn:item.hsn||'',description:text(l.description??item.description,1000),uom:item.uom,quantity:String(l.quantity),unitPrice:String(l.unitPrice),discountPercent:String(l.discountPercent??'0'),taxPercent:String(l.taxPercent??'0')});
 if(l.sourceLineId!=null){if(typeof l.sourceLineId!=='string'||!l.sourceLineId.trim()||l.sourceLineId.length>100)fail(422,'Source line references must contain 1 to 100 characters.');lines.at(-1).sourceLineId=l.sourceLineId;}
 try{lines.at(-1).requestDetails=quotationLineRequest(l.requestDetails,today());}catch(error){fail(422,`Line ${lines.length}: ${error.message}`);}
 lines.at(-1).rateContractId=await contractForLine(db,customer.id,lines.at(-1),pricingDate);
 const selection=await bindQuotationLevel(db,lines.at(-1),l.pricingSelection,pricingDate);if(selection)lines.at(-1).pricingSelection=selection;
 const customerPricing=await bindCustomerPricing(db,customer.id,companyId,{...lines.at(-1),customerPricing:l.customerPricing},pricingDate);if(customerPricing)lines.at(-1).customerPricing=customerPricing;
 }
 const sourceIds=lines.map(l=>l.sourceLineId).filter(Boolean);if(new Set(sourceIds).size!==sourceIds.length)fail(422,'Source line references must be distinct.');
 let math;try{math=calculateQuotation(lines,policy.seller_state,pos,costs,policy.floor_percent,policy.margin_basis);}catch(e){fail(422,e.message);}
 if(scaled(math.total)>999999999999000000n)fail(422,'Quotation total exceeds the supported limit.');
 const {cost,missingCost,marginPercent,belowFloor,...publicMath}=math;
 const privateLines=math.lines.map(({itemId,unitCost,cost,marginPercent,belowFloor})=>({itemId,unitCost,cost,marginPercent,belowFloor}));
 publicMath.lines=math.lines.map(({unitCost:ignored,cost:ignored2,marginPercent:ignored3,belowFloor:ignored4,...l})=>l);
 return {policy,public:{...(companyId?{companyId}:{}),quotation_number:number,customerId:customer.id,customer_name:customer.name,customerGstin:customer.gstin||'',customerAddress:customer.billing_address||'',enquiryId,request,validUntil:b.validUntil,placeOfSupply:pos,sellerState:policy.seller_state,supplyType:'DOMESTIC_STANDARD',terms:text(b.terms??'',10000),notes:text(b.notes??'',10000),letterhead:policy.letterhead,...publicMath},private:{cost,missingCost,marginPercent,belowFloor,floorPercent:policy.floor_percent,marginBasis:policy.margin_basis,lines:privateLines}};
}
export async function previewQuoteDraft(db,b,user){
 can(user,'quotations.create');await requireQuotableCustomer(db,b.customerId);await requireCustomerHandler(db,b.customerId,user);
 return snapshot(db,b,'PREPARATION',b.enquiryId??null);
}
async function persistVersion(db,row,user,why){
 await db.prepare('INSERT INTO crm_quotation_versions(quotation_id,version,public_snapshot,private_snapshot,reason,created_by) VALUES(?,?,?::text::jsonb,?::text::jsonb,?,?)').run(row.quotation_id,row.version,JSON.stringify(row.public_snapshot),JSON.stringify(row.private_snapshot),why,user.id);
 await recordQuotationRevision(db,row.quotation_id,user.id,why);
}
async function baseLines(db,qid,snap){await db.prepare("UPDATE quotation_lines SET is_deleted=true,status='ARCHIVED' WHERE quotation_id=? AND NOT is_deleted").run(qid);
 for(const [position,l]of snap.lines.entries())await db.prepare('INSERT INTO quotation_lines(quotation_id,item_id,description,uom,quantity,unit_price,discount_percent,tax_percent,position) VALUES(?,?,?,?,?,?,?,?,?)').run(qid,l.itemId,l.description,l.uom,l.quantity,l.unitPrice,l.discountPercent,l.taxPercent,position);
}
export async function saveQuote(db,quoteId,b,user,duplicateOf=null){can(user,quoteId?'quotations.update':'quotations.create');const why=reason(b);
 await requireQuotableCustomer(db,b.customerId);
 await requireCustomerHandler(db,b.customerId,user);
 return work(db,user,why,async()=>{
 const old=quoteId?await rowFor(db,quoteId):null;
 const sourceIntake=b.enquiryId?await db.prepare('SELECT id,company_id,quotation_id,status FROM crm_sales_intakes WHERE enquiry_id=? FOR UPDATE').get(id(b.enquiryId)):null;
 if(sourceIntake?.status==='CANCELLED')fail(409,'The source intake is cancelled. Review it before preparing another quotation.');
 if(sourceIntake?.quotation_id&&sourceIntake.quotation_id!==old?.quotation_id&&!duplicateOf)throw conflict('This enquiry already has a linked quotation. Open that draft or use its explicit revision/duplicate workflow.','INTAKE_QUOTATION_ALREADY_EXISTS',{quotationId:sourceIntake.quotation_id});
 if(sourceIntake){if(b.companyId&&b.companyId!==sourceIntake.company_id)fail(409,'Enquiry source and selling company differ.');b={...b,companyId:sourceIntake.company_id};}
 if(old&&await db.prepare("SELECT h.id FROM crm_quote_reservations h JOIN crm_quotation_availability_lines l ON l.id=h.availability_line_id JOIN crm_quotation_availability r ON r.id=l.request_id WHERE r.quotation_id=? AND h.status='TRANSFERRED' LIMIT 1").get(old.quotation_id))fail(409,'This quotation has an order reservation. Resolve the order before revising it.');
 const priorAvailability=await db.prepare('SELECT intake_id,company_id FROM crm_quotation_availability WHERE quotation_id=? ORDER BY quotation_version DESC LIMIT 1').get(quoteId??duplicateOf??null);
 if(old?.public_snapshot.companyId){if(b.companyId&&b.companyId!==old.public_snapshot.companyId)fail(409,'The selling company of a saved quotation cannot change.');b={...b,companyId:old.public_snapshot.companyId};}
 if(priorAvailability)b={...b,companyId:priorAvailability.company_id};
 if(old&&(!['DRAFT','APPROVED','PENDING_APPROVAL'].includes(old.status)||b.version!==old.version))fail(409,'Quotation changed or cannot be edited. Reload; sent quotations must be duplicated.');
 const number=old?.public_snapshot.quotation_number||`QTN-${new Date().getUTCFullYear()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
 const enquiryId=b.enquiryId?id(b.enquiryId):null,s=await snapshot(db,b,number,enquiryId);
 s.private.businessRuleVersions=await pricingRuleVersions(db);s.private.pricingAuthorRole=user.role;s.private.availabilityRequired=true;s.private.customerPricingRequired=true;
 let qid=old?.quotation_id;
 if(!qid)qid=(await db.prepare('INSERT INTO quotations(quotation_number,customer_id,enquiry_id,valid_until,terms,notes,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)').run(number,s.public.customerId,enquiryId,b.validUntil,s.public.terms,s.public.notes,user.id,user.id)).insertedId;
 else await db.prepare("UPDATE quotations SET customer_id=?,enquiry_id=?,valid_until=?,terms=?,notes=?,status='DRAFT',updated_by=?,updated_at=now() WHERE id=?").run(s.public.customerId,enquiryId,b.validUntil,s.public.terms,s.public.notes,user.id,qid);
 if(old)await invalidateAvailability(db,qid,user,why);
 await baseLines(db,qid,s.public);
 if(old)await db.prepare("UPDATE crm_quotation_workflows SET version=version+1,status='DRAFT',policy_revision=?,place_of_supply=?,public_snapshot=?::text::jsonb,private_snapshot=?::text::jsonb WHERE quotation_id=?").run(s.policy.revision,s.public.placeOfSupply,JSON.stringify(s.public),JSON.stringify(s.private),qid);
 else await db.prepare('INSERT INTO crm_quotation_workflows(quotation_id,policy_revision,place_of_supply,public_snapshot,private_snapshot,created_by) VALUES(?,?,?,?::text::jsonb,?::text::jsonb,?)').run(qid,s.policy.revision,s.public.placeOfSupply,JSON.stringify(s.public),JSON.stringify(s.private),user.id);
 if(duplicateOf)await db.prepare('UPDATE crm_quotation_workflows SET duplicate_of=? WHERE quotation_id=?').run(duplicateOf,qid);
 const row=await rowFor(db,qid);await persistVersion(db,row,user,why);await event(db,user,row,duplicateOf?'DUPLICATED':old?'REVISED':'CREATED',why,{status:'DRAFT',version:row.version,...(duplicateOf?{sourceId:duplicateOf}:{})});
 if(sourceIntake&&!sourceIntake.quotation_id)await salesWork(db,user,why,()=>db.prepare("UPDATE crm_sales_intakes SET quotation_id=?,status='PREPARED',updated_by=?,updated_at=now() WHERE id=?").run(qid,user.id,sourceIntake.id));
 if(row.public_snapshot.companyId)await requestAvailability(db,qid,duplicateOf?null:sourceIntake?.id??priorAvailability?.intake_id??null,user);
 return visible(row,user);
 });
}
async function ensureCurrent(db,row,{complete=false,review=true}={}){const requestBlock=quotationRequestBlock(row.public_snapshot.request,row.public_snapshot.terms);if(requestBlock)fail(422,requestBlock);await requireQuotableCustomer(db,row.public_snapshot.customerId);for(const line of row.public_snapshot.lines){await requireContractBinding(db,row.public_snapshot.customerId,line,today());await bindQuotationLevel(db,line,line.pricingSelection);}const p=await quotePolicy(db);if(!p||p.revision!==row.policy_revision)fail(409,'Policy changed. Revise and resubmit the quotation.');
 await requireAvailability(db,row);
 if(row.private_snapshot.customerPricingRequired)for(const line of row.public_snapshot.lines)await bindCustomerPricing(db,row.public_snapshot.customerId,row.public_snapshot.companyId,line);
 const margin=await requireSetting(db,'margin.floor_percent');
 if(row.private_snapshot.missingCost)fail(422,'Submission is blocked: ask the owner to enter costs for every item in Quotations → Item costs, then save the draft again to capture those costs.');
 for(const l of row.private_snapshot.lines){const c=await db.prepare('SELECT unit_cost::text AS value FROM crm_quotation_costs WHERE item_id=?').get(l.itemId);if(c?.value==null||scaled(c.value)!==scaled(l.unitCost??'0'))fail(409,'Item costs changed or are missing. Open Quotations → Item costs, then revise and resubmit the quotation.');}
 if(row.public_snapshot.subtotal==='0.00')fail(422,'A quotation must have a positive net sales amount before submission.');
 if(row.public_snapshot.validUntil<today())fail(422,'Quotation validity has expired.');
 const plan=await requirePricingRules(db,row,null),sourceFingerprint=quotationApprovalFingerprint(row,plan,margin);
 if(review&&row.private_snapshot.approvalReview)await validateQuotationReview(db,row,plan,row.private_snapshot.approvalReview,sourceFingerprint,{complete:complete||row.status==='APPROVED'});
 else if(review&&plan.stages.length>1&&(complete||row.status!=='DRAFT'))throw conflict('This quotation needs a fresh staged approval round. Return to draft and submit it again.','QUOTATION_APPROVAL_INCOMPLETE');
 return {plan,sourceFingerprint};
}
/** Conversion checks current complete evidence without changing historical issued documents. */
export async function requireQuotationApproval(db,quoteId){return ensureCurrent(db,await rowFor(db,quoteId),{complete:true});}
export async function quoteAction(db,quoteId,b,user){const why=reason(b),action=b.action;
 can(user,action==='APPROVE'||action==='RETURN'?'quotations.approve':action==='SUBMIT'?'quotations.update':'quotations.status');
 return work(db,user,why,async()=>{const row=await rowFor(db,quoteId);
 const requestHash=action==='APPROVE'?quotationApprovalCommand(b,user,row.quotation_id):null;
 if(action==='APPROVE'&&b.requestKey){const receipt=await db.prepare("SELECT quotation_id,created_by,public_detail,private_detail FROM crm_quotation_events WHERE action='APPROVE' AND public_detail->>'requestKey'=? ORDER BY id LIMIT 1").get(b.requestKey);if(receipt){if(receipt.quotation_id!==row.quotation_id||receipt.created_by!==user.id||receipt.private_detail.approvalRequestHash!==requestHash)throw conflict('This approval requestKey was used for another command.','IDEMPOTENCY_KEY_REUSED');return {...await visibleWithApproval(db,row,user),replayed:true};}}
 if(b.version!==row.version)fail(409,'Quotation changed. Reload before continuing.');
 let next,reviewDetail=null,reviewEvidence=null;
 if(action==='SUBMIT'&&row.status==='DRAFT'){const {plan,sourceFingerprint}=await ensureCurrent(db,row,{review:false});const approvalReview=createQuotationReview(row,plan,sourceFingerprint);await db.prepare('UPDATE crm_quotation_workflows SET private_snapshot=?::text::jsonb WHERE quotation_id=?').run(JSON.stringify({...row.private_snapshot,approvalReview}),row.quotation_id);next='PENDING_APPROVAL';reviewEvidence=approvalReview;reviewDetail={roundId:approvalReview.roundId,total:approvalReview.stages.length};}
 else if(action==='APPROVE'&&row.status==='PENDING_APPROVAL'){
  const {plan,sourceFingerprint}=await ensureCurrent(db,row),approvalReview=row.private_snapshot.approvalReview??createQuotationReview(row,plan,sourceFingerprint);
  requireQuotationStageCommand(b,approvalReview);const stage=await requireQuotationReviewer(db,row,approvalReview,user);
  if(stage.ownerSelfApproval&&b.ownerSelfApproval!==true)fail(422,'Acknowledge that you are approving your own quotation as Owner.');
  if(row.private_snapshot.belowFloor&&b.overrideFloor!==true)fail(422,'Explicitly confirm the below-floor exception and provide its reason.');
  approvalReview.completed.push({stageId:stage.stageId,reviewerId:user.id,at:new Date().toISOString(),requestKey:b.requestKey??null,...(stage.ownerSelfApproval?{ownerSelfApproval:true}: {})});
  next=approvalReview.completed.length===approvalReview.stages.length?'APPROVED':'PENDING_APPROVAL';
  await db.prepare('UPDATE crm_quotation_workflows SET private_snapshot=?::text::jsonb WHERE quotation_id=?').run(JSON.stringify({...row.private_snapshot,approvalReview}),row.quotation_id);
  reviewEvidence=approvalReview;
  reviewDetail={roundId:approvalReview.roundId,stageId:stage.stageId,completed:approvalReview.completed.length,total:approvalReview.stages.length,...(stage.ownerSelfApproval?{ownerSelfApproval:true,approvalException:'OWNER_SELF_APPROVAL_USER_AUTHORISED_2026_11_18'}:{}),...(b.requestKey?{requestKey:b.requestKey}:{})};
 }else if(action==='RETURN'&&row.status==='PENDING_APPROVAL'){const {approvalReview,...retained}=row.private_snapshot;await db.prepare('UPDATE crm_quotation_workflows SET private_snapshot=?::text::jsonb WHERE quotation_id=?').run(JSON.stringify(retained),row.quotation_id);next='DRAFT';reviewEvidence=approvalReview;reviewDetail={roundId:approvalReview?.roundId??null,completed:approvalReview?.completed.length??0};}
 else if(action==='SEND'&&row.status==='APPROVED'){await requireCustomerHandler(db,row.public_snapshot.customerId,user);await ensureCurrent(db,row);await bindFirstQuotationOwner(db,row.public_snapshot.customerId,row.created_by,user);next='SENT';}
 else if(['WON','LOST'].includes(action)&&row.status==='SENT')next=action;
 else if(action==='EXPIRE'&&['SENT','APPROVED','PENDING_APPROVAL','DRAFT'].includes(row.status)&&row.public_snapshot.validUntil<today())next='EXPIRED';
 else if(action==='CANCEL'&&!['WON','LOST','EXPIRED','CANCELLED'].includes(row.status))next='CANCELLED';
 else fail(422,`Cannot ${String(action).toLowerCase()} a ${row.status} quotation.`);
 const base={DRAFT:'DRAFT',PENDING_APPROVAL:'DRAFT',APPROVED:'DRAFT',SENT:'SENT',WON:'ACCEPTED',LOST:'REJECTED',EXPIRED:'EXPIRED',CANCELLED:'CANCELLED'}[next];
 if(['CANCELLED','EXPIRED','LOST'].includes(next))await invalidateAvailability(db,row.quotation_id,user,why,{cancel:true});
 await db.prepare('UPDATE crm_quotation_workflows SET status=? WHERE quotation_id=?').run(next,row.quotation_id);
 await db.prepare('UPDATE quotations SET status=?,updated_by=?,updated_at=now() WHERE id=?').run(base,user.id,row.quotation_id);
 if(next==='SENT'&&row.public_snapshot.enquiryId)await db.prepare("UPDATE enquiries SET status='QUOTED',updated_by=?,updated_at=now() WHERE id=? AND status IN ('NEW','QUALIFIED')").run(user.id,row.public_snapshot.enquiryId);
 await event(db,user,row,action,why,{from:row.status,to:next,version:row.version,...reviewDetail},{...(action==='APPROVE'?{overrideFloor:row.private_snapshot.belowFloor,pricing:row.private_snapshot,...(b.requestKey?{approvalRequestHash:requestHash}:{})}:{}),...(reviewEvidence?{approvalReview:reviewEvidence}:{})});
 return visibleWithApproval(db,await rowFor(db,quoteId),user);
 });
}
export async function quoteHistory(db,quoteId,user){can(user,'quotations.read');await rowFor(db,quoteId);
 const versions=await db.prepare('SELECT * FROM crm_quotation_versions WHERE quotation_id=? ORDER BY version DESC').all(id(quoteId));
 const events=await db.prepare('SELECT e.*,u.name AS actor FROM crm_quotation_events e JOIN users u ON u.id=e.created_by WHERE quotation_id=? ORDER BY e.id DESC').all(id(quoteId));
 return {versions:versions.map(({private_snapshot,...r})=>({...r,...(costAccess(user)?{pricing:private_snapshot}:{})})),events:events.map(({private_detail,...r})=>({...r,...(costAccess(user)?{private_detail}:{})}))};
}
export async function duplicateQuote(db,quoteId,b,user){const source=await quoteDetail(db,quoteId,user),why=reason(b);
 // A fresh draft takes current costs/policy and never inherits approval.
 return saveQuote(db,null,{...source,...b,request:source.request?{...source.request,quantityConfirmed:false,termsConfirmed:false}:undefined,customerId:source.customerId,lines:source.lines,reason:why},user,id(quoteId));
}
export async function emailWorkflowQuote(db,quoteId,b,user,config,sendMail){
 can(user,'quotations.send');const why=text(b.reason||'Approved quotation emailed');
 if(typeof b.to!=='string'||b.to.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.to))fail(422,'A valid recipient email is required.');
 let attempted=false;
 try{return await work(db,user,why,async()=>{const row=await rowFor(db,quoteId);
 await requireQuotableCustomer(db,row.public_snapshot.customerId);
 await requireCustomerHandler(db,row.public_snapshot.customerId,user);
 if(!['APPROVED','SENT'].includes(row.status))fail(409,'Only an approved or sent quotation can be emailed.');
 if(!await db.prepare('SELECT id FROM customer_contacts WHERE customer_id=? AND lower(email)=lower(?) AND NOT is_deleted').get(row.public_snapshot.customerId,b.to))fail(422,'Recipient must be a registered contact email for this customer.');
 if(b.version!=null&&b.version!==row.version)fail(409,'Quotation changed. Reload before sending.');
 if(['APPROVED','SENT'].includes(row.status))await ensureCurrent(db,row);
 const quote=visible(row,{role:'EXECUTIVE'}),subject=text(b.subject||`Quotation ${quote.quotation_number}`,300),message=text(b.message||'Please find the approved quotation attached.',10000),pdf=await quotationPdf(quote);
 try{attempted=true;await sendMail(config,{quote,to:b.to,subject,message,pdf});}catch(err){fail(err.code==='SMTP_NOT_CONFIGURED'?503:502,err.code==='SMTP_NOT_CONFIGURED'?'Email delivery is not configured.':'Email delivery failed. Check delivery before retrying.');}
 await bindFirstQuotationOwner(db,row.public_snapshot.customerId,row.created_by,user);
 // Serialize edits/policy changes with delivery so a different version cannot be sent.
 await db.prepare("UPDATE crm_quotation_workflows SET status='SENT' WHERE quotation_id=?").run(row.quotation_id);
 await db.prepare("UPDATE quotations SET status='SENT',updated_by=?,updated_at=now() WHERE id=?").run(user.id,row.quotation_id);
 if(row.public_snapshot.enquiryId)await db.prepare("UPDATE enquiries SET status='QUOTED',updated_by=?,updated_at=now() WHERE id=? AND status IN ('NEW','QUALIFIED')").run(user.id,row.public_snapshot.enquiryId);
 await event(db,user,row,'EMAIL_SENT',why,{to:b.to,subject,version:row.version});return {ok:true,status:'SENT'};
 });}catch(err){if(attempted)await work(db,user,'Email attempt failed or delivery is uncertain',async()=>{const row=await rowFor(db,quoteId);await event(db,user,row,'EMAIL_FAILED_OR_UNCERTAIN','Email attempt failed or delivery is uncertain',{to:b.to,version:row.version,statusCode:err.status||500});});throw err;}
}
import {requireQuotableCustomer,requireCustomerHandler,contractForLine,requireContractBinding,bindFirstQuotationOwner} from './modules/operations/customer-gates.js';
