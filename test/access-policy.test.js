import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccessService } from '../src/modules/access/access-service.js';
import { permissionsFor, installPermissionProvider } from '../src/rbac.js';

function fixture() {
  let inTransaction = false;
  const events = [], audits = [];
  const roles = ['OWNER','MANAGER','EXECUTIVE','ACCOUNTS','LOGISTICS_LEAD','STORE_STAFF'].map(key => ({key,name:key,status:'ACTIVE',all_permissions:key === 'OWNER',requires_mfa:key === 'OWNER'}));
  const permissions = [
    {key:'access.manage',owner_only:true}, {key:'access.read',owner_only:false},
    {key:'users.create',owner_only:true}, {key:'customers.read',owner_only:false},
    {key:'logistics.read',owner_only:false}, {key:'quotations.cost.read',owner_only:false}
  ];
  let grants = ['MANAGER','EXECUTIVE','ACCOUNTS'].map(role_key => ({role_key,permission_key:'customers.read'}));
  grants.push(...['LOGISTICS_LEAD','STORE_STAFF'].map(role_key => ({role_key,permission_key:'logistics.read'})));
  const repository = {
    lockMatrix: async () => {},
    roles: async () => structuredClone(roles), grants: async () => structuredClone(grants), permissions: async () => permissions,
    version: async () => events.length,
    role: async key => roles.find(r => r.key === key), permission: async key => permissions.find(p => p.key === key),
    hasGrant: async (role,key) => grants.some(g => g.role_key === role && g.permission_key === key),
    grant: async (role,key) => { grants.push({role_key:role,permission_key:key}); },
    revoke: async (role,key) => { grants = grants.filter(g => g.role_key !== role || g.permission_key !== key); },
    event: async value => events.push(value), history: async () => [], activeUserCount: async () => 0,
    createRole: async row => roles.push({...row,status:'ACTIVE',all_permissions:false}),
    updateRole: async (key,next) => Object.assign(roles.find(r => r.key === key),{name:next.name,status:next.status,requires_mfa:next.requiresMfa})
  };
  const transactions = { failCommit:false, async run(actor,reason,callback) {
    const before = structuredClone(grants); inTransaction = true;
    try { const value = await callback(); if (this.failCommit) throw new Error('commit failed'); return value; }
    catch (error) { grants = before; throw error; } finally { inTransaction = false; }
  } };
  const service = new AccessService({repository,transactions,audit:{record:async value=>audits.push(value)}});
  return {service,roles,permissions,repository,transactions,events,audits,get inTransaction(){return inTransaction;}};
}
const owner = {id:1,role:'OWNER'};

test('six baseline roles have effective permissions; unknown roles fail closed', async () => {
  const f=fixture(); await f.service.load();
  for(const role of ['MANAGER','EXECUTIVE','ACCOUNTS']) { assert.equal(f.service.can({role},'customers.read'),true); assert.equal(f.service.can({role},'access.manage'),false); }
  for(const role of ['LOGISTICS_LEAD','STORE_STAFF']) { assert.equal(f.service.can({role},'logistics.read'),true); assert.equal(f.service.can({role},'customers.read'),false); }
  assert.equal(f.service.can(owner,'anything'),true);
  assert.equal(f.service.can({role:'UNKNOWN'},'customers.read'),false);
});

test('corrupt owner-only and unknown grants never become effective or display as allowed',async()=>{
  const f=fixture(); await f.repository.grant('MANAGER','access.manage'); await f.repository.grant('MANAGER','missing.permission');
  await f.service.load();f.service.install();
  try { assert.deepEqual(permissionsFor('MANAGER'),['customers.read']); assert.equal(f.service.can({role:'MANAGER'},'access.manage'),false); const view=await f.service.matrixView(owner); assert.deepEqual(view.permissions.find(p=>p.key==='access.manage').grantedTo,['OWNER']); }
  finally {installPermissionProvider(null);}
});

test('wildcard is reserved for actual Owner even with corrupted role metadata',async()=>{
  const f=fixture();f.roles.find(r=>r.key==='MANAGER').all_permissions=true;await f.service.load();assert.equal(f.service.can({role:'MANAGER'},'users.create'),false);
});

test('inactive roles lose all permissions including Owner wildcard',async()=>{
  const f=fixture();f.roles.forEach(r=>r.status='INACTIVE');await f.service.load();for(const r of f.roles)assert.deepEqual(f.service.permissionsForRole(r.key),[]);
});

test('Owner grant and revoke update installed provider only after commit and record exact audit',async()=>{
  const f=fixture();await f.service.load();f.service.install();const load=f.service.load.bind(f.service);
  f.service.load=async()=>{assert.equal(f.inTransaction,false);return load();};
  try {
    await f.service.setGrant(owner,{role:'ACCOUNTS',permission:'quotations.cost.read',granted:true,reason:'VERIFY- role grant'});
    assert.equal(permissionsFor('ACCOUNTS').includes('quotations.cost.read'),true);
    await f.service.setGrant(owner,{role:'ACCOUNTS',permission:'quotations.cost.read',granted:false,reason:'VERIFY- remove grant'});
    assert.equal(permissionsFor('ACCOUNTS').includes('quotations.cost.read'),false);
    assert.equal(f.audits.length,2);assert.equal(f.events.length,2);assert.equal(f.audits[0].recordId,'ACCOUNTS:quotations.cost.read');
  }finally{installPermissionProvider(null);}
});

test('failed commit cannot publish tentative permission grants',async()=>{
  const f=fixture();await f.service.load();f.transactions.failCommit=true;
  await assert.rejects(f.service.setGrant(owner,{role:'ACCOUNTS',permission:'quotations.cost.read',granted:true,reason:'VERIFY- failed transaction'}),/commit failed/);
  assert.equal(f.service.can({role:'ACCOUNTS'},'quotations.cost.read'),false);
});

test('non-Owner cannot edit grants; Owner-only grants and logistics expansion are rejected',async()=>{
  const f=fixture();await f.service.load();
  await assert.rejects(f.service.setGrant({id:2,role:'MANAGER'},{role:'MANAGER',permission:'customers.read',granted:true}),{status:403});
  await assert.rejects(f.service.setGrant(owner,{role:'MANAGER',permission:'users.create',granted:true}),{code:'OWNER_ONLY_PERMISSION'});
  await assert.rejects(f.service.setGrant(owner,{role:'STORE_STAFF',permission:'quotations.cost.read',granted:true}),{status:403});
});

test('protected Owner role cannot be disabled or lose mandatory MFA',async()=>{
  const f=fixture();await f.service.load();
  for(const patch of [{status:'INACTIVE'},{requiresMfa:false}])await assert.rejects(f.service.updateRole(owner,'OWNER',{...patch,reason:'VERIFY- protected role'}),{code:'ROLE_LOCKED'});
});

test('roles with active users cannot be deactivated',async()=>{
  const f=fixture();f.repository.activeUserCount=async()=>1;await f.service.load();await assert.rejects(f.service.updateRole(owner,'MANAGER',{status:'INACTIVE',reason:'VERIFY- lifecycle'}),{status:422});
});

test('custom Admin name confers no privilege and records provisional role creation',async()=>{
  const f=fixture();await f.service.load();await f.service.createRole(owner,{key:'ADMIN',name:'Admin',requiresMfa:true,reason:'VERIFY- provisional support role'});
  assert.deepEqual(f.service.permissionsForRole('ADMIN'),[]);assert.equal(f.events[0].change,'ROLE_CREATED');assert.equal(f.audits[0].action,'CREATE');
});

test('nested idempotent transaction does not publish access before outer commit',async()=>{
 const f=fixture();await f.service.load();f.transactions.active=true;
 await f.service.createRole(owner,{key:'VERIFY_ROLE',name:'Verify role',requiresMfa:false,reason:'VERIFY- nested transaction'});
 assert.equal(f.service.roleExists('VERIFY_ROLE'),false);
 f.transactions.active=false;await f.service.refreshIfStale(f.events.length);
 assert.equal(f.service.roleExists('VERIFY_ROLE'),true);
});

test('a grant committed during loading cannot be cached under the newer version',async()=>{
 const f=fixture();let revision=0,reads=0;
 f.repository.version=async()=>revision;
 const grants=f.repository.grants;
 f.repository.grants=async()=>{const snapshot=await grants();if(++reads===1){await f.repository.revoke('MANAGER','customers.read');revision++;}return snapshot;};
 await f.service.load();
 assert.equal(reads,2);
 assert.equal(f.service.loadedVersion,1);
 assert.equal(f.service.can({role:'MANAGER'},'customers.read'),false);
});

test('constant permission churn fails closed instead of publishing a mixed snapshot',async()=>{
 const f=fixture();let version=0;f.repository.version=async()=>version++;
 await assert.rejects(f.service.load(),{code:'ACCESS_REFRESH_RETRY',status:503});
 assert.equal(f.service.loadedVersion,-1);
 assert.equal(f.service.can({role:'MANAGER'},'customers.read'),false);
});

test('concurrent permission refresh callers share the same consistent snapshot',async()=>{
 const f=fixture();let reads=0;const roles=f.repository.roles;
 f.repository.roles=async()=>{reads++;return roles();};
 await Promise.all([f.service.load(),f.service.load(),f.service.load()]);
 assert.equal(reads,1);
});

test('grant, role creation and role update acquire the matrix lock before writing',async()=>{
 const f=fixture();await f.service.load();let locked=false;
 f.repository.lockMatrix=async()=>{locked=true;};
 const event=f.repository.event;f.repository.event=async value=>{assert.equal(locked,true);return event(value);};
 for(const run of [()=>f.service.setGrant(owner,{role:'ACCOUNTS',permission:'quotations.cost.read',granted:true,reason:'VERIFY- serialized grant'}),()=>f.service.createRole(owner,{key:'VERIFY_ROLE',name:'VERIFY- role',requiresMfa:false,reason:'VERIFY- serialized role'}),()=>f.service.updateRole(owner,'MANAGER',{name:'VERIFY- manager',reason:'VERIFY- serialized update'})]){locked=false;await run();}
});
