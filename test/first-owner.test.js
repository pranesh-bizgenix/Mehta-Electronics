import assert from 'node:assert/strict';
import {test} from 'node:test';
import {provisionFirstOwner} from '../src/first-owner.js';
import {verifyPassword} from '../src/security.js';

const input={name:'VERIFY- Operator',email:'verify-owner@example.test',password:'VERIFY-Private#Pass1',reason:'VERIFY- approved initial setup'};
function protocol({count=0,role={key:'OWNER',status:'ACTIVE',all_permissions:true,requires_mfa:true},auditFailure=false}={}) {
  const writes=[];let committed=false,rolledBack=false;
  const tx=async(strings,...values)=>{
    const text=strings.join('?');
    if(text.includes('count(*)'))return [{count}];
    if(text.includes('FROM roles'))return role?[role]:[];
    if(text.startsWith('INSERT INTO users')){writes.push({text,values});return [{id:1,name:input.name,email:input.email,role:'OWNER',status:'ACTIVE'}];}
    if(text.startsWith('INSERT INTO audit_logs')){if(auditFailure)throw new Error('audit failed');writes.push({text,values});}
    return [];
  };
  return {writes,get committed(){return committed;},get rolledBack(){return rolledBack;},begin:async callback=>{try{const value=await callback(tx);committed=true;return value;}catch(e){rolledBack=true;throw e;}}};
}
test('first Owner is explicit, hashed, password-change required and audited without credentials',async()=>{
  const db=protocol();const user=await provisionFirstOwner(db,input);assert.equal(user.role,'OWNER');assert.equal(db.committed,true);
  assert.ok(verifyPassword(input.password,db.writes[0].values.at(-1)));assert.match(db.writes[0].text,/must_change_password.*1/);
  const audit=JSON.stringify(db.writes[1]);assert.ok(!audit.includes(input.password));assert.ok(!audit.includes('scrypt$'));assert.match(audit,/FIRST_OWNER_PROVISIONED/);
});
test('first Owner refuses any existing staff, avoiding a recovery privilege bypass',async()=>{
  const db=protocol({count:1});await assert.rejects(provisionFirstOwner(db,input),{code:'FIRST_OWNER_ALREADY_CONFIGURED'});assert.equal(db.writes.length,0);
});
test('first Owner refuses missing or unprotected Owner role',async()=>{
  for(const role of [null,{status:'INACTIVE',all_permissions:true,requires_mfa:true},{status:'ACTIVE',all_permissions:false,requires_mfa:true},{status:'ACTIVE',all_permissions:true,requires_mfa:false}]){
    const db=protocol({role});await assert.rejects(provisionFirstOwner(db,input),{code:'OWNER_ROLE_INVALID'});assert.equal(db.writes.length,0);
  }
});
test('failed audit prevents Owner provisioning commit',async()=>{
  const db=protocol({auditFailure:true});await assert.rejects(provisionFirstOwner(db,input),/audit failed/);assert.equal(db.committed,false);assert.equal(db.rolledBack,true);
});
test('weak password and missing identity are rejected before a transaction',async()=>{
  for(const patch of [{password:'weak'},{email:''},{name:''},{reason:''}]){const db=protocol();await assert.rejects(provisionFirstOwner(db,{...input,...patch}),{status:422});assert.equal(db.writes.length,0);}
});
