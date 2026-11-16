import type {ApiClient} from '@/lib/api/client';
export interface PriceRow {sourceRow:number;partCode:string;uom:string;unitPrice:string;minQuantity:string;discountPercent:string;edition:string;level:string;issues:string[]}
export interface PricePlan {rows:PriceRow[];excludedSourceRows?:number[];canSave:boolean;invalidRows:number;validRows:number;fileSha256:string;previewFingerprint:string}
export interface SourceTable {sheets:string[];rows?:{number:number;page?:number;sourceText?:string;cells:({text:string}|null)[]}[];sourceRows?:number;sourcePage?:number;sourcePages?:number}
export interface PriceReview {id:string;status:string;source_revision:number;mapping?:Record<string,unknown>;row_count:number;metadata:{name:string;currency:string;effectiveFrom:string;effectiveTo:string;discountPercent:string};plan_hash:string;created_by:number;entries?:{source_row_number:number;part_code:string;uom:string;min_quantity:string;unit_price:string;discount_percent:string;edition:string;source_level:string}[];events?:{action:string;reason:string;actor_id:number;created_at:string}[]}
export const priceImportsApi=(client:ApiClient)=>({
 list:()=>client.data<PriceReview[]>('GET','/api/crm/price-imports'),
 detail:(id:string,page:number)=>client.data<PriceReview>('GET',`/api/crm/price-imports/${id}?page=${page}`),
 inspect:(body:unknown)=>client.data<SourceTable>('POST','/api/crm/price-imports/inspect',body),
 preview:(body:unknown)=>client.data<PricePlan>('POST','/api/crm/price-imports/preview',body),
 save:(body:unknown)=>client.data<{id:string}>('POST','/api/crm/price-imports',body),
 decide:(id:string,action:string,reason:string)=>client.data('POST',`/api/crm/price-imports/${id}/decision`,{action,reason})
});
