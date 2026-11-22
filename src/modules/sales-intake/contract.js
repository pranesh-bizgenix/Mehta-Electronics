import {fingerprint} from '../../core/runtime.js';
import {validationFailed} from '../../core/errors.js';
import {validDate} from '../../crm-modules.js';
import {decimal,add,compare} from '../../../public/money.js';

export const INTAKE_VERSION='1.0';
export const INTAKE_TYPES=['CUSTOMER_PO','QUOTATION_REQUEST','LEAD_ENQUIRY'];
export const HEADER_ALIASES={'PO Number':'poNumber','PO Date':'poDate','Buyer / Company Name':'buyerName','Supplier / Vendor Name':'supplierName','Billing Address':'billingAddress','Delivery Address':'deliveryAddress','GST Number':'gstin','Contact Person':'contactPerson','Email':'email','Phone Number':'phone','Total PO Value':'totalPoValue','Delivery Date':'deliveryDate','Payment Terms':'paymentTerms','Other Terms & Conditions':'otherTerms'};
export const ITEM_ALIASES={'Item Description':'description','Product / Material Code':'productCode','HSN / SAC Code':'hsn','Quantity':'quantity','Unit of Measurement':'uom','Unit Price':'unitPrice','Discount':'discount','GST Rate':'gstRate','Taxable Amount':'taxableAmount'};
const fail=(path,message)=>{throw validationFailed(message,{fields:[{path,message}]});};
const obj=(v,path)=>{if(!v||typeof v!=='object'||Array.isArray(v))fail(path,'Provide an object.');return v;};
const string=(v,path,max=2000)=>{if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))fail(path,`Use text up to ${max} characters.`);return v.trim();};
const required=(v,path,max)=>{const out=string(v,path,max);if(!out)fail(path,'This field is required.');return out;};
const uuid=(v,path)=>{if(typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))fail(path,'Use a UUID.');return v.toLowerCase();};
function exact(v,path,{positive=false,percent=false}={}){
 if(typeof v!=='string'||!/^\d{1,14}(?:\.\d{1,6})?$/.test(v))fail(path,'Use an exact decimal string with up to six decimal places; missing is not zero.');
 const [a,b='']=v.split('.'),n=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));
 if(positive&&n===0n||percent&&n>100000000n)fail(path,'Value is outside the permitted range.');
 return BigInt(a).toString()+(b.replace(/0+$/,'')?'.'+b.replace(/0+$/,''):'');
}
const optional=(v,fn)=>v==null||v===''?null:fn(v);
function keys(v,allowed,path){obj(v,path);for(const key of Object.keys(v))if(!allowed.includes(key))fail(path+'.'+key,'Unknown field.');return v;}
function aliases(value,map,allowed,path){
 obj(value,path);const out={};
 for(const [key,v]of Object.entries(value)){
  const target=map[key]??key;if(!allowed.includes(target))fail(path+'.'+key,'Unknown field.');
  if(Object.hasOwn(out,target)&&fingerprint(out[target])!==fingerprint(v))fail(path+'.'+key,'Conflicting aliases supplied for '+target+'.');out[target]=v;
 }
 return out;
}
function address(value,path){
 if(typeof value==='string')return {text:required(value,path,2000)};
 keys(value,['text','line1','line2','city','stateCode','pincode','country'],path);
 if(value.stateCode&&!/^(0[1-9]|[12][0-9]|3[0-8])$/.test(value.stateCode))fail(path+'.stateCode','Use a two-digit state code.');
 if(value.pincode&&!/^\d{6}$/.test(value.pincode))fail(path+'.pincode','Use a six-digit postal code.');
 return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,optional(v,x=>string(x,path+'.'+k,500))]));
}
function date(v,path){if(!validDate(v))fail(path,'Use a valid YYYY-MM-DD date.');return v;}
function timestamp(v,path){if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v)||!validDate(v.slice(0,10))||!Number.isFinite(Date.parse(v)))fail(path,'Use a valid ISO timestamp with a timezone.');return new Date(v).toISOString();}
export function normalizeIntake(input){
 keys(input,['schemaVersion','eventId','idempotencyKey','messageType','companyId','source','provenance','header','items'],'payload');
 if(input.schemaVersion!==INTAKE_VERSION)fail('schemaVersion','Supported schemaVersion is '+INTAKE_VERSION+'.');
 if(!INTAKE_TYPES.includes(input.messageType))fail('messageType','Choose CUSTOMER_PO, QUOTATION_REQUEST or LEAD_ENQUIRY.');
 if(input.eventId&&input.idempotencyKey&&input.eventId!==input.idempotencyKey)fail('eventId','Conflicting delivery identities.');
 const eventId=required(input.eventId??input.idempotencyKey,'eventId',200),companyId=uuid(input.companyId,'companyId');
 const src=keys(input.source,['system','mailbox','messageId','threadId','receivedAt','originalText','attachments'],'source');
 const source={system:required(src.system,'source.system',100),mailbox:required(src.mailbox,'source.mailbox',254).toLowerCase(),messageId:required(src.messageId,'source.messageId',500),threadId:optional(src.threadId,v=>string(v,'source.threadId',500)),receivedAt:timestamp(src.receivedAt,'source.receivedAt'),originalText:optional(src.originalText,v=>string(v,'source.originalText',250000)),attachments:[]};
 if(src.attachments!=null&&!Array.isArray(src.attachments)||src.attachments?.length>20)fail('source.attachments','Use at most 20 attachment references.');
 for(const [index,a]of (src.attachments??[]).entries()){
  const p=`source.attachments.${index}`;keys(a,['id','name','mimeType','bytes','sha256','storageReference'],p);
  if(!Number.isSafeInteger(a.bytes)||a.bytes<0||a.bytes>100*1024*1024)fail(p+'.bytes','Use a non-negative byte count up to 100 MiB.');
  if(typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256))fail(p+'.sha256','Use a lowercase SHA-256 hash.');
  const storageReference=required(a.storageReference,p+'.storageReference',2000);if(!/^s3:\/\/[^/\s]+\/[^\x00-\x20]+$/.test(storageReference))fail(p+'.storageReference','Use an S3 location reference; file contents and arbitrary URLs are not accepted.');
  const name=required(a.name,p+'.name',200);if(/[\\/]/.test(name))fail(p+'.name','Use a filename without a path.');
  source.attachments.push({id:required(a.id,p+'.id',300),name,mimeType:required(a.mimeType,p+'.mimeType',120),bytes:a.bytes,sha256:a.sha256,storageReference});
 }
 if(new Set(source.attachments.map(a=>a.id)).size!==source.attachments.length)fail('source.attachments','Attachment identities must be unique.');
 const provenance=keys(input.provenance,['extractor','version','reference'],'provenance');
 const extraction=Object.fromEntries(['extractor','version','reference'].map(k=>[k,required(provenance[k],'provenance.'+k,500)]));
 const fields=[...Object.values(HEADER_ALIASES),'placeOfSupply','validUntil','quotationId','customerId','supplyType'];
 const h=aliases(input.header??{},HEADER_ALIASES,fields,'header'),header={};
 for(const key of fields)header[key]=optional(h[key],v=>['billingAddress','deliveryAddress'].includes(key)?address(v,'header.'+key):['poDate','deliveryDate','validUntil'].includes(key)?date(v,'header.'+key):key==='totalPoValue'?exact(v,'header.'+key):['customerId','quotationId'].includes(key)?Number.isSafeInteger(v)&&v>0?v:fail('header.'+key,'Use a positive CRM ID.'):string(v,'header.'+key,['otherTerms','paymentTerms'].includes(key)?10000:2000));
 if(header.email&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(header.email))fail('header.email','Invalid email address.');
 if(header.gstin&&!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[A-Z0-9]$/i.test(header.gstin))fail('header.gstin','Invalid GSTIN format.');
 if(header.gstin)header.gstin=header.gstin.toUpperCase();
 if(header.placeOfSupply&&!/^(0[1-9]|[12][0-9]|3[0-8])$/.test(header.placeOfSupply))fail('header.placeOfSupply','Use a two-digit state code.');
 if(header.supplyType&&!['DOMESTIC_STANDARD','SEZ','EXPORT','SPECIAL'].includes(header.supplyType))fail('header.supplyType','Use an explicit tax treatment.');
 if(!Array.isArray(input.items)||input.items.length>100)fail('items','Use a list of at most 100 extracted lines; an empty list is retained for review.');
 const items=input.items.map((value,index)=>{
  const p=`items.${index}`,raw=aliases(value,ITEM_ALIASES,[...Object.values(ITEM_ALIASES),'lineId','itemId','deliverySchedules','terms','pricingSelection'],p),out={lineId:required(raw.lineId,p+'.lineId',100)};
  if(raw.pricingSelection!=null){const v=keys(raw.pricingSelection,['level','fingerprint'],p+'.pricingSelection');if(!Number.isSafeInteger(v.level)||v.level<1||v.level>4||typeof v.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(v.fingerprint))fail(p+'.pricingSelection','Use a currently previewed level and fingerprint.');out.pricingSelection={level:v.level,fingerprint:v.fingerprint};}
  for(const key of ['description','productCode','hsn','uom','terms'])out[key]=optional(raw[key],v=>string(v,p+'.'+key,key==='terms'?10000:2000));
  if(out.uom&&!/^[\p{L}\p{N}._/ -]{1,40}$/u.test(out.uom))fail(p+'.uom','Invalid unit.');
  out.itemId=optional(raw.itemId,v=>Number.isSafeInteger(v)&&v>0?v:fail(p+'.itemId','Use a positive CRM item ID.'));
  for(const key of ['quantity','unitPrice','gstRate','taxableAmount'])out[key]=optional(raw[key],v=>exact(v,p+'.'+key,{positive:key==='quantity',percent:key==='gstRate'}));
  out.discount=optional(raw.discount,v=>{keys(v,['kind','value','scope'],p+'.discount');if(!['PERCENT','AMOUNT'].includes(v.kind))fail(p+'.discount.kind','Specify PERCENT or AMOUNT.');if(v.scope!=null&&v.scope!=='LINE')fail(p+'.discount.scope','Only an explicitly identified LINE scope is supported.');if(v.kind==='AMOUNT'&&v.scope!=='LINE')fail(p+'.discount.scope','Amount discounts must explicitly use LINE scope.');return {kind:v.kind,value:exact(v.value,p+'.discount.value',{percent:v.kind==='PERCENT'}),...(v.kind==='AMOUNT'?{scope:'LINE'}:{})};});
  if(raw.deliverySchedules!=null&&(!Array.isArray(raw.deliverySchedules)||raw.deliverySchedules.length>100))fail(p+'.deliverySchedules','Use at most 100 delivery schedules.');
  out.deliverySchedules=(raw.deliverySchedules??[]).map((v,i)=>{keys(v,['date','quantity','terms'],p+'.deliverySchedules.'+i);return {date:date(v.date,p+'.deliverySchedules.'+i+'.date'),quantity:exact(v.quantity,p+'.deliverySchedules.'+i+'.quantity',{positive:true}),terms:optional(v.terms,x=>string(x,p+'.deliverySchedules.'+i+'.terms',2000))};});
  if(out.quantity&&out.deliverySchedules.length&&compare(out.deliverySchedules.reduce((sum,s)=>add(sum,decimal(s.quantity)),decimal('0')),decimal(out.quantity))!==0)fail(p+'.deliverySchedules','Scheduled quantities must equal the extracted line quantity.');
  return out;
 });
 if(new Set(items.map(line=>line.lineId)).size!==items.length)fail('items','Every line needs a distinct stable lineId.');
 const normalized={messageType:input.messageType,header,items};
 return {schemaVersion:INTAKE_VERSION,eventId,companyId,source,provenance:extraction,...normalized,businessHash:fingerprint(normalized)};
}

export function missingBusinessFields(data){
 const result=[];const need=(v,path)=>{if(v==null||v==='')result.push(path);};
 need(data.header.buyerName,'header.buyerName');
 if(data.messageType==='CUSTOMER_PO')for(const key of ['poNumber','poDate','totalPoValue'])need(data.header[key],'header.'+key);
 if(!data.items.length)result.push('items');
 for(const line of data.items)for(const key of ['description','quantity','uom'])need(line[key],`items.${line.lineId}.${key}`);
 return result;
}
