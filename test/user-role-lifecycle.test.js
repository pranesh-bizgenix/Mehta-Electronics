import assert from 'node:assert/strict';
import {test} from 'node:test';
import {UserAdminService} from '../src/modules/admin/user-admin-service.js';

function service() {
  let writes=0;
  const actor={id:1,role:'OWNER',status:'ACTIVE'};
  const staff={id:2,name:'VERIFY- Staff',email:'verify-staff@example.test',role:'MANAGER',status:'ACTIVE'};
  const repository={get:async id=>id===1?actor:staff,lock:async()=>{},activeRole:async()=>null,create:async()=>{writes++;},update:async()=>{writes++;}};
  const access={require:()=>{},roleExists:()=>true};
  const value=new UserAdminService({repository,access,transactions:{run:async(a,r,callback)=>callback()},audit:{record:async()=>{writes++;}}});
  return {value,actor,get writes(){return writes;}};
}

test('staff creation rejects a role deactivated after the cached preview',async()=>{
  const f=service();await assert.rejects(f.value.create(f.actor,{name:'VERIFY- Staff',email:'verify-staff@example.test',password:'VERIFY-Private#Pass1',role:'MANAGER',ownerUserId:1,reason:'VERIFY- concurrent role lifecycle'}),{status:422});assert.equal(f.writes,0);
});

test('staff reassignment rechecks and locks the current active role before saving',async()=>{
  const f=service();await assert.rejects(f.value.update(f.actor,2,{role:'MANAGER',reason:'VERIFY- concurrent role lifecycle'}),{status:422});assert.equal(f.writes,0);
});
