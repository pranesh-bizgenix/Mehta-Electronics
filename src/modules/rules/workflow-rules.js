import {F1_RULES} from './rule-definitions.js';
import {BUSINESS_RULES} from './business-rule-definitions.js';
import {OPERATIONS_RULES} from '../operations/operations-rules.js';
import {validate} from '../../core/schema.js';
import {ruleNotConfigured,conflict} from '../../core/errors.js';
import {hasPermission} from '../../rbac.js';
import {usableSetting} from '../decisions/service.js';
import {fingerprint} from '../../core/runtime.js';
const definitions=new Map([...F1_RULES,...BUSINESS_RULES,...OPERATIONS_RULES].map(d=>[d.key,d]));
export const PRICING_RULE_KEYS=['discount.levels','discount.role_limits','quotation.approval_levels'];
export async function workflowRule(db,key,required=true){
 const definition=definitions.get(key);if(!definition)throw new Error(`Unknown workflow rule ${key}.`);
 const row=await usableSetting(db,key);
 let value;
 if(row)try{value=validate(definition.schema,row.value);if(definition.validate?.(value))value=undefined;}catch{value=undefined;}
 if(value===undefined){if(required)throw ruleNotConfigured(key,`${definition.label} — blocks: ${definition.dependents.join(', ')}`);return null;}
 return {value,version:row.version,decisionVersion:row.decisionVersion};
}
export const APPROVAL_REVIEWER_POLICY='quotation.approval_reviewer_policy';
const binding=rule=>rule?{version:rule.version,decisionVersion:rule.decisionVersion}:null;
const sameBinding=(stored,rule)=>typeof stored==='number'?stored===rule.version:fingerprint(stored??null)===fingerprint(binding(rule));
export async function pricingRuleVersions(db){return Object.fromEntries(await Promise.all([...PRICING_RULE_KEYS,APPROVAL_REVIEWER_POLICY].map(async key=>[key,binding(await workflowRule(db,key,false))])));}
const units=value=>{const [a,b='']=value.split('.');return BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));};
/** Pure matching/order check; owner-supplied sequence, never array/name/role ordering. */
export function matchingApprovalPlan(row,rules,reviewerPolicy=null){
 const role=row.private_snapshot.pricingAuthorRole,limit=rules['discount.role_limits'].value.find(v=>v.role===role);
 if(!limit)throw conflict(`Discount limit for ${role??'the draft editor'} is not set. Owner must set it in Rules before quotation submission.`);
 const levels=rules['discount.levels'].value,applies=new Set(['ALL']);
 if(row.private_snapshot.belowFloor)applies.add('BELOW_MARGIN_FLOOR');
 for(const line of row.public_snapshot.lines){
  const amount=units(line.discountPercent);
  if(amount>units(limit.maximumPercent))throw conflict(`Quotation discount exceeds the confirmed limit for ${role}. Revise the draft.`);
  const level=['level1','level2','level3'].find(key=>amount>=units(levels[key].min)&&amount<=units(levels[key].max));
  if(!level)throw conflict('A line discount falls outside the confirmed discount bands. Revise it or ask Owner to review the rules.');
  if(level==='level2')applies.add('DISCOUNT_LEVEL_2');if(level==='level3')applies.add('DISCOUNT_LEVEL_3');
 }
 const required=rules['quotation.approval_levels'].value.filter(v=>applies.has(v.appliesTo));
 if(!required.length)throw conflict('The confirmed approval policy has no matching level for this quotation. Owner must review Rules.');
 if(required.length>1){
  if(required.some(stage=>!Number.isSafeInteger(stage.sequence))||new Set(required.map(stage=>stage.sequence)).size!==required.length)throw conflict('Owner must confirm a unique sequence number for every matching approval stage.');
  if(!reviewerPolicy)throw ruleNotConfigured(APPROVAL_REVIEWER_POLICY,'Reviewer reuse for staged quotation approval');
 }
 const stages=(required.length>1?[...required].sort((a,b)=>a.sequence-b.sequence):required).map(stage=>({...stage,policyStageId:fingerprint(stage)}));
 return {stages,reuse:required.length>1?reviewerPolicy.value.reuse:'SINGLE_REVIEWER'};
}
export async function requirePricingRules(db,row,user,{approval=false}={}){
 const rules={};for(const key of PRICING_RULE_KEYS)rules[key]=await workflowRule(db,key);
 if(PRICING_RULE_KEYS.some(key=>!sameBinding(row.private_snapshot.businessRuleVersions?.[key],rules[key])))throw conflict('Pricing rules changed or were confirmed after this draft. Save a new draft revision and submit it again.');
 const reviewerPolicy=await workflowRule(db,APPROVAL_REVIEWER_POLICY,false),plan=matchingApprovalPlan(row,rules,reviewerPolicy);
 if(plan.stages.length>1&&fingerprint(row.private_snapshot.businessRuleVersions?.[APPROVAL_REVIEWER_POLICY]??null)!==fingerprint(binding(reviewerPolicy)))throw conflict('Reviewer policy changed or was confirmed after this draft. Save a new draft revision and submit it again.');
 if(approval&&!hasPermission(user,plan.stages[0].permission))throw conflict('This reviewer does not hold the permission required by the confirmed pricing approval level.');
 return {...plan,ruleBindings:Object.fromEntries([...PRICING_RULE_KEYS,...(plan.stages.length>1?[APPROVAL_REVIEWER_POLICY]:[])].map(key=>[key,binding(key===APPROVAL_REVIEWER_POLICY?reviewerPolicy:rules[key])]))};
}
