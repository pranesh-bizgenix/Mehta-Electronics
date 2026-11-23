import {createHash} from 'node:crypto';

// Kept dependency-free apart from node:crypto so this exact function can run in
// the existing Make Code module. It never fetches data or handles credentials.
export function mapMakeSalesDelivery(input){
 const parse=v=>typeof v==='string'?JSON.parse(v):v;
 const staged=parse(input.staged),payload=staged?.crm_payload??staged;
 if(!payload||payload.department!=='SALES')throw new Error('Only a classified Sales payload may enter CRM intake.');
 if(!/^[0-9a-f-]{36}$/i.test(input.companyId??''))throw new Error('A verified CRM company ID is required.');
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.mailbox??''))throw new Error('The receiving mailbox is required.');
 const providerId=String(input.providerMessageId??'').trim();if(!providerId)throw new Error('The Gmail message ID is required.');
 const rawTime=input.receivedAt;
 if(rawTime===null||rawTime===undefined||rawTime==='')throw new Error('The actual source receipt time is required.');
 const at=new Date(typeof rawTime==='number'||/^\d+$/.test(String(rawTime))?Number(rawTime):rawTime);
 if(!Number.isFinite(at.getTime()))throw new Error('The actual source receipt time is invalid.');
 const documents=Array.isArray(payload.documents)&&payload.documents.length?payload.documents:[{data:null,review_reasons:['NO_DOCUMENTS_EXTRACTED']}];
 const references=parse(input.attachments??[])??[];
 if(!Array.isArray(references))throw new Error('Attachment metadata must be a list.');
 const hash=value=>createHash('sha256').update(value).digest('hex');
 return {deliveries:documents.map(doc=>{
  const data=doc.data??{},issues=[];
  const warn=value=>{const s=String(value??'').trim().slice(0,1000);if(s&&!issues.includes(s))issues.push(s);};
  for(const reason of [...(staged.review_reasons??[]),...(doc.review_reasons??[])])warn(reason);
  if(doc.needs_review===true||payload.requires_review===true)warn('Automation requested source verification before quotation preparation.');
  const text=(v,field,max=2000)=>{if(v==null||v==='')return null;if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)){warn(field+': verify the original text.');return null;}return v.trim()||null;};
  const exact=(v,field,positive=false,percent=false)=>{
   if(v==null||v==='')return null;
   const value=typeof v==='number'&&Number.isFinite(v)?String(v):typeof v==='string'?v.trim():'';
   if(!/^\d{1,14}(?:\.\d{1,6})?$/.test(value)){warn(field+': confirm an exact decimal with at most six decimal places.');return null;}
   const [a,b='']=value.split('.'),n=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));
   if(positive&&n===0n||percent&&n>100000000n){warn(field+': value is outside the permitted range.');return null;}
   return value;
  };
  const date=(v,field)=>{if(v==null||v==='')return null;const value=String(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value){warn(field+': confirm the date from the original document.');return null;}return value;};
  const kind={PO:'CUSTOMER_PO',QUOTATION_REQUEST:'QUOTATION_REQUEST',LEAD:'LEAD_ENQUIRY'};
  const classified={PO_RECEIVED:'CUSTOMER_PO',QUOTATION_REQUEST:'QUOTATION_REQUEST',LEAD:'LEAD_ENQUIRY'}[payload.sales_type];
  const messageType=kind[data.document_type]??classified??'LEAD_ENQUIRY';
  if(!kind[data.document_type]&&!classified)warn('Request category is unclear; verify the original Sales message.');
  if(kind[data.document_type]&&classified&&kind[data.document_type]!==classified)warn('Email classification and extracted document type disagree.');
  const validText=(v,field,pattern)=>{const value=text(v,field);if(value&&!pattern.test(value)){warn(field+': verify the identifier from the original document.');return null;}return value;};
  const header={poNumber:text(data.po_number,'PO number'),poDate:date(data.po_date,'PO date'),buyerName:text(data.buyer_company_name,'Buyer'),supplierName:text(data.supplier_vendor_name,'Supplier'),billingAddress:text(data.billing_address,'Billing address'),deliveryAddress:text(data.delivery_address,'Delivery address'),gstin:validText(data.gst_number,'Buyer GSTIN',/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[A-Z0-9]$/i),contactPerson:text(data.contact_person,'Contact person'),email:validText(data.email,'Customer email',/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/),phone:text(data.phone_number,'Phone'),totalPoValue:exact(data.total_po_value,'PO total'),deliveryDate:date(data.delivery_date,'Delivery date'),paymentTerms:text(data.payment_terms,'Payment terms',10000),otherTerms:text(data.other_terms_conditions,'Other terms',10000)};
  if(Number.isSafeInteger(payload.customer_id)&&payload.customer_id>0)header.customerId=payload.customer_id;
  // A currency must be explicit before a financial document is prepared.
  if(data.currency!=='INR')warn('Confirm that the source document currency is INR; no currency was assumed.');
  const rawItems=Array.isArray(data.items)?data.items:[];
  if(rawItems.length>100)throw new Error('More than 100 item lines require a reviewed split; no lines were discarded.');
  const items=rawItems.map((line,i)=>{
   const prefix='Line '+(i+1),uom=text(line.unit_of_measurement,prefix+' UOM');let discount=null;
   if(line.discount!=null&&String(line.discount).trim()!==''){
    const value=String(line.discount).trim(),match=/^(\d{1,3}(?:\.\d{1,6})?)\s*%$/.exec(value);
    if(match){const amount=exact(match[1],prefix+' discount',false,true);if(amount!==null)discount={kind:'PERCENT',value:amount};}
    else if(value==='0')discount={kind:'PERCENT',value:'0'};
    else warn(prefix+': confirm whether the discount is a percentage or an amount per line.');
   }
   if(uom&&!/^[\p{L}\p{N}._/ -]{1,40}$/u.test(uom))warn(prefix+': verify the unit of measurement.');
   return {lineId:String(i+1),description:text(line.item_description,prefix+' description'),productCode:text(line.product_material_code,prefix+' code'),hsn:text(line.hsn_sac_code,prefix+' HSN'),quantity:exact(line.quantity,prefix+' quantity',true),uom:uom&&/^[\p{L}\p{N}._/ -]{1,40}$/u.test(uom)?uom:null,unitPrice:exact(line.unit_price,prefix+' price'),discount,gstRate:exact(line.gst_rate,prefix+' GST',false,true),taxableAmount:exact(line.taxable_amount,prefix+' taxable amount')};
  });
  const attachments=references.map(a=>({id:String(a.id),name:String(a.name).replace(/[\\/\x00-\x1f]/g,'_'),mimeType:a.mimeType,bytes:typeof a.bytes==='string'?Number(a.bytes):a.bytes,sha256:a.sha256,storageReference:a.storageReference}));
  if(attachments.length>20)throw new Error('More than 20 attachments require reviewed handling; no references were discarded.');
  const identity=doc.source?.sha256??hash(JSON.stringify(doc));
  const sourceKey='gmail:'+providerId+':'+identity;
  const originalText=String(input.originalText??'')+'\n\nOriginal extraction before CRM normalization:\n'+JSON.stringify(doc);
  if(originalText.length>250000)throw new Error('The retained extraction exceeds the source-text limit; no source data was truncated.');
  const body={schemaVersion:'1.0',eventId:'MEHETA-'+hash(providerId+'|'+identity),messageType,companyId:input.companyId,source:{system:'MAKE_MEHETA_SALES',mailbox:input.mailbox,messageId:sourceKey,threadId:input.threadId?String(input.threadId):null,receivedAt:at.toISOString(),originalText,attachments},provenance:{extractor:'MEHETA_SALES_ADAPTER',version:'1',reference:String(staged.email_message_id??payload.email_message_id??providerId)},header,items,reviewIssues:issues};
  if(issues.length>100)throw new Error('More than 100 review issues require reviewed handling; none were dropped.');
  return {eventId:body.eventId,body:JSON.stringify(body)};
 })};
}

export function makeSalesReceipt(response,emailId){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const status=Number(response?.statusCode??response?.status);
 let body=response?.data??response?.body;if(typeof body==='string')body=JSON.parse(body);
 const receipt=body?.data??body;
 if(status<200||status>299||!Number.isFinite(status)||!uuid.test(emailId??'')||!uuid.test(receipt?.id??'')||!['NEEDS_REVIEW','PREPARED','CANCELLED'].includes(receipt?.status))throw new Error('CRM delivery was not acknowledged with a valid request ID.');
 return {requestId:receipt.id,status:receipt.status,duplicate:receipt.duplicate===true,query:`INSERT INTO public.automation_processing_runs(email_id,stage,status,started_at,finished_at) VALUES('${emailId}'::uuid,'CRM_DELIVERY:${receipt.id}','Succeeded',now(),now()) RETURNING id`};
}
