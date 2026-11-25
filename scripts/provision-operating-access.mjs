import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
import {getConfig} from '../src/config.js';
import {createDatabase} from '../src/postgres.js';
import {createApp} from '../src/app.js';
import {OPERATING_ROLES} from '../src/modules/access/operating-model.js';

const apply=process.argv.includes('--apply'),actorId=Number(process.argv.find(a=>a.startsWith('--actor-id='))?.split('=')[1]);
if(!Number.isSafeInteger(actorId)||actorId<1)throw Error('Supply the existing authorising Owner with --actor-id=ID.');
const config=getConfig({schedulerEnabled:false}),target=new URL(config.databaseUrl);
if(target.hostname!=='mehta-controldesk-db01.chs2eymsy2ec.ap-southeast-2.rds.amazonaws.com'||target.pathname!=='/postgres'||target.searchParams.get('sslmode')!=='require')throw Error('This authorised operating-model procedure requires the existing development RDS.');
const db=createDatabase(config),dir='.vercel/acceptance',credentialFile=dir+'/operating-test-accounts.private.json';
fs.mkdirSync(dir,{recursive:true});let app;
const profiles=[['owner@test.local','OWNER','SALES'],['manager@test.local','MANAGER','SALES'],['executive@test.local','EXECUTIVE','SALES'],['accounts@test.local','ACCOUNTS','ACCOUNTS'],['logistics-lead@test.local','LOGISTICS_LEAD','OPERATIONS'],['store-staff@test.local','STORE_STAFF','OPERATIONS'],['operations@test.local','OPERATIONS_COORDINATOR','OPERATIONS'],['support@test.local','CUSTOMER_SUPPORT','CUSTOMER_SUPPORT']];
const password=()=>`A9!${randomBytes(18).toString('base64url')}z`;
try{
 await db.ready();app=createApp({db,config});await app.modules.ready();const {access,userAdmin}=app.modules.services;
 const actor=await db.prepare("SELECT id,role,name FROM users WHERE id=? AND role='OWNER' AND status='ACTIVE'").get(actorId);if(!actor)throw Error('An existing active Owner must authorise this operation.');
 const catalogue=new Map((await db.prepare('SELECT key,owner_only FROM permissions').all()).map(p=>[p.key,p]));
 const current=await db.prepare('SELECT role_key,permission_key FROM role_permissions').all(),roles=await db.prepare('SELECT key FROM roles').all(),knownRoles=new Set(roles.map(r=>r.key));
 const plan=OPERATING_ROLES.map(r=>{const before=current.filter(g=>g.role_key===r.key).map(g=>g.permission_key);for(const key of r.permissions??[]){if(!catalogue.has(key)||catalogue.get(key).owner_only)throw Error(`Invalid non-Owner permission in ${r.key}: ${key}`);}return {key:r.key,name:r.name,description:r.description,create:!knownRoles.has(r.key),grant:r.permissions?.filter(k=>!before.includes(k))??[],revoke:r.permissions?before.filter(k=>!r.permissions.includes(k)):[],preserveMfa:true};});
 fs.writeFileSync(dir+'/operating-access-plan.json',JSON.stringify({actorId,apply,plan},null,2));console.log(JSON.stringify({apply,roles:plan.map(p=>({key:p.key,create:p.create,grant:p.grant.length,revoke:p.revoke.length}))}));
 if(!apply)process.exitCode=0;
 else{
  const reason='Operator-authorised CRM departmental operating model and fictional review accounts';
  for(const r of OPERATING_ROLES)if(!knownRoles.has(r.key))await access.createRole(actor,{key:r.key,name:r.name,description:r.description,requiresMfa:true,reason});
  await app.modules.transactions.run(actor,reason,async()=>{
   await db.prepare("SELECT set_config('lock_timeout','15000',true),set_config('statement_timeout','30000',true),set_config('idle_in_transaction_session_timeout','120000',true)").get();
   access.require(actor,'access.manage');
   await access.repository.lockMatrix();
   const lockedGrants=await db.prepare('SELECT role_key,permission_key FROM role_permissions').all();
   for(const r of OPERATING_ROLES){
    if(!r.permissions)continue;
    console.log('Applying role '+r.key);
    const old=await access.repository.role(r.key);
    if(!old||old.all_permissions||old.status!=='ACTIVE')throw Error('Role is unavailable or protected: '+r.key);
    if(old.name!==r.name||old.description!==r.description){
     const next={name:r.name,description:r.description,requiresMfa:old.requires_mfa,status:old.status};
     await access.repository.updateRole(r.key,next,actor.id);
     await access.repository.event({roleKey:r.key,change:'ROLE_UPDATED',oldValue:old,newValue:next,reason,actorId:actor.id});
     await app.modules.audit.record({actorId:actor.id,entity:'ROLE',recordId:r.key,action:'UPDATE',oldValue:old,newValue:next,reason});
    }
    const before=lockedGrants.filter(g=>g.role_key===r.key).map(g=>g.permission_key);
    const changes=[...r.permissions.filter(k=>!before.includes(k)).map(permission=>({permission,granted:true})),...before.filter(k=>!r.permissions.includes(k)).map(permission=>({permission,granted:false}))];
    for(const {permission,granted} of changes){
     if(granted)await access.repository.grant(r.key,permission,actor.id);else await access.repository.revoke(r.key,permission);
     const change=granted?'GRANT':'REVOKE',oldValue={granted:!granted},newValue={granted};
     await access.repository.event({roleKey:r.key,permissionKey:permission,change,oldValue,newValue,reason,actorId:actor.id});
     await app.modules.audit.record({actorId:actor.id,entity:'ACCESS_MATRIX',recordId:r.key+':'+permission,action:change,oldValue,newValue,reason});
    }
   }
  });
  await access.load();
  const existingPasswords=process.env.QA_EXISTING_PASSWORD_FILE?JSON.parse(fs.readFileSync(process.env.QA_EXISTING_PASSWORD_FILE)):{};
  const prior=fs.existsSync(credentialFile)?JSON.parse(fs.readFileSync(credentialFile)):[],accounts=[];
  for(const [email,role,department] of profiles){let row=await db.prepare('SELECT id,name,email,role,status,must_change_password FROM users WHERE email=?').get(email),saved=prior.find(a=>a.email===email);
   if(row&&(!row.name.startsWith('TEST_')||row.status!=='ACTIVE'||row.role!==role))throw Error(`Reserved test identity is not safe to reuse: ${email}`);
   if(!row){const temporaryPassword=password(),finalPassword=password(),created=await userAdmin.create(actor,{name:'TEST_'+role,email,role,department,ownerUserId:actor.id,backupUserId:48,password:temporaryPassword,reason});row={...created,must_change_password:1};saved={temporaryPassword,password:finalPassword,setupPending:true};}
   accounts.push({id:row.id,name:row.name,email,role,department,password:saved?.password??existingPasswords[email]??null,...(saved?.setupPending?{temporaryPassword:saved.temporaryPassword,setupPending:true}:{}),verified:false});
   fs.writeFileSync(credentialFile,JSON.stringify([...accounts,...prior.filter(p=>!accounts.some(a=>a.email===p.email))],null,2),{mode:0o600});
  }
  const expiresAt=new Date(Date.now()+7*86400000).toISOString(),exemptions=accounts.map(a=>({userId:a.id,email:a.email,expiresAt}));
  fs.writeFileSync(dir+'/operating-test-mfa-exceptions.private.json',JSON.stringify(exemptions),{mode:0o600});
  console.log(JSON.stringify({applied:true,accountCount:accounts.length,credentials:'Private acceptance file; verify normal login before delivery',mfaExceptionExpiresAt:expiresAt}));
 }
}finally{if(app)await app.close();await db.close();}
