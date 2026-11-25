import test from 'node:test';
import assert from 'node:assert/strict';
import {SupportIntakeService} from '../src/modules/support-intake/service.js';
import {installPermissionProvider} from '../src/rbac.js';
test('Support write access follows assignment; ordinary write permission cannot edit another owner request',async()=>{
 const row={assigned_to:70,backup_owner_id:71};
 const service=new SupportIntakeService({db:{},operations:{}});service.one=async()=>row;
 installPermissionProvider({permissionsFor:role=>role==='SUPERVISOR'?['operations.read','operations.write','work.reassign']:['operations.read','operations.write'],requiresMfa:()=>false});
 try{
  const id='11111111-1111-4111-8111-111111111111';
  await assert.rejects(service.row({id:72,role:'STAFF'},id,id,true),{status:403});
  for(const actor of [{id:70,role:'STAFF'},{id:71,role:'STAFF'},{id:72,role:'SUPERVISOR'}])assert.equal(await service.row(actor,id,id,true),row);
  assert.equal(await service.row({id:72,role:'STAFF'},id,id,false),row,'Existing authorised read behaviour stays unchanged');
 }finally{installPermissionProvider(null);}
});
