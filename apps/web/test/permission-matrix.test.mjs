import assert from 'node:assert/strict';
import {test} from 'node:test';
import {permissionAuditReason,permissionCellLocked} from '../features/users/permission-matrix.ts';

test('routine role permission changes use precise automatic audit wording',()=>{
 assert.equal(permissionAuditReason('customers.create',true),'Granted customers.create from the Users & roles permission matrix.');
 assert.equal(permissionAuditReason('customers.create',false),'Removed customers.create from the Users & roles permission matrix.');
});

test('one-click permissions retain Owner, owner-only and logistics restrictions',()=>{
 const ordinary={key:'customers.read',ownerOnly:false},ownerOnly={key:'access.manage',ownerOnly:true};
 assert.equal(permissionCellLocked({allPermissions:false},ordinary,false),false);
 assert.equal(permissionCellLocked({allPermissions:true},ordinary,true),true);
 assert.equal(permissionCellLocked({allPermissions:false},ownerOnly,false),true);
 assert.equal(permissionCellLocked({allPermissions:false,allowedPermissions:['orders.read']},ordinary,false),true);
 assert.equal(permissionCellLocked({allPermissions:false,allowedPermissions:['customers.read']},ordinary,false),false);
});
