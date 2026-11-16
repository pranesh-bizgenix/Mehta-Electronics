import assert from 'node:assert/strict';
import {test} from 'node:test';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {execFileSync} from 'node:child_process';
import {withTestTransaction} from '../test-support/transaction.js';
import {tallyFixture} from '../test-support/tally-fixture.js';
import {createConnectorStore} from '../src/connector-store.js';
import {getConfig} from '../src/config.js';
import {createApp} from '../src/app.js';
import {tokenDigest} from '../src/security.js';
import {installPermissionProvider} from '../src/rbac.js';

test('updater syntax, hashes, rollback quarantine and validation isolation use temporary files only',()=>{
 const result=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','test-support/check-connector-update.ps1'],{encoding:'utf8',windowsHide:true});assert.match(result,/PASS: 9/);
});
test('reviewed release passes validation-only without installed profile/service access',()=>{
 const result=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/update-tally-sales-connector.ps1','-ValidateOnly'],{encoding:'utf8',windowsHide:true});assert.match(result,/No service or installed file was changed/);
});
test('authenticated heartbeat stores explicit build version, supports older agents, audits changes and exposes no credentials',()=>withTestTransaction(async db=>{
 const f=await tallyFixture(db),config=getConfig({mfaEnabled:false}),store=createConnectorStore(config,{database:db.sql});
 await store.ready();
 const token=crypto.randomBytes(32).toString('hex');await db.sql`UPDATE tally_connectors SET access_token_hash=${tokenDigest(token)},access_token_expires_at=now()+interval '1 hour',agent_version='0.9.0' WHERE id=${f.connector}`;
 const actor=await store.authenticate({authorization:`Bearer ${token}`});
 assert.equal((await store.status({readOnly:true})).connectors.find(row=>row.id===f.connector).connector_version,null);
 const body={machineName:'ZZTEST_pc',agentVersion:'old-client-version',connectorVersion:'1.1.0',tallyAvailable:true,selectedCompany:'ZZTEST_Mehta'};
 await store.heartbeat(actor,body);await store.heartbeat(actor,body);
 let status=await store.status({readOnly:true}),row=status.connectors.find(row=>row.id===f.connector);assert.equal(row.connector_version,'1.1.0');assert.equal(row.agent_version,'1.1.0');
 assert.equal((await db.sql`SELECT count(*) AS n FROM audit_logs WHERE entity='TALLY_CONNECTOR' AND record_id=${f.connector} AND action='VERSION_REPORTED'`)[0].n,1);
 await assert.rejects(store.heartbeat(actor,{...body,connectorVersion:123}),{status:422});
 await assert.rejects(store.heartbeat(actor,{...body,connectorVersion:'1.1.0',selectedCompany:'ZZTEST_wrong_company'}),{status:403});
 await assert.rejects(store.authenticate({authorization:'Bearer ZZTEST_invalid'}),{status:401});
 await store.heartbeat(actor,{...body,connectorVersion:undefined,agentVersion:'1.0.0'});
 row=(await store.status({readOnly:true})).connectors.find(row=>row.id===f.connector);assert.equal(row.connector_version,'1.0.0');
 assert.ok(!JSON.stringify(status).includes(token));assert.ok(!JSON.stringify(status).includes('access_token_hash'));
 const owner=(await db.sql`INSERT INTO users(name,email,role,password_hash,must_change_password) VALUES('ZZTEST connector owner','ZZTEST_connector_owner@example.test','OWNER','not-a-login',0) RETURNING id`)[0].id;
 const sessionToken=crypto.randomUUID();await db.sql`INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES(${owner},${tokenDigest(sessionToken)},'ZZTEST_csrf',now()+interval '1 hour')`;
 const app=createApp({db,config,connectorStore:store});
 async function request(method,path,headers,body={}){const req=Readable.from([Buffer.from(JSON.stringify(body))]);Object.assign(req,{method,url:path,headers:{host:'localhost',...headers},socket:{remoteAddress:'test'}});const res={status:0,headersSent:false,setHeader(){},writeHead(n){this.status=n;this.headersSent=true;},end(value){this.body=value?JSON.parse(String(value)):null;}};await app(req,res);return res;}
 try {
  assert.equal((await request('GET','/api/tally-connector/status',{})).status,401);
  assert.equal((await request('POST','/api/connectors/heartbeat',{},body)).status,401);
  // Connector traffic uses existing bearer authentication, not employee CSRF.
  assert.equal((await request('POST','/api/connectors/heartbeat',{authorization:`Bearer ${token}`},body)).status,200);
  const result=await request('GET','/api/tally-connector/status',{cookie:`crm_session=${sessionToken}`});assert.equal(result.status,200);assert.equal(result.body.connectors.find(row=>row.id===f.connector).connector_version,'1.1.0');
 } finally {await app.close();installPermissionProvider(null);}
}));
