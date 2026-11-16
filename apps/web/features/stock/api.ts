import type {ApiClient} from '@/lib/api/client';
export interface StockInput {itemId:number;requestedQuantity:string;basis:'FREE_STOCK'|'RESERVED_STOCK';reservationKey?:string}
export interface StockPreview {item:{id:number;part_code:string;description:string};status:string;available:boolean|null;stockInHand:string|null;reservedQuantity:string|null;freeQuantity:string|null;selectedReservedQuantity:string|null;uom:string|null;sourceTimestamp:string|null;ageSeconds:number|null;issues:string[];previewFingerprint:string;reservations:{position:number;key:string;quantity:string;reference:string|null;party:string|null}[]}
export interface StockHistory {id:string;created_at:string;staff_name:string;part_code:string;requested_quantity:string;stock_in_hand:string|null;reserved_quantity:string|null;free_quantity:string|null;status:string;reason:string;source_observed_at:string|null;reservation_detail:{uom:string|null;available:boolean|null;issues:string[]}}
export interface StockDaily {created_by:number;staff_name:string;status:string;check_count:string;product_count:string}
export const stockApi=(client:ApiClient,companyId:string)=>{
 const query=`companyId=${encodeURIComponent(companyId)}`;
 return {
  preview:(body:StockInput)=>client.data<StockPreview>('POST',`/api/crm/stock-checks/preview?${query}`,body),
  record:(body:StockInput&{reason:string;requestId:string;previewFingerprint:string})=>client.data<{id:string;status:string;replayed?:boolean}>('POST',`/api/crm/stock-checks?${query}`,body),
  history:(page:number,signal?:AbortSignal)=>client.data<StockHistory[]>('GET',`/api/crm/stock-checks?${query}&page=${page}`,undefined,{signal}),
  daily:(day:string)=>client.data<StockDaily[]>('GET',`/api/crm/stock-checks/daily?${query}&day=${encodeURIComponent(day)}`)
 };
};
