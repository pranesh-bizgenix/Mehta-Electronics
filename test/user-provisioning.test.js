import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { eligibleReviewers,provisioningWarnings } from '../src/modules/admin/reviewer-eligibility.js';
import { UserAdminService } from '../src/modules/admin/user-admin-service.js';
import { hasPermission,installPermissionProvider } from '../src/rbac.js';
import { withTestTransaction } from '../test-support/transaction.js';
import { createApp } from '../src/app.js';
import { getConfig } from '../src/config.js';
import { tokenDigest,verifyPassword } from '../src/security.js';

const access={can:hasPermission,requiresMfa:()=>false};
const ready=(id,role='OWNER',extra={})=>({id,name:`VERIFY-${id}`,role,status:'ACTIVE',on_leave:false,must_change_password:0,mfa_enabled:true,...extra});
test('maker-checker eligibility excludes creator/editor, disabled/locked/leave/setup accounts and wrong permissions',()=>{
  const users=[ready(1),ready(2),ready(3,'OWNER',{status:'INACTIVE'}),ready(4,'OWNER',{status:'LOCKED'}),ready(5,'OWNER',{on_leave:true}),ready(6,'OWNER',{must_change_password:1}),ready(7,'OWNER',{locked_until:new Date(Date.now()+60_000).toISOString()}),ready(8,'STORE_STAFF'),ready(9,'ACCOUNTS'),ready(10,'OWNER',{mfa_enabled:false}),ready(11)];
  const mfa={...access,requiresMfa:()=>true};
  assert.deepEqual(eligibleReviewers(users,mfa,'quotations',{makerId:'1',editorId:2,excludedIds:[11]}).map(u=>u.id),[]);
  assert.deepEqual(eligibleReviewers([ready(1),ready(2)],access,'quotations',{makerId:1}).map(u=>u.id),[2]);
  assert.equal(eligibleReviewers([ready(1)],access,'quotations',{makerId:1}).length,0);
  assert.equal(eligibleReviewers([ready(1,'LOGISTICS_LEAD'),ready(2,'LOGISTICS_LEAD')],access,'grn',{makerId:1}).length,1);
  assert.equal(eligibleReviewers([ready(1,'LOGISTICS_LEAD'),ready(2,'STORE_STAFF')],access,'grn',{makerId:1}).length,0);
});
test('coverage warns about one Owner and a missing independent reviewer; a named backup is not a permission grant',()=>{
  const alone=provisioningWarnings([ready(1)],access);
  assert.equal(alone.activeOwnerCount,1);
  assert.ok(alone.warnings.some(w=>w.code==='SINGLE_OWNER'));
  assert.ok(alone.warnings.some(w=>w.code==='NO_INDEPENDENT_REVIEWER'&&w.workflow==='quotations'));
  const withStaff=provisioningWarnings([ready(1,'OWNER',{backup_user_id:2}),ready(2,'STORE_STAFF')],access);
  assert.ok(withStaff.warnings.some(w=>w.code==='NO_INDEPENDENT_REVIEWER'&&w.workflow==='quotations'));
  const two=provisioningWarnings([ready(1),ready(2)],access);
  assert.equal(two.warnings.length,0);
  const notReady=provisioningWarnings([ready(1),ready(2,'OWNER',{must_change_password:1})],access);
  assert.ok(notReady.warnings.some(w=>w.workflow==='quotations'&&w.makers.some(m=>m.id===1)));
  const edited=eligibleReviewers([ready(1),ready(2),ready(3)],access,'orders',{makerId:1,editorId:2});
  assert.deepEqual(edited.map(u=>u.id),[3]);
});
test('last Owner protection runs under the shared provisioning lock and refuses self-demotion',async()=>{
  const events=[];
  const repository={lock:async()=>events.push('lock'),get:async()=>ready(1),activeRole:async key=>({key}),owners:async()=>{events.push('count');return 1;},update:async()=>events.push('update')};
  const service=new UserAdminService({repository,access:{require:()=>{},roleExists:()=>true},transactions:{run:async(_a,_r,fn)=>fn()},audit:{record:async()=>events.push('audit')}});
  await assert.rejects(service.update({id:1,role:'OWNER'},1,{role:'EXECUTIVE',reason:'VERIFY- owner demotion'}),{status:422});
  assert.deepEqual(events,['lock','count']);
});

test('staff provisioning, ownership, deactivation and first-login password change are enforced by the real handler in a rollback transaction',()=>withTestTransaction(async db=>{
  const make=async(role,suffix)=>({id:(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(${`VERIFY-${suffix}`},${`VERIFY-${suffix}@example.test`},${role},'not-a-login',0) RETURNING id`)[0].id,role});
  const owner=await make('OWNER','provision_owner'),backup=await make('MANAGER','provision_backup'),executive=await make('EXECUTIVE','provision_exec');
  const app=createApp({db,config:getConfig({mfaEnabled:false})}),tokens=new Map();
  async function session(user) {
    const token=crypto.randomUUID();tokens.set(user.id,token);
    await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${user.id},${tokenDigest(token)},'VERIFY-csrf',now()+interval '1 hour')`;
  }
  await session(owner);await session(executive);
  async function request(method,url,actor,body={},csrf=true,extraHeaders={}) {
    const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,url,headers:{host:'localhost','content-type':'application/json',...(actor?{cookie:`crm_session=${tokens.get(actor.id)}`}:{}),...(csrf?{'x-csrf-token':'VERIFY-csrf'}:{}),...extraHeaders},socket:{remoteAddress:'test'}});
    const response={status:0,headersSent:false,setHeader(){},writeHead(status){this.status=status;this.headersSent=true;},end(value){this.body=value?JSON.parse(String(value)):null;}};
    await app(req,response);return response;
  }
  const temporary=`Aa1!${crypto.randomBytes(20).toString('hex')}`,personal=`Bb2!${crypto.randomBytes(20).toString('hex')}`;
  const body={name:'VERIFY-Provisioned staff',email:'VERIFY-provisioned@example.test',role:'EXECUTIVE',ownerUserId:owner.id,backupUserId:backup.id,password:temporary,reason:'VERIFY- provisioning test'};
  try {
    assert.equal((await request('POST','/api/v1/users',null,body)).status,401);
    assert.equal((await request('POST','/api/v1/users',executive,body)).status,403);
    assert.equal((await request('POST','/api/v1/users',owner,body,false)).status,403);
    for(const changed of [{ownerUserId:0},{backupUserId:owner.id},{mustChangePassword:false},{role:'ADMIN'}])assert.equal((await request('POST','/api/v1/users',owner,{...body,...changed})).status,422);
    const created=await request('POST','/api/v1/users',owner,body);
    assert.equal(created.status,201);const staff=created.body.data;
    assert.equal(staff.ownerUserId,owner.id);assert.equal(staff.managerUserId,owner.id);assert.equal(staff.backupUserId,backup.id);assert.equal(staff.mustChangePassword,true);
    assert.equal(Object.hasOwn(staff,'password'),false);assert.equal(Object.hasOwn(staff,'password_hash'),false);
    const stored=(await db.sql`SELECT password_hash,must_change_password FROM users WHERE id=${staff.id}`)[0];
    assert.equal(stored.must_change_password,1);assert.ok(verifyPassword(temporary,stored.password_hash));
    const audit=await db.sql`SELECT old_value,new_value FROM audit_logs WHERE entity='USER' AND record_id=${String(staff.id)}`;
    const text=JSON.stringify(audit);assert.ok(!text.includes(temporary)&&!text.includes(stored.password_hash)&&!text.includes('passwordHash'));
    assert.equal((await request('POST','/api/users',owner,{...body,email:'VERIFY-without_owner@example.test',ownerUserId:null})).status,422);
    assert.equal((await request('POST','/api/v1/users',owner,body)).status,409);
    const pendingBackup=await request('POST','/api/v1/users',owner,{...body,name:'VERIFY-No backup yet',email:'VERIFY-pending_backup@example.test',backupUserId:null});
    assert.equal(pendingBackup.status,201);assert.equal(pendingBackup.body.data.backupUserId,null);
    const idempotent={...body,name:'VERIFY-Retry staff',email:'VERIFY-retry_staff@example.test'},retryHeaders={'idempotency-key':crypto.randomUUID()};
    const first=await request('POST','/api/v1/users',owner,idempotent,true,retryHeaders),replay=await request('POST','/api/v1/users',owner,idempotent,true,retryHeaders);
    assert.equal(first.status,201);assert.equal(replay.status,201);assert.equal(first.body.data.id,replay.body.data.id);
    assert.equal((await db.sql`SELECT count(*) AS n FROM users WHERE email='verify-retry_staff@example.test'`)[0].n,1);
    const service=app.modules.services.userAdmin,originalAudit=service.audit;
    service.audit={record:async()=>{throw new Error('VERIFY- audit unavailable');}};
    try { await assert.rejects(service.create(owner,{...body,email:'VERIFY-failed_audit@example.test'}),/VERIFY- audit unavailable/); }
    finally {service.audit=originalAudit;}
    assert.equal((await db.sql`SELECT count(*) AS n FROM users WHERE email='verify-failed_audit@example.test'`)[0].n,0);
    const preview=await request('POST','/api/v1/users/provisioning-preview',owner,{userId:staff.id,status:'INACTIVE'});
    assert.equal(preview.status,200);assert.equal((await db.sql`SELECT status FROM users WHERE id=${staff.id}`)[0].status,'ACTIVE');
    await session(staff);
    await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${staff.id},${tokenDigest(crypto.randomUUID())},'VERIFY-other_session',now()+interval '1 hour')`;
    const blocked=await request('GET','/api/crm/orders',staff);assert.equal(blocked.status,403);assert.equal(blocked.body.code,'PASSWORD_CHANGE_REQUIRED');
    assert.equal((await request('GET','/api/auth/me',staff)).body.user.mustChangePassword,true);
    assert.equal((await request('POST','/api/auth/change-password',staff,{currentPassword:temporary,newPassword:personal},false)).status,403);
    assert.equal((await request('POST','/api/auth/change-password',staff,{currentPassword:temporary,newPassword:temporary})).status,422);
    assert.equal((await request('POST','/api/auth/change-password',staff,{currentPassword:temporary,newPassword:personal})).status,200);
    assert.equal((await db.sql`SELECT count(*) AS n FROM sessions WHERE user_id=${staff.id}`)[0].n,1);
    assert.equal((await request('GET','/api/auth/me',staff)).body.user.mustChangePassword,false);
    assert.equal((await request('GET','/api/crm/orders',staff)).status,200);
    assert.equal((await request('PATCH',`/api/v1/users/${staff.id}`,owner,{status:'INACTIVE'})).status,422);
    assert.equal((await request('PATCH',`/api/users/${staff.id}`,owner,{status:'INACTIVE'})).status,422);
    assert.equal((await request('PATCH',`/api/v1/users/${staff.id}`,owner,{ownerUserId:staff.id,reason:'VERIFY- invalid self owner'})).status,422);
    assert.equal((await request('PATCH',`/api/users/${staff.id}`,owner,{status:'INACTIVE',reason:'VERIFY- staff leaves'})).status,200);
    assert.equal((await db.sql`SELECT status FROM users WHERE id=${staff.id}`)[0].status,'INACTIVE');
    assert.equal((await db.sql`SELECT count(*) AS n FROM sessions WHERE user_id=${staff.id}`)[0].n,0);
    assert.equal((await request('GET','/api/auth/me',staff)).status,401);
    assert.ok((await db.sql`SELECT 1 FROM audit_logs WHERE record_id=${String(staff.id)} AND reason='VERIFY- staff leaves'`).length);
  } finally { await app.close();installPermissionProvider(null); }
}));
