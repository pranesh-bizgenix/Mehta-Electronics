import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {matchingApprovalPlan} from '../src/modules/rules/workflow-rules.js';
import {fingerprint} from '../src/core/runtime.js';
import {createQuotationReview,quotationApprovalFingerprint,validateQuotationReviewShape,validateQuotationReview,requireQuotationReviewer,quotationApprovalCommand,requireQuotationStageCommand,quotationApprovalProjection,quotationReviewer} from '../src/quotation-approvals.js';
import {F1_RULES} from '../src/modules/rules/rule-definitions.js';
import {validate} from '../src/core/schema.js';

const stage=(name,sequence,permission='quotations.approve')=>({name,sequence,permission,appliesTo:'ALL'});
const quote=()=>({quotation_id:1,version:2,created_by:10,policy_revision:3,status:'PENDING_APPROVAL',public_snapshot:{lines:[{discountPercent:'0'}]},private_snapshot:{pricingAuthorRole:'EXECUTIVE',cost:'VERIFY-private_cost',lines:[{unitCost:'VERIFY-private_cost'}],belowFloor:false}});
const rules=stages=>({'discount.levels':{value:{level1:{min:'0',max:'10'},level2:{min:'10.000001',max:'20'},level3:{min:'20.000001',max:'100'}}},'discount.role_limits':{value:[{role:'EXECUTIVE',maximumPercent:'100'}]},'quotation.approval_levels':{value:stages}});
const plan=()=>({...matchingApprovalPlan(quote(),rules([stage('VERIFY- later',20),stage('VERIFY- earlier',10)]),{value:{reuse:'DISTINCT_REVIEWERS'}}),ruleBindings:{'quotation.approval_levels':{version:2,decisionVersion:7}}});

test('quotation review never gives non-Owner roles wildcard authority from corrupted role metadata',async()=>{
 const user={id:99,role:'MANAGER',status:'ACTIVE',role_status:'ACTIVE',all_permissions:true,on_leave:false,must_change_password:0,mfa_enabled:true,role_requires_mfa:true};
 let grants=[];
 const db={prepare:statement=>statement.includes('FROM users')?{get:async()=>user}:{all:async()=>grants.map(permission_key=>({permission_key}))}};
 assert.equal(await quotationReviewer(db,99,'quotations.approve',{mfaEnabled:true}),false);
 grants=['quotations.read','quotations.approve'];
 assert.equal(await quotationReviewer(db,99,'quotations.approve',{mfaEnabled:true}),true);
 user.role='OWNER';grants=[];
 assert.equal(await quotationReviewer(db,99,'quotations.approve',{mfaEnabled:true}),true);
});

test('multiple quotation stages require explicit unique ordering and confirmed reviewer reuse; one stage keeps its existing behavior',()=>{
 const row=quote(),definition=F1_RULES.find(rule=>rule.key==='quotation.approval_levels');
 assert.throws(()=>matchingApprovalPlan(row,rules([stage('A',undefined),stage('B',undefined)]),null),/unique sequence/);
 assert.throws(()=>matchingApprovalPlan(row,rules([stage('A',1),stage('B',2)]),null),{code:'RULE_NOT_CONFIGURED'});
 assert.deepEqual(plan().stages.map(step=>step.name),['VERIFY- earlier','VERIFY- later']);
 assert.equal(matchingApprovalPlan(row,rules([{name:'VERIFY- one',permission:'quotations.approve',appliesTo:'ALL'}])).reuse,'SINGLE_REVIEWER');
 assert.ok(definition.validate(validate(definition.schema,[stage('A',1),stage('B',1)])));
 assert.ok(definition.validate(validate(definition.schema,[stage('A',1),stage('a',2)])));
 const reviewerRule=F1_RULES.find(rule=>rule.key==='quotation.approval_reviewer_policy');
 assert.throws(()=>validate(reviewerRule.schema,{}),{status:422});
 assert.throws(()=>validate(reviewerRule.schema,{reuse:'GUESS',instructions:'VERIFY- explicit instructions'}),{status:422});
});

test('approval rounds and source bindings cannot be reused across returns, decision changes or unfinished stages',()=>{
 const row=quote(),policy=plan(),margin={version:3,decisionVersion:4},source=quotationApprovalFingerprint(row,policy,margin),review=createQuotationReview(row,policy,source);
 assert.notEqual(review.roundId,createQuotationReview(row,policy,source).roundId);
 assert.equal(validateQuotationReviewShape(row,policy,review,source).stageId,review.stages[0].stageId);
 assert.throws(()=>validateQuotationReviewShape(row,policy,review,source,{complete:true}),{code:'QUOTATION_APPROVAL_INCOMPLETE'});
 assert.throws(()=>validateQuotationReviewShape(row,policy,review,quotationApprovalFingerprint(row,policy,{...margin,decisionVersion:5})),{code:'QUOTATION_APPROVAL_CHANGED'});
 const changedPlan={...policy,ruleBindings:{'quotation.approval_levels':{version:2,decisionVersion:8}}};
 assert.notEqual(fingerprint(policy),fingerprint(changedPlan));
 review.completed.push({stageId:review.stages[0].stageId,reviewerId:20});
 assert.equal(validateQuotationReviewShape(row,policy,review,source).stageId,review.stages[1].stageId);
 review.completed.push({stageId:review.stages[1].stageId,reviewerId:20});
 assert.throws(()=>validateQuotationReviewShape(row,policy,review,source),/different reviewer/);
});

test('stage commands require round, stage and retry identities and bind actor, reason and payload',()=>{
 const row=quote(),review=createQuotationReview(row,plan(),'VERIFY- fingerprint'),actor={id:20},command={action:'APPROVE',version:2,reason:'VERIFY- checked stage',roundId:review.roundId,stageId:review.stages[0].stageId,requestKey:randomUUID()};
 assert.doesNotThrow(()=>requireQuotationStageCommand(command,review));
 for(const key of ['roundId','stageId','requestKey'])assert.throws(()=>requireQuotationStageCommand({...command,[key]:undefined},review),{status:422});
 assert.throws(()=>requireQuotationStageCommand({...command,stageId:review.stages[1].stageId},review),{code:'QUOTATION_APPROVAL_STAGE_CHANGED'});
 const hash=quotationApprovalCommand(command,actor,1);
 assert.notEqual(hash,quotationApprovalCommand({...command,reason:'VERIFY- changed reason'},actor,1));
 assert.notEqual(hash,quotationApprovalCommand(command,{id:21},1));
 assert.notEqual(hash,quotationApprovalCommand(command,actor,2));
 assert.notEqual(hash,quotationApprovalCommand({...command,overrideFloor:true},actor,1));
 assert.notEqual(hash,quotationApprovalCommand({...command,ownerSelfApproval:true},actor,1));
 assert.throws(()=>quotationApprovalCommand({...command,ownerSelfApproval:'true'},actor,1),{status:422});
 assert.throws(()=>quotationApprovalCommand({...command,overrideFloor:'true'},actor,1),{status:422});
 assert.throws(()=>quotationApprovalCommand({...command,total:'100'},actor,1),{status:422});
});

test('reviewer checks use current grants and active status, exclude makers and keep the public progress projection nonfinancial',async()=>{
 const row=quote(),policy=plan(),source='VERIFY- fingerprint',review=createQuotationReview(row,policy,source);
 const ready={on_leave:false,must_change_password:0,locked_until:null,mfa_enabled:true,role_requires_mfa:true};
 const users=new Map([[10,{...ready,id:10,role:'OWNER',status:'ACTIVE',role_status:'ACTIVE',all_permissions:true}],[20,{...ready,id:20,role:'MANAGER',status:'ACTIVE',role_status:'ACTIVE',all_permissions:false}],[21,{...ready,id:21,role:'MANAGER',status:'ACTIVE',role_status:'ACTIVE',all_permissions:false}]]);
 let grants=['quotations.read','quotations.approve'];
 // Query protocol doubles only; no connection or in-memory database is created.
 const db={prepare(sql){if(sql.startsWith('SELECT role FROM users'))return {get:async id=>users.get(id)};if(sql.startsWith('SELECT u.id,u.role'))return {get:async id=>users.get(id)};if(sql.startsWith('SELECT permission_key'))return {all:async()=>grants.map(permission_key=>({permission_key}))};if(sql.startsWith('SELECT created_by'))return {get:async()=>({created_by:21})};throw new Error('Unexpected query.');}};
 assert.equal((await requireQuotationReviewer(db,row,review,{id:20})).stageId,review.stages[0].stageId);
 assert.equal((await requireQuotationReviewer(db,row,review,{id:10})).ownerSelfApproval,true);
 for(const id of [21])await assert.rejects(()=>requireQuotationReviewer(db,row,review,{id,role:'OWNER'}),{status:403});
 const ownerReview=createQuotationReview(row,policy,source);ownerReview.completed.push({stageId:ownerReview.stages[0].stageId,reviewerId:10,ownerSelfApproval:true});
 await validateQuotationReview(db,row,policy,ownerReview,source);
 delete ownerReview.completed[0].ownerSelfApproval;await assert.rejects(()=>validateQuotationReview(db,row,policy,ownerReview,source),{code:'QUOTATION_REVIEWER_CHANGED'});
 ownerReview.completed[0].ownerSelfApproval=true;users.get(10).role='MANAGER';await assert.rejects(()=>validateQuotationReview(db,row,policy,ownerReview,source),{code:'QUOTATION_REVIEWER_CHANGED'});users.get(10).role='OWNER';
 review.completed.push({stageId:review.stages[0].stageId,reviewerId:20});
 await assert.rejects(()=>requireQuotationReviewer(db,row,review,{id:20}),{status:403});
 assert.equal((await validateQuotationReview(db,row,policy,review,source)).stageId,review.stages[1].stageId);
 users.get(20).status='INACTIVE';await assert.rejects(()=>validateQuotationReview(db,row,policy,review,source),{code:'QUOTATION_REVIEWER_CHANGED'});users.get(20).status='ACTIVE';
 grants=[];await assert.rejects(()=>validateQuotationReview(db,row,policy,review,source),{code:'QUOTATION_REVIEWER_CHANGED'});grants=['quotations.read','quotations.approve'];
 for(const patch of [{on_leave:true},{must_change_password:1},{locked_until:new Date(Date.now()+60000).toISOString()}]){Object.assign(users.get(20),ready,patch);await assert.rejects(()=>validateQuotationReview(db,row,policy,review,source),{code:'QUOTATION_REVIEWER_CHANGED'});}Object.assign(users.get(20),ready);
 users.get(20).mfa_enabled=false;assert.equal(await quotationReviewer(db,20,'quotations.approve',{mfaEnabled:true}),false);assert.equal(await quotationReviewer(db,20,'quotations.approve',{mfaEnabled:false}),true);Object.assign(users.get(20),ready);
 row.private_snapshot.approvalReview=review;
 const projected=await quotationApprovalProjection(db,row,{id:20});
 assert.equal(projected.completed,1);assert.equal(projected.canApprove,false);assert.equal(projected.canReturn,true);
 for(const hidden of ['VERIFY-private_cost','VERIFY- earlier','VERIFY- later','quotations.approve','unitCost','permission'])assert.equal(JSON.stringify(projected).includes(hidden),false,hidden);
});
