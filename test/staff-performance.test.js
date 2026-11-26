import test from 'node:test';
import assert from 'node:assert/strict';
import {percentage,performanceRow} from '../src/modules/billing/performance.js';
import {reportData} from '../src/modules/billing/reports.js';
test('No activity is unavailable rather than a misleading zero score',()=>assert.equal(percentage('0','0'),'N/A'));
test('Conversion percentages round once at two decimal places',()=>{assert.equal(percentage('1','3'),'33.33%');assert.equal(percentage('2','3'),'66.67%');assert.equal(percentage('5','5'),'100.00%');});
test('Impossible, negative and fractional counts are rejected',()=>{for(const [a,b] of [['2','1'],['-1','2'],['0.1','1'],['x','3']])assert.throws(()=>percentage(a,b));});
test('Unfinished due tasks remain in denominator; independent metrics have no blended score',()=>{const row=performanceRow({quoted_enquiries:'2',enquiries:'5',ordered_quotes:'1',issued_quotes:'2',tasks_on_time:'3',tasks_due:'5'});assert.equal(row.enquiry_conversion,'40.00%');assert.equal(row.order_conversion,'50.00%');assert.equal(row.on_time_tasks,'60.00%');assert.equal(row.score,undefined);});
test('Employees with the same name retain distinct stable report identities',async()=>{
 const empty={staff:'Same staff name',enquiries:'0',quoted_enquiries:'0',issued_quotes:'0',ordered_quotes:'0',tasks_due:'0',tasks_on_time:'0',responded_requests:'0',unanswered_requests:'0',average_response_minutes:'N/A'};
 const db={prepare:()=>({all:async()=>[{...empty,staff_id:'1'},{...empty,staff_id:'2'}]})};
 const report=await reportData(db,{id:1,role:'OWNER'},'staff_performance',{from:'2026-11-01',to:'2026-11-25'});
 assert.deepEqual(report.rows.map(r=>r.staff_id),['1','2']);assert.equal(report.rows[0].enquiry_conversion,'N/A');assert.ok(!report.columns.includes('staff_id'));
});
