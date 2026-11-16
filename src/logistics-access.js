import { hasPermission } from './rbac.js';
import { id } from './crm-modules.js';

export const logisticsFail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function logisticsCan(user, permission) { if (!hasPermission(user, permission)) logisticsFail(403, 'Logistics permission required.'); }
export async function requireLogisticsOrder(db, orderId, user, lock = false) {
  logisticsCan(user, 'logistics.read');
  const order = await db.prepare(`SELECT w.sales_order_id AS id,w.version,w.status,w.public_snapshot FROM crm_order_workflows w WHERE w.sales_order_id=?${lock ? ' FOR UPDATE' : ''}`).get(id(orderId));
  if (!order) logisticsFail(404, 'Order not found.');
  if (!hasPermission(user, 'logistics.orders.read')) {
    logisticsCan(user, 'logistics.orders.assigned');
    const assignment = await db.prepare(`SELECT id FROM logistics_order_assignments WHERE sales_order_id=? AND user_id=? AND status='ACTIVE'${lock ? ' FOR UPDATE' : ''}`).get(order.id, user.id);
    if (!assignment) logisticsFail(404, 'Assigned order not found.');
  }
  return order;
}
export const operationalLine = line => ({ id: line.id, itemId: line.itemId, lineKey: line.lineKey, poLineKey: line.poLineKey,
  partCode: line.partCode, actualPartCode: line.actualPartCode, description: line.description, uom: line.uom,
  quantity: line.quantity, received: line.received, accepted: line.accepted, rejected: line.rejected,
  ordered: line.ordered, previousAccepted: line.previousAccepted, cumulativeAccepted: line.cumulativeAccepted, remaining: line.remaining });
export function operationalGrn(grn) {
  return { id: grn.id, number: grn.number, version: grn.version, status: grn.status, supplierPoId: grn.supplier_po_id,
    receivedDate: grn.payload.receivedDate, reference: grn.payload.reference, lines: grn.payload.lines.map(operationalLine) };
}
export async function logisticsOrderDetail(db, orderId, user) {
  const order = await requireLogisticsOrder(db, orderId, user), s = order.public_snapshot;
  const fulfilled = await db.prepare('SELECT id,fulfilled_quantity::text AS quantity FROM sales_order_lines WHERE sales_order_id=? AND NOT is_deleted').all(order.id);
  return { id: order.id, version: order.version, status: order.status, orderNumber: s.order_number,
    customerName: s.customer_name, poNumber: s.poNumber, promisedDate: s.promisedDate,
    lines: s.lines.map(l => ({ ...operationalLine(l), fulfilledQuantity: fulfilled.find(f => f.id === l.id)?.quantity ?? '0' })),
    shipments: await db.prepare('SELECT id,status,vehicle_number,lr_number,transporter FROM crm_shipments WHERE sales_order_id=? ORDER BY id DESC').all(order.id),
    grns: await db.prepare('SELECT g.id,g.number,g.version,g.status FROM crm_grns g JOIN crm_supplier_pos p ON p.id=g.supplier_po_id WHERE p.sales_order_id=? ORDER BY g.id DESC').all(order.id),
    evidence: await db.prepare('SELECT id,kind,grn_id,shipment_id,line_ref,item_code,photo_name,photo_mime,created_by,created_at FROM logistics_evidence WHERE sales_order_id=? ORDER BY id DESC').all(order.id),
    ...(hasPermission(user,'logistics.assignment.manage')?{assignments:await db.prepare('SELECT a.user_id,a.status,u.name FROM logistics_order_assignments a JOIN users u ON u.id=a.user_id WHERE a.sales_order_id=? ORDER BY a.id').all(order.id)}:{}) };
}
