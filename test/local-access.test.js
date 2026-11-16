import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {localAccessAllowed,localReviewUser} from '../src/local-access.js';
import {getConfig} from '../src/config.js';

const config={localReviewAccess:true,host:'127.0.0.1',port:3000};
const request=(address='127.0.0.1',host='127.0.0.1:3000',extra={})=>({method:'GET',url:'/api/auth/me',socket:{remoteAddress:address},headers:{host,...extra}});
test('login-free review requires explicit configuration, loopback listener and peer, local Host and same-site origin',()=>{
  assert.equal(localAccessAllowed(request(),config),true);
  assert.equal(localAccessAllowed(request('::1','localhost:3000'),config),true);
  for(const req of [request('192.168.1.20'),request('127.0.0.1','evil.example:3000'),request('127.0.0.1','localhost:4000'),request('127.0.0.1','localhost:3000',{origin:'https://evil.example'}),request('127.0.0.1','localhost:3000',{'sec-fetch-site':'cross-site'})]) assert.equal(localAccessAllowed(req,config),false);
  assert.equal(localAccessAllowed(request(),{...config,localReviewAccess:false}),false);
  assert.equal(localAccessAllowed(request(),{...config,host:'0.0.0.0'}),false);
});
test('local review clears onboarding gates in request context only and keeps real Owner identity',async()=>{
  const owner={id:10,role:'OWNER',must_change_password:1,mfa_enabled:true};
  const local=await localReviewUser(null,request(),null,config,owner);
  assert.equal(local.id,10);assert.equal(local.must_change_password,0);assert.equal(local.mfa_enabled,false);
  assert.equal(owner.must_change_password,1);
  assert.equal(await localReviewUser(null,request('192.168.1.20'),null,config,owner),owner);
});

test('production refuses local review before startup and config overrides cannot weaken the environment',()=>{
  assert.throws(()=>getConfig({...config,isProduction:true}),{code:'LOCAL_REVIEW_PRODUCTION_FORBIDDEN'});
  assert.equal(getConfig({...config,isProduction:true,localReviewAccess:false}).localReviewAccess,false);
  const result=spawnSync(process.execPath,['--input-type=module','--eval',`
    import {getConfig} from './src/config.js';
    import {localAccessAllowed} from './src/local-access.js';
    for (const overrides of [{}, {isProduction:false}]) {
      try { getConfig(overrides); process.exitCode=1; }
      catch (error) {
        if (error.code!=='LOCAL_REVIEW_PRODUCTION_FORBIDDEN' || !error.message.includes('LOCAL_REVIEW_ACCESS=false')) throw error;
      }
    }
    const request={socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost:3000'}};
    if (localAccessAllowed(request,{isProduction:false,localReviewAccess:true,host:'127.0.0.1',port:3000})) process.exitCode=1;
  `],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,NODE_ENV:'production',LOCAL_REVIEW_ACCESS:'true'},encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.error,undefined);
});

test('production never grants local review or clears onboarding gates even for loopback Owners',async()=>{
  const production={...config,isProduction:true},owner={id:10,role:'OWNER',must_change_password:1,mfa_enabled:true};
  for(const req of [request(),request('::1','localhost:3000'),request('::ffff:127.0.0.1')]) {
    assert.equal(localAccessAllowed(req,production),false);
    assert.equal(await localReviewUser(null,req,null,production,owner),owner);
    assert.equal(await localReviewUser(null,req,null,production,null),null);
  }
  assert.equal(getConfig({...config,isProduction:false}).localReviewAccess,true);
  assert.equal(localAccessAllowed(request(),{...config,isProduction:false}),true);
});
