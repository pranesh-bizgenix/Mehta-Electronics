import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {withTestTransaction} from '../test-support/transaction.js';
import {quotationFixture} from '../test-support/quotation-fixture.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {AutomationCredentialRepository,AutomationCredentialService,parseAllowlist,allowsPeer} from '../src/modules/automation-api/credentials.js';
import {TransactionRunner,AuditRepository,FixedClock} from '../src/core/runtime.js';
import {hasPermission,installPermissionProvider} from '../src/rbac.js';
import {forbidden} from '../src/core/errors.js';
import {tokenDigest} from '../src/security.js';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {testFetch} from '../test-support/http-client.js';
const reason='ZZTEST explicit service credential setup';
async function fixture(db){const f=await quotationFixture(db),clock=new FixedClock(new Date()),service=new AutomationCredentialService({db,clock,repository:new AutomationCredentialRepository(db),transactions:new TransactionRunner(db),audit:new AuditRepository(db),access:{require(actor,key){if(!actor?.id||!hasPermission(actor,key))throw forbidden();}}});const input={id:randomUUID(),label:'ZZTEST scoped integration',scopes:['automation.read'],companyIds:[f.company],ownerId:f.executive.id,backupOwnerId:f.manager.id,expiresAt:new Date(clock.now().getTime()+3600000).toISOString(),ratePerMinute:100,ipAllowlist:[],reason};return {...f,clock,service,input};}
const authenticate=(f,token,extra={})=>f.service.authenticate({authorization:`Bearer ${token}`,companyId:f.company,scope:'automation.read',peer:'127.0.0.1',...extra});
test('A2 IP allowlist accepts literal addresses/subnets only and normalises IPv4-mapped peers',()=>{
 assert.equal(allowsPeer(['127.0.0.0/8'],'::ffff:127.0.0.1'),true);assert.equal(allowsPeer(['::1'],'::1'),true);assert.equal(allowsPeer(['10.0.0.0/8'],'127.0.0.1'),false);assert.equal(allowsPeer(['::1'],'not-an-IP'),false);
 for(const row of ['localhost','10.0.0.1/33','::1/129','127.0.0.1/1e2'])assert.throws(()=>parseAllowlist([row]),{status:422});
});
test('A2 failed-peer abuse cap refuses repeated malformed tokens without granting a principal and expires with the window',async()=>{
 const clock=new FixedClock(new Date()),service=new AutomationCredentialService({clock}),input={authorization:'Bearer invalid',peer:'127.0.0.1'};
 for(let i=0;i<100;i++)await assert.rejects(()=>service.authenticate(input),{status:401});
 await assert.rejects(()=>service.authenticate(input),{status:429});clock.advance(60001);await assert.rejects(()=>service.authenticate(input),{status:401});
});
test('A2 only Owner provisions explicit scoped credentials; secrets are hashed, shown once and absent from retained metadata/audit',()=>withTestTransaction(async db=>{
 const f=await fixture(db);await assert.rejects(()=>f.service.create(f.manager,f.input),{status:403});
 for(const input of [{...f.input,scopes:['automation.approve']},{...f.input,ratePerMinute:undefined},{...f.input,companyIds:[]},{...f.input,ownerId:f.input.backupOwnerId},{...f.input,unexpected:true}])await assert.rejects(()=>f.service.create(f.owner,input),{status:422});
 const issued=await f.service.create(f.owner,f.input);assert.ok(issued.token.startsWith(`cdsvc.${issued.id}.`));const stored=await db.prepare('SELECT token_hash FROM automation_service_credentials WHERE id=?').get(issued.id);assert.equal(stored.token_hash,tokenDigest(issued.token));assert.notEqual(stored.token_hash,issued.token);
 const replay=await f.service.create(f.owner,f.input);assert.equal(replay.token,null);assert.equal(replay.replayed,true);await assert.rejects(()=>f.service.create(f.owner,{...f.input,label:'ZZTEST changed'}),{status:409});
 const listing=JSON.stringify(await f.service.list(f.owner)),audit=JSON.stringify(await db.prepare("SELECT new_value FROM audit_logs WHERE entity IN ('AUTOMATION_CREDENTIAL','ROW_METADATA') AND (record_id=? OR record_id LIKE ?)").all(issued.id,`%${issued.id}%`));assert.equal(listing.includes(issued.token),false);assert.equal(listing.includes(stored.token_hash),false);assert.equal(audit.includes(issued.token),false);assert.equal(audit.includes(stored.token_hash),false);
 const principal=await authenticate(f,issued.token);assert.equal(principal.kind,'AUTOMATION_SERVICE');assert.equal(principal.companyId,f.company);assert.equal('role' in principal,false);assert.equal('id' in principal,false);
 const before=(await db.prepare('SELECT count(*)::int AS n FROM automation_service_credential_events WHERE credential_id=?').get(issued.id)).n;f.service.audit={record:async()=>{throw new Error('ZZTEST auth audit unavailable');}};
 await assert.rejects(()=>authenticate(f,issued.token),/ZZTEST auth audit unavailable/);assert.equal((await db.prepare('SELECT count(*)::int AS n FROM automation_service_credential_events WHERE credential_id=?').get(issued.id)).n,before);
}));
test('A2 rotation/revocation are generation-bound, safely replayed and old/expired credentials cannot authenticate',()=>withTestTransaction(async db=>{
 const f=await fixture(db),issued=await f.service.create(f.owner,f.input),command={requestKey:randomUUID(),expectedGeneration:1,reason};
 const rotated=await f.service.change(f.owner,issued.id,command);assert.equal(rotated.generation,2);assert.ok(rotated.token);assert.equal((await f.service.change(f.owner,issued.id,command)).token,null);
 await assert.rejects(()=>authenticate(f,issued.token),{status:401});await authenticate(f,rotated.token);
 await assert.rejects(()=>f.service.change(f.owner,issued.id,{...command,reason:'ZZTEST different replay'}),{status:409});
 await f.service.change(f.owner,issued.id,{requestKey:randomUUID(),expectedGeneration:2,reason},true);await assert.rejects(()=>authenticate(f,rotated.token),{status:401});
 const next=await f.service.create(f.owner,{...f.input,id:randomUUID()});f.clock.advance(3600001);await assert.rejects(()=>authenticate(f,next.token),{status:401});
 await assert.rejects(db.prepare("UPDATE automation_service_credential_events SET reason='ZZTEST tamper' WHERE credential_id=?").run(issued.id),/append.only/i);
}));
test('A2 auth enforces scope/company/IP and explicit rate; refused requests retain audited outcomes and do not grant staff access',()=>withTestTransaction(async db=>{
 const f=await fixture(db),issued=await f.service.create(f.owner,{...f.input,ratePerMinute:2,ipAllowlist:['127.0.0.0/8']}),other=await tallyFixture(db,'ZZTEST scope B');
 await assert.rejects(()=>authenticate(f,issued.token,{companyId:other.company}),{status:403});await assert.rejects(()=>authenticate(f,issued.token,{scope:'automation.write.drafts'}),{status:403});await assert.rejects(()=>authenticate(f,issued.token,{peer:'10.0.0.1'}),{status:403});
 await authenticate(f,issued.token);await authenticate(f,issued.token);await assert.rejects(()=>authenticate(f,issued.token),{status:429});
 assert.equal((await db.prepare("SELECT count(*)::int AS n FROM automation_service_credential_events WHERE credential_id=? AND action='AUTH_ACCEPTED'").get(issued.id)).n,2);
 assert.ok((await db.prepare("SELECT count(*)::int AS n FROM audit_logs WHERE entity='AUTOMATION_AUTH' AND record_id=? AND action='REFUSED'").get(issued.id)).n>=4);
 f.clock.advance(60000);await authenticate(f,issued.token);
}));
test('A2 credential creation fails atomically if audit fails; original staff/connector auth remains isolated from service tokens',()=>withTestTransaction(async db=>{
 const f=await fixture(db),audit=f.service.audit;f.service.audit={record:async()=>{throw new Error('ZZTEST audit unavailable');}};
 await assert.rejects(()=>f.service.create(f.owner,f.input),/ZZTEST audit unavailable/);assert.equal((await db.prepare('SELECT id FROM automation_service_credentials WHERE id=?').all(f.input.id)).length,0);f.service.audit=audit;
 const app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false})}),fetch=testFetch(app),session=randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${f.owner.id},${tokenDigest(session)},'ZZTEST_service_csrf',now()+interval '1 hour')`;
 const staff={cookie:`crm_session=${session}`,'x-csrf-token':'ZZTEST_service_csrf','content-type':'application/json'};
 try{
  const base='http://localhost/api/v1/automation-credentials';assert.equal((await fetch(base)).status,401);assert.equal((await fetch(base,{method:'POST',headers:{cookie:staff.cookie,'content-type':'application/json'},body:JSON.stringify(f.input)})).status,403);
  const response=await fetch(base,{method:'POST',headers:staff,body:JSON.stringify(f.input)});assert.equal(response.status,201);const issued=(await response.json()).data,h={authorization:`Bearer ${issued.token}`};
  const switches=await fetch(`http://localhost/api/v1/automation/switches?companyId=${f.company}`,{headers:h});assert.equal(switches.status,200);assert.equal(switches.headers.get('x-controldesk-api-version'),'1.0.0');const body=await switches.json();assert.equal(body.companyId,f.company);assert.deepEqual(body.freshness,[]);assert.ok(body.data.every(row=>Object.keys(row).sort().join(',')==='enabled,key'));
  assert.deepEqual(Object.keys(body).sort(),['companyId','data','freshness','pagination']);assert.deepEqual(Object.keys(body.pagination).sort(),['hasMore','page','pageSize']);
  assert.equal((await fetch(`http://localhost/api/v1/automation/switches?companyId=${f.company}`,{headers:staff})).status,401);
  for(const path of ['/api/v1/automation','/api/v1/messages/send','/api/connectors/company-config',base])assert.equal((await fetch(`http://localhost${path}`,{headers:{...staff,...h}})).status,403);
  assert.equal((await fetch('http://localhost/api/v1/messages/send',{method:'POST',headers:{...staff,...h},body:'{}'})).status,403);
  const listing=await fetch(base,{headers:staff});assert.equal(listing.status,200);assert.equal(JSON.stringify(await listing.json()).includes(issued.token),false);
  const change={requestKey:randomUUID(),expectedGeneration:1,reason},rotatedResponse=await fetch(`${base}/${issued.id}/rotate`,{method:'POST',headers:staff,body:JSON.stringify(change)});assert.equal(rotatedResponse.status,200);const rotated=(await rotatedResponse.json()).data;
  assert.equal((await fetch(`http://localhost/api/v1/automation/switches?companyId=${f.company}`,{headers:h})).status,401);
  const revoke=await fetch(`${base}/${issued.id}/revoke`,{method:'POST',headers:staff,body:JSON.stringify({requestKey:randomUUID(),expectedGeneration:2,reason})});assert.equal(revoke.status,200);
  assert.equal((await fetch(`http://localhost/api/v1/automation/switches?companyId=${f.company}`,{headers:{authorization:`Bearer ${rotated.token}`}})).status,401);
  const limited=await f.service.create(f.owner,{...f.input,id:randomUUID(),ratePerMinute:1}),limitedHeaders={authorization:`Bearer ${limited.token}`},readUrl=`http://localhost/api/v1/automation/switches?companyId=${f.company}`;
  assert.equal((await fetch(readUrl,{headers:limitedHeaders})).status,200);const refused=await fetch(readUrl,{headers:limitedHeaders});assert.equal(refused.status,429);assert.equal(refused.headers.get('retry-after'),'60');
 }finally{await app.close();installPermissionProvider(null);}
}));
