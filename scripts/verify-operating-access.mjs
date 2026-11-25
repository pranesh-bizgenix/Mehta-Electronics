// Explicitly authorised fictional-account acceptance procedure. Credentials
// remain in the ignored private acceptance directory and are never logged.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {getConfig} from '../src/config.js';
import {createDatabase} from '../src/postgres.js';
import {createApp} from '../src/app.js';
import {OPERATING_ROLES} from '../src/modules/access/operating-model.js';
const dir='.vercel/acceptance',file=dir+'/operating-test-accounts.private.json';
const accounts=JSON.parse(fs.readFileSync(file)),exceptions=JSON.parse(fs.readFileSync(dir+'/operating-test-mfa-exceptions.private.json'));
const config=getConfig({mfaEnabled:true,schedulerEnabled:false,mfaTestExemptAccounts:exceptions}),target=new URL(config.databaseUrl);
if(target.hostname!=='mehta-controldesk-db01.chs2eymsy2ec.ap-southeast-2.rds.amazonaws.com'||target.pathname!=='/postgres'||target.searchParams.get('sslmode')!=='require')throw Error('Requires the explicitly authorised development RDS.');
const db=createDatabase(config),report={checks:[],accounts:[]};let app;
async function call(method,path,body,cookie='',csrf=''){
 const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);
 Object.assign(req,{method,url:path,headers:{host:'localhost','content-type':'application/json',cookie,'x-csrf-token':csrf},socket:{remoteAddress:'127.0.0.1'}});
 const headers={};const res={headersSent:false,setHeader(k,v){headers[k.toLowerCase()]=v;},hasHeader(k){return k.toLowerCase() in headers;},writeHead(status,h){this.status=status;Object.assign(headers,Object.fromEntries(Object.entries(h??{}).map(([k,v])=>[k.toLowerCase(),v])));this.headersSent=true;},end(text){this.body=text?JSON.parse(String(text)):null;}};
 await app(req,res);return {...res,cookie:String(headers['set-cookie']??'').split(';')[0]};
}
try{
 await db.ready();app=createApp({db,config});await app.modules.ready();
 for(const account of accounts){
  assert.match(account.email,/^[^@\s]+@test\.local$/);assert.match(account.name,/^TEST_/);assert.ok(account.password,'No private password available for '+account.email);
  let response=await call('POST','/api/auth/login',{email:account.email,password:account.setupPending?account.temporaryPassword:account.password});
  assert.equal(response.status,200,'Normal sign-in failed for '+account.email);assert.equal(response.body.user.id,account.id);assert.equal(response.body.mfa.required,false,'Test account unexpectedly requires MFA');
  const cookie=response.cookie,csrf=response.body.csrfToken;
  if(account.setupPending){
   assert.ok(process.argv.includes('--complete-test-password-setup'),'Explicit --complete-test-password-setup required');
   const changed=await call('POST','/api/auth/change-password',{currentPassword:account.temporaryPassword,newPassword:account.password},cookie,csrf);
   assert.equal(changed.status,200,'Normal first-password change failed');delete account.temporaryPassword;delete account.setupPending;
   fs.writeFileSync(file,JSON.stringify(accounts,null,2),{mode:0o600});
  }
  const me=await call('GET','/api/auth/me',null,cookie);assert.equal(me.status,200);assert.equal(me.body.user.mustChangePassword,false);assert.equal(me.body.mfa.required,false);
  const expected=OPERATING_ROLES.find(r=>r.key===account.role).permissions;
  assert.deepEqual([...me.body.permissions].sort(),[...(expected??['*'])].sort());
  const admin=await call('GET','/api/users',null,cookie);assert.equal(admin.status,me.body.permissions.includes('*')||me.body.permissions.includes('users.read')?200:403);
  const finance=await call('GET','/api/v1/operations/COLLECTION',null,cookie);assert.equal(finance.status,['OWNER','ACCOUNTS'].includes(account.role)?200:403);
  assert.equal((await call('POST','/api/auth/logout',{},cookie,csrf)).status,200);
  account.verified=true;account.verifiedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(accounts,null,2),{mode:0o600});
  report.accounts.push({email:account.email,role:account.role,verified:true});console.log('PASS normal sign-in, exact permissions and finance/admin restrictions: '+account.role);
 }
 if(process.argv.includes('--configure-test-routing')){
  const actor=await db.prepare("SELECT id,role FROM users WHERE id=47 AND role='OWNER' AND status='ACTIVE'").get();assert.ok(actor);
  const credential=JSON.parse(fs.readFileSync(dir+'/make-sales-service-credential.private.json'));
  const companies=await db.prepare('SELECT company_id FROM automation_service_companies WHERE credential_id=?').all(credential.id);assert.ok(companies.length);
  const byRole=role=>accounts.find(a=>a.role===role).id;
  const value=companies.flatMap(c=>[['OPERATIONS','OPERATIONS_COORDINATOR'],['ACCOUNTS','ACCOUNTS'],['CUSTOMER_SUPPORT','CUSTOMER_SUPPORT']].map(([department,role])=>({companyId:c.company_id,department,ownerUserId:byRole(role),backupUserId:actor.id})));
  const existing=await app.modules.services.rules.get('intake.department_owners');
  if(JSON.stringify(existing?.value)!==JSON.stringify(value))await app.modules.services.rules.set(actor,'intake.department_owners',value,'Operator-authorised departmental request ownership for fictional acceptance accounts');
  report.checks.push('Configured company-specific Operations, Accounts and Support assignment; Sales and service credentials unchanged');
 }
 report.passed=true;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{if(app)await app.close();await db.close();fs.mkdirSync('verification-output/crm-expansion',{recursive:true});fs.writeFileSync('verification-output/crm-expansion/operating-access-report.json',JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
