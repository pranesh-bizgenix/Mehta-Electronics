import type {ApiClient,Pagination} from '@/lib/api/client';
export interface Identity {requestedId:number;canonicalId:number;merged:boolean;customerIds:number[];relatedCustomers:{id:number;name:string;status:string}[];note:string}
export interface Address {id:string;customer_id:number;label:string;kind:'BILLING'|'DELIVERY';line1:string;line2:string;city:string;state_code:string;postal_code:string;country_code:string;contact_name:string;phone:string;is_default:boolean;status:string;version:number}
export interface Activity {id:string;customer_id:number;kind:string;title:string;notes:string;occurred_at:string;follow_up_at:string|null;owner_id:number;owner_name:string;status:string;version:number}
export interface Opportunity {id:string;customer_id:number;title:string;stage:string;expected_value:string|null;expected_close:string|null;notes:string;owner_id:number;owner_name:string;enquiry_id:number|null;quotation_id:number|null;sales_order_id:number|null;close_reason:string|null;version:number}
export interface History {kind:string;id:string;reference:string;title:string;status:string;customer_id:number;created_at:string;href:string;amount:string|null}
export interface ClassStrategy {strategy:'RATE_CONTRACT'|'PRICE_LEVEL'|'MANUAL_REVIEW';level?:number}
export interface CommercialPolicy {company_id:string;version:number;value:{classes?:Record<string,ClassStrategy>;classification?:{basis:'PO'|'ORDER'|'INVOICE';statuses:string[];periodDays:number|null;existingMinimum:number;potentialBelow:number|null}}}
export interface Commercial {policy:CommercialPolicy;context:{pricingClass:string|null;companyId:string|null;policyVersion:number;strategy:ClassStrategy|null}}
export interface Classification {state:string;classification:string|null;tier:string|null;count:number|null;unscopedRecords?:number;policyVersion:number;restriction:string|null;note?:string}
export interface MergePreview {source:{id:number;name:string};target:{id:number;name:string};blockers:string[];openWork:Record<string,number>;fingerprint:string;note:string}
export interface Merge {id:string;source_id:number;target_id:number;source_name:string;target_name:string;status:string;reason:string;created_by:number;version:number;decision_reason:string|null}
export interface PricingPreview {state:'UNCLASSIFIED'|'MANUAL_REVIEW'|'RESOLVED';context:{pricingClass:string|null;policyVersion:number};unitPrice?:string;discountPercent?:string;source?:{level?:number;fingerprint?:string;contractId?:string};fingerprint?:string}
export interface PricingBinding {fingerprint:string;pricingClass:string|null;policyVersion:number;state:string}
export const pricingBinding=(v:PricingPreview):PricingBinding|undefined=>v.fingerprint?{fingerprint:v.fingerprint,pricingClass:v.context.pricingClass,policyVersion:v.context.policyVersion,state:v.state}:undefined;
export const customerManagementApi=(api:ApiClient,id:number|string)=>{
 const base=`/api/v1/customers/${id}`;
 return {
  identity:(signal?:AbortSignal)=>api.data<Identity>('GET',base+'/identity',undefined,{signal}),
  addresses:(signal?:AbortSignal)=>api.data<{identity:Identity;data:Address[]}>('GET',base+'/addresses',undefined,{signal}),
  activities:(page:number,signal?:AbortSignal)=>api.data<{data:Activity[]}>('GET',base+'/activities',undefined,{query:{page},signal}),
  opportunities:(page:number,signal?:AbortSignal)=>api.data<{data:Opportunity[]}>('GET',base+'/opportunities',undefined,{query:{page},signal}),
  timeline:(kind:string,page:number,signal?:AbortSignal)=>api.data<{data:History[];identity:Identity;pagination:Pagination}>('GET',base+'/timeline',undefined,{query:{kind,page},signal}),
  save:(kind:string,recordId:string|null,body:unknown,key:string)=>api.data(recordId?'PUT':'POST',base+'/'+kind+(recordId?'/'+recordId:''),body,{idempotencyKey:key}),
  archive:(kind:string,row:{id:string;version:number},reason:string)=>api.data('POST',base+'/'+kind+'/'+row.id+'/archive',{version:row.version,reason}),
  commercial:(companyId:string,signal?:AbortSignal)=>api.data<Commercial>('GET',base+'/commercial-policy',undefined,{query:{companyId},signal}),
  classification:(companyId:string,signal?:AbortSignal)=>api.data<Classification>('GET',base+'/classification',undefined,{query:{companyId},signal}),
  applyClassification:(companyId:string,body:unknown)=>api.data('POST',base+'/classification/apply',body,{query:{companyId}}),
  savePolicy:(companyId:string,body:unknown)=>api.data<CommercialPolicy>('PUT',base+'/commercial-policy',body,{query:{companyId}}),
  previewPricing:(companyId:string,itemId:number,quantity:string)=>api.data<PricingPreview>('POST',base+'/pricing-preview',{itemId,quantity},{query:{companyId}}),
  merges:(signal?:AbortSignal)=>api.data<Merge[]>('GET',base+'/merges',undefined,{signal}),
  mergePreview:(targetId:number)=>api.data<MergePreview>('POST',base+'/merge-preview',{targetId}),
  requestMerge:(body:unknown,key:string)=>api.data('POST',base+'/merges',body,{idempotencyKey:key}),
  decideMerge:(row:Merge,decision:'APPROVE'|'REJECT',reason:string)=>api.data('POST',base+'/merges/'+row.id+'/decision',{version:row.version,decision,reason})
 };
};
