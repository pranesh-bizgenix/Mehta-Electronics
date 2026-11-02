import crypto from 'node:crypto';
import {OPERATION_DESCRIPTORS,CLOSED_OPERATION_STATUSES} from '../../../public/operation-descriptors.js';
import {forbidden,conflict,notFound,validationFailed} from '../../core/errors.js';
import {validDate,decimal} from '../../crm-modules.js';
import {sha256} from '../../core/runtime.js';

const finance=user=>['OWNER','ACCOUNTS'].includes(user?.role);
const uuid=value=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw validationFailed('Choose a valid record.');return value;};
const text=(value,label,max=2000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw validationFailed(`${label} is required (up to ${max} characters).`);return value.trim();};
const scaled=value=>{const [a,b='']=String(value).split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));};
const transitions={OPEN:['START','SUBMIT','RESPOND','RESOLVE','CANCEL'],IN_PROGRESS:['SUBMIT','RESPOND','RESOLVE','CANCEL'],RESPONDED:['START','SUBMIT','RESOLVE','CANCEL'],PENDING_APPROVAL:['APPROVE','CONFIRM','REJECT'],APPROVED:['RESOLVE']};
export class OperationsService {
 constructor(dependencies){Object.assign(this,dependencies);}
 definition(user,kind,write=false){const d=OPERATION_DESCRIPTORS[kind];if(!d)throw notFound('Workflow not found.');
  if(d.financial&&!finance(user))throw forbidden('Accounts and Owner only.');
  this.access.require(user,d.financial?(write?'collections.write':'collections.read'):(write?'operations.write':'operations.read'));return d;}
 async catalogue(user){return Object.fromEntries(Object.entries(OPERATION_DESCRIPTORS).filter(([,d])=>!d.financial||finance(user)));}
 project(row,user){const copy={...row,payload:{...row.payload}};if(!finance(user))delete copy.payload.originalText;return copy;}
 async list(user,kind,query){this.definition(user,kind);return this.repository.list(kind,query);}
 async detail(user,recordId){const row=await this.repository.record(uuid(recordId));if(!row)throw notFound();this.definition(user,row.kind);
  const events=await this.repository.events(row.id),policy=row.kind==='WARRANTY'?await this.rules.get('warranty.policy'):null;
  const responseHours=row.first_response_at?(new Date(row.first_response_at)-new Date(row.created_at))/3600000:null;
  return {record:this.project(row,user),events,original:row.kind==='INTAKE'&&finance(user)?await this.repository.originalForRecord(row.id):null,actions:Object.keys(OPERATION_DESCRIPTORS[row.kind].actions).filter(a=>(transitions[row.status]||[]).includes(a)).filter(a=>['APPROVE','CONFIRM','REJECT'].includes(a)?row.created_by!==user.id&&this.access.can(user,OPERATION_DESCRIPTORS[row.kind].financial?'collections.approve':'operations.approve'):[row.owner_id,row.backup_id].includes(user.id)||this.access.can(user,'work.reassign')),
   firstResponse:{at:row.first_response_at,hours:responseHours,targetHours:policy?.value.firstResponseHours??null,note:'First response time, not total resolution time.'},
   approvalChecks:row.kind==='PAYMENT'?(await this.rules.get('payments.authorisation'))?.value.checks||[]:[],
   note:row.kind==='INVOICE'?'Reference to an existing invoice only. This does not issue an invoice, IRN or e-Way bill.':row.kind==='PAYMENT'?'CRM approval only. This does not transfer money or post to Tally.':null};}
 async create(user,kind,input){const d=this.definition(user,kind,true),reason=text(input.reason,'Reason'),title=text(input.title,'Title',200);
  if(!input.payload||typeof input.payload!=='object'||Array.isArray(input.payload))throw validationFailed('Enter the required details.');
  const payload={};for(const key of Object.keys(input.payload))if(!d.fields.some(f=>f.key===key))throw validationFailed(`Unknown field: ${key}.`);
  for(const f of d.fields){const v=input.payload[f.key];if(v==null||v===''){if(f.required)throw validationFailed(`${f.label} is required.`);continue;}
   payload[f.key]=text(v,f.label,f.key==='originalText'?500000:f.type==='textarea'?10000:2000);
   if(f.type==='decimal')payload[f.key]=decimal(v,f.label,{positive:true});
   if(f.type==='date'&&!validDate(v))throw validationFailed(`${f.label} must be a valid date.`);
   if(f.type==='datetime-local'){const at=new Date(v);if(!Number.isFinite(at.valueOf())||at>this.clock.now())throw validationFailed('Source check time must be a valid past time.');payload[f.key]=at.toISOString();}
  }
  if(kind==='INTAKE'&&!['EMAIL','WHATSAPP','MANUAL'].includes(payload.channel))throw validationFailed('Choose a message channel.');
  if(kind==='INTAKE'&&!['BANK','SPAM','PO_RECEIVED','LEAD','QUOTATION_REQUEST','OPERATIONS','ACCOUNTS','CUSTOMER_SUPPORT','REVIEW'].includes(payload.category))throw validationFailed('Choose a routing category.');
  if(kind==='WARRANTY'&&!['TECHNICAL_FAULT','PHYSICAL_DAMAGE','UNDETERMINED'].includes(payload.faultType))throw validationFailed('Choose a fault type.');
  if(kind==='INTAKE'&&['BANK','SPAM'].includes(payload.category)){
   await this.audit.record({actorId:user.id,entity:'INBOUND_SUPPRESSION',recordId:sha256(`${payload.channel}:${payload.externalId}`),action:'IGNORE',reason:'Bank email or spam: no draft, reply or automation.'});
   return {ignored:true,note:'Ignored. No CRM record, reply, draft or automation was created.'};
  }
  const ownerId=Number(input.ownerId||user.id),backupId=input.backupId?Number(input.backupId):null;
  if(!Number.isSafeInteger(ownerId)||!await this.repository.user(ownerId)||backupId&&(!Number.isSafeInteger(backupId)||!await this.repository.user(backupId)||backupId===ownerId))throw validationFailed('Choose active, different owner and backup users.');
  if(!backupId)throw validationFailed('Select a backup owner.');
  const customerId=input.customerId?Number(input.customerId):null;
  if(customerId&&(!Number.isSafeInteger(customerId)||!await this.repository.customer(customerId)))throw validationFailed('Choose an existing customer.');
  if(kind!=='INTAKE'&&!customerId)throw validationFailed('Choose the customer.');
  let dueAt=null;if(input.dueAt){const at=new Date(input.dueAt);if(!Number.isFinite(at.valueOf()))throw validationFailed('Enter a valid due time.');dueAt=at.toISOString();}
  return this.transactions.run(user,reason,async()=>{
   let originalHash;
   if(kind==='INTAKE'){
    originalHash=sha256(payload.originalText);await this.repository.lockKey(`${payload.channel}:${payload.externalId}`);
    const existing=await this.repository.original(payload.channel,payload.externalId);
    if(existing){if(existing.sha256!==originalHash)throw conflict('This message ID has different content. Review the original; it was not overwritten.');return {record:this.project(await this.repository.record(existing.record_id),user),duplicate:true};}
   }
   if(payload.invoiceId){const invoice=await this.repository.record(uuid(payload.invoiceId),{lock:true});
    if(!invoice||invoice.kind!=='INVOICE'||invoice.customer_id!==customerId||CLOSED_OPERATION_STATUSES.includes(invoice.status))throw validationFailed('Select an open invoice reference belonging to this customer.');
    if(kind==='RECEIPT'&&await this.repository.duplicateReceipt(invoice.id,payload.transactionReference))throw conflict('This transaction is already recorded against this invoice.');
    if(scaled(payload.amount)>scaled(invoice.payload.amount))throw validationFailed('Amount exceeds the referenced invoice.');
   }
   const original=kind==='INTAKE'?{...payload}:null;if(original)delete payload.originalText;
   const row=await this.repository.insert({kind,title,customerId,ownerId,backupId,payload,dueAt,actorId:user.id,now:this.clock.now().toISOString(),reference:`${kind}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`});
   if(original)await this.repository.retainOriginal(row,original,originalHash);
   await this.repository.event(row,'CREATE',null,reason,user.id);
   await this.audit.record({actorId:user.id,entity:'CRM_OPERATION',recordId:row.id,action:'CREATE',newValue:{kind,reference:row.reference,ownerId,backupId},reason});
   const department=kind==='INTAKE'&&['OPERATIONS','ACCOUNTS','CUSTOMER_SUPPORT'].includes(payload.category)?payload.category:d.department;
   await this.work.open(user,{entityType:kind,entityId:row.id,title,department,ownerUserId:ownerId,backupUserId:backupId,dueAt,assignmentReason:reason});
   return {record:this.project(row,user),duplicate:false};
  });
 }
 async act(user,recordId,input){const reason=text(input.reason,'Reason');return this.transactions.run(user,reason,async()=>{
  const row=await this.repository.record(uuid(recordId),{lock:true});if(!row)throw notFound();const d=this.definition(user,row.kind,true);
  if(row.version!==input.version)throw conflict('Record changed. Reload before continuing.');
  const action=input.action,next=d.actions[action];if(!next||!(transitions[row.status]||[]).includes(action))throw conflict('This action is not available in the current state.');
  if(!['APPROVE','CONFIRM','REJECT'].includes(action)&&![row.owner_id,row.backup_id].includes(user.id)&&!this.access.can(user,'work.reassign'))throw forbidden('Only the owner, backup or an authorised manager may progress this case.');
  if(['APPROVE','CONFIRM','REJECT'].includes(action)){
   this.access.require(user,d.financial?'collections.approve':'operations.approve');
   if(user.id===row.created_by)throw forbidden('A different person must review this request.');
  }
  if(action==='APPROVE'&&row.kind==='WARRANTY'){
   const policy=(await this.rules.require('warranty.policy')).value;
   if(row.payload.faultType==='UNDETERMINED'||policy.technicalFaultsOnly&&row.payload.faultType!=='TECHNICAL_FAULT')throw conflict('Warranty eligibility is not established for this fault.');
   const start=new Date(row.payload.purchaseDate+'T00:00:00Z'),end=new Date(start);end.setUTCMonth(end.getUTCMonth()+policy.periodMonths);
   if(start>new Date(row.created_at)||new Date(row.created_at)>end)throw conflict('Claim falls outside the confirmed warranty period.');
  }
  if(action==='APPROVE'&&row.kind==='RETURN'&&!row.payload.evidence)throw conflict('Receipt and inspection evidence is required before return approval.');
  if(action==='APPROVE'&&row.kind==='PAYMENT'){
   const policy=(await this.rules.require('payments.authorisation')).value;
   if(scaled(row.payload.amount)>scaled(policy.maximumAmount))throw conflict('Payment exceeds the configured authorisation limit.');
   if(!input.checks||policy.checks.some(check=>typeof input.checks[check]!=='string'||!input.checks[check].trim()))throw validationFailed('Provide evidence for every configured payment check.');
  }
  if(action==='CONFIRM'&&row.kind==='RECEIPT'){
   const invoice=await this.repository.record(row.payload.invoiceId,{lock:true});
   if(!invoice||invoice.status!=='OPEN')throw conflict('The referenced invoice is not open.');
   const prior=await this.repository.confirmedTotal(invoice.id);
   if(scaled(prior)+scaled(row.payload.amount)>scaled(invoice.payload.amount))throw conflict('Confirmed receipts would exceed this invoice.');
  }
  if(action==='RESOLVE'&&row.kind==='COLLECTION'){
   const total=await this.repository.confirmedTotal(row.payload.invoiceId);
   if(scaled(total)<scaled(row.payload.amount))throw conflict('A confirmed receipt covering this outstanding amount is still required. Partial payment leaves collection open.');
  }
  const response=action==='RESPOND';if(response)text(input.response,'Response notes',10000);
  const closing=CLOSED_OPERATION_STATUSES.includes(next)||(row.kind==='PAYMENT'&&next==='APPROVED'),updated=await this.repository.transition(row,next,user.id,this.clock.now().toISOString(),{response,closing});
  if(!updated)throw conflict('Record changed. Reload.');
  await this.repository.event(updated,action,row.status,reason,user.id,{...(response?{response:input.response}:{}),...(input.checks?{checks:input.checks}:{})});
  await this.audit.record({actorId:user.id,entity:'CRM_OPERATION',recordId:row.id,action,oldValue:{status:row.status},newValue:{status:next,version:updated.version},reason});
  if(closing)await this.work.closeForEntity(user,row.kind,row.id,next==='CANCELLED'?'CANCELLED':'DONE',reason);
  return this.detail(user,row.id);
 });}
 async revise(user,recordId,input){const reason=text(input.reason,'Revision reason');return this.transactions.run(user,reason,async()=>{
  const row=await this.repository.record(uuid(recordId),{lock:true});if(!row)throw notFound();const d=this.definition(user,row.kind,true);
  if(![row.owner_id,row.backup_id].includes(user.id)&&!this.access.can(user,'work.reassign'))throw forbidden('Only the owner, backup or an authorised manager may revise findings.');
  if(!['SUPPORT','WARRANTY','RETURN'].includes(row.kind)||!['OPEN','IN_PROGRESS','RESPONDED'].includes(row.status))throw conflict('Only open support findings can be revised. Approved terms and retained originals are unchanged.');
  if(input.version!==row.version)throw conflict('Record changed. Reload.');
  if(!input.payload||typeof input.payload!=='object'||Array.isArray(input.payload)||Object.keys(input.payload).some(k=>!d.fields.some(f=>f.key===k)))throw validationFailed('Provide supported finding fields.');
  const payload={};for(const field of d.fields){const value=input.payload[field.key];if(value==null||value===''){if(field.required)throw validationFailed(`${field.label} is required.`);continue;}
   payload[field.key]=text(value,field.label,field.type==='textarea'?10000:2000);
   if(field.type==='decimal')payload[field.key]=decimal(value,field.label,{positive:true});
   if(field.type==='date'&&!validDate(value))throw validationFailed('Enter a valid date.');
  }
  if(row.kind==='WARRANTY'&&!['TECHNICAL_FAULT','PHYSICAL_DAMAGE','UNDETERMINED'].includes(payload.faultType))throw validationFailed('Choose a supported fault classification.');
  const updated=await this.repository.revise(row,payload,user.id,this.clock.now().toISOString());if(!updated)throw conflict('Record changed. Reload.');
  await this.repository.event(updated,'REVISE_FINDINGS',row.status,reason,user.id,{before:row.payload,after:payload});
  await this.audit.record({actorId:user.id,entity:'CRM_OPERATION',recordId:row.id,action:'REVISE_FINDINGS',oldValue:row.payload,newValue:payload,reason});return this.detail(user,row.id);
 });}
 async controls(user,customerId,body){this.access.require(user,'customers.controls');const cid=Number(customerId);if(!Number.isSafeInteger(cid)||cid<1||!await this.repository.customer(cid))throw notFound('Customer not found.');
  if(!body)return await this.repository.controls(cid)||{customer_id:cid,classification:null,credit_exempt:false,version:0};
  if(!['NEW','EXISTING','POTENTIAL','DO_NOT_QUOTE'].includes(body.classification)||typeof body.creditExempt!=='boolean')throw validationFailed('Choose a customer classification and credit-exempt flag.');
  const reason=text(body.reason,'Reason');return this.transactions.run(user,reason,async()=>{await this.repository.lockKey(`customer-controls:${cid}`);const old=await this.repository.controls(cid);
   if(body.version!==(old?.version||0))throw conflict('Customer controls changed. Reload.');
   const pricingClass=body.pricingClass===undefined?old?.pricing_class||null:body.pricingClass;
   if(pricingClass!==null&&!['RATE_CONTRACT','MEDIUM_DISCOUNT','DEALER_NETWORK','NEW'].includes(pricingClass))throw validationFailed('Choose a supported pricing class.');
   const saved=await this.repository.saveControls(cid,body.classification,body.creditExempt,reason,user.id,pricingClass);
   await this.audit.record({actorId:user.id,entity:'CUSTOMER_CONTROLS',recordId:String(cid),action:'SET',oldValue:old,newValue:saved,reason});return saved;});
 }
}
