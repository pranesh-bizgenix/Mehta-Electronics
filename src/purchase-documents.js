import crypto from 'node:crypto';
import {transaction,id,validDate,validateTax} from './crm-modules.js';
import {hasPermission} from './rbac.js';
import {writeAudit} from './db.js';
import {scaled,money} from '../public/quotation-math.js';
import {financialYear,documentNumber,purchaseDocumentTotals,validateDocumentYear,validateDocumentPrefixes} from './purchase-document-math.js';
import {purchaseDocumentPdf} from './purchase-document-pdf.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const text=(v,max=2000)=>{if(v==null)return '';if(typeof v!=='string'||v.length>max)fail(422,`Use text of at most ${max} characters.`);return v.trim();};
const why=b=>{const v=text(b.reason);if(v.length<3)fail(422,'Enter a reason of at least three characters.');return v;};
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const kinds=['RFQ','PO'];
const kind=k=>{if(!kinds.includes(k))fail(422,'Choose RFQ or PO.');return k;};
const permit=(u,p)=>{if(!p||!hasPermission(u,p))fail(403,'Document permission is not configured or is not granted to your role.');};
const guard=db=>db.prepare("SELECT pg_advisory_xact_lock(812733),set_config('mehta.purchase_document_write','authorized',true)").get();
async function audit(db,u,record,action,reason,detail={}){await writeAudit(db,{userId:u.id,entity:'PURCHASE_DOCUMENT',recordId:String(record),action,reason,newValue:detail});}
export async function documentSettings(db){return db.prepare('SELECT * FROM company_document_settings WHERE id=1').get();}
export async function saveDocumentSettings(db,b,u){
 permit(u,'rules.manage');const reason=why(b),v=b.value;if(!v||typeof v!=='object'||Array.isArray(v))fail(422,'Provide document settings.');
 const out={};for(const key of ['name','gstin','stateCode','address','contact','footer','purchasingTerms','taxWithholdingLine'])out[key]=text(v[key],key==='purchasingTerms'?10000:2000);
 for(const [key,max]of [['name',200],['address',500],['contact',250],['footer',120]])if(out[key].length>max)fail(422,`Company ${key} must be at most ${max} characters.`);
 const tax=validateTax(out.gstin,out.stateCode);if(tax.stateCode&&tax.stateCode!=='33')fail(422,'Mehta buyer state must be Tamil Nadu (33).');out.gstin=tax.gstin||'';out.stateCode=tax.stateCode||'';
 if(typeof v.showListPriceDiscount!=='boolean')fail(422,'Choose whether list price and discount are printed.');out.showListPriceDiscount=v.showListPriceDiscount;
 out.logoBase64=text(v.logoBase64,280000);if(out.logoBase64){const bytes=Buffer.from(out.logoBase64,'base64');if(bytes.length>200000||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail(422,'Use a PNG logo of at most 200 KB.');}
 out.documents={};for(const k of kinds){const c=v.documents?.[k];if(!c)fail(422,`Configure ${k}.`);const d={};
  for(const a of ['create','approve','download','send']){d[a]=text(c[a],100);if(d[a]&&!await db.prepare('SELECT key FROM permissions WHERE key=?').get(d[a]))fail(422,'Select an existing permission key.');}
  d.prefix=text(c.prefix,20);if(d.prefix&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(d.prefix))fail(422,'Prefix permits letters, digits, underscore and hyphen.');
  if(typeof c.allowDraftDownload!=='boolean')fail(422,'Choose the draft-download policy.');d.allowDraftDownload=c.allowDraftDownload;out.documents[k]=d;
 }
 try{validateDocumentPrefixes(out.documents.RFQ.prefix,out.documents.PO.prefix);}catch(e){fail(422,e.message);}
 return transaction(db,u,reason,async()=>{await guard(db);const old=await documentSettings(db);if(b.version!==old.version)fail(409,'Settings changed. Reload.');
 await db.prepare('UPDATE company_document_settings SET value=?::text::jsonb,version=version+1,updated_by=?,updated_at=now() WHERE id=1').run(JSON.stringify(out),u.id);
 const {logoBase64,...auditedSettings}=out;await audit(db,u,'settings','SETTINGS_CHANGED',reason,{version:old.version+1,settings:auditedSettings,logoSha256:logoBase64?digest(logoBase64):null});return documentSettings(db);});
}
export async function getDocument(db,recordId,u,{lock=false}={}){
 permit(u,'purchasing.read');const row=await db.prepare(`SELECT * FROM purchase_documents WHERE id=?${lock?' FOR UPDATE':''}`).get(id(recordId));if(!row)fail(404,'Document not found.');return row;
}
export async function listDocuments(db,k,u,url){permit(u,'purchasing.read');const page=Number(url?.searchParams.get('page')||1),search='%'+String(url?.searchParams.get('search')||'').slice(0,200)+'%';if(!Number.isSafeInteger(page)||page<1||page>1000000)fail(422,'Invalid page.');
 const where="kind=? AND (number ILIKE ? OR payload->'supplier'->>'name' ILIKE ?)",args=[kind(k),search,search],total=(await db.prepare(`SELECT count(*) AS n FROM purchase_documents WHERE ${where}`).get(...args)).n;
 return {data:await db.prepare(`SELECT id,kind,number,status,version,payload,created_by,created_at FROM purchase_documents WHERE ${where} ORDER BY id DESC LIMIT 25 OFFSET ?`).all(...args,(page-1)*25),pagination:{page,pageSize:25,total,pages:Math.ceil(total/25)}};
}
async function validatedPayload(db,k,b,settings){
 const v=await db.prepare("SELECT id,payload FROM crm_procurement_vendors WHERE id=? AND status='ACTIVE' AND NOT is_deleted").get(id(b.vendorId));if(!v)fail(422,'Choose an active purchasing vendor.');
 if(!validDate(b.date))fail(422,'Enter a document date.');if(!Array.isArray(b.lines)||!b.lines.length||b.lines.length>100)fail(422,'Enter 1 to 100 lines.');
 const p={vendorId:v.id,date:b.date,supplier:v.payload,company:settings.value,settingsVersion:settings.version,lines:[],terms:text(b.terms,10000)};
 for(const l of b.lines){
  const row={};for(const key of ['partCode','description','make','uom','hsn'])row[key]=text(l[key],key==='description'?1000:200);
  if(!row.partCode||!row.description||!row.uom)fail(422,'Each line needs a code, description and UoM.');
  try{row.quantity=String(l.quantity);if(scaled(row.quantity)<=0n)throw new Error('Quantity must be positive.');
   if(k==='PO')for(const key of ['unitPrice','discountPercent','taxPercent']){row[key]=String(l[key]);scaled(row[key]);}
  }catch(e){fail(422,e.message);}p.lines.push(row);
 }
 if(k==='RFQ'){
  if(!validDate(b.responseDeadline)||b.responseDeadline<b.date)fail(422,'Response deadline must be on or after the RFQ date.');
  p.responseDeadline=b.responseDeadline;p.requestedLeadTime=text(b.requestedLeadTime);p.requestedTerms={};for(const key of ['priceBasis','delivery','payment','validity'])p.requestedTerms[key]=text(b.requestedTerms?.[key]);
 }else{
  if(!validDate(b.deliveryDate)||b.deliveryDate<b.date)fail(422,'Delivery date must be on or after the PO date.');
  p.deliveryDate=b.deliveryDate;for(const key of ['billTo','shipTo','paymentTerms','freightPacking','signatory'])p[key]=text(b[key]);
  if(typeof b.roundToRupee!=='boolean')fail(422,'Choose round-off policy.');p.roundToRupee=b.roundToRupee;
  try{p.totals=purchaseDocumentTotals(p.lines,v.payload.stateCode,settings.value.stateCode,b.roundToRupee);p.lines=p.totals.lines.map(l=>({...l,netRate:money((scaled(l.unitPrice)*(100000000n-scaled(l.discountPercent))*100n+50000000000000n)/100000000000000n)}));}catch(e){fail(422,e.message);}
 }
 return {vendorId:v.id,payload:p};
}
export async function savePurchaseDocument(db,recordId,b,u){const reason=why(b);return transaction(db,u,reason,async()=>{
 await guard(db);const settings=await documentSettings(db),k=kind(b.kind),policy=settings.value.documents?.[k];permit(u,policy?.create);
 let old;if(recordId){old=await getDocument(db,recordId,u,{lock:true});if(old.kind!==k||old.status!=='DRAFT'||old.version!==b.version)fail(409,'Only the current draft can be edited.');}
 if(!old&&!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(b.requestKey||''))fail(422,'A retry UUID is required.');
 const hash=digest(b);if(!old){const existing=await db.prepare('SELECT * FROM purchase_documents WHERE request_key=?::uuid').get(b.requestKey);if(existing){if(existing.created_by!==u.id||existing.payload.requestHash!==hash)fail(409,'Retry key was already used.');return existing;}}
 const {vendorId,payload}=await validatedPayload(db,k,b,settings);try{validateDocumentYear(payload.date,old?.payload.date);}catch(e){fail(422,e.message);}payload.requestHash=hash;payload.editorId=u.id;
 let record;if(old){await db.prepare('UPDATE purchase_documents SET vendor_id=?,payload=?::text::jsonb,version=version+1,approved_by=NULL WHERE id=?').run(vendorId,JSON.stringify(payload),old.id);record=old.id;}
 else{const fy=financialYear(b.date);let number;try{documentNumber(policy.prefix,fy,1);const n=await db.prepare('INSERT INTO purchase_document_counters(kind,financial_year,next_value) VALUES(?,?,2) ON CONFLICT(kind,financial_year) DO UPDATE SET next_value=purchase_document_counters.next_value+1 RETURNING next_value-1 AS sequence').get(k,fy);number=documentNumber(policy.prefix,fy,n.sequence);}catch(e){fail(422,e.message);}
  const r=await db.prepare('INSERT INTO purchase_documents(kind,number,vendor_id,payload,request_key,created_by) VALUES(?,?,?,?::text::jsonb,?::uuid,?)').run(k,number,vendorId,JSON.stringify(payload),b.requestKey,u.id);record=r.insertedId;}
 await audit(db,u,record,old?'REVISED':'CREATED',reason,{kind:k});return getDocument(db,record,u);
 });}
export function documentTransition(row,action,actorId){
 if(action==='SUBMIT'&&row.status==='DRAFT')return 'PENDING_APPROVAL';
 if(action==='APPROVE'&&row.status==='PENDING_APPROVAL'){if(row.created_by===actorId||row.payload?.editorId===actorId)fail(403,'A different authorised reviewer must approve purchasing documents.');return 'APPROVED';}
 if(action==='RETURN'&&['PENDING_APPROVAL','APPROVED'].includes(row.status))return 'DRAFT';
 if(action==='MARK_SENT'&&row.status==='APPROVED')return 'SENT';
 if(action==='CANCEL'&&['DRAFT','PENDING_APPROVAL','APPROVED'].includes(row.status))return 'CANCELLED';
 fail(409,'Invalid document transition.');
}
function complete(row,settings){
 if(row.status!=='SENT'&&row.payload.settingsVersion!==settings.version)fail(409,'Company settings changed. Return to draft and save again before approval or download.');
 const p=row.payload,c=p.company;
 for(const key of ['name','gstin','stateCode','address','contact'])if(!c[key])fail(409,`Confirm company ${key} in document settings.`);
 if(!p.supplier.address)fail(409,'Confirm supplier address.');
 if(row.kind==='PO'){
  if(!p.supplier.gstin)fail(409,'Confirm supplier GSTIN.');
  for(const key of ['billTo','shipTo','paymentTerms','freightPacking','signatory','terms'])if(!p[key])fail(409,`Confirm ${key} before submission.`);
  if(p.lines.some(l=>!l.hsn))fail(409,'Confirm HSN for every PO line.');
 }
}
async function validApproval(db,row,policy){
 if(row.status==='SENT'){if(!row.approved_by||row.approved_by===row.created_by||row.approved_by===row.payload.editorId)fail(409,'The sent document has no independent approval evidence.');return;}
 if(row.status!=='APPROVED')return;
 const reviewer=await db.prepare("SELECT u.id,u.role,u.status,r.status AS role_status FROM users u JOIN roles r ON r.key=u.role WHERE u.id=?").get(row.approved_by);
 if(!reviewer||reviewer.status!=='ACTIVE'||reviewer.role_status!=='ACTIVE'||reviewer.id===row.created_by||reviewer.id===row.payload.editorId||!policy?.approve||!hasPermission(reviewer,policy.approve))fail(409,'The approving user no longer has current approval authority. Return the approved document to draft for review.');
}
export async function actPurchaseDocument(db,recordId,b,u){const reason=why(b);return transaction(db,u,reason,async()=>{
 await guard(db);const row=await getDocument(db,recordId,u,{lock:true}),settings=await documentSettings(db),policy=settings.value.documents?.[row.kind];
 if(row.version!==b.version)fail(409,'Document changed. Reload.');
 permit(u,policy?.[['APPROVE','RETURN'].includes(b.action)?'approve':b.action==='MARK_SENT'?'send':'create']);
 const next=documentTransition(row,b.action,u.id);if(['SUBMIT','APPROVE','MARK_SENT'].includes(b.action))complete(row,settings);
 if(b.action==='MARK_SENT')await validApproval(db,row,policy);
 if(b.action==='MARK_SENT'&&b.confirmSent!==true)fail(422,'Confirm the document was sent outside ControlDesk. No message is sent by this action.');
 await db.prepare('UPDATE purchase_documents SET status=?,version=version+1,approved_by=? WHERE id=?').run(next,next==='APPROVED'?u.id:next==='DRAFT'?null:row.approved_by,row.id);
 await audit(db,u,row.id,b.action,reason,{from:row.status,to:next,version:row.version+1});return getDocument(db,row.id,u);
 });}
export async function downloadPurchaseDocument(db,recordId,b,u){const reason=why(b);return transaction(db,u,reason,async()=>{
 await guard(db);const row=await getDocument(db,recordId,u,{lock:true}),settings=await documentSettings(db);permit(u,settings.value.documents?.[row.kind]?.download);
 if(row.version!==b.version)fail(409,'Document changed. Reload before downloading.');
 const draft=row.status==='DRAFT';if(!['APPROVED','SENT'].includes(row.status)&&!(draft&&settings.value.documents?.[row.kind]?.allowDraftDownload===true))fail(409,'Only approved or sent documents can be downloaded. Draft downloads are disabled by default.');
 if(!draft){complete(row,settings);await validApproval(db,row,settings.value.documents?.[row.kind]);}
 const bytes=await purchaseDocumentPdf(row,{draft});await audit(db,u,row.id,b.preview?'PDF_PREVIEW':'PDF_DOWNLOAD',reason,{version:row.version,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),draft});return {bytes,number:row.number};
 });}
