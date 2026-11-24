// Shared with the existing MEHETA Operations receipt-validation code module.
// No network or secret handling belongs in this adapter.
export function operationsDeliveryContext(input) {
 const parse=value=>typeof value==='string'?JSON.parse(value):value;
 const response=parse(input.response),status=Number(response?.statusCode??response?.status);
 const body=parse(response?.data??response?.body),receipt=body?.data;
 const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
 if(![200,201].includes(status)||!uuid(receipt?.id)||receipt?.companyId!==input.companyId||!['ORDER_STATUS','STOCK','PROCUREMENT','OTHER'].includes(receipt.kind)||!['NEEDS_REVIEW','REVIEWED','APPROVED','REJECTED','COMPLETED'].includes(receipt.status)||typeof receipt.duplicate!=='boolean'||typeof receipt.requiresReview!=='boolean'||!Number.isInteger(receipt.version)||receipt.version<1)throw Error('OPERATIONS_CRM_RECEIPT_INVALID');
 const base=parse(input.staged),payload=JSON.parse(JSON.stringify(base?.payload??null));
 if(payload?.department!=='OPERATIONS'||!uuid(payload.email_message_id))throw Error('OPERATIONS_SOURCE_INVALID');
 const kind=payload.operations_type==='STOCK_PROCUREMENT'?'STOCK':payload.operations_type;
 if(receipt.kind!==kind)throw Error('OPERATIONS_CRM_KIND_MISMATCH');
 // A transport receipt never authorises a stock/delivery promise or order change.
 payload.crm_delivery='DELIVERED';payload.crm_receipt={id:receipt.id,status:receipt.status,companyId:receipt.companyId,duplicate:receipt.duplicate};
 payload.requires_review=true;payload.review_reasons=[...new Set([...(payload.review_reasons??[]),'CRM_STAFF_REVIEW_REQUIRED'])];
 payload.automatic_reply={facts:[],requires_human_followup:true};
 const request={contents:[{role:'user',parts:[{text:'Return only {"selected_fact_ids":[]}. No verified facts have been released by CRM. Do not answer the customer question or make availability, price or delivery promises.'}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:128}};
 const query=`INSERT INTO public.automation_processing_runs(email_id,stage,status,started_at,finished_at) VALUES('${payload.email_message_id}'::uuid,'OPS_CRM_DELIVERY:${receipt.id}','Succeeded',now(),now()) RETURNING id;`;
 return {payload,receipt,facts:[],requires_human_followup:true,reply_request_body:JSON.stringify(request),query};
}
