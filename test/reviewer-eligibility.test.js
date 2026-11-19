import assert from 'node:assert/strict';
import {test} from 'node:test';
import {eligibleReviewers,provisioningWarnings} from '../src/modules/admin/reviewer-eligibility.js';

const ready=(id,patch={})=>({id,name:`VERIFY- Reviewer ${id}`,role:'MANAGER',status:'ACTIVE',on_leave:false,must_change_password:0,mfa_enabled:true,...patch});
const access={can:(user,key)=>(user.permissions??['quotations.read','quotations.approve']).includes(key),requiresMfa:()=>true};

test('reviewer coverage excludes makers, editors and explicitly excluded people',()=>{
  const users=[ready(1),ready(2),ready(3),ready(4)];
  assert.deepEqual(eligibleReviewers(users,access,'quotations',{makerId:'1',editorId:2,excludedIds:['3']}).map(u=>u.id),[4]);
});

test('reviewer coverage requires active available enrolled unlocked accounts and changed passwords',()=>{
  const now=Date.parse('2026-11-17T00:00:00Z');
  const users=[ready(1,{status:'INACTIVE'}),ready(2,{on_leave:true}),ready(3,{must_change_password:1}),ready(4,{mfa_enabled:false}),ready(5,{locked_until:'2026-11-18T00:00:00Z'}),ready(6,{locked_until:'2026-11-16T00:00:00Z'})];
  assert.deepEqual(eligibleReviewers(users,access,'quotations',{now}).map(u=>u.id),[6]);
});

test('approval authority requires every permission and financial role restrictions',()=>{
  assert.equal(eligibleReviewers([ready(1,{permissions:['quotations.approve']})],access,'quotations').length,0);
  const permissions=['collections.read','collections.approve'];
  assert.deepEqual(eligibleReviewers([ready(1,{permissions}),ready(2,{role:'ACCOUNTS',permissions}),ready(3,{role:'OWNER',permissions})],access,'collections').map(u=>u.id),[2,3]);
});

test('capacity warnings report missing independent reviewers instead of treating the maker as coverage',()=>{
  const permissions=['quotations.read','quotations.create','quotations.approve'];
  const result=provisioningWarnings([ready(1,{role:'OWNER',permissions})],access);
  assert.ok(result.warnings.some(w=>w.code==='SINGLE_OWNER'));
  assert.ok(result.warnings.some(w=>w.code==='NO_INDEPENDENT_REVIEWER'&&w.workflow==='quotations'));
  assert.deepEqual(result.workflows.find(w=>w.key==='quotations').makersWithoutReviewer,[{id:1,name:'VERIFY- Reviewer 1'}]);
});
