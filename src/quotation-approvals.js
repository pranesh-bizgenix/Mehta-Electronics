import {randomUUID} from 'node:crypto';
import {fingerprint} from './core/runtime.js';
import {s,validate} from './core/schema.js';
import {conflict,forbidden,validationFailed} from './core/errors.js';
import {restrictLogisticsPermissions} from './logistics-policy.js';
import {eligibleReviewers} from './modules/admin/reviewer-eligibility.js';
import {getConfig} from './config.js';
const currentOwner=async(db,id)=>(await db.prepare('SELECT role FROM users WHERE id=? FOR SHARE').get(id))?.role==='OWNER';

/** Current database grants, independent of a request's cached permission matrix. */
export async function quotationReviewer(db,actorId,permission='quotations.approve',{mfaEnabled=getConfig().mfaEnabled,now=Date.now()}={}){
 const user=await db.prepare('SELECT u.id,u.role,u.status,u.on_leave,u.must_change_password,u.locked_until,r.status AS role_status,r.all_permissions,r.requires_mfa AS role_requires_mfa,(m.enabled_at IS NOT NULL) AS mfa_enabled FROM users u JOIN roles r ON r.key=u.role LEFT JOIN user_mfa m ON m.user_id=u.id WHERE u.id=? FOR SHARE OF u,r').get(actorId);
 if(!user||user.status!=='ACTIVE'||user.role_status!=='ACTIVE')return false;
 const grants=user.role==='OWNER'&&user.all_permissions?['*']:(await db.prepare('SELECT permission_key FROM role_permissions WHERE role_key=? FOR SHARE').all(user.role)).map(row=>row.permission_key);
 const allowed=restrictLogisticsPermissions(user.role,grants);
 const can=(_user,key)=>allowed.includes('*')||allowed.includes(key);
 return eligibleReviewers([user],{can,requiresMfa:()=>mfaEnabled&&Boolean(user.role_requires_mfa)},'quotations',{now}).length===1&&can(user,permission);
}
export function quotationApprovalFingerprint(row,plan,margin){
 const p=row.private_snapshot;
 return fingerprint({quoteId:row.quotation_id,version:row.version,public:row.public_snapshot,policyRevision:row.policy_revision,
  pricing:{cost:p.cost,missingCost:p.missingCost,marginPercent:p.marginPercent,belowFloor:p.belowFloor,floorPercent:p.floorPercent,marginBasis:p.marginBasis,lines:p.lines,pricingAuthorRole:p.pricingAuthorRole},
  rules:plan.ruleBindings,plan,margin:{version:margin.version,decisionVersion:margin.decisionVersion}});
}
export function createQuotationReview(row,plan,sourceFingerprint){return {roundId:randomUUID(),quoteVersion:row.version,planFingerprint:fingerprint(plan),sourceFingerprint,reuse:plan.reuse,stages:plan.stages.map(stage=>({...stage,stageId:randomUUID()})),completed:[]};}
export function validateQuotationReviewShape(row,plan,review,sourceFingerprint,{complete=false}={}){
 if(!review||review.quoteVersion!==row.version||review.planFingerprint!==fingerprint(plan)||review.sourceFingerprint!==sourceFingerprint)throw conflict('Quotation approval sources or policy changed. Return to draft, save the current revision and submit for a new review.','QUOTATION_APPROVAL_CHANGED');
 try{validate(s.uuid(),review.roundId);}catch{throw conflict('The approval round is unavailable. Return and submit the quotation again.');}
 if(!Array.isArray(review.stages)||review.stages.length!==plan.stages.length||!Array.isArray(review.completed)||review.completed.length>review.stages.length)throw conflict('The retained approval plan is invalid. Submit a new review.');
 for(const [index,stage]of review.stages.entries()){
  const {stageId,...definition}=stage;try{validate(s.uuid(),stageId);}catch{throw conflict('The retained approval stage is invalid.');}
  if(fingerprint(definition)!==fingerprint(plan.stages[index]))throw conflict('The retained approval stages no longer match policy.');
 }
 if(new Set(review.stages.map(stage=>stage.stageId)).size!==review.stages.length)throw conflict('The retained approval stage identities are invalid.');
 for(const [index,decision]of review.completed.entries())if(decision.stageId!==review.stages[index].stageId||!Number.isSafeInteger(decision.reviewerId))throw conflict('The retained approval decisions are invalid.');
 if(review.reuse==='DISTINCT_REVIEWERS'&&new Set(review.completed.map(decision=>decision.reviewerId)).size!==review.completed.length)throw conflict('The confirmed policy requires a different reviewer for every stage.');
 if(complete&&review.completed.length!==review.stages.length)throw conflict('Every required approval stage must be completed before issuing or converting this quotation.','QUOTATION_APPROVAL_INCOMPLETE');
 return review.stages[review.completed.length]??null;
}
export async function validateQuotationReview(db,row,plan,review,sourceFingerprint,options){
 const pending=validateQuotationReviewShape(row,plan,review,sourceFingerprint,options);
 const latest=await db.prepare('SELECT created_by FROM crm_quotation_versions WHERE quotation_id=? AND version=?').get(row.quotation_id,row.version);
 for(const [index,decision]of review.completed.entries()){
  const self=decision.reviewerId===row.created_by||decision.reviewerId===latest?.created_by;
  if((self&&!(decision.ownerSelfApproval===true&&await currentOwner(db,decision.reviewerId)))||!await quotationReviewer(db,decision.reviewerId,review.stages[index].permission))throw conflict('An earlier reviewer is no longer eligible. Return to draft and obtain a new eligible review.','QUOTATION_REVIEWER_CHANGED');
 }
 return pending;
}
export async function requireQuotationReviewer(db,row,review,actor){
 const stage=review.stages[review.completed.length];if(!stage)throw conflict('All approval stages are already complete.');
 const latest=await db.prepare('SELECT created_by FROM crm_quotation_versions WHERE quotation_id=? AND version=?').get(row.quotation_id,row.version);
 const self=actor.id===row.created_by||actor.id===latest?.created_by;
 if(self&&!await currentOwner(db,actor.id))throw forbidden('A different eligible person must approve this quotation. Only Owner may use the self-approval exception.');
 if(!await quotationReviewer(db,actor.id,stage.permission))throw forbidden('You do not hold the current permissions required for this approval stage.');
 if(review.reuse==='DISTINCT_REVIEWERS'&&review.completed.some(decision=>decision.reviewerId===actor.id))throw forbidden('The confirmed policy requires a different reviewer for this stage.');
 return self?{...stage,ownerSelfApproval:true}:stage;
}
export function quotationApprovalCommand(input,actor,quoteId){
 const fields=['action','version','reason','overrideFloor','roundId','stageId','requestKey','ownerSelfApproval'];
 if(Object.keys(input).some(key=>!fields.includes(key)))throw validationFailed('Provide only supported quotation approval fields.');
 if(input.requestKey!==undefined)validate(s.uuid(),input.requestKey,'requestKey');
 if(input.roundId!==undefined)validate(s.uuid(),input.roundId,'roundId');
 if(input.stageId!==undefined)validate(s.uuid(),input.stageId,'stageId');
 if(input.overrideFloor!==undefined&&typeof input.overrideFloor!=='boolean')throw validationFailed('The margin exception acknowledgement must be true or false.');
 if(input.ownerSelfApproval!==undefined&&typeof input.ownerSelfApproval!=='boolean')throw validationFailed('The Owner self-approval acknowledgement must be true or false.');
 return fingerprint({actorId:actor.id,quoteId,version:input.version,reason:input.reason,roundId:input.roundId??null,stageId:input.stageId??null,overrideFloor:input.overrideFloor===true,...(input.ownerSelfApproval===true?{ownerSelfApproval:true}:{})});
}
export function requireQuotationStageCommand(input,review){
 const pending=review.stages[review.completed.length];
 if(review.stages.length>1){validate(s.uuid(),input.requestKey,'requestKey');validate(s.uuid(),input.roundId,'roundId');validate(s.uuid(),input.stageId,'stageId');}
 if(input.roundId!==undefined&&input.roundId!==review.roundId||input.stageId!==undefined&&input.stageId!==pending?.stageId)throw conflict('The approval round or pending stage changed. Reload before approving.','QUOTATION_APPROVAL_STAGE_CHANGED');
}
export async function quotationApprovalProjection(db,row,user){
 const review=row.private_snapshot.approvalReview;if(!review)return null;
 const total=review.stages?.length??0,completed=review.completed?.length??0,pending=review.stages?.[completed];
 let canApprove=false,canReturn=false,ownerSelfApproval=false;
 if(row.status==='PENDING_APPROVAL'){
  canReturn=await quotationReviewer(db,user?.id);
  if(pending)try{const stage=await requireQuotationReviewer(db,row,review,user);canApprove=true;ownerSelfApproval=stage.ownerSelfApproval===true;}catch{/* Public eligibility never exposes pricing or required permission names. */}
 }
 return {roundId:review.roundId,completed,total,pendingStageId:pending?.stageId??null,canApprove,canReturn,ownerSelfApproval,steps:(review.stages??[]).map((stage,index)=>({id:stage.stageId,number:index+1,status:index<completed?'COMPLETED':index===completed?'PENDING':'WAITING'}))};
}
