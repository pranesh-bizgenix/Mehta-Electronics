import test from 'node:test';
import assert from 'node:assert/strict';
import {OrderWorkbookService} from '../src/modules/order-imports/service.js';
import {installPermissionProvider} from '../src/rbac.js';

test('Order imports reuse permissions and deny capture, corrections and review before database access',async()=>{
 installPermissionProvider({permissionsFor:role=>role==='READ_ONLY'?['orders.read']:[],requiresMfa:()=>false});
 try{
  const service=new OrderWorkbookService({db:{prepare:()=>{throw new Error('Unexpected database access');}}}),reader={id:1,role:'READ_ONLY'};
  for(const action of [()=>service.capture(reader,{}),()=>service.preview(reader,{}),()=>service.context(reader,'invalid',{}),()=>service.editRow(reader,'invalid','invalid',{}),()=>service.submit(reader,'invalid',{}),()=>service.decide(reader,'invalid',{})])await assert.rejects(action(),{status:403});
  await assert.rejects(service.scope(reader,{created_by:2,customer_id:null}),{status:403});
  await service.scope(reader,{created_by:1,customer_id:null});
 }finally{installPermissionProvider(null);}
});

test('Source summary reconciliation uses exact decimal quantities and does not infer stock',()=>{
 const service=new OrderWorkbookService({db:null}),row=(kind,quantity)=>({effective:{kind,externalCode:'SAMPLE',scheduleKind:'IMMEDIATE',requiredDate:null,openQuantity:quantity},excluded:false});
 assert.equal(service.summaryComparison([row('PO_LINE','0.1'),row('PO_LINE','0.2'),row('SUMMARY','0.3')]).status,'MATCHED');
 const difference=service.summaryComparison([row('PO_LINE','2'),row('SUMMARY','3')]);assert.equal(difference.status,'DIFFERENCE');assert.equal(difference.differences[0].difference,'1.000000');
 assert.equal(service.summaryComparison([row('PO_LINE',null),row('SUMMARY','3')]).status,'INCOMPLETE');
});
