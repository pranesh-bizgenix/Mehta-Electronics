import type {ApiClient} from '@/lib/api/client';

export type DecisionStatus='EMPTY'|'PROPOSED'|'ENTERED'|'CONFIRMED'|'REJECTED';
export type DecisionAction='CONFIRM'|'REJECT'|'CLEAR';
export interface DecisionOption {label:string;value:unknown}
export interface BusinessDecision {
 key:string;area:string;label:string;description:string;plainQuestion:string;workflow?:string;
 value:unknown;status:DecisionStatus;version:number;evidenceSource:string|null;
 confirmedBy:string|number|null;confirmedByName?:string|null;confirmedAt:string|null;enteredBy?:string|number|null;enteredByName?:string|null;reason?:string|null;
 blockedWorkflows:string[];shape:string|null;fixHref:string;
 valueKind:'NUMBER'|'TEXT'|'CHOICE'|'JSON';numberEncoding?:'INTEGER'|'DECIMAL_STRING'|null;
 options:DecisionOption[];hints:string|null;recommendedValue:unknown;suggestedEvidence?:string|null;suggestionStatus?:'PROPOSED'|null;
}
export interface DecisionSummary {total:number;confirmed:number;blocked:number;confirmedPercent:number;onlyOneOwner:boolean}
export interface DecisionsResponse {data:BusinessDecision[];summary:DecisionSummary}
export interface DecisionImportRow {row:number;key:string;label:string;expectedVersion:number;currentStatus:DecisionStatus;currentValue:unknown;value:unknown;evidenceSource:string|null;changed:boolean;issues:string[]}
export interface DecisionImportPreview {fingerprint:string;canImport:boolean;rows:DecisionImportRow[];issues:string[]}
export interface DecisionChange {expectedVersion:number;requestKey:string;reason:string}
export interface DecisionHistoryEntry {version:number;status:DecisionStatus;value:unknown;evidenceSource:string|null;reason:string;enteredBy:number|null;confirmedBy:number|null;confirmedAt:string|null;at:string;by:number}
export const decisionsApi=(api:ApiClient)=>({
 list:(signal?:AbortSignal)=>api.get<DecisionsResponse>('/api/v1/decisions',{signal}),
 history:(key:string,signal?:AbortSignal)=>api.data<DecisionHistoryEntry[]>('GET',`/api/v1/decisions/${encodeURIComponent(key)}/history`,undefined,{signal}),
 enter:(key:string,body:DecisionChange&{value:unknown;evidenceSource?:string;confirm:boolean})=>api.data<BusinessDecision>('POST',`/api/v1/decisions/${encodeURIComponent(key)}/enter`,body),
 decide:(key:string,body:DecisionChange&{decision:DecisionAction})=>api.data<BusinessDecision>('POST',`/api/v1/decisions/${encodeURIComponent(key)}/decide`,body),
 bulk:(body:{entries:{key:string;expectedVersion:number}[];decision:DecisionAction;requestKey:string;reason:string})=>api.data<{rows:BusinessDecision[];replayed:boolean}>('POST','/api/v1/decisions/bulk-decide',body),
 previewImport:(csv:string)=>api.data<DecisionImportPreview>('POST','/api/v1/decisions/preview-import',{csv}),
 importSheet:(body:{csv:string;fingerprint:string;requestKey:string;reason:string})=>api.data<{rows:BusinessDecision[];replayed:boolean}>('POST','/api/v1/decisions/import',body)
});
