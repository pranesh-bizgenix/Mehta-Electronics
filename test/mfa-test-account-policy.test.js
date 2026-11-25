import test from 'node:test';
import assert from 'node:assert/strict';
import {isMfaExemptTestAccount} from '../src/modules/mfa/test-account-policy.js';
const user={id:47,email:'owner@test.local',name:'TEST_OWNER',status:'ACTIVE',role:'OWNER'};
const config={mfaTestExemptUserId:47,mfaTestExemptEmail:'owner@test.local'};
test('Time-limited exceptions apply to exact reserved accounts and expire automatically',()=>{
 const now=Date.parse('2026-11-25T00:00:00Z'),c={mfaTestExemptAccounts:[{userId:47,email:'owner@test.local',expiresAt:'2026-12-02T00:00:00Z'}]};
 assert.equal(isMfaExemptTestAccount(c,user,now),true);
 assert.equal(isMfaExemptTestAccount(c,user,Date.parse('2026-12-02T00:00:00Z')),false);
 assert.equal(isMfaExemptTestAccount({...config,...c},user,Date.parse('2026-12-02T00:00:00Z')),false);
 for(const change of [{id:48},{email:'owner@real-company.com'},{name:'Real Owner'},{status:'LOCKED'}])assert.equal(isMfaExemptTestAccount(c,{...user,...change},now),false);
 assert.equal(isMfaExemptTestAccount({mfaTestExemptAccounts:[{userId:47,email:'owner@test.local',expiresAt:'invalid'}]},user,now),false);
 assert.equal(isMfaExemptTestAccount(c,null,now),false);
});
test('MFA exception is off by default and matches only the explicitly selected fictional account',()=>{
 assert.equal(isMfaExemptTestAccount({},user),false);
 assert.equal(isMfaExemptTestAccount(config,user),true);
 for(const change of [{id:1},{email:'real-owner@example.com'},{name:'Actual Owner'},{status:'INACTIVE'}])assert.equal(isMfaExemptTestAccount(config,{...user,...change}),false);
 assert.equal(isMfaExemptTestAccount({...config,mfaTestExemptEmail:'real-owner@example.com'},{...user,email:'real-owner@example.com'}),false);
 assert.equal(isMfaExemptTestAccount({...config,mfaTestExemptUserId:0},user),false);
 assert.equal(isMfaExemptTestAccount(config,null),false);
});
