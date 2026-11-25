import crypto from 'node:crypto';
import {s,validate} from '../../core/schema.js';
import {validationFailed} from '../../core/errors.js';
import {supportPayloadSchema} from './payload-schema.js';
export const categories=['PRODUCT_ENQUIRY','PRODUCT_SUPPORT','OTHER'];
export const statuses=['NEEDS_REVIEW','REVIEWED','LINKED','CLOSED','REJECTED'];
export const eventId=(emailId,revision)=>'MEHETA-CS-'+crypto.createHash('sha256').update(emailId+'|'+revision).digest('hex');
export function warrantyPeriod(invoiceDate,receivedAt,months){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)||!Number.isFinite(Date.parse(invoiceDate))||new Date(invoiceDate).toISOString().slice(0,10)!==invoiceDate||!Number.isInteger(months)||months<1||months>120||!Number.isFinite(Date.parse(receivedAt)))throw validationFailed('The invoice date, received timestamp or confirmed warranty period is invalid.');
 const received=new Date(receivedAt),parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(received),day=kind=>parts.find(p=>p.type===kind).value,checkedOn=day('year')+'-'+day('month')+'-'+day('day');
 const end=new Date(invoiceDate+'T00:00:00Z'),originalDay=end.getUTCDate();end.setUTCDate(1);end.setUTCMonth(end.getUTCMonth()+months);end.setUTCDate(Math.min(originalDay,new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1,0)).getUTCDate()));const expiresOn=end.toISOString().slice(0,10);
 return {status:invoiceDate>checkedOn?'DATE_REVIEW_REQUIRED':checkedOn>expiresOn?'OUTSIDE_POLICY_PERIOD':'WITHIN_POLICY_PERIOD',expiresOn,checkedOn};
}

// Small strict JSON-schema subset; no coercion, external refs, executable strings or remote schemas.
export function validateSupportPayload(value){
 const errors=[];const fail=(path,rule)=>{if(errors.length<30)errors.push({path,rule});};
 const type=(v,t)=>t==='null'?v===null:t==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):t==='array'?Array.isArray(v):t==='integer'?Number.isSafeInteger(v):typeof v===t;
 function walk(v,rule,path){
  if(rule.type&&![].concat(rule.type).some(t=>type(v,t))){fail(path,'TYPE');return;}
  if(Object.hasOwn(rule,'const')&&v!==rule.const)fail(path,'CONST');
  if(rule.enum&&!rule.enum.includes(v))fail(path,'ENUM');
  if(v===null)return;
  if(typeof v==='string'){
   if(v.length>(rule.maxLength??100000)||v.length<(rule.minLength??0)||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))fail(path,'TEXT');
   if(rule.pattern&&!new RegExp(rule.pattern).test(v))fail(path,'PATTERN');
   if(rule.format==='email'&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v))fail(path,'EMAIL');
   if(rule.format==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))fail(path,'DATE');
   if(rule.format==='date-time'&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v))))fail(path,'DATE_TIME');
  }
  if(typeof v==='number'&&(!Number.isFinite(v)||v<(rule.minimum??-Infinity)||v>(rule.maximum??Infinity)))fail(path,'RANGE');
  if(Array.isArray(v)){if(v.length>(rule.maxItems??500))fail(path,'MAX_ITEMS');if(rule.items)v.forEach((x,i)=>walk(x,rule.items,path+'/'+i));}
  else if(typeof v==='object'){for(const k of rule.required??[])if(!Object.hasOwn(v,k))fail(path+'/'+k,'REQUIRED');for(const k of Object.keys(v)){if(rule.properties?.[k])walk(v[k],rule.properties[k],path+'/'+k);else if(rule.additionalProperties===false)fail(path+'/'+k,'UNEXPECTED_FIELD');}}
 }
 if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>500000)throw validationFailed('Provide a bounded Customer Support JSON object.');
 walk(value,supportPayloadSchema,'');
 if(errors.length)throw validationFailed('Invalid Customer Support fields.',{errors});
 const b=structuredClone(value);validate(s.uuid(),b.companyId);validate(s.uuid(),b.source.emailId);
 if(b.requestKey!=='MEHETA-CS-'+b.source.emailId||b.eventId!==eventId(b.source.emailId,b.revision))throw validationFailed('Support event identity does not match the source message and revision.');
 if(b.request.attachmentsPresent!==(b.source.attachments.length>0))throw validationFailed('Attachment references do not match the request.');
 for(const a of b.source.attachments)if(/[\x00-\x1f]/.test(a.s3Key??'')||'content' in a||'base64' in a)throw validationFailed('Store attachment location references only.');
 if(b.category==='PRODUCT_ENQUIRY'&&['REPORT_PRODUCT_ISSUE','REQUEST_WARRANTY','PROVIDE_INVOICE'].includes(b.intent.action)||b.category==='PRODUCT_SUPPORT'&&['ASK_PRICE','ASK_PRODUCT_DETAILS','ASK_PRODUCT_SUITABILITY'].includes(b.intent.action))throw validationFailed('Support category and intent disagree.');
 for(const reply of Object.values(b.replies))if(reply.status==='SENT'&&!reply.providerMessageId)throw validationFailed('A reported sent reply needs its provider message ID.');
 return b;
}
export const reviewSchema=s.object({version:s.int({min:1}),reason:s.reason(),category:s.enum(categories),customerId:s.id().nullable(),invoiceId:s.uuid().nullable(),assignedTo:s.id(),sourceChecked:s.bool(),notes:s.text({max:4000}).default('')});
export const linkSchema=s.object({version:s.int({min:1}),reason:s.reason(),kind:s.enum(['SUPPORT','WARRANTY','RETURN']),payload:s.object({}, {strict:false})});
