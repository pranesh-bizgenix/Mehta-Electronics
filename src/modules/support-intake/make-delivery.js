// Executed unchanged by the existing Make support receipt modules.
export function supportDeliveryReceipt(input){
 const parse=v=>typeof v==='string'?JSON.parse(v):v,response=parse(input.response),body=parse(response?.data??response?.body),receipt=body?.data;
 const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
 if(![200,201].includes(Number(response?.statusCode??response?.status))||!uuid(receipt?.id)||!uuid(input.email_id)||!uuid(input.support_run_id)||receipt.companyId!==input.company_id||receipt.requestKey!==input.request_key||receipt.revision!==Number(input.revision)||typeof receipt.duplicate!=='boolean'||!['NEEDS_REVIEW','REVIEWED','LINKED','CLOSED','REJECTED'].includes(receipt.status))throw Error('SUPPORT_CRM_RECEIPT_INVALID');
 return {accepted:true,request_id:receipt.id,duplicate:receipt.duplicate,status:receipt.status,query:`INSERT INTO public.automation_processing_runs(email_id,stage,status,started_at,finished_at) VALUES('${input.email_id}'::uuid,'CS_CRM_DELIVERY:${receipt.id}','Succeeded',now(),now()) RETURNING id;`};
}
