import type {InvoiceSourceLine} from './source-lines';
import type {ApiClient,Paginated} from '@/lib/api/client';
export interface InvoiceLine {code:string;description:string;hsn:string;uom:string;quantity:string;unitPrice:string;taxPercent:string}
export interface BillingSettings {version:number;value:Record<string,string|boolean>}
export interface InvoiceDocument {id:string;source:'CRM'|'TALLY';customer_id:number;sales_order_id?:number|null;shipment_id?:number|null;number:string|null;status:string;version:number;created_by:number;customer_name?:string;invoice_date:string;total?:string;payload:{sourceLines?:InvoiceSourceLine[];sourceLinesVerified?:boolean;sourceLinesEnteredBy?:number;sourceEvidence?:string;date?:string;customer:{id:number;name:string};totals:{subtotal?:string;cgst?:string;sgst?:string;igst?:string;total:string};lines?:InvoiceLine[]};original?:{filename:string;sha256:string;uploaded_by:number;verified_by:number|null}|null}
export interface Report {key:string;title:string;count:number;generatedAt:string;note:string;columns:string[];rows:Record<string,string>[]}
export function billingApi(api:ApiClient){return {
 list:(query:Record<string,string|number>)=>api.get<Paginated<InvoiceDocument>>('/api/crm/billing',{query}),
 detail:(id:string)=>api.data<InvoiceDocument>('GET',`/api/crm/billing/${id}`),
 settings:()=>api.data<BillingSettings>('GET','/api/crm/billing/settings'),
 saveSettings:(body:unknown)=>api.data<BillingSettings>('PUT','/api/crm/billing/settings',body),
 create:(body:unknown)=>api.data<InvoiceDocument>('POST','/api/crm/billing',body),
 action:(id:string,body:unknown)=>api.data<InvoiceDocument>('POST',`/api/crm/billing/${id}/actions`,body),
 saveSourceLines:(id:string,body:unknown)=>api.data<InvoiceDocument>('PATCH',`/api/crm/billing/${id}/source-lines`,body),
 upload:(id:string,body:unknown)=>api.data<InvoiceDocument>('POST',`/api/crm/billing/${id}/original`,body)
};}
