import {validationFailed} from '../../core/errors.js';
import {s,validate} from '../../core/schema.js';

// Confirmed by the user on 23 November 2026. Persist this choice when a tier
// policy is saved; existing explicit policy snapshots retain their meaning.
export const CONFIRMED_EXACTLY_FIVE_TIER='ELITE';
const tier=s.object({basis:s.enum(['PO','ENQUIRY']),statuses:s.array(s.string({min:1,max:30}),{min:1,max:10}),includeCurrent:s.bool(),threshold:s.int({min:5,max:5}),exactlyFive:s.enum(['EARLY_BIRD','ELITE','UNCLASSIFIED','REVIEW']).optional(),companyScoped:s.bool()});
const pointer=s.string({min:1,max:200,pattern:/^\/(?:[A-Za-z0-9_.~-]+\/?)+$/});
export const salesIntakePolicySchema=s.object({
 ingestionEnabled:s.bool().optional(),mailboxes:s.array(s.string({min:3,max:254}),{max:20}).optional(),
 assignment:s.object({mode:s.enum(['CUSTOMER_OWNER','FIXED','UNASSIGNED']),userId:s.id().optional(),fallbackUserId:s.id().optional()}).optional(),
 tiers:s.object({po:tier.optional(),enquiry:tier.optional()}).optional(),
 quotationValidityDays:s.int({min:1,max:366}).optional(),
 taxTreatment:s.enum(['DOMESTIC_STANDARD']).optional(),sellerState:s.string({pattern:/^(0[1-9]|[12][0-9]|3[0-8])$/}).optional(),
 locationStock:s.object({balancesPointer:pointer,namePointer:pointer,quantityPointer:pointer,reservedPointer:pointer,reservationsPointer:pointer}).optional(),
 response:s.object({qualifyingActions:s.array(s.enum(['CUSTOMER_RESPONSE_REFERENCE']),{min:1,max:1}),instructions:s.string({min:3,max:2000}),reassignmentAttribution:s.enum(['FIRST_ASSIGNEE','RESPONDING_ASSIGNEE']),excludeCancelled:s.bool(),pauseMode:s.enum(['NO_PAUSES']),reopenBehavior:s.enum(['KEEP_FIRST_ASSIGNMENT_AND_RESPONSE'])}).optional(),
 kpi:s.object({metric:s.enum(['ON_TIME_FIRST_RESPONSE_RATE']),denominator:s.enum(['ASSIGNED','RESPONDED']),weight:s.string({pattern:/^(?:\d{1,2}(?:\.\d{1,6})?|100(?:\.0{1,6})?)$/}),periodFrom:s.date(),periodTo:s.date(),excludeCancelled:s.bool()}).optional()
});
export function validateSalesIntakePolicy(value){
 const out=validate(salesIntakePolicySchema,value);
 if(out.assignment?.mode==='FIXED'&&!out.assignment.userId)throw validationFailed('FIXED assignment requires a salesperson ID.');
 if(out.assignment?.fallbackUserId&&out.assignment.mode!=='CUSTOMER_OWNER')throw validationFailed('A fallback salesperson is only used with CUSTOMER_OWNER assignment.');
 if(out.kpi&&out.kpi.periodTo<out.kpi.periodFrom)throw validationFailed('KPI reporting period must be in date order.');
 if(out.kpi&&out.response&&out.kpi.excludeCancelled!==out.response.excludeCancelled)throw validationFailed('Response and KPI cancellation exclusions must agree.');
 if(out.tiers?.po&&out.tiers.po.basis!=='PO')throw validationFailed('PO tier counting must use distinct customer POs.');
 for(const policy of Object.values(out.tiers??{})){
  policy.exactlyFive??=CONFIRMED_EXACTLY_FIVE_TIER;
  if(policy.companyScoped!==true)throw validationFailed('Tier counts must remain company scoped.');
  const statuses=policy.basis==='PO'?['ACTIVE','ARCHIVED']:['NEW','QUALIFIED','QUOTED','WON','LOST','CANCELLED'];
  if(new Set(policy.statuses).size!==policy.statuses.length||policy.statuses.some(status=>!statuses.includes(status)))throw validationFailed('Choose distinct statuses supported by the selected PO/enquiry counting basis.');
 }
 if(out.locationStock)for(const p of Object.values(out.locationStock))if(/__proto__|constructor|prototype|amount|rate|price|margin|cost|value/i.test(p))throw validationFailed('Location stock mapping cannot expose financial or unsafe fields.');
 return out;
}
export function tierResult(count,policy){
 if(!policy)return {tier:null,state:'TIER_POLICY_REQUIRED',count:null,policy:null};
 const exactlyFive=policy.exactlyFive??CONFIRMED_EXACTLY_FIVE_TIER;
 const tier=count<5?'EARLY_BIRD':count>5?'ELITE':exactlyFive==='REVIEW'?null:exactlyFive==='UNCLASSIFIED'?null:exactlyFive;
 return {tier,state:count===5&&exactlyFive==='REVIEW'?'TIER_POLICY_REQUIRED':'CLASSIFIED',count,policy};
}

export function quotationValidityDate(now,days){
 const local=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const date=new Date(local+'T00:00:00.000Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);
}
