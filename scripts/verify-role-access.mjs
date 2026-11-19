import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';
const output=new URL(process.env.ROLE_VERIFICATION_OUTPUT || '../verification-output/role-access/2026-11-17/',import.meta.url);
await fs.mkdir(output,{recursive:true});
const accounts=(await fs.readFile(new URL('../verification-output/role-access/credentials.md',import.meta.url),'utf8')).split('\n').filter(l=>/^\| (OWNER|MANAGER|EXECUTIVE|ACCOUNTS|LOGISTICS_LEAD|STORE_STAFF) \|/.test(l)).map(l=>{const c=l.split('|').map(v=>v.trim());return {role:c[1],email:c[2],password:c[3]};});
assert.equal(accounts.length,6);
const base='http://127.0.0.1:3000',browser=await chromium.launch({headless:true});
const permissionOnly=process.argv.includes('--permission-only');
const contexts=new Map(),results={at:new Date().toISOString(),roles:[],changes:[],checks:[],cleanup:{}};
const sql=connectPostgres(getConfig().databaseUrl,{postgresOptions:{max:1,connection:{default_transaction_read_only:'on'}}});
let originalGrant,ownerContext,ownerMe,pendingPermissionSave;const identities=new Map();let changedStaff;
const snapshot=()=>sql`SELECT role_key,permission_key FROM role_permissions ORDER BY role_key,permission_key`;
const before=await snapshot();
const can=(me,p)=>me.permissions.includes('*')||me.permissions.includes(p);
async function check(response,status,label){assert.equal(response.status(),status,label);results.checks.push({label,status});return response;}
async function save(){await fs.writeFile(new URL(permissionOnly?'permission-save.json':'acceptance.json',output),JSON.stringify(results,null,2));}
try{
 await check(await (await browser.newContext()).request.get(base+'/api/v1/roles'),401,'anonymous matrix denied');
 for(const account of accounts.filter(a=>!permissionOnly||['OWNER','ACCOUNTS'].includes(a.role))){
  const context=await browser.newContext();contexts.set(account.role,context);const page=await context.newPage();page.setDefaultTimeout(90000);
  await page.goto(base+'/login',{timeout:180000});await page.getByLabel(/^Email/).fill(account.email);await page.getByLabel(/^Password/).fill(account.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL(/\/(dashboard|logistics|settings)(?:\?.*)?$/,{timeout:180000});
  const me=await (await check(await context.request.get(base+'/api/auth/me'),200,account.role+' session')).json();assert.equal(me.user.role,account.role);assert.equal(me.user.mustChangePassword,false);
  identities.set(account.role,me.user);if(account.role==='OWNER'){ownerContext=context;ownerMe=me;}
  const cookies=await context.cookies();const cookie=cookies.find(c=>c.name==='crm_session');assert.equal(cookie.httpOnly,true);assert.equal(cookie.sameSite,'Strict');
  const endpoints=[['/api/v1/roles','access.read'],['/api/v1/users','users.read'],['/api/customers?pageSize=1','customers.read'],['/api/items?pageSize=1','items.read'],['/api/crm/quotations?pageSize=1','quotations.read'],['/api/crm/orders?pageSize=1','orders.read'],['/api/crm/logistics/orders','logistics.read'],['/api/crm/purchasing/vendors','purchasing.read'],['/api/tally-connector/status','tally.connector.manage'],['/api/crm/quotation-costs/2147483647','quotations.cost.read']];
  for(const [path,permission] of endpoints.filter(([,permission])=>!permissionOnly||['customers.read','access.read'].includes(permission)))await check(await context.request.get(base+path),can(me,permission)?200:403,account.role+' '+permission);
  if(account.role!=='OWNER'){
   await check(await context.request.put(base+'/api/v1/roles/ACCOUNTS/permissions/customers.read',{headers:{'x-csrf-token':me.csrfToken},data:{granted:true,reason:'VERIFY- blocked role change'}}),403,account.role+' cannot edit permissions');
   await check(await context.request.post(base+'/api/v1/users',{headers:{'x-csrf-token':me.csrfToken},data:{}}),403,account.role+' cannot create staff');
  }
  await page.goto(base+'/users',{timeout:180000});
  if(can(me,'users.read'))await page.getByRole('heading',{name:'Users & roles',exact:true}).waitFor();else await page.getByRole('heading',{name:'Access restricted',exact:true}).waitFor();
  await page.screenshot({path:fileURLToPath(new URL(account.role.toLowerCase()+'.png',output)),fullPage:true});
  results.roles.push({role:account.role,login:true,permissions:me.permissions,staffScreen:can(me,'users.read')?'allowed':'restricted',cookieHttpOnly:true,cookieSameSite:'Strict'});await save();console.log(account.role+': role boundaries passed');await page.close();
 }
 assert.ok(ownerContext);const headers={'x-csrf-token':ownerMe.csrfToken};
 await check(await ownerContext.request.put(base+'/api/v1/roles/ACCOUNTS/permissions/customers.read',{data:{granted:false,reason:'VERIFY- CSRF denial'}}),403,'Owner write requires CSRF');
 await check(await ownerContext.request.patch(base+'/api/v1/roles/OWNER',{headers,data:{status:'INACTIVE',reason:'VERIFY- Owner lock'}}),409,'Owner role cannot be deactivated');
 await check(await ownerContext.request.put(base+'/api/v1/roles/STORE_STAFF/permissions/quotations.cost.read',{headers,data:{granted:true,reason:'VERIFY- logistics restriction'}}),403,'Store financial grant blocked');
 await check(await ownerContext.request.put(base+'/api/v1/roles/ACCOUNTS/permissions/users.create',{headers,data:{granted:true,reason:'VERIFY- reserved permission'}}),409,'Owner-only delegation blocked');
 await check(await ownerContext.request.put(base+'/api/v1/roles/ACCOUNTS/permissions/customers.read',{headers,data:{granted:true}}),422,'Grant reason required');
 if(!permissionOnly){
 const staff=identities.get('MANAGER');changedStaff={id:staff.id,role:'MANAGER',status:'ACTIVE'};
 const staffContext=contexts.get('MANAGER');
 await check(await ownerContext.request.patch(base+'/api/v1/users/'+staff.id,{headers,data:{role:'EXECUTIVE',reason:'VERIFY- temporary role reassignment acceptance'}}),200,'Owner reassigns demonstration Manager');
 await check(await staffContext.request.get(base+'/api/auth/me'),401,'role reassignment revokes existing staff session');
 await check(await ownerContext.request.patch(base+'/api/v1/users/'+staff.id,{headers,data:{role:'MANAGER',reason:'VERIFY- restore demonstration Manager role'}}),200,'restore Manager role');
 const staffAccount=accounts.find(a=>a.role==='MANAGER');
 const renewed=await check(await staffContext.request.post(base+'/api/auth/login',{data:{email:staffAccount.email,password:staffAccount.password}}),200,'restored Manager signs in again');
 assert.equal((await renewed.json()).user.role,'MANAGER');
 await check(await ownerContext.request.patch(base+'/api/v1/users/'+staff.id,{headers,data:{status:'INACTIVE',reason:'VERIFY- temporary demonstration account deactivation'}}),200,'Owner deactivates demonstration Manager');
 await check(await staffContext.request.get(base+'/api/auth/me'),401,'deactivation revokes existing staff session');
 await check(await staffContext.request.post(base+'/api/auth/login',{data:{email:staffAccount.email,password:staffAccount.password}}),401,'inactive staff cannot log in');
 await check(await ownerContext.request.patch(base+'/api/v1/users/'+staff.id,{headers,data:{status:'ACTIVE',reason:'VERIFY- restore demonstration Manager account'}}),200,'restore Manager account');
 results.staffLifecycle={roleChangeRevokesSession:true,deactivationRevokesSession:true,inactiveLoginDenied:true};
 }
 const matrix=await (await ownerContext.request.get(base+'/api/v1/roles')).json();const m=matrix.data;const permission=m.permissions.find(p=>p.key==='customers.read');originalGrant=permission.grantedTo.includes('ACCOUNTS');assert.equal(originalGrant,true);
 const page=await ownerContext.newPage();await page.goto(base+'/users?tab=roles',{timeout:180000});
 const checkbox=page.getByRole('checkbox',{name:'Accounts: '+permission.description,exact:true});await checkbox.waitFor();assert.equal(await checkbox.isChecked(),true);
 const accountsContext=contexts.get('ACCOUNTS');
 const revoked=pendingPermissionSave=page.waitForResponse(r=>r.url().endsWith('/api/v1/roles/ACCOUNTS/permissions/customers.read')&&r.request().method()==='PUT');await checkbox.click();await check(await revoked,200,'UI immediately saves Accounts revoke');
 await check(await accountsContext.request.get(base+'/api/customers?pageSize=1'),403,'existing Accounts session immediately loses access');
 let me=await (await accountsContext.request.get(base+'/api/auth/me')).json();assert.equal(me.permissions.includes('customers.read'),false);
 const accountPage=await accountsContext.newPage();await accountPage.goto(base+'/customers',{timeout:180000});await accountPage.getByRole('heading',{name:'Access restricted',exact:true}).waitFor();
 await checkbox.waitFor({state:'visible'});await page.waitForFunction(()=>Array.from(document.querySelectorAll('input[type=checkbox]')).some(i=>!i.disabled));
 const restored=pendingPermissionSave=page.waitForResponse(r=>r.url().endsWith('/api/v1/roles/ACCOUNTS/permissions/customers.read')&&r.request().method()==='PUT');await checkbox.click();await check(await restored,200,'UI immediately saves Accounts restore');
 await check(await accountsContext.request.get(base+'/api/customers?pageSize=1'),200,'existing Accounts session immediately regains access');
 const current=await (await ownerContext.request.get(base+'/api/v1/roles')).json();assert.ok(current.data.history.some(h=>h.role==='ACCOUNTS'&&h.permission==='customers.read'&&h.change==='REVOKE'));assert.ok(current.data.history.some(h=>h.role==='ACCOUNTS'&&h.permission==='customers.read'&&h.change==='GRANT'));
 results.changes.push({role:'ACCOUNTS',permission:'customers.read',revokedInUi:true,immediateApiDenial:true,directScreenDenied:true,restoredInUi:true,immediateApiAllowed:true,historyRecorded:true});
 const audits=await sql`SELECT action,record_id,reason FROM audit_logs WHERE entity='ACCESS_MATRIX' AND record_id='ACCOUNTS:customers.read' ORDER BY id DESC LIMIT 2`;assert.deepEqual(audits.map(a=>a.action),['GRANT','REVOKE']);results.audit=audits;
 await page.screenshot({path:fileURLToPath(new URL('permission-matrix.png',output)),fullPage:true});results.status='PASS';
}catch(error){results.status='FAIL';results.error={name:error.name,message:accounts.reduce((message,account)=>message.replaceAll(account.password,'[redacted]'),String(error.message)).slice(0,1000)};await save();console.error('Role acceptance failed: '+error.name);process.exitCode=1;}
finally{
 try{
  if(pendingPermissionSave)await pendingPermissionSave.catch(()=>{});
  if(changedStaff&&ownerContext){const response=await ownerContext.request.patch(base+'/api/v1/users/'+changedStaff.id,{headers:{'x-csrf-token':ownerMe.csrfToken},data:{role:changedStaff.role,status:changedStaff.status,reason:'VERIFY- final restoration of demonstration staff access'}});assert.equal(response.status(),200);const [staff]=await sql.unsafe('SELECT role,status FROM users WHERE id=$1',[changedStaff.id]);assert.equal(staff.role,changedStaff.role);assert.equal(staff.status,changedStaff.status);results.cleanup.staffAccessRestored=true;}
  if(originalGrant!==undefined&&ownerContext){const response=await ownerContext.request.put(base+'/api/v1/roles/ACCOUNTS/permissions/customers.read',{headers:{'x-csrf-token':ownerMe.csrfToken},data:{granted:originalGrant,reason:'VERIFY- restore original Accounts permission after acceptance'}});assert.equal(response.status(),200);}
  assert.deepEqual(await snapshot(),before);results.cleanup.permissionMembershipRestored=true;
  for(const [role,context]of contexts){const response=await context.request.get(base+'/api/auth/me');if(response.status()===200){const me=await response.json();await check(await context.request.post(base+'/api/auth/logout',{headers:{'x-csrf-token':me.csrfToken},data:{}}),200,role+' logout');await check(await context.request.get(base+'/api/auth/me'),401,role+' expired session denied');}}
  results.cleanup.businessFixturesCreated=0;results.cleanup.auditHistoryRetained=true;
 }catch(error){results.cleanup.error=String(error.message).slice(0,600);process.exitCode=1;results.status='FAIL';}
 await save();await browser.close();await sql.end();
}
console.log('Role acceptance: '+results.status+'; '+results.checks.length+' HTTP checks; evidence saved.');
