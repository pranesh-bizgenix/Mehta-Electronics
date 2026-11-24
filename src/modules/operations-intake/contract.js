import {s,validate} from '../../core/schema.js';
import {validationFailed} from '../../core/errors.js';
import {decimal,compare,sub,format} from '../../../public/money.js';
export const kinds=['ORDER_STATUS','STOCK','PROCUREMENT','OTHER'];
export const statuses=['NEEDS_REVIEW','REVIEWED','APPROVED','REJECTED','COMPLETED'];
export const readPermission=kind=>({ORDER_STATUS:'orders.read',STOCK:'items.read',PROCUREMENT:'purchasing.read',OTHER:'operations.read'})[kind];
export const writePermission=kind=>({ORDER_STATUS:'orders.update',STOCK:'orders.update',PROCUREMENT:'purchasing.write',OTHER:'operations.write'})[kind];
const txt=(v,label,max=250,optional=false)=>{if(optional&&v==null)return null;if(typeof v!=='string'||(!optional&&!v.trim())||v.length>max||v.includes('\u0000'))throw validationFailed(`Invalid ${label}.`);return v.trim();};
export function quantity(v){if(v===null||v===undefined)return null;const text=typeof v==='number'&&Number.isFinite(v)?String(v):v;if(typeof text!=='string'||!/^\d{1,18}(?:\.\d{1,6})?$/.test(text)||compare(decimal(text),decimal('0'))<=0)throw validationFailed('Use a positive quantity with up to six decimal places.');return text;}
export function normalizeOperations(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw validationFailed('Provide Operations JSON.');
 const b=input.crm_payload??input;
 if(b.schema_version!=='meheta-operations-v1'||b.department!=='OPERATIONS')throw validationFailed('Use schema_version meheta-operations-v1 and department OPERATIONS.');
 const emailId=validate(s.uuid(),b.email_message_id),providerMessageId=txt(b.provider_message_id,'provider_message_id'),r=b.request;
 if(!r||!['ORDER_STATUS','STOCK_PROCUREMENT','STOCK','PROCUREMENT','OTHER'].includes(r.operations_type)||r.operations_type!==b.operations_type)throw validationFailed('Request and envelope must have the same Operations type.');
 if(!['ENQUIRY','UPDATE_REQUEST','CANCEL_REQUEST','NOT_APPLICABLE'].includes(r.order_action)||r.order_action!==b.order_action)throw validationFailed('Invalid or inconsistent order action.');
 const array=(v,max,label)=>{if(!Array.isArray(v)||v.length>max)throw validationFailed(`Invalid ${label}.`);return v;};
 const poNumbers=array(r.po_numbers,20,'PO references').map(v=>txt(v,'PO number',120));
 if(new Set(poNumbers).size!==poNumbers.length)throw validationFailed('PO references must not repeat.');
 const items=array(r.stock_items,10,'stock items').map((v,i)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw validationFailed('Every stock item must be an object.');return {lineId:String(i+1),productCode:txt(v.product_code,'product code',200,true),description:txt(v.product_name,'product name',1000,true),quantity:quantity(v.requested_quantity),uom:txt(v.unit,'unit',40,true)};});
 const changes=array(r.requested_changes,100,'requested changes').map(v=>({field:txt(v?.field,'change field',100),requestedValue:txt(v?.requested_value,'requested value',2000),sourceQuote:txt(v?.source_quote,'source quote',2000)}));
 const sender=txt(b.original_email?.sender,'sender',254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender))throw validationFailed('Use a valid sender email.');
 const archive=b.source_archive;let sourceArchive=null;
 if(archive!=null){const bucket=txt(archive.s3_bucket,'S3 bucket',63),key=txt(archive.s3_key,'S3 key',2000);if(!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket)||/[\x00-\x1f]/.test(key))throw validationFailed('Invalid S3 source reference.');sourceArchive={bucket,key,sha256:archive.sha256==null?null:validate(s.string({pattern:/^[a-f0-9]{64}$/}),archive.sha256)};}
 const warnings=array(b.review_reasons??[],100,'review reasons').map(v=>txt(v,'review warning',1000));
 return {schemaVersion:'meheta-operations-v1',emailId,providerMessageId,kind:r.operations_type==='STOCK_PROCUREMENT'?'STOCK':r.operations_type,action:r.order_action,sender,subject:txt(b.original_email?.subject??'Operations request','subject',500),body:txt(b.original_email?.body??'','email body',20000,true),summary:txt(r.question_summary,'question summary',2000),poNumbers,items,changes,warnings,sourceArchive,
  // Make's claimed customer, order, quantities, approvals and existing_data are
  // deliberately not trusted. CRM services verify them again on every action.
  transportReviewRequired:Boolean(b.requires_review)};
}
export function shortageOf(preview,requested){
 if(preview.status!=='VERIFIED'||preview.freeQuantity==null)return null;
 const free=decimal(preview.freeQuantity),amount=compare(free,decimal('0'))<0?decimal('0'):free,wanted=decimal(requested);return compare(amount,wanted)>=0?'0.000000':format(sub(wanted,amount),6);
}
export const reviewSchema=s.object({version:s.int({min:1}),reason:s.reason(),kind:s.enum(kinds),customerId:s.id().nullable(),orderId:s.id().nullable(),assignedTo:s.id(),sourceChecked:s.bool(),items:s.array(s.object({lineId:s.string({min:1,max:50}),itemId:s.id(),quantity:s.string({pattern:/^\d{1,18}(?:\.\d{1,6})?$/}),uom:s.string({min:1,max:40})}),{max:10})});
export const actionSchema=s.object({version:s.int({min:1}),reason:s.reason(),action:s.enum(['APPROVE','REJECT','COMPLETE'])});
