import {validate,s} from '../../core/schema.js';
import {fingerprint} from '../../core/runtime.js';
import {conflict} from '../../core/errors.js';
import {packingDispatchQuantities} from './domain.js';
export const packingSourceFingerprint=lines=>fingerprint(lines.map(l=>({id:l.id,itemId:l.itemId??l.item_id,partCode:l.partCode??l.part_code,uom:l.uom,quantity:l.quantity??l.ordered_quantity})).sort((a,b)=>a.id-b.id));
export async function requirePackingDispatch(db,orderId,picked,boxIds){
 const control=await db.prepare('SELECT sales_order_id FROM warehouse_order_controls WHERE sales_order_id=?').get(orderId);if(!control){if(boxIds?.length)throw conflict('Enable order packing checks before selecting boxes.');return [];}
 const ids=validate(s.array(s.uuid(),{min:1,max:100}),boxIds);if(new Set(ids).size!==ids.length)throw conflict('Select each packing box once.');
 await db.prepare("SELECT pg_advisory_xact_lock(73429983),set_config('mehta.warehouse_write','authorized',true)").get();
 const boxes=await db.prepare('SELECT id,status,source_fingerprint FROM packing_boxes WHERE sales_order_id=? AND id=ANY(?::uuid[]) AND NOT is_deleted FOR UPDATE').all(orderId,ids);if(boxes.length!==ids.length)throw conflict('A selected box does not belong to this order.');
 const items=await db.prepare('SELECT box_id,order_line_id,quantity::text AS quantity FROM packing_box_items WHERE box_id=ANY(?::uuid[]) AND NOT is_deleted').all(ids);
 packingDispatchQuantities(boxes,items,picked);
 const row=await db.prepare('SELECT public_snapshot FROM crm_order_workflows WHERE sales_order_id=?').get(orderId),source=packingSourceFingerprint(row.public_snapshot.lines);if(boxes.some(box=>box.source_fingerprint!==source))throw conflict('Order items changed after packing review. Cancel and repack the affected boxes.');return ids;
}
export async function consumePackingDispatch(db,shipmentId,boxIds){
 if(!boxIds.length)return;
 await db.prepare("UPDATE packing_boxes SET status='DISPATCHED',shipment_id=?,version=version+1 WHERE id=ANY(?::uuid[]) AND status='PACKED'").run(shipmentId,boxIds);
 await db.prepare("UPDATE warehouse_allocated_serials SET status='CONSUMED' WHERE status='RESERVED' AND allocation_id IN (SELECT id FROM warehouse_pick_allocations WHERE box_id=ANY(?::uuid[]) AND status='RESERVED')").run(boxIds);
 await db.prepare("UPDATE warehouse_pick_allocations SET status='CONSUMED' WHERE box_id=ANY(?::uuid[]) AND status='RESERVED'").run(boxIds);
}
