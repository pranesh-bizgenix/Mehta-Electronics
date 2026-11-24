// This exact validator is also used by the existing Make Accounts delivery step.
export function accountsDeliveryReceipt(input){
 const parse=v=>typeof v==='string'?JSON.parse(v):v,response=parse(input.response),body=parse(response?.data??response?.body),receipt=body?.data,status=Number(response?.statusCode??response?.status);
 const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
 if(![200,201].includes(status)||!uuid(receipt?.id)||receipt.companyId!==input.companyId||!uuid(input.emailId)||!['NEEDS_REVIEW','REVIEWED','APPROVED','REJECTED','COMPLETED'].includes(receipt.status)||typeof receipt.duplicate!=='boolean')throw Error('ACCOUNTS_CRM_RECEIPT_INVALID');
 return {receipt,copy_allowed:false,query:`INSERT INTO public.automation_processing_runs(email_id,stage,status,started_at,finished_at) VALUES('${input.emailId}'::uuid,'ACCOUNTS_CRM_DELIVERY:${receipt.id}','Succeeded',now(),now()) RETURNING id;`};
}
