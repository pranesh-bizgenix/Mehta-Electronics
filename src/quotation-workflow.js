import crypto from 'node:crypto';
import {transaction,id,validDate,validateTax} from './crm-modules.js';
import {writeAudit,recordQuotationRevision,quotationView} from './db.js';
import {hasPermission} from './rbac.js';
import {calculateQuotation,scaled} from '../public/quotation-math.js';
import {quotationPdf} from './quotation-document.js';

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
export async function saveQuotePolicy(db,b,user){can(user,'quotations.policy.manage');const why=reason(b),floor=String(b.floorPercent),basis=b.marginBasis;
 try{if(scaled(floor)>100000000n)fail(422,'Invalid margin floor.');}catch(e){fail(422,e.message);}
 if(!['LINE_AND_TOTAL','TOTAL'].includes(basis))fail(422,'Select a margin basis.');
 const seller=state(b.sellerState),letterhead={name:text(b.letterhead?.name??'',200),address:text(b.letterhead?.address??'',1000),gstin:text(b.letterhead?.gstin??'',15).toUpperCase(),email:text(b.letterhead?.email??'',200),phone:text(b.letterhead?.phone??'',60)};
 if(!letterhead.name)fail(422,'Company name is required.');validateTax(letterhead.gstin,seller);
 return work(db,user,why,async()=>{const old=await quotePolicy(db);
 if(old)await db.prepare('UPDATE crm_quotation_policy SET floor_percent=?,margin_basis=?,seller_state=?,letterhead=?::text::jsonb,revision=revision+1 WHERE id=?').run(floor,basis,seller,JSON.stringify(letterhead),old.id);
 else await db.prepare('INSERT INTO crm_quotation_policy(floor_percent,margin_basis,seller_state,letterhead,created_by) VALUES(?,?,?,?::text::jsonb,?)').run(floor,basis,seller,JSON.stringify(letterhead),user.id);
 const updated=await quotePolicy(db);await event(db,user,null,'POLICY_CHANGED',why,{revision:updated.revision},{before:old,after:updated});return updated;
 });
}
export async function quoteCost(db,itemId,user){can(user,'quotations.cost.read');return await db.prepare('SELECT item_id,unit_cost::text AS unit_cost,updated_at FROM crm_quotation_costs WHERE item_id=?').get(id(itemId))||{item_id:id(itemId),unit_cost:null};}
export async function pricingHistory(db,itemId,user){can(user,'quotations.cost.read');
 return db.prepare("SELECT e.*,u.name AS actor FROM crm_quotation_events e JOIN users u ON u.id=e.created_by WHERE e.quotation_id IS NULL AND ((?='' AND e.action='POLICY_CHANGED') OR (e.action='COST_CHANGED' AND e.public_detail->>'itemId'=?)) ORDER BY e.id DESC").all(itemId?String(id(itemId)):'',itemId?String(id(itemId)):'');
}
export async function saveQuoteCost(db,itemId,b,user){can(user,'quotations.cost.manage');const why=reason(b),cost=String(b.unitCost);try{scaled(cost);}catch(e){fail(422,e.message);}
 return work(db,user,why,async()=>{
 if(!await db.prepare("SELECT id FROM items WHERE id=? AND status='ACTIVE'").get(id(itemId)))fail(422,'Select an active CRM item.');
 const old=await quoteCost(db,itemId,user);
 if(old.unit_cost!==null)await db.prepare('UPDATE crm_quotation_costs SET unit_cost=? WHERE item_id=?').run(cost,id(itemId));
 else await db.prepare('INSERT INTO crm_quotation_costs(item_id,unit_cost,created_by) VALUES(?,?,?)').run(id(itemId),cost,user.id);
 await event(db,user,null,'COST_CHANGED',why,{itemId:id(itemId)},{before:old.unit_cost,after:cost});return quoteCost(db,itemId,user);
 });
}
function visible(row,user){const out={...row.public_snapshot,id:row.quotation_id,status:row.status,version:row.version,created_by:row.created_by,updated_at:row.updated_at,duplicateOf:row.duplicate_of};
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
 if(row){const p=row.public_snapshot;q.subtotal=Number(p.subtotal);q.tax_total=Number((Number(p.cgst)+Number(p.sgst)+Number(p.igst)).toFixed(2));q.total=Number(p.total);q.workflowStatus=row.status;}
 return q;
}
export async function quoteDetail(db,quoteId,user){can(user,'quotations.read');return visible(await rowFor(db,quoteId),user);}
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
 const policy=await quotePolicy(db);if(!policy)fail(409,'The owner must configure quotation policy and company letterhead first.');
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
 }
 let math;try{math=calculateQuotation(lines,policy.seller_state,pos,costs,policy.floor_percent,policy.margin_basis);}catch(e){fail(422,e.message);}
 if(scaled(math.total)>999999999999000000n)fail(422,'Quotation total exceeds the supported limit.');
 const {cost,missingCost,marginPercent,belowFloor,...publicMath}=math;
 const privateLines=math.lines.map(({itemId,unitCost,cost,marginPercent,belowFloor})=>({itemId,unitCost,cost,marginPercent,belowFloor}));
 publicMath.lines=math.lines.map(({unitCost:ignored,cost:ignored2,marginPercent:ignored3,belowFloor:ignored4,...l})=>l);
 return {policy,public:{quotation_number:number,customerId:customer.id,customer_name:customer.name,customerGstin:customer.gstin||'',customerAddress:customer.billing_address||'',enquiryId,validUntil:b.validUntil,placeOfSupply:pos,sellerState:policy.seller_state,supplyType:'DOMESTIC_STANDARD',terms:text(b.terms??'',10000),notes:text(b.notes??'',10000),letterhead:policy.letterhead,...publicMath},private:{cost,missingCost,marginPercent,belowFloor,floorPercent:policy.floor_percent,marginBasis:policy.margin_basis,lines:privateLines}};
}
async function persistVersion(db,row,user,why){
 await db.prepare('INSERT INTO crm_quotation_versions(quotation_id,version,public_snapshot,private_snapshot,reason,created_by) VALUES(?,?,?::text::jsonb,?::text::jsonb,?,?)').run(row.quotation_id,row.version,JSON.stringify(row.public_snapshot),JSON.stringify(row.private_snapshot),why,user.id);
 await recordQuotationRevision(db,row.quotation_id,user.id,why);
}
async function baseLines(db,qid,snap){await db.prepare("UPDATE quotation_lines SET is_deleted=true,status='ARCHIVED' WHERE quotation_id=? AND NOT is_deleted").run(qid);
 for(const [position,l]of snap.lines.entries())await db.prepare('INSERT INTO quotation_lines(quotation_id,item_id,description,uom,quantity,unit_price,discount_percent,tax_percent,position) VALUES(?,?,?,?,?,?,?,?,?)').run(qid,l.itemId,l.description,l.uom,l.quantity,l.unitPrice,l.discountPercent,l.taxPercent,position);
}
export async function saveQuote(db,quoteId,b,user,duplicateOf=null){can(user,quoteId?'quotations.update':'quotations.create');const why=reason(b);
 return work(db,user,why,async()=>{
 const old=quoteId?await rowFor(db,quoteId):null;
 if(old&&(!['DRAFT','APPROVED','PENDING_APPROVAL'].includes(old.status)||b.version!==old.version))fail(409,'Quotation changed or cannot be edited. Reload; sent quotations must be duplicated.');
 const number=old?.public_snapshot.quotation_number||`QTN-${new Date().getUTCFullYear()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
 const enquiryId=b.enquiryId?id(b.enquiryId):null,s=await snapshot(db,b,number,enquiryId);
 let qid=old?.quotation_id;
 if(!qid)qid=(await db.prepare('INSERT INTO quotations(quotation_number,customer_id,enquiry_id,valid_until,terms,notes,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)').run(number,s.public.customerId,enquiryId,b.validUntil,s.public.terms,s.public.notes,user.id,user.id)).insertedId;
 else await db.prepare("UPDATE quotations SET customer_id=?,enquiry_id=?,valid_until=?,terms=?,notes=?,status='DRAFT',updated_by=?,updated_at=now() WHERE id=?").run(s.public.customerId,enquiryId,b.validUntil,s.public.terms,s.public.notes,user.id,qid);
 await baseLines(db,qid,s.public);
 if(old)await db.prepare("UPDATE crm_quotation_workflows SET version=version+1,status='DRAFT',policy_revision=?,place_of_supply=?,public_snapshot=?::text::jsonb,private_snapshot=?::text::jsonb WHERE quotation_id=?").run(s.policy.revision,s.public.placeOfSupply,JSON.stringify(s.public),JSON.stringify(s.private),qid);
 else await db.prepare('INSERT INTO crm_quotation_workflows(quotation_id,policy_revision,place_of_supply,public_snapshot,private_snapshot,created_by) VALUES(?,?,?,?::text::jsonb,?::text::jsonb,?)').run(qid,s.policy.revision,s.public.placeOfSupply,JSON.stringify(s.public),JSON.stringify(s.private),user.id);
 if(duplicateOf)await db.prepare('UPDATE crm_quotation_workflows SET duplicate_of=? WHERE quotation_id=?').run(duplicateOf,qid);
 const row=await rowFor(db,qid);await persistVersion(db,row,user,why);await event(db,user,row,duplicateOf?'DUPLICATED':old?'REVISED':'CREATED',why,{status:'DRAFT',version:row.version,...(duplicateOf?{sourceId:duplicateOf}:{})});return visible(row,user);
 });
}
async function ensureCurrent(db,row){const p=await quotePolicy(db);if(!p||p.revision!==row.policy_revision)fail(409,'Policy changed. Revise and resubmit the quotation.');
 for(const l of row.private_snapshot.lines){const c=await db.prepare('SELECT unit_cost::text AS value FROM crm_quotation_costs WHERE item_id=?').get(l.itemId);if(c?.value==null||scaled(c.value)!==scaled(l.unitCost??'0'))fail(409,'Item costs changed or are missing. Revise and resubmit the quotation.');}
 if(row.private_snapshot.missingCost)fail(422,'The owner must enter costs for every item before submission.');
 if(row.public_snapshot.subtotal==='0.00')fail(422,'A quotation must have a positive net sales amount before submission.');
 if(row.public_snapshot.validUntil<today())fail(422,'Quotation validity has expired.');
}
export async function quoteAction(db,quoteId,b,user){const why=reason(b),action=b.action;
 can(user,action==='APPROVE'||action==='RETURN'?'quotations.approve':action==='SUBMIT'?'quotations.update':'quotations.status');
 return work(db,user,why,async()=>{const row=await rowFor(db,quoteId);if(b.version!==row.version)fail(409,'Quotation changed. Reload before continuing.');
 let next;
 if(action==='SUBMIT'&&row.status==='DRAFT'){await ensureCurrent(db,row);next='PENDING_APPROVAL';}
 else if(action==='APPROVE'&&row.status==='PENDING_APPROVAL'){
  await ensureCurrent(db,row);const last=await db.prepare('SELECT created_by FROM crm_quotation_versions WHERE quotation_id=? AND version=?').get(row.quotation_id,row.version);
  if(last.created_by===user.id||row.created_by===user.id)fail(403,'A different manager or owner must approve this quotation.');
  if(row.private_snapshot.belowFloor&&b.overrideFloor!==true)fail(422,'Explicitly confirm the below-floor exception and provide its reason.');next='APPROVED';
 }else if(action==='RETURN'&&row.status==='PENDING_APPROVAL')next='DRAFT';
 else if(action==='SEND'&&row.status==='APPROVED'){await ensureCurrent(db,row);next='SENT';}
 else if(['WON','LOST'].includes(action)&&row.status==='SENT')next=action;
 else if(action==='EXPIRE'&&['SENT','APPROVED','PENDING_APPROVAL','DRAFT'].includes(row.status)&&row.public_snapshot.validUntil<today())next='EXPIRED';
 else if(action==='CANCEL'&&!['WON','LOST','EXPIRED','CANCELLED'].includes(row.status))next='CANCELLED';
 else fail(422,`Cannot ${String(action).toLowerCase()} a ${row.status} quotation.`);
 const base={DRAFT:'DRAFT',PENDING_APPROVAL:'DRAFT',APPROVED:'DRAFT',SENT:'SENT',WON:'ACCEPTED',LOST:'REJECTED',EXPIRED:'EXPIRED',CANCELLED:'CANCELLED'}[next];
 await db.prepare('UPDATE crm_quotation_workflows SET status=? WHERE quotation_id=?').run(next,row.quotation_id);
 await db.prepare('UPDATE quotations SET status=?,updated_by=?,updated_at=now() WHERE id=?').run(base,user.id,row.quotation_id);
 if(next==='SENT'&&row.public_snapshot.enquiryId)await db.prepare("UPDATE enquiries SET status='QUOTED',updated_by=?,updated_at=now() WHERE id=? AND status IN ('NEW','QUALIFIED')").run(user.id,row.public_snapshot.enquiryId);
 await event(db,user,row,action,why,{from:row.status,to:next,version:row.version},action==='APPROVE'?{overrideFloor:row.private_snapshot.belowFloor,pricing:row.private_snapshot}:{});
 return visible(await rowFor(db,quoteId),user);
 });
}
export async function quoteHistory(db,quoteId,user){can(user,'quotations.read');await rowFor(db,quoteId);
 const versions=await db.prepare('SELECT * FROM crm_quotation_versions WHERE quotation_id=? ORDER BY version DESC').all(id(quoteId));
 const events=await db.prepare('SELECT e.*,u.name AS actor FROM crm_quotation_events e JOIN users u ON u.id=e.created_by WHERE quotation_id=? ORDER BY e.id DESC').all(id(quoteId));
 return {versions:versions.map(({private_snapshot,...r})=>({...r,...(costAccess(user)?{pricing:private_snapshot}:{})})),events:events.map(({private_detail,...r})=>({...r,...(costAccess(user)?{private_detail}:{})}))};
}
export async function duplicateQuote(db,quoteId,b,user){const source=await quoteDetail(db,quoteId,user),why=reason(b);
 // A fresh draft takes current costs/policy and never inherits approval.
 return saveQuote(db,null,{...source,...b,customerId:source.customerId,lines:source.lines,reason:why},user,id(quoteId));
}
export async function emailWorkflowQuote(db,quoteId,b,user,config,sendMail){
 can(user,'quotations.send');const why=text(b.reason||'Approved quotation emailed');
 if(typeof b.to!=='string'||b.to.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.to))fail(422,'A valid recipient email is required.');
 let attempted=false;
 try{return await work(db,user,why,async()=>{const row=await rowFor(db,quoteId);
 if(!['APPROVED','SENT'].includes(row.status))fail(409,'Only an approved or sent quotation can be emailed.');
 if(b.version!=null&&b.version!==row.version)fail(409,'Quotation changed. Reload before sending.');
 if(row.status==='APPROVED')await ensureCurrent(db,row);
 const quote=visible(row,{role:'EXECUTIVE'}),subject=text(b.subject||`Quotation ${quote.quotation_number}`,300),message=text(b.message||'Please find the approved quotation attached.',10000),pdf=await quotationPdf(quote);
 try{attempted=true;await sendMail(config,{quote,to:b.to,subject,message,pdf});}catch(err){fail(err.code==='SMTP_NOT_CONFIGURED'?503:502,err.code==='SMTP_NOT_CONFIGURED'?'Email delivery is not configured.':'Email delivery failed. Check delivery before retrying.');}
 // Serialize edits/policy changes with delivery so a different version cannot be sent.
 await db.prepare("UPDATE crm_quotation_workflows SET status='SENT' WHERE quotation_id=?").run(row.quotation_id);
 await db.prepare("UPDATE quotations SET status='SENT',updated_by=?,updated_at=now() WHERE id=?").run(user.id,row.quotation_id);
 if(row.public_snapshot.enquiryId)await db.prepare("UPDATE enquiries SET status='QUOTED',updated_by=?,updated_at=now() WHERE id=? AND status IN ('NEW','QUALIFIED')").run(user.id,row.public_snapshot.enquiryId);
 await event(db,user,row,'EMAIL_SENT',why,{to:b.to,subject,version:row.version});return {ok:true,status:'SENT'};
 });}catch(err){if(attempted)await work(db,user,'Email attempt failed or delivery is uncertain',async()=>{const row=await rowFor(db,quoteId);await event(db,user,row,'EMAIL_FAILED_OR_UNCERTAIN','Email attempt failed or delivery is uncertain',{to:b.to,version:row.version,statusCode:err.status||500});});throw err;}
}
