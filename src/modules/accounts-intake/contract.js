import {s,validate} from '../../core/schema.js';
import {validationFailed} from '../../core/errors.js';
export const categories=['CREDIT_NOTE','DEBIT_NOTE','INVOICE','REMINDER','DUE_PAYMENT','PAYMENT_CLAIM','PAYMENT_STATUS','PAYMENT_CONFIRMATION','PAYMENT_DISPUTE','OTHER_PAYMENT','OTHER'];
export const statuses=['NEEDS_REVIEW','REVIEWED','APPROVED','REJECTED','COMPLETED'];
export const labels={CREDIT_NOTE:'Credit-note request',DEBIT_NOTE:'Debit-note request',INVOICE:'Invoice request',REMINDER:'Payment follow-up',DUE_PAYMENT:'Outstanding / due-date enquiry',PAYMENT_CLAIM:'Payment reported — verify',PAYMENT_STATUS:'Payment-status enquiry',PAYMENT_CONFIRMATION:'Receipt-confirmation request',PAYMENT_DISPUTE:'Payment dispute',OTHER_PAYMENT:'Other payment message',OTHER:'Accounts review'};
const txt=(v,name,max=250,optional=false)=>{if(optional&&v==null)return null;if(typeof v!=='string'||(!optional&&!v.trim())||v.length>max||v.includes('\u0000'))throw validationFailed(`Invalid ${name}.`);return v.trim();};
export function exactAmount(value){const text=typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<1e12?String(value):value;if(typeof text!=='string'||!/^\d{1,14}(?:\.\d{1,2})?$/.test(text))throw validationFailed('Use an exact non-negative amount with up to two decimal places.');return text;}
const day=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw validationFailed('Use a valid YYYY-MM-DD date.');return value;};
export function normalizeAccounts(input){
 const b=input?.crm_payload??input;if(!b||typeof b!=='object'||Array.isArray(b)||b.schema_version!=='meheta-accounts-v1'||b.department!=='ACCOUNTS')throw validationFailed('Use schema_version meheta-accounts-v1 and department ACCOUNTS.');
 const r=b.request;if(!r||typeof r!=='object'||Array.isArray(r)||!categories.includes(b.category)||r.category!==b.category||!['REQUEST','PAYMENT','OTHER'].includes(b.accounts_branch)||r.accounts_branch!==b.accounts_branch)throw validationFailed('Use consistent Accounts category and branch.');
 const expected=['CREDIT_NOTE','DEBIT_NOTE','INVOICE'].includes(b.category)?'REQUEST':b.category==='OTHER'?'OTHER':'PAYMENT';if(expected!==b.accounts_branch)throw validationFailed('Accounts category does not match its branch.');
 const warnings=[];const array=(v,max,name)=>{if(!Array.isArray(v)||v.length>max)throw validationFailed(`Invalid ${name}.`);return v;};
 const refs=(v,name)=>{const list=array(v,20,name).map(x=>txt(x,name,150));if(new Set(list).size!==list.length)throw validationFailed('References must not repeat.');return list;};
 const field=(key,fn)=>{if(r[key]==null)return null;try{return fn(r[key]);}catch{warnings.push(`Verify ${key} against the original source.`);return null;}};
 const sender=validate(s.email(),b.original_email?.sender),intent=r.intent??b.intent;
 if(!intent||typeof intent.action!=='string')throw validationFailed('Provide the requested Accounts action.');
 let sourceArchive=null;if(b.source_archive!=null){const a=b.source_archive,bucket=txt(a.s3_bucket,'S3 bucket',63),key=txt(a.s3_key,'S3 key',2000);if(!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket)||/[\x00-\x1f]/.test(key))throw validationFailed('Invalid archived source location.');sourceArchive={bucket,key,sha256:a.sha256==null?null:validate(s.string({pattern:/^[a-f0-9]{64}$/}),a.sha256)};}
 const claimedAmount=field('claimed_amount',exactAmount),adjustmentAmount=field('requested_adjustment_amount',exactAmount),statedDueAmount=field('stated_due_amount',exactAmount);
 const currency=field('currency',v=>validate(s.string({pattern:/^[A-Z]{3}$/}),v)),paymentDate=field('payment_date',day),statedDueDate=field('stated_due_date',day);
 warnings.push(...array(b.review_reasons??[],100,'review warnings').map(x=>txt(x,'review warning',1000)));
 return {schemaVersion:'meheta-accounts-v1',emailId:validate(s.uuid(),b.email_message_id),providerMessageId:txt(b.provider_message_id,'Gmail message ID'),category:b.category,branch:b.accounts_branch,action:txt(intent.action,'requested action',100),summary:txt(intent.summary??r.summary,'request summary',2000),sender,subject:txt(b.original_email?.subject??'Accounts request','subject',500),body:txt(b.original_email?.body??'','email body',30000,true),invoiceNumbers:refs(r.invoice_numbers,'invoice references'),poNumbers:refs(r.po_numbers,'PO references'),paymentReferences:refs(r.payment_references,'payment references'),claimedAmount,adjustmentAmount,statedDueAmount,currency,paymentDate,statedDueDate,reminderRequest:txt(r.reminder_request_text,'reminder instructions',4000,true),requestReason:txt(r.reason??'','source reason',4000,true),warnings:[...new Set(warnings)],sourceArchive};
 // Make's customer IDs, bank matches, balances, reminder holds and copy eligibility
 // are deliberately excluded. CRM source records and staff decisions govern them.
}
export const reviewSchema=s.object({version:s.int({min:1}),reason:s.reason(),category:s.enum(categories),customerId:s.id().nullable(),invoiceId:s.uuid().nullable(),assignedTo:s.id(),sourceChecked:s.bool(),invoiceCompanyConfirmed:s.bool(),amount:s.string({pattern:/^\d{1,14}(?:\.\d{1,2})?$/}).nullable(),currency:s.string({pattern:/^[A-Z]{3}$/}).nullable(),paymentDate:s.string({max:10}).nullable(),dueDate:s.string({max:10}).nullable(),paymentReference:s.string({max:250}).nullable(),financialSourceChecked:s.bool()});
export const actionSchema=s.object({version:s.int({min:1}),reason:s.reason(),action:s.enum(['APPROVE','REJECT','COMPLETE'])});
export const handoffSchema=s.object({version:s.int({min:1}),reason:s.reason(),kind:s.enum(['RECEIPT','COLLECTION']),backupId:s.id()});
export const validateDay=day;
