import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {emailAutomationRoutes,integrationHealth,pageRows} from '../src/modules/email-automation/routes.js';
import {createMockAdapter} from '../src/modules/email-automation/mock-adapter.js';
import {installPermissionProvider} from '../src/rbac.js';
const route=(method,pattern,permission,handler)=>({method,pattern,permission,handler});
function harness(config={emailAutomationEnabled:true}) {
 const audits=[];const db={prepare(sql){assert.match(sql,/^(SELECT 1|INSERT INTO audit_logs)/);return {async get(){return {healthy:1};},async run(...args){audits.push(args);}};}};
 return {audits,routes:emailAutomationRoutes({db,config,route,json(res,status,body){res.status=status;res.body=body;}})};
}
async function call(routes,suffix,{params={},query='',user={id:1,role:'OWNER'}}={}){
 const r=routes.find(r=>r.pattern==='/api/v1/email-automation'+suffix);assert.ok(r);const res={};await r.handler({res,user,params,url:new URL('http://localhost/?'+query)});return res.body;
}
test('flag OFF registers no APIs and never touches the database',()=>{
 assert.deepEqual(emailAutomationRoutes({config:{},db:new Proxy({},{get(){throw Error('DB touched');}}),route}),[]);
});
test('all seven APIs are permission-protected GET routes with no mutation actions',()=>{
 const {routes}=harness();assert.equal(routes.length,7);
 for(const r of routes){assert.equal(r.method,'GET');assert.match(r.permission,/^email_automation\./);assert.doesNotMatch(r.pattern,/retry|send|approve|replay|edit/);}
});
test('mock records share IDs across all pages, return copies and never persist fixtures',async()=>{
 const a=createMockAdapter();const first=await a.read();first.emails[0].subject='changed';assert.notEqual((await a.read()).emails[0].subject,'changed');
 const {routes,audits}=harness();const inbox=await call(routes,'/emails');assert.equal(inbox.sample,true);
 const attachments=await call(routes,'/attachments'),processing=await call(routes,'/processing'),errors=await call(routes,'/errors');
 const ids=new Set(inbox.data.map(e=>e.id));for(const row of [...attachments.data,...processing.data])assert.ok(ids.has(row.emailId));
 assert.equal(errors.data.length,1);assert.equal(errors.data[0].status,'Failed');
 const detail=await call(routes,'/emails/:id',{params:{id:inbox.data[0].id}});assert.equal(detail.data.attachments.length,inbox.data[0].attachmentCount);
 const counts=await call(routes,'/dashboard');assert.equal(counts.data.emails,inbox.pagination.total);assert.equal(counts.data.attachments,attachments.pagination.total);
 for(const args of audits){assert.equal(args[1],'email-automation');assert.equal(args[2],'module');assert.match(args[3],/^VIEW_/);assert.equal(args[4],null);assert.equal(args[5],null);assert.equal(args[6],null);assert.doesNotMatch(JSON.stringify(args),/sample-email|example.invalid|Fictional|sample-order|s3:\/\//);}
});
test('server rejects anonymous and ungranted existing staff roles',async()=>{
 const {routes,audits}=harness();for(const user of [null,{id:2,role:'EXECUTIVE'},{id:3,role:'MANAGER'}])await assert.rejects(()=>call(routes,'/emails',{user}),e=>e.status===(!user?401:403));assert.equal(audits.length,0);
});
test('new keys allow explicitly granted custom role; integration permission is separate',async()=>{
 installPermissionProvider({permissionsFor:role=>role==='EMAIL_READER'?['email_automation.read']:[],requiresMfa:()=>false});
 try{const {routes}=harness();const user={id:2,role:'EMAIL_READER'};assert.equal((await call(routes,'/emails',{user})).sample,true);await assert.rejects(()=>call(routes,'/integrations',{user}),e=>e.status===403);}finally{installPermissionProvider(null);}
});
test('health is truthful, never leaks provider errors or returns invented provider connectivity',async()=>{
 const ok=await integrationHealth({prepare:()=>({get:async()=>({healthy:1})})});assert.equal(ok[0].status,'Connected');assert.ok(ok[0].checkedAt);for(const r of ok.slice(1)){assert.equal(r.status,'Not configured');assert.equal(r.checkedAt,null);}
 const failed=await integrationHealth({prepare(){throw Error('secret database URL');}});assert.equal(failed[0].status,'Unavailable');assert.doesNotMatch(JSON.stringify(failed),/secret/);
});
test('error center projects real integration failure only for integration-authorized readers',async()=>{
 let healthChecks=0;const db={prepare:()=>({get:async()=>{healthChecks++;throw Error('Private connection failure');},run:async()=>{}})};
 const routes=emailAutomationRoutes({db,config:{emailAutomationEnabled:true},route,json(res,status,body){res.body=body;}});
 const errors=await call(routes,'/errors');assert.ok(errors.data.some(r=>r.source==='Real integration check'&&r.emailId===null));assert.equal(healthChecks,1);assert.doesNotMatch(JSON.stringify(errors),/Private connection/);
 installPermissionProvider({permissionsFor:()=>['email_automation.read'],requiresMfa:()=>false});
 try {const filtered=await call(routes,'/errors',{user:{id:2,role:'EMAIL_READER'}});assert.ok(filtered.data.every(r=>r.emailId));assert.equal(healthChecks,1);}finally{installPermissionProvider(null);}
});
test('pagination, search, filters, missing detail and invalid query are handled',async()=>{
 const {routes}=harness();assert.equal((await call(routes,'/emails',{query:'search=delivery'})).data.length,1);
 assert.equal((await call(routes,'/emails',{query:'status=Failed'})).data.length,1);
 assert.equal((await call(routes,'/emails',{query:'page=2&pageSize=2'})).data.length,1);
 assert.equal((await call(routes,'/emails',{query:'search=absent'})).pagination.total,0);
 await assert.rejects(()=>call(routes,'/emails/:id',{params:{id:'absent'}}),e=>e.status===404);
 for(const query of ['page=0','pageSize=101','page=oops','page=-1'])assert.throws(()=>pageRows([],new URLSearchParams(query)),e=>e.status===422);
});
test('migration is additive, after 0060, with no grants or fixture data',()=>{
 const sql=fs.readFileSync(new URL('../database/postgres/migrations/0061_email_automation_read_models.sql',import.meta.url),'utf8');
 assert.doesNotMatch(sql,/ALTER TABLE|DROP TABLE|INSERT INTO (email_messages|source_documents|role_permissions)/i);
 assert.equal([...sql.matchAll(/CREATE TABLE (\w+)/g)].length,4);for(const [,name] of sql.matchAll(/CREATE TABLE (\w+)/g))assert.ok(name.startsWith('automation_'));
});
