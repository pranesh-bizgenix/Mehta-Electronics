import type {ApiClient,Paginated} from '@/lib/api/client';
export type OperationsKind='ORDER_STATUS'|'STOCK'|'PROCUREMENT'|'OTHER';
export interface RequestRow {id:string;kind:OperationsKind;status:string;version:number;subject:string;summary:string;customer_name?:string;assigned_name?:string;created_at:string;sales_order_id:number|null;purchase_request_id:number|null;customer_id:number|null;assigned_to:number}
export interface ReviewedItem {lineId:string;itemId:number;quantity:string;uom:string}
export interface RequestDetail extends RequestRow {reviewed_by:number|null;sourceOrders?:{batch_id:string;source_date:string;po_number:string;part_code:string;reported_open:string;uom:string;required_date:string|null}[];source:{sender:string;subject:string;summary:string;body:string|null;action:string;poNumbers:string[];items:{lineId:string;productCode:string|null;description:string|null;quantity:string|null;uom:string|null}[];changes:{field:string;requestedValue:string;sourceQuote:string}[];warnings:string[];sourceArchive:{bucket:string;key:string;sha256:string|null}|null};resolutions:{sourceChecked?:boolean;items?:ReviewedItem[]};blockers:string[];procurementProgress?:null|{request:{id:number;number:string;status:string};rfqs:{id:number;number:string;status:string}[];supplierOrders:{id:number;number:string;status:string;delivery_by:string|null;receipts:{id:number;number:string;status:string}[]}[]};order:null|{id:number;status:string;effectiveStatus:string;version:number;lines:{partCode:string;quantity?:string;orderedQuantity?:string;fulfilledQuantity:string;uom:string}[];shipments:{id:number;status:string;lr_number:string|null}[]};events:{id:number;action:string;reason:string;actor_name:string|null;created_at:string}[]}
export interface StockResult {fingerprint:string;lines:{lineId:string;itemId:number;partCode:string;uom:string|null;requestedQuantity:string;stockInHand:string|null;reservedQuantity:string|null;freeQuantity:string|null;shortage:string|null;status:string;sourceTimestamp:string|null;issues:string[]}[]}
export const operationsIntakeApi=(api:ApiClient,companyId:string)=>{
 const query={companyId},base='/api/crm/operations-intake';
 return {
  list:(kind:OperationsKind,status:string,page:number,signal?:AbortSignal)=>api.get<Paginated<RequestRow>>(base,{query:{...query,kind,status,page},signal}),
  detail:(id:string)=>api.data<RequestDetail>('GET',`${base}/${id}`,undefined,{query}),
  review:(id:string,body:unknown)=>api.data<RequestDetail>('POST',`${base}/${id}/review`,body,{query}),
  action:(id:string,body:unknown)=>api.data<RequestDetail>('POST',`${base}/${id}/actions`,body,{query}),
  stock:(id:string)=>api.data<StockResult>('GET',`${base}/${id}/stock-preview`,undefined,{query}),
  procure:(id:string,body:unknown)=>api.data<{id:number;duplicate:boolean}>('POST',`${base}/${id}/purchase-request`,body,{query})
 };
};
