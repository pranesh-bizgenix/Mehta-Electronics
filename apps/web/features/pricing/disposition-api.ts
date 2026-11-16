import type {ApiClient} from '@/lib/api/client';
export interface DispositionCommand {action:'RETIRE'|'SUPERSEDE';listId:number;replacementId?:number}
export interface DispositionPreview {action:string;list:{id:number;name:string;createdBy:number;reviewed:boolean};replacement:{id:number;name:string}|null;policyVersion:number;affectedLevels:{number:number;label:string}[];sourceRowCount:number;uncoveredTierCount:number;uncoveredTiers:{itemId:number;minQuantity:string}[];warning:string;previewFingerprint:string}
export interface DispositionReview {id:string;requested_by:number;status:string;created_at:string;payload_snapshot:{command:DispositionCommand;reason:string;previewFingerprint:string;preview:DispositionPreview};decisions?:{decision:string;decided_by:number;reason:string;decided_at:string}[]}
export const dispositionApi=(client:ApiClient)=>({
 list:(page:number)=>client.data<DispositionReview[]>('GET',`/api/crm/price-dispositions?page=${page}`),
 detail:(id:string)=>client.data<DispositionReview>('GET',`/api/crm/price-dispositions/${id}`),
 preview:(body:DispositionCommand)=>client.data<DispositionPreview>('POST','/api/crm/price-dispositions/preview',body),
 request:(body:DispositionCommand&{reason:string;requestId:string;previewFingerprint:string})=>client.data<{id:string}>('POST','/api/crm/price-dispositions',body),
 decide:(id:string,decision:'APPROVED'|'REJECTED',reason:string)=>client.data('POST',`/api/crm/price-dispositions/${id}/decision`,{decision,reason})
});
