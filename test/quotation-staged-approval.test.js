import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {confirmFixturePricing,fixtureRuleService} from '../test-support/business-rule-fixture.js';
import {saveQuotePolicy,saveQuoteCost,saveQuote,quoteAction,quoteDetail,quoteForDocument,quoteHistory} from '../src/quotation-workflow.js';
import {orderQuoteSource} from '../src/sales-orders.js';
import {DecisionService} from '../src/modules/decisions/service.js';
import {TransactionRunner} from '../src/core/runtime.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {testFetch} from '../test-support/http-client.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';

const reason='VERIFY- independent staged quotation review';
async function fixture(db,{reuse='DISTINCT_REVIEWERS',secondPermission='orders.credit.review'}={}){
 const f=await quotationFixture(db),rules=fixtureRuleService(db);await confirmFixturePricing(db,f.owner);
 await rules.set(f.owner,'quotation.approval_levels',[{name:'VERIFY- second review',permission:secondPermission,appliesTo:'ALL',sequence:20},{name:'VERIFY- first review',permission:'quotations.approve',appliesTo:'ALL',sequence:10}],reason);
 await rules.set(f.owner,'quotation.approval_reviewer_policy',{reuse,instructions:'VERIFY- explicit reviewer reuse decision'},reason);
 await saveQuotePolicy(db,{floorPercent:'0',marginBasis:'TOTAL',sellerState:'27',letterhead:{name:'VERIFY- quotation seller'},reason},f.owner);
 await saveQuoteCost(db,f.item.id,{unitCost:'50',reason},f.owner);
 const body={customerId:f.customer.id,validUntil:'2099-12-31',placeOfSupply:'27',supplyType:'DOMESTIC_STANDARD',reason,lines:[{itemId:f.item.id,quantity:'1',unitPrice:'100',discountPercent:'0',taxPercent:'18'}]};
 let q=await saveQuote(db,null,body,f.executive);q=await quoteAction(db,q.id,{action:'SUBMIT',version:q.version,reason},f.executive);
 return {...f,rules,body,q};
}
const command=q=>({action:'APPROVE',version:q.version,reason,roundId:q.approval.roundId,stageId:q.approval.pendingStageId,requestKey:randomUUID()});

test('quotation stages follow explicit sequence, keep pending until complete, bind retries and enforce current independent reviewers',()=>withTestTransaction(async db=>{
 const f=await fixture(db);let q=f.q;assert.equal(q.status,'PENDING_APPROVAL');assert.equal(q.approval.completed,0);assert.equal(q.approval.total,2);assert.equal(q.approval.canApprove,false);
 q=await quoteDetail(db,q.id,f.manager);assert.equal(q.approval.canApprove,true);assert.equal(q.pricing.approvalReview.stages[0].name,'VERIFY- first review');
 await assert.rejects(()=>quoteAction(db,q.id,{action:'APPROVE',version:q.version,reason},f.manager),{status:422});
 const first=command(q);await assert.rejects(()=>quoteAction(db,q.id,{...first,stageId:q.pricing.approvalReview.stages[1].stageId},f.manager),{code:'QUOTATION_APPROVAL_STAGE_CHANGED'});
 await assert.rejects(()=>quoteAction(db,q.id,first,f.executive),{status:403});
 q=await quoteAction(db,q.id,first,f.manager);assert.equal(q.status,'PENDING_APPROVAL');assert.equal(q.approval.completed,1);assert.equal(q.approval.canApprove,false);
 assert.equal((await quoteAction(db,q.id,first,f.manager)).replayed,true);assert.equal((await quoteDetail(db,q.id,f.manager)).approval.completed,1);
 await assert.rejects(()=>quoteAction(db,q.id,{...first,reason:'VERIFY- changed replay reason'},f.manager),{code:'IDEMPOTENCY_KEY_REUSED'});
 await assert.rejects(()=>quoteAction(db,q.id,first,f.owner),{code:'IDEMPOTENCY_KEY_REUSED'});
 await assert.rejects(()=>orderQuoteSource(db,q.id,f.manager),{status:409});
 assert.equal((await quoteForDocument(db,q.id,f.accounts)).status,'PENDING_APPROVAL');
 const final=command(q);await assert.rejects(()=>quoteAction(db,q.id,final,f.manager),{status:403});
 q=await quoteAction(db,q.id,final,f.owner);assert.equal(q.status,'APPROVED');assert.equal(q.approval.completed,2);
 assert.equal((await orderQuoteSource(db,q.id,f.manager)).id,q.id);
 const publicDetail=await quoteDetail(db,q.id,f.accounts);assert.equal(publicDetail.pricing,undefined);
 for(const hidden of ['unitCost','sourceFingerprint','planFingerprint','VERIFY- first review','orders.credit.review'])assert.equal(JSON.stringify(publicDetail.approval).includes(hidden),false,hidden);
 await new TransactionRunner(db).run(f.owner,reason,()=>db.prepare("UPDATE users SET status='INACTIVE' WHERE id=?").run(f.manager.id));
 assert.equal((await quoteForDocument(db,q.id,f.accounts)).status,'DRAFT');
 await assert.rejects(()=>quoteAction(db,q.id,{action:'SEND',version:q.version,reason},f.owner),{code:'QUOTATION_REVIEWER_CHANGED'});
 await assert.rejects(()=>orderQuoteSource(db,q.id,f.owner),{status:409});
 const history=await quoteHistory(db,q.id,f.accounts);for(const field of ['sourceFingerprint','approvalRequestHash','requestHash'])assert.equal(JSON.stringify(history).includes(field),false,field);assert.equal(history.events.filter(event=>event.action==='APPROVE').length,2);
}));

test('return/resubmit starts a new approval round; old retry never advances it and reviewer reuse requires explicit confirmation',()=>withTestTransaction(async db=>{
 const f=await fixture(db,{reuse:'ALLOW_REUSE',secondPermission:'quotations.approve'});let q=f.q;
 const oldFirst=command(q);q=await quoteAction(db,q.id,oldFirst,f.manager);const oldSecond=command(q);
 q=await quoteAction(db,q.id,{action:'RETURN',version:q.version,reason},f.owner);assert.equal(q.status,'DRAFT');assert.equal(q.approval,undefined);
 q=await quoteAction(db,q.id,{action:'SUBMIT',version:q.version,reason},f.executive);assert.notEqual(q.approval.roundId,oldFirst.roundId);assert.equal(q.approval.completed,0);
 await assert.rejects(()=>quoteAction(db,q.id,oldSecond,f.manager),{code:'QUOTATION_APPROVAL_STAGE_CHANGED'});
 const replay=await quoteAction(db,q.id,oldFirst,f.manager);assert.equal(replay.replayed,true);assert.equal(replay.approval.completed,0);
 q=await quoteAction(db,q.id,command(q),f.manager);assert.equal(q.status,'PENDING_APPROVAL');assert.equal(q.approval.canApprove,true);
 q=await quoteAction(db,q.id,command(q),f.manager);assert.equal(q.status,'APPROVED');
 const events=await quoteHistory(db,q.id,f.owner);assert.equal(events.events.filter(event=>event.action==='SUBMIT').length,2);assert.ok(events.events.find(event=>event.action==='RETURN').private_detail.approvalReview);
}));

test('decision reconfirmation, earlier reviewer permission changes and audit failure cannot advance or revive a staged approval',()=>withTestTransaction(async db=>{
 const f=await fixture(db,{secondPermission:'quotations.approve'});let q=f.q;
 const injected=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{const statement=target.prepare(sql);if(sql.startsWith('INSERT INTO audit_logs'))return {...statement,run:async(...args)=>{if(args[3]==='APPROVE')throw new Error('VERIFY- approval audit refused');return statement.run(...args);}};return statement;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const first=command(q);await assert.rejects(()=>quoteAction(injected,q.id,first,f.manager),/audit refused/);
 assert.equal((await quoteDetail(db,q.id,f.manager)).approval.completed,0);
 assert.equal((await db.prepare("SELECT count(*)::integer AS count FROM crm_quotation_events WHERE quotation_id=? AND action='APPROVE'").get(q.id)).count,0);
 q=await quoteAction(db,q.id,first,f.manager);
 const decisions=new DecisionService({db}),key='margin.floor_percent',current=(await decisions.list(f.owner)).data.find(row=>row.key===key),rawPolicy=await decisions.repository.canonical(decisions.catalog.require(key));
 const empty=await decisions.decide(f.owner,key,{decision:'CLEAR',expectedVersion:current.version,requestKey:randomUUID(),reason});
 await decisions.enter(f.owner,key,{value:rawPolicy.value,confirm:true,expectedVersion:empty.version,requestKey:randomUUID(),reason});
 assert.equal((await decisions.repository.canonical(decisions.catalog.require(key))).version,rawPolicy.version);
 await assert.rejects(()=>quoteAction(db,q.id,command(q),f.owner),{code:'QUOTATION_APPROVAL_CHANGED'});
 const blocked=await quoteDetail(db,q.id,f.owner);assert.equal(blocked.approval.canApprove,false);assert.equal(blocked.approval.blocked,true);
 q=await quoteAction(db,q.id,{action:'RETURN',version:q.version,reason},f.owner);q=await quoteAction(db,q.id,{action:'SUBMIT',version:q.version,reason},f.executive);
 q=await quoteAction(db,q.id,command(q),f.manager);
 // Preserve grant rows: deactivate the reviewer's role inside the rollback test.
 await new TransactionRunner(db).run(f.owner,reason,()=>db.prepare("UPDATE roles SET status='INACTIVE' WHERE key='MANAGER'").run());
 await assert.rejects(()=>quoteAction(db,q.id,command(q),f.owner),{code:'QUOTATION_REVIEWER_CHANGED'});
 assert.equal((await quoteDetail(db,q.id,f.owner)).approval.completed,1);
}));

test('staged approval HTTP exposes only eligible next steps and enforces sessions, CSRF and final completion',()=>withTestTransaction(async db=>{
 const f=await fixture(db),app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false})}),fetch=testFetch(app);
 async function headers(actor){const token=randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${actor.id},${tokenDigest(token)},'VERIFY-stage_csrf',now()+interval '1 hour')`;return {cookie:`crm_session=${token}`,'x-csrf-token':'VERIFY-stage_csrf','content-type':'application/json'};}
 try{
  const manager=await headers(f.manager),owner=await headers(f.owner),accounts=await headers(f.accounts),url=`/api/crm/quotations/${f.q.id}/actions`,body=command(f.q);
  assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})).status,401);
  assert.equal((await fetch(url,{method:'POST',headers:{cookie:manager.cookie,'content-type':'application/json'},body:JSON.stringify(body)})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:accounts,body:JSON.stringify(body)})).status,403);
  const first=await fetch(url,{method:'POST',headers:manager,body:JSON.stringify(body)});assert.equal(first.status,200);const pending=(await first.json()).data;assert.equal(pending.status,'PENDING_APPROVAL');assert.equal(pending.approval.canApprove,false);
  const read=await fetch(`/api/crm/quotations/${f.q.id}`,{headers:accounts}),publicQuote=(await read.json()).data;assert.equal(publicQuote.pricing,undefined);assert.equal(publicQuote.approval.canApprove,false);assert.equal(JSON.stringify(publicQuote).includes('unitCost'),false);
  const result=await fetch(url,{method:'POST',headers:owner,body:JSON.stringify(command(pending))});assert.equal(result.status,200);assert.equal((await result.json()).data.status,'APPROVED');
 }finally{await app.close();installPermissionProvider(null);}
}));
