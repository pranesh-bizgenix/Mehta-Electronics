import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {request} from 'playwright';
import {getConfig} from '../src/config.js';
import {connectPostgres} from '../src/postgres.js';
const base='http://127.0.0.1:3000',results={at:new Date().toISOString(),checks:[],cleanup:{}};
const rows=(await fs.readFile(new URL('../verification-output/role-access/credentials.md',import.meta.url),'utf8')).split('\n').filter(l=>/^\| (OWNER|MANAGER) \|/.test(l)).map(l=>{const c=l.split('|').map(v=>v.trim());return {role:c[1],email:c[2],password:c[3]};});
const owner=await request.newContext(),staff=await request.newContext();
const sql=connectPostgres(getConfig().databaseUrl,{postgresOptions:{max:1,connection:{default_transaction_read_only:'on'}}});
let me,original;
async function check(response,status,label){assert.equal(response.status(),status,label);results.checks.push({label,status});return response;}
try{
 for(const [role,context]of [['OWNER',owner],['MANAGER',staff]]){const account=rows.find(a=>a.role===role);await check(await context.post(base+'/api/auth/login',{data:{email:account.email,password:account.password}}),200,role+' login');const current=await (await context.get(base+'/api/auth/me')).json();if(role==='OWNER')me=current;else original=current.user;}
 assert.match(original.email,/^verify-manager@/);assert.equal(original.status,'ACTIVE');assert.equal(original.role,'MANAGER');
 const headers={'x-csrf-token':me.csrfToken},url=base+'/api/v1/users/'+original.id;
 await check(await owner.patch(url,{headers,data:{role:'EXECUTIVE',reason:'VERIFY- temporary demonstration staff reassignment acceptance'}}),200,'change demonstration Manager role');
 await check(await staff.get(base+'/api/auth/me'),401,'role change revokes existing session');
 await check(await owner.patch(url,{headers,data:{role:'MANAGER',reason:'VERIFY- restore demonstration Manager role'}}),200,'restore role');
 const account=rows.find(a=>a.role==='MANAGER');const signed=await check(await staff.post(base+'/api/auth/login',{data:{email:account.email,password:account.password}}),200,'staff logs in with restored role');assert.equal((await signed.json()).user.role,'MANAGER');
 await check(await owner.patch(url,{headers,data:{status:'INACTIVE',reason:'VERIFY- temporary demonstration account lifecycle acceptance'}}),200,'deactivate demonstration staff');
 await check(await staff.get(base+'/api/auth/me'),401,'deactivation revokes session');
 await check(await staff.post(base+'/api/auth/login',{data:{email:account.email,password:account.password}}),401,'inactive account login denied');
 results.status='PASS';
}catch(error){results.status='FAIL';results.error=rows.reduce((s,a)=>s.replaceAll(a.password,'[redacted]'),String(error.message)).slice(0,800);process.exitCode=1;}
finally{
 try{
  if(original&&me){await check(await owner.patch(base+'/api/v1/users/'+original.id,{headers:{'x-csrf-token':me.csrfToken},data:{role:original.role,status:original.status,reason:'VERIFY- final restore demonstration account after lifecycle acceptance'}}),200,'final restore original staff access');const [row]=await sql`SELECT role,status FROM users WHERE id=${original.id}`;assert.equal(row.role,original.role);assert.equal(row.status,original.status);results.cleanup.staffAccessRestored=true;results.audit=await sql`SELECT action,record_id,reason FROM audit_logs WHERE entity='USER' AND record_id=${String(original.id)} AND reason LIKE 'VERIFY-%' ORDER BY id DESC LIMIT 4`;assert.equal(results.audit.length,4);}
  if(me)await check(await owner.post(base+'/api/auth/logout',{headers:{'x-csrf-token':me.csrfToken},data:{}}),200,'Owner logout');
  results.cleanup.businessFixturesCreated=0;
 }catch(error){results.cleanup.error=String(error.message).slice(0,500);results.status='FAIL';process.exitCode=1;}
 await fs.writeFile(new URL('../verification-output/role-access/2026-11-17/staff-lifecycle.json',import.meta.url),JSON.stringify(results,null,2));await owner.dispose();await staff.dispose();await sql.end();
}
console.log('Staff lifecycle: '+results.status+'; '+results.checks.length+' checks.');
