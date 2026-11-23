import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {getConfig} from '../src/config.js';
import {tokenDigest} from '../src/security.js';
import {testFetch} from './http-client.js';
import {installPermissionProvider} from '../src/rbac.js';

/** Real request pipeline, no listener or external calls; caller owns rollback. */
export async function customerManagementHttpChecks(db,{owner,customer},{progress=()=>{}}={}){
 const app=createApp({db,config:getConfig({mfaEnabled:false,localReviewAccess:false,schedulerEnabled:false})}),fetch=testFetch(app),checks=[];
 const pass=name=>{checks.push(name);progress(name);},base=`http://localhost/api/v1/customers/${customer.id}`;
 try{
  const token=randomUUID(),csrf='ZZTEST_CUSTOMER_CSRF';
  await app.modules.transactions.run(owner,'ZZTEST_CUSTOMER_HTTP session',()=>db.prepare("INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(?,?,?,now()+interval '1 hour')").run(owner.id,tokenDigest(token),csrf));
  const headers={cookie:`crm_session=${token}`,'x-csrf-token':csrf,'content-type':'application/json','idempotency-key':randomUUID()};
  assert.equal((await fetch(base+'/addresses')).status,401);pass('HTTP customer routes require login');
  assert.equal((await fetch(base+'/addresses',{headers})).status,200);pass('HTTP customer routes return authorised records');
  const body={value:{label:'ZZTEST_HTTP delivery',kind:'DELIVERY',line1:'Synthetic address only',city:'Test city',stateCode:'33',countryCode:'IN',isDefault:false},reason:'ZZTEST_HTTP verified address'};
  assert.equal((await fetch(base+'/addresses',{method:'POST',headers:{cookie:headers.cookie,'content-type':'application/json'},body:JSON.stringify(body)})).status,403);pass('HTTP customer mutations require CSRF');
  let response=await fetch(base+'/addresses',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(response.status,200);const saved=(await response.json()).data;
  response=await fetch(base+'/addresses',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(response.status,200);assert.equal((await response.json()).data.id,saved.id);pass('HTTP retry reuses the same address record');
  response=await fetch(base+'/addresses',{method:'POST',headers,body:JSON.stringify({...body,reason:'ZZTEST_HTTP changed payload'})});assert.equal(response.status,409);pass('HTTP idempotency rejects changed payloads');
  response=await fetch(base+'/addresses',{method:'POST',headers:{...headers,'idempotency-key':randomUUID()},body:JSON.stringify({...body,unknown:'unexpected'})});assert.equal(response.status,422);pass('HTTP contracts reject unknown fields');
  const staff=await app.modules.transactions.run(owner,'ZZTEST_CUSTOMER_HTTP staff',()=>db.prepare("INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES(?,?,'STORE_STAFF','not-a-login',0) RETURNING id,role").get('ZZTEST_CUSTOMER_HTTP staff',randomUUID()+'@example.test'));
  const staffToken=randomUUID();await app.modules.transactions.run(owner,'ZZTEST_CUSTOMER_HTTP session',()=>db.prepare("INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(?,?,?,now()+interval '1 hour')").run(staff.id,tokenDigest(staffToken),csrf));
  response=await fetch(base+'/addresses',{method:'POST',headers:{...headers,cookie:`crm_session=${staffToken}`,'idempotency-key':randomUUID()},body:JSON.stringify(body)});assert.equal(response.status,403);pass('HTTP restricted staff cannot write customer addresses');
  return {passed:checks.length,checks};
 }finally{await app.close();installPermissionProvider(null);}
}
