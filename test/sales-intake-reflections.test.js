import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reservationReflectionIssues,unreflectedHolds} from '../src/modules/sales-intake/availability.js';

for(let i=0;i<10;i++)test(`reservation evidence ${i+1}: unknown native references require review; exact partial/full reflections are not subtracted twice`,()=>{
 const hold={id:'ZZTEST_'+i,availability_line_id:'ZZTEST_line_'+i,status:'TRANSFERRED',quantity:'2',warehouse_key:'ZZTEST_WH'};
 const unknown={reservedQuantity:'1',reservations:[{key:'unresolved-native-order-'+i,quantity:'1'}]};
 assert.deepEqual(reservationReflectionIssues([hold],unknown),['TRANSFERRED_RESERVATION_REFERENCE_REQUIRED']);
 assert.deepEqual(reservationReflectionIssues([{...hold,status:'ACTIVE'}],unknown),[]);
 assert.deepEqual(reservationReflectionIssues([hold],{reservedQuantity:'0',reservations:[]}),[]);
 const key='CRM-QUOTE:'+hold.availability_line_id,partial={reservedQuantity:'1',reservations:[{key,quantity:'1'}]},location=[{key:'ZZTEST_WH',reservations:[{key,quantity:'1'}]}];
 assert.deepEqual(reservationReflectionIssues([hold],partial),[]);assert.equal(unreflectedHolds([hold],partial,location)[0].quantity,'1.000000');
 assert.equal(unreflectedHolds([hold],{reservedQuantity:'2',reservations:[{key,quantity:'2'}]},[{key:'ZZTEST_WH',reservations:[{key,quantity:'2'}]}]).length,0);
});
