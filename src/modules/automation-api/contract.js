// Versioned design contract. A route is not operational merely because it is
// listed here; runtime delivery and mock-client acceptance are tracked separately.
export const AUTOMATION_API_VERSION='1.0.0';
export const AUTOMATION_SCOPES=['automation.read','automation.write.drafts','automation.write.intake'];
export const AUTOMATION_OPERATIONS=[
 ['GET','/customers/match','matchCustomers','automation.read','CustomerCandidate'],
 ['GET','/items','lookupItems','automation.read','Item'],
 ['POST','/price-availability/preview','previewPriceAvailability','automation.read','PriceAvailability','PriceRequest'],
 ['GET','/orders/{id}','orderStatus','automation.read','Order'],
 ['GET','/invoices','invoiceReferences','automation.read','Invoice'],
 ['GET','/documents/{handle}','readDocument','automation.read','Document'],
 ['GET','/dispatches','dispatchStatus','automation.read','Dispatch'],
 ['GET','/tickets/{id}','ticketStatus','automation.read','Ticket'],
 ['GET','/templates','listTemplates','automation.read','Template'],
 ['GET','/switches','readSwitches','automation.read','Switch'],
 ['GET','/settings','readSettings','automation.read','Setting'],
 ['POST','/intake','queueIntake','automation.write.intake','QueueReceipt','IntakeRequest'],
 ['POST','/drafts','createDraft','automation.write.drafts','QueueReceipt','DraftRequest'],
 ['POST','/review-items','queueReview','automation.write.intake','QueueReceipt','ReviewRequest'],
 ['POST','/tasks','queueTask','automation.write.intake','QueueReceipt','TaskRequest'],
 ['POST','/enquiries','queueEnquiry','automation.write.intake','QueueReceipt','EnquiryRequest']
].map(([method,path,id,scope,response,request])=>({method,path:`/api/v1/automation${path}`,id,scope,response,request}));
const ref=name=>({$ref:`#/components/schemas/${name}`});
const text=(maxLength=250)=>({type:'string',maxLength});
const id={type:'integer',minimum:1};
const company={type:'string',format:'uuid'};
const decimal={type:'string',pattern:'^-?\\d{1,24}(?:\\.\\d{1,6})?$'};
const nullable=value=>({...value,nullable:true});
const array=(items,maxItems=100)=>({type:'array',items,maxItems});
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const reason={type:'string',minLength:3,maxLength:1000};
const refs=array(text(250),20);
const base={companyId:company,reason};
export function automationOpenApi(){
 const schemas={
  Error:object({error:text(2000),code:text(80),correlationId:text(100),details:{type:'object',additionalProperties:true}},['error','code']),
  Freshness:object({dataset:text(80),status:text(80),sourceTimestamp:nullable({type:'string',format:'date-time'}),lastSuccessfulSync:nullable({type:'string',format:'date-time'}),ageSeconds:nullable({type:'integer',minimum:0})}),
  CustomerCandidate:object({id,name:text(),gstin:nullable(text(20)),matchMethods:array(text(80),10),confidence:nullable({type:'string',pattern:'^(?:0(?:\\.\\d{1,6})?|1(?:\\.0{1,6})?)$'}),requiresReview:{type:'boolean'}}),
  Item:object({id,partCode:text(200),description:text(2000),unit:text(40),matchedBy:text(80),sourceRecordKey:nullable(text())}),
  PriceAvailability:object({customerId:id,itemId:id,currency:nullable(text(3)),netUnitPrice:nullable(decimal),requestedQuantity:decimal,availableQuantity:nullable(decimal),unit:nullable(text(40)),available:nullable({type:'boolean'}),status:text(80),blockedBy:array(text(250),100),priceFingerprint:nullable(text(64)),stockFingerprint:nullable(text(64))}),
  OrderLine:object({itemId:id,acceptedQuantity:decimal,suppliedQuantity:nullable(decimal),pendingQuantity:nullable(decimal),unit:text(40)}),
  Order:object({id,customerId:id,status:text(80),lines:array(ref('OrderLine'),1000)}),
  Invoice:object({id:text(),customerId:id,reference:text(),date:nullable({type:'string',format:'date'}),documentHandle:nullable(text()),gstMismatch:nullable({type:'boolean'}),creditNoteReferences:array(text()),debitNoteReferences:array(text())}),
  Document:object({handle:text(),contentType:text(100),byteCount:{type:'integer',minimum:1},downloadPath:text(500)}),
  Dispatch:object({id:text(),orderId:id,status:text(80),lrReference:nullable(text()),podHandle:nullable(text())}),
  Ticket:object({id:text(),customerId:id,status:text(80),slaState:text(80)}),
  Template:object({id:text(),version:{type:'integer',minimum:1},category:text(80),status:text(80),placeholders:array(text(80)),approvedAt:nullable({type:'string',format:'date-time'})}),
  Switch:object({key:text(120),enabled:{type:'boolean'}}),
  Setting:object({key:text(160),status:{type:'string',enum:['EMPTY','PROPOSED','ENTERED','CONFIRMED','REJECTED']},usable:{type:'boolean'},value:{nullable:true,description:'Allowlisted operational values only, and only when CONFIRMED. No secrets or financial policy internals.'}},['key','status','usable','value']),
  QueueReceipt:object({id:text(),status:{type:'string',enum:['DRAFT','QUEUED','REVIEW_REQUIRED']},requiresReview:{type:'boolean'},reviewItemId:nullable(text()),ownerId:nullable(id),backupOwnerId:nullable(id),dueAt:nullable({type:'string',format:'date-time'}),blockedBy:array(text(250))}),
  PriceRequest:object({companyId:company,customerId:id,itemId:id,quantity:{...decimal,pattern:'^\\d{1,24}(?:\\.\\d{1,6})?$'},level:{type:'integer',minimum:1,maximum:3},basis:{type:'string',enum:['FREE_STOCK','RESERVED_STOCK']},reservationKey:text()},['companyId','customerId','itemId','quantity','basis']),
  IntakeRequest:object({...base,provider:text(80),providerMessageId:text(250),threadId:text(250),sender:{type:'string',format:'email',maxLength:254},intent:text(80),secondaryIntents:array(text(80),20),confidence:nullable({type:'string',pattern:'^(?:0(?:\\.\\d{1,6})?|1(?:\\.0{1,6})?)$'}),subject:text(500),bodyText:text(20000),extractedIds:array(object({kind:text(80),value:text(250)}),100),attachmentReferences:refs},['companyId','reason','provider','providerMessageId','sender','intent','confidence','attachmentReferences']),
  DraftRequest:object({...base,customerId:id,templateId:text(),templateVersion:{type:'integer',minimum:1},subject:text(500),bodyText:text(20000),recipientContactIds:array(id,20),attachmentReferences:refs,sourceIntakeId:text(),outboundKey:text(200)},['companyId','reason','customerId','templateId','templateVersion','subject','bodyText','recipientContactIds','attachmentReferences','outboundKey']),
  ReviewRequest:object({...base,summary:text(500),sourceIntakeId:text(),ownerId:id,backupOwnerId:id,dueAt:{type:'string',format:'date-time'}},['companyId','reason','summary']),
  TaskRequest:object({...base,title:text(500),description:text(10000),customerId:id,orderId:id,ownerId:id,backupOwnerId:id,dueAt:{type:'string',format:'date-time'}},['companyId','reason','title']),
  EnquiryRequest:object({...base,customerId:id,sourceIntakeId:text(),summary:text(2000),attachmentReferences:refs},['companyId','reason','summary','attachmentReferences'])
 };
 const paths={};
 for(const op of AUTOMATION_OPERATIONS){
  const query=op.method==='GET'?[{name:'companyId',in:'query',required:true,schema:company},{name:'page',in:'query',schema:{type:'integer',minimum:1}},{name:'pageSize',in:'query',schema:{type:'integer',minimum:1,maximum:100}}]:[];
  for(const key of op.path.matchAll(/\{([^}]+)\}/g))query.push({name:key[1],in:'path',required:true,schema:key[1]==='id'?id:text()});
  if(op.id==='matchCustomers')for(const name of ['gstin','email','name'])query.push({name,in:'query',schema:text()});
  if(op.id==='lookupItems')for(const name of ['partCode','customerPartCode','search'])query.push({name,in:'query',schema:text()});
  if(['invoiceReferences','dispatchStatus'].includes(op.id))query.push({name:'customerId',in:'query',required:true,schema:id});
  const response=object({data:array(ref(op.response)),companyId:company,freshness:array(ref('Freshness'),30),pagination:object({page:{type:'integer',minimum:1},pageSize:{type:'integer',minimum:1,maximum:100},hasMore:{type:'boolean'}})});
  const responses={'200':{description:'Bounded company-scoped result; draft/queue receipt for writes. No approval or send is performed.',headers:{'X-ControlDesk-API-Version':{schema:{type:'string',enum:[AUTOMATION_API_VERSION]}}},content:{'application/json':{schema:response}}}};
  for(const status of ['400','401','403','404','409','413','422','429','503'])responses[status]={description:{401:'Missing, invalid, revoked or expired service token',403:'Wrong scope or company; no fallback to staff access',409:'Replay mismatch or unconfirmed workflow setting',413:'Size limit',429:'Rate limit; Retry-After applies'}[status]??'Request refused; no partial mutation',content:{'application/json':{schema:ref('Error')}}};
  const operation={operationId:op.id,summary:op.id,security:[{ServiceToken:[]}],'x-required-scope':op.scope,'x-implementation-status':op.id==='readSwitches'?'IMPLEMENTED':'PLANNED',parameters:query,responses};
  if(op.request)operation.requestBody={required:true,content:{'application/json':{schema:ref(op.request)}}};
  if(op.method==='POST'&&op.scope!=='automation.read')operation.parameters.push({name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:200}});
  paths[op.path]={[op.method.toLowerCase()]:operation};
 }
 return {openapi:'3.0.3',info:{title:'ControlDesk automation interface',version:AUTOMATION_API_VERSION,description:'Design contract. PLANNED endpoints are not implemented or enabled merely by this document. Only this existing app serves the eventual interface; no external server is configured.'},servers:[{url:'/'}],paths,components:{securitySchemes:{ServiceToken:{type:'http',scheme:'bearer',description:'Scoped service credential; never a staff session or connector credential.'}},schemas}};
}
