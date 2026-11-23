import {s,validate} from '../../core/schema.js';
import {validationFailed} from '../../core/errors.js';

const note=s.string({min:1,max:10000,trim:false}),short=s.string({min:1,max:200});
export const addressSchema=s.object({label:s.string({min:1,max:100}),kind:s.enum(['BILLING','DELIVERY']),line1:short,line2:s.string({max:200}).optional(),city:short,stateCode:s.string({min:1,max:80}),postalCode:s.string({max:20}).optional(),countryCode:s.string({pattern:/^[A-Z]{2}$/}),contactName:s.string({max:200}).optional(),phone:s.string({max:40}).optional(),isDefault:s.bool()});
export const activitySchema=s.object({kind:s.enum(['CALL','VISIT','MEETING','NOTE']),title:short,notes:note,occurredAt:short,followUpAt:short.nullable().optional(),ownerId:s.id(),relatedKind:s.enum(['ENQUIRY','QUOTATION','ORDER']).nullable().optional(),relatedId:s.id().nullable().optional()});
export const opportunitySchema=s.object({title:short,stage:s.enum(['NEW','QUALIFIED','PROPOSAL','NEGOTIATION','WON','LOST']),expectedValue:s.string({pattern:/^\d{1,14}(?:\.\d{1,6})?$/}).nullable().optional(),expectedClose:s.date().nullable().optional(),notes:s.string({max:10000,trim:false}).optional(),ownerId:s.id(),enquiryId:s.id().nullable().optional(),quotationId:s.id().nullable().optional(),salesOrderId:s.id().nullable().optional(),closeReason:s.string({max:2000}).nullable().optional()});
const classPricing=s.object({strategy:s.enum(['RATE_CONTRACT','PRICE_LEVEL','MANUAL_REVIEW']),level:s.int({min:1,max:4}).optional()});
export const commercialSchema=s.object({classes:s.object({RATE_CONTRACT:classPricing.optional(),MEDIUM_DISCOUNT:classPricing.optional(),DEALER_NETWORK:classPricing.optional(),NEW:classPricing.optional()}).optional(),classification:s.object({basis:s.enum(['PO','ORDER','INVOICE']),statuses:s.array(s.string({min:1,max:40}),{min:1,max:10}),periodDays:s.int({min:1,max:36500}).nullable(),existingMinimum:s.int({min:1,max:1000000}),potentialBelow:s.int({min:1,max:1000000}).nullable()}).optional()});
export function validateCommercial(value){
 const v=validate(commercialSchema,value);
 for(const [key,p]of Object.entries(v.classes??{})){
  if(p.strategy==='PRICE_LEVEL'&&!p.level)throw validationFailed('Select an approved price level for '+key+'.');
  if(p.strategy!=='PRICE_LEVEL'&&p.level!=null)throw validationFailed('Only price-level strategies accept a level.');
  if(key==='RATE_CONTRACT'&&p.strategy!=='RATE_CONTRACT')throw validationFailed('Rate-contract customers must retain exclusive approved contract pricing.');
 }
 if(v.classification?.potentialBelow!=null&&v.classification.potentialBelow<=v.classification.existingMinimum)throw validationFailed('Potential cutoff must be above the minimum count for existing customers.');
 if(v.classification){const c=v.classification,allowed={PO:['ACTIVE','ARCHIVED'],ORDER:['DRAFT','HELD','APPROVED','PARTIALLY_DISPATCHED','DISPATCHED','DELIVERED','CANCELLED'],INVOICE:['ISSUED']}[c.basis];if(new Set(c.statuses).size!==c.statuses.length||c.statuses.some(x=>!allowed.includes(x)))throw validationFailed('Choose distinct supported history statuses for the selected basis.');}
 return v;
}
export function validateActivity(value,now=new Date()){
 const v=validate(activitySchema,value),at=new Date(v.occurredAt),follow=v.followUpAt?new Date(v.followUpAt):null;
 const zoned=x=>typeof x==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(x);
 if(!zoned(v.occurredAt)||!Number.isFinite(at.valueOf())||at>now)throw validationFailed('Activity time needs a valid past timestamp with timezone.');
 if(follow&&(!zoned(v.followUpAt)||!Number.isFinite(follow.valueOf())||follow<at))throw validationFailed('Follow-up must be a valid timestamp after the activity.');
 if(Boolean(v.relatedKind)!==Boolean(v.relatedId))throw validationFailed('Choose both the related record type and ID.');
 return {...v,occurredAt:at.toISOString(),followUpAt:follow?.toISOString()??null};
}
export function classifyHistory(count,policy){
 if(!policy)return {state:'NOT_CONFIGURED',classification:null,tier:null,count:null};
 const classification=count<policy.existingMinimum?'NEW':policy.potentialBelow!=null&&count<policy.potentialBelow?'POTENTIAL':'EXISTING';
 return {state:'EVALUATED',classification,tier:policy.basis==='PO'&&classification==='EXISTING'?(count<5?'EARLY_BIRD':'ELITE'):null,count};
}
