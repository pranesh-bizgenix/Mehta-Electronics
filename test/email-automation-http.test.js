import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {testFetch} from '../test-support/http-client.js';
import {withAuthorizedRdsRollbackVerification} from '../test-support/transaction.js';
import {createStoredAdapter} from '../src/modules/email-automation/repository.js';
import {installPermissionProvider} from '../src/rbac.js';

test('real app returns 404 when disabled and 405 for mutation methods without database queries',async()=>{
 const db={sql:{},prepare(){throw Error('Unexpected DB access');},withConnection:fn=>fn()};
 for(const enabled of [false,true]){
  const app=createApp({db,config:getConfig({emailAutomationEnabled:enabled}),connectorStore:{}}),fetch=testFetch(app);
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal((await fetch('/api/v1/email-automation/emails',{method})).status,enabled?405:404);
  if(!enabled)for(const path of ['emails','emails/sample-email-1','attachments','processing','dashboard','integrations','errors'])assert.equal((await fetch('/api/v1/email-automation/'+path)).status,404);
 }
});

test('authorized existing database: real session, MFA, permission checks and audit privacy', {skip:process.env.VERIFY_AUTHORIZED_RDS_ROLLBACK!=='true'},()=>withAuthorizedRdsRollbackVerification(async db=>{
 const owner=await db.prepare("SELECT id,role FROM users WHERE role='OWNER' AND status='ACTIVE' AND must_change_password=0 ORDER BY id LIMIT 1").get();assert.ok(owner,'Existing active Owner required; no users are provisioned.');
 const token=crypto.randomUUID();
 await db.prepare("INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at,mfa_verified_at) VALUES(?,?,?,CURRENT_TIMESTAMP+INTERVAL '5 minutes',CURRENT_TIMESTAMP)").run(owner.id,tokenDigest(token),'ZZTEST_email_automation');
 const fetch=testFetch(createApp({db,config:getConfig({emailAutomationEnabled:true,emailAutomationDataMode:'mock',localReviewAccess:false,mfaEnabled:false}),connectorStore:{}}));
 const headers={cookie:`crm_session=${token}`};
 try{
  assert.equal((await fetch('/api/v1/email-automation/emails')).status,401);
  for(const path of ['emails','emails/sample-email-1','attachments','processing','dashboard','integrations','errors']){
   const response=await fetch('/api/v1/email-automation/'+path,{headers});assert.equal(response.status,200,path);assert.equal(response.headers.get('cache-control'),'no-store');
  }
  const audit=await db.prepare("SELECT entity,record_id,action,old_value,new_value,reason FROM audit_logs WHERE user_id=? AND entity='email-automation' ORDER BY id DESC LIMIT 7").all(owner.id);
  assert.equal(audit.length,7);for(const row of audit){assert.equal(row.record_id,'module');assert.equal(row.new_value,null);assert.equal(row.old_value,null);assert.equal(row.reason,null);}
  const grants=await db.prepare("SELECT count(*)::integer AS n FROM role_permissions WHERE permission_key IN ('email_automation.read','email_automation.integrations.read')").get();assert.equal(grants.n,0);
  const mfaFetch=testFetch(createApp({db,config:getConfig({emailAutomationEnabled:true,localReviewAccess:false,mfaEnabled:true}),connectorStore:{}}));
  await db.prepare('UPDATE sessions SET mfa_verified_at=NULL WHERE token_hash=?').run(tokenDigest(token));
  assert.equal((await mfaFetch('/api/v1/email-automation/emails',{headers})).status,403);
 }finally{installPermissionProvider(null);}
}));

test('stored adapter SQL runs against applied 0061 without inserting email fixtures',{skip:process.env.VERIFY_AUTHORIZED_RDS_ROLLBACK!=='true'},async t=>withAuthorizedRdsRollbackVerification(async db=>{
 const schema=await db.prepare("SELECT to_regclass('automation_email_metadata') AS relation").get();
 if(!schema.relation){t.skip('0061 is not applied: deployment requires a fresh verified backup.');return;}
 const stored=await createStoredAdapter(db).read();assert.ok(Array.isArray(stored.emails));assert.ok(Array.isArray(stored.attachments));assert.ok(Array.isArray(stored.runs));
}));
