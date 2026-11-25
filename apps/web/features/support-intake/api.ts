import type {ApiClient,Paginated} from '@/lib/api/client';
export const categories=['PRODUCT_ENQUIRY','PRODUCT_SUPPORT','OTHER'] as const;
export type Category=typeof categories[number];
export interface SupportRow {id:string;category:Category;status:string;version:number;subject:string;sender:string;summary:string;customer_name?:string;assigned_name?:string;received_at:string;created_at:string}
interface Source {sender:string;subject:string;body:string;attachments:{filename:string;mimeType:string;bytes:number;sha256:string;readable:boolean;archived:boolean}[];archive:{bucket:string;key:string;sha256:string;status?:string}}
export interface SupportDetail extends SupportRow {source:Source;customer_id:number|null;invoice_document_id:string|null;assigned_to:number;backup_owner_id:number;reviewed_by:number|null;revision:number;resolutions:{sourceChecked?:boolean;notes?:string};linked:{id:string;kind:string;reference:string;status:string}[];assessment:{status:string;months:number|null;expiresOn?:string;note:string};blockers:string[];replyNote:string;payload:{intent:{action:string;summary:string};request:{issueDescription:string|null;productCodes:string[];serialNumbers:string[];invoiceNumbers:string[]};products:{itemId:number|string|null;partCode:string|null;description:string|null;listPrice:string|null;uom:string|null;matchStatus:string}[];invoice:{attachmentStatus:string;verification:{status:string;discrepancies:string[]}};warranty:{status:string};reviewReasons:string[];replies:{acknowledgement:{status:string;text:string|null};answer:{status:string;text:string|null}}};events:{id:number;action:string;reason:string;actor_name:string|null;created_at:string}[]}
export interface Options {staff:{id:number;name:string}[];customers:{id:number;name:string}[];invoices:{id:string;number:string}[]}
export const supportApi=(api:ApiClient,companyId:string)=>({
 list:(query:Record<string,string|number>,signal?:AbortSignal)=>api.get<Paginated<SupportRow>>('/api/crm/support-intake',{query:{companyId,...query},signal}),
 detail:(id:string)=>api.data<SupportDetail>('GET',`/api/crm/support-intake/${id}?companyId=${encodeURIComponent(companyId)}`),
 options:(customerId?:string,search?:string,signal?:AbortSignal)=>api.get<{data:Options}>('/api/crm/support-intake/options',{query:{companyId,customerId,search},signal}).then(r=>r.data),
 command:(id:string,path:'review'|'cases'|'actions',body:unknown)=>api.data<SupportDetail>('POST',`/api/crm/support-intake/${id}/${path}?companyId=${encodeURIComponent(companyId)}`,body)
});
