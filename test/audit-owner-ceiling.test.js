import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AuditController,AuditService,requireAuditOwner} from '../src/modules/admin/audit-service.js';
import {forbidden} from '../src/core/errors.js';
import {createApp} from '../src/app.js';
import {installPermissionProvider} from '../src/rbac.js';
import {testFetch} from '../test-support/http-client.js';

const query={page:1,pageSize:50};

test('audit trail stays Owner-only when a mutable permission provider grants audit.read to every role',async()=>{
  let repositoryReads=0,permissionChecks=0;
  const service=new AuditService({
    access:{require(_user,permission){assert.equal(permission,'audit.read');permissionChecks++;}},
    repository:{async search(){repositoryReads++;return {total:0,rows:[]};},async modules(){repositoryReads++;return [];}}
  });
  const route=new AuditController({auditQuery:service}).routes()[0];
  assert.equal(route.path,'/api/v1/audit-logs');
  assert.equal(route.permission,'audit.read');
  for(const role of ['MANAGER','EXECUTIVE','ACCOUNTS','LOGISTICS_LEAD','STORE_STAFF','ADMIN',undefined]) {
    const user=role?{id:2,role}:null;
    assert.throws(()=>requireAuditOwner(user),{status:403,code:'FORBIDDEN'});
    await assert.rejects(service.search(user,query),{status:403,code:'FORBIDDEN'});
    await assert.rejects(route.handler({user,query}),{status:403,code:'FORBIDDEN'});
  }
  assert.equal(repositoryReads,0);
  assert.equal(permissionChecks,0);
  const response=await route.handler({user:{id:1,role:'OWNER'},query});
  assert.deepEqual(response.body,{data:[],pagination:{page:1,pageSize:50,total:0,pages:0},modules:[]});
  assert.equal(repositoryReads,2);
  assert.equal(permissionChecks,1);
});

test('Owner audit ceiling preserves the normal permission check and audit result projection',async()=>{
  let reads=0;
  const denied=new AuditService({access:{require(){throw forbidden();}},repository:{async search(){reads++;}}});
  await assert.rejects(denied.search({id:1,role:'OWNER'},query),{status:403});
  assert.equal(reads,0);
  const owner={id:1,role:'OWNER'},received=[];
  const service=new AuditService({
    access:{require(user,permission){assert.equal(user,owner);assert.equal(permission,'audit.read');}},
    repository:{async search(input){received.push(input);return {total:1,rows:[{id:9,user_id:1,user_name:'Fixture Owner',entity:'ITEM',record_id:'8',action:'UPDATE',old_value:'{"status":"ACTIVE"}',new_value:'{"status":"ARCHIVED"}',reason:'Fixture reason',ip_address:'127.0.0.1',created_at:'2026-11-06T00:00:00Z'}]};},async modules(){return ['ITEM'];}}
  });
  const result=await service.search(owner,{...query,from:'2026-11-05',to:'2026-11-06'});
  assert.equal(received[0].from,'2026-11-05T00:00:00Z');
  assert.equal(received[0].to,'2026-11-07T00:00:00.000Z');
  assert.deepEqual(result.data[0].before,{status:'ACTIVE'});
  assert.deepEqual(result.data[0].after,{status:'ARCHIVED'});
  assert.equal(result.data[0].reason,'Fixture reason');
  assert.deepEqual(result.pagination,{page:1,pageSize:50,total:1,pages:1});
  assert.deepEqual(result.modules,['ITEM']);
});

test('both audit HTTP aliases reject non-Owners before reading audit rows even with an added audit grant',async()=>{
  let currentUser,auditReads=0;
  const db={
    withConnection:async work=>work(),
    prepare(sql){
      if(sql.includes('FROM sessions s JOIN users'))return {get:async()=>currentUser};
      if(sql.startsWith('UPDATE sessions SET last_seen_at'))return {run:async()=>{}};
      if(sql.includes('audit_logs')){auditReads++;throw new Error('Audit rows must not be queried for a non-Owner.');}
      throw new Error('Unexpected database operation in no-database boundary test.');
    }
  };
  const app=createApp({db,config:{localReviewAccess:false,mfaEnabled:false,sessionTtlMinutes:60},connectorStore:{async close(){}}}),fetch=testFetch(app);
  app.modules.ready=async()=>{};
  app.modules.services.access.refreshIfStale=async()=>{};
  app.modules.services.access.require=(_user,permission)=>assert.equal(permission,'audit.read');
  installPermissionProvider({permissionsFor:()=>['audit.read'],requiresMfa:()=>false});
  try {
    for(const role of ['MANAGER','EXECUTIVE','ACCOUNTS','LOGISTICS_LEAD','STORE_STAFF']) {
      currentUser={id:2,role,status:'ACTIVE',session_id:1,csrf_token:'fixture',must_change_password:false};
      for(const path of ['/api/audit-logs','/api/v1/audit-logs']) {
        const result=await fetch(path,{headers:{cookie:'crm_session=fixture'}});
        assert.equal(result.status,403,`${path} ${role}`);
        // Logistics roles have a separate approved permission ceiling as well.
        if(!['LOGISTICS_LEAD','STORE_STAFF'].includes(role))assert.equal((await result.json()).error,'Only the Owner may read the audit trail.');
      }
    }
    assert.equal(auditReads,0);
  } finally {installPermissionProvider(null);await app.close();}
});
