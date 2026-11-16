import type {ApiClient} from '@/lib/api/client';
import type {CommercialLine} from '@/features/workflows/line-editor';
export interface OrderStockLine extends CommercialLine {stockBasis?:'FREE_STOCK'|'RESERVED_STOCK'|null;stockReservationKey?:string|null;stockTallyOrderKey?:string|null}
export interface NativeStockOrder {id:string;number:string|null;party:string|null;guid:string|null;master_id:string|null}
export interface OrderStockEvidence {itemId:number;partCode:string;uom:string;basis:string;requestedQuantity:string;stockInHand:string|null;reservedQuantity:string|null;freeQuantity:string|null;selectedReservedQuantity:string|null;status:string;available:boolean|null;sourceTimestamp:string|null;ageSeconds:number|null;issues:string[];pendingConsumptionCount:number;legacyReviewCount:number;ownershipVerified:boolean;note:string}
export interface StockConsumption {id:string;created_at:string;created_by:number;item_id:number;part_code:string;sales_order_id:number;order_number:string;shipment_id:number;quantity:string;uom:string;source_observed_at:string;reason:string}
export interface ConsumptionPreview {movementId:string;companyId:string;canReview:boolean;status:string;sourceSessionId:string|null;sourceTimestamp:string|null;sourceRecordKey:string|null;stockInHand:string|null;reservedQuantity:string|null;issues:string[];note:string;fingerprint:string}
export interface ConsumptionReview {requestKey:string;reason:string;evidenceReference:string;attestedInTally:boolean;sourceFingerprint:string}
export const orderStockApi=(api:ApiClient)=>({
 sources:(companyId:string,signal?:AbortSignal)=>api.data<NativeStockOrder[]>('GET','/api/crm/order-stock-sources',undefined,{query:{companyId},signal}),
 pending:(companyId:string,signal?:AbortSignal)=>api.data<StockConsumption[]>('GET','/api/crm/stock-consumptions',undefined,{query:{companyId},signal}),
 preview:(id:string)=>api.data<ConsumptionPreview>('GET',`/api/crm/stock-consumptions/${encodeURIComponent(id)}/preview`),
 review:(id:string,body:ConsumptionReview)=>api.data<{id:string;replayed:boolean}>('POST',`/api/crm/stock-consumptions/${encodeURIComponent(id)}/review`,body)
});
