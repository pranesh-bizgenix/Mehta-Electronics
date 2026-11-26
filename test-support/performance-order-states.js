import assert from 'node:assert/strict';
import {QUALIFYING_ORDER_SQL} from '../src/modules/billing/performance.js';

// SQL VALUES fixtures shadow the workflow relation for this statement only.
// No CRM records are inserted or changed by this check.
export async function verifyPerformanceOrderStates(db){
 const rows=await db.prepare(`WITH crm_order_workflows(sales_order_id,status,version,approved_version) AS (
 VALUES (1,'DRAFT',1,NULL),(2,'HELD',1,NULL),(3,'APPROVED',2,2),(4,'APPROVED',3,2),
 (5,'PARTIALLY_DISPATCHED',3,3),(6,'DISPATCHED',2,2),(7,'DELIVERED',2,2),(8,'CANCELLED',2,2),(11,'APPROVED',2,2)
 ) SELECT o.id FROM (VALUES
 (1,'CONFIRMED',false),(2,'CONFIRMED',false),(3,'CONFIRMED',false),(4,'CONFIRMED',false),
 (5,'PARTIALLY_DISPATCHED',false),(6,'DISPATCHED',false),(7,'COMPLETED',false),(8,'CANCELLED',false),
 (9,'CONFIRMED',false),(10,'CANCELLED',false),(11,'CONFIRMED',true),(12,'PROCESSING',false)
 ) AS o(id,status,is_deleted) WHERE ${QUALIFYING_ORDER_SQL} ORDER BY o.id`).all();
 assert.deepEqual(rows.map(row=>row.id),[3,5,6,7,9,12]);
}
