import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assertActiveOwner} from '../src/db.js';
import {getConfig} from '../src/config.js';

function ownerProtocol(users=[],roles=[{key:'OWNER',status:'ACTIVE'}]) {
  const statements=[];
  const db={prepare(sql){
    statements.push(sql);
    assert.match(sql,/^SELECT u\.id FROM users u JOIN roles r ON r\.key=u\.role/);
    assert.match(sql,/u\.role='OWNER' AND u\.status='ACTIVE' AND r\.status='ACTIVE'/);
    assert.doesNotMatch(sql,/password|email|INSERT|UPDATE|DELETE|TRUNCATE/i);
    return {async get(){return users.filter(user=>user.role==='OWNER'&&user.status==='ACTIVE'&&roles.some(role=>role.key===user.role&&role.status==='ACTIVE')).sort((a,b)=>a.id-b.id).map(({id})=>({id}))[0];}};
  }};
  return {db,statements};
}

test('startup refuses missing or inactive Owners using only a read query',async()=>{
  const secret='VERIFY-secret_that_must_never_be_reported';
  const cases=[
    [],
    [{id:1,role:'EXECUTIVE',status:'ACTIVE',password_hash:secret}],
    [{id:1,role:'OWNER',status:'INACTIVE',password_hash:secret}],
    [{id:1,role:'OWNER',status:'LOCKED',password_hash:secret}]
  ];
  for(const users of cases){
    const {db,statements}=ownerProtocol(users);
    await assert.rejects(assertActiveOwner(db),error=>{
      assert.equal(error.code,'ACTIVE_OWNER_REQUIRED');
      assert.match(error.message,/No account or password was created/);
      assert.equal(error.message.includes(secret),false);
      return true;
    });
    assert.equal(statements.length,1);
  }
  const {db}=ownerProtocol([{id:1,role:'OWNER',status:'ACTIVE'}],[{key:'OWNER',status:'INACTIVE'}]);
  await assert.rejects(assertActiveOwner(db),{code:'ACTIVE_OWNER_REQUIRED'});
});

test('startup preserves an existing active Owner without creating or changing access',async()=>{
  const users=[{id:9,role:'OWNER',status:'ACTIVE',must_change_password:1},{id:3,role:'OWNER',status:'ACTIVE'}];
  const before=JSON.stringify(users),{db,statements}=ownerProtocol(users);
  assert.equal(await assertActiveOwner(db),3);
  assert.equal(statements.length,1);
  assert.equal(JSON.stringify(users),before);
});

test('configuration and startup provide no automatic bootstrap credentials',()=>{
  const config=getConfig({localReviewAccess:false});
  assert.equal(Object.hasOwn(config,'seedOwnerEmail'),false);
  assert.equal(Object.hasOwn(config,'seedOwnerPassword'),false);
  const example=fs.readFileSync(new URL('../.env.example',import.meta.url),'utf8');
  assert.doesNotMatch(example,/SEED_OWNER_(?:EMAIL|PASSWORD)/);
  const database=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.doesNotMatch(database,/INSERT INTO users|seedOwner\(|hashPassword/);
  assert.ok(database.indexOf('await assertActiveOwner(db)')<database.indexOf('await backfillDocumentRevisions(db)'));
  const startup=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(startup,/'ACTIVE_OWNER_REQUIRED'/);
});

test('startup protects the selected Owner and role without locking unrelated user writes',async()=>{
  const {db,statements}=ownerProtocol([{id:3,role:'OWNER',status:'ACTIVE'}]);
  assert.equal(await assertActiveOwner(db),3);
  assert.match(statements[0],/LIMIT 1 FOR SHARE OF u,r$/);
  const database=fs.readFileSync(new URL('../src/db.js',import.meta.url),'utf8');
  assert.doesNotMatch(database,/LOCK TABLE users IN EXCLUSIVE MODE/);
});
