import { transaction, id } from './crm-modules.js';
import { writeAudit } from './db.js';
import { hasPermission } from './rbac.js';
import { validateOriginal } from './sales-orders.js';
import { logisticsCan, logisticsFail as fail, requireLogisticsOrder, logisticsOrderDetail, operationalLine, operationalGrn } from './logistics-access.js';

const reason = body => {
  if (typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.length > 2000) fail(422, 'A reason of 3–2000 characters is required.');
  return body.reason.trim();
};
const strict = (body, keys) => { if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(k => !keys.includes(k))) fail(422, 'Only the listed operational fields are permitted.'); };

export async function logisticsOrders(db, url, user) {
  logisticsCan(user, 'logistics.read');
  const all = hasPermission(user, 'logistics.orders.read');
  if (!all) logisticsCan(user, 'logistics.orders.assigned');
  const page = Number(url.searchParams.get('page') || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail(422, 'Invalid page.');
  const scope = all ? '' : " WHERE EXISTS(SELECT 1 FROM logistics_order_assignments a WHERE a.sales_order_id=w.sales_order_id AND a.user_id=? AND a.status='ACTIVE')";
  const args = all ? [] : [user.id];
  const total = (await db.prepare(`SELECT count(*) AS n FROM crm_order_workflows w${scope}`).get(...args)).n;
  const data = await db.prepare(`SELECT w.sales_order_id AS id,w.version,w.status,w.public_snapshot->>'order_number' AS "orderNumber",w.public_snapshot->>'customer_name' AS "customerName",w.public_snapshot->>'poNumber' AS "poNumber" FROM crm_order_workflows w${scope} ORDER BY w.id DESC LIMIT 25 OFFSET ?`).all(...args,(page-1)*25);
  return { data, pagination: { page, pageSize: 25, total, pages: Math.ceil(total/25) } };
}

export async function assignStore(db, orderId, body, user) {
  logisticsCan(user, 'logistics.assignment.manage');
  strict(body, ['userId','active','reason']); const why = reason(body);
  if (typeof body.active !== 'boolean') fail(422, 'Choose active or revoked.');
  return transaction(db, user, why, async () => {
    await requireLogisticsOrder(db, orderId, user, true);
    const target = await db.prepare("SELECT id FROM users WHERE id=? AND role='STORE_STAFF' AND status='ACTIVE'").get(id(body.userId));
    if (!target && body.active) fail(422, 'Choose active Store staff.');
    const old = await db.prepare('SELECT * FROM logistics_order_assignments WHERE sales_order_id=? AND user_id=? FOR UPDATE').get(id(orderId),id(body.userId));
    if (!body.active && !old) fail(404, 'Assignment not found.');
    if (old) await db.prepare('UPDATE logistics_order_assignments SET status=?,reason=?,updated_by=?,updated_at=now() WHERE id=?').run(body.active?'ACTIVE':'ARCHIVED',why,user.id,old.id);
    else await db.prepare('INSERT INTO logistics_order_assignments(sales_order_id,user_id,reason,created_by,updated_by) VALUES(?,?,?,?,?)').run(id(orderId),target.id,why,user.id,user.id);
    const after = await db.prepare('SELECT * FROM logistics_order_assignments WHERE sales_order_id=? AND user_id=?').get(id(orderId),id(body.userId));
    await writeAudit(db,{userId:user.id,entity:'LOGISTICS_ASSIGNMENT',recordId:after.id,action:body.active?'ASSIGN':'ARCHIVE',oldValue:old,newValue:after,reason:why});
    return after;
  });
}

export async function receivingPos(db, user) {
  logisticsCan(user, 'logistics.grn.read');
  return db.prepare("SELECT id,number,status,sales_order_id AS \"orderId\" FROM crm_supplier_pos WHERE status IN ('ISSUED','PARTIALLY_RECEIVED','RECEIVED') ORDER BY id DESC LIMIT 100").all();
}
export async function receivingPo(db, poId, user) {
  logisticsCan(user, 'logistics.grn.read');
  const po = await db.prepare('SELECT id,number,status,sales_order_id,payload FROM crm_supplier_pos WHERE id=?').get(id(poId));
  if (!po) fail(404, 'Supplier PO not found.');
  return { id:po.id,number:po.number,status:po.status,orderId:po.sales_order_id,lines:po.payload.lines.map(operationalLine),
    grns: await db.prepare('SELECT id,number,version,status FROM crm_grns WHERE supplier_po_id=? ORDER BY id DESC').all(po.id) };
}
export async function logisticsGrn(db, grnId, user, lock = false) {
  logisticsCan(user, 'logistics.read');
  const grn = await db.prepare(`SELECT g.*,p.sales_order_id FROM crm_grns g JOIN crm_supplier_pos p ON p.id=g.supplier_po_id WHERE g.id=?${lock?' FOR UPDATE OF g':''}`).get(id(grnId));
  if (!grn) fail(404, 'GRN not found.');
  if (!hasPermission(user, 'logistics.grn.read')) {
    if (!grn.sales_order_id) fail(404, 'Assigned GRN not found.');
    await requireLogisticsOrder(db, grn.sales_order_id, user, lock);
  }
  return { ...operationalGrn(grn), orderId:grn.sales_order_id,
    evidence:await db.prepare('SELECT id,kind,item_code,photo_name,created_by,created_at FROM logistics_evidence WHERE grn_id=? ORDER BY id DESC').all(grn.id) };
}

export async function appendEvidence(db, kind, recordId, body, user) {
  logisticsCan(user, 'logistics.evidence.write');
  strict(body,['version','lineRef','itemCode','photo','shipmentId','reason']);
  if (!['GRN','DISPATCH'].includes(kind)) fail(422, 'Choose GRN or dispatch.');
  if (kind==='GRN' && body.shipmentId != null) fail(422, 'A GRN cannot reference a shipment.');
  const why=reason(body);
  if (typeof body.lineRef !== 'string' || !body.lineRef || body.lineRef.length>200) fail(422,'Select an item line.');
  let code=null,photo=null;
  if (body.itemCode !== undefined) { if(typeof body.itemCode!=='string'||!body.itemCode.trim()||body.itemCode.length>200)fail(422,'Enter an item code of at most 200 characters.');code=body.itemCode.trim(); }
  if (body.photo !== undefined) {
    strict(body.photo,['name','base64']); photo=validateOriginal(body.photo);
    if (!['image/png','image/jpeg'].includes(photo.mime)) fail(422,'Only PNG or JPEG photos are permitted.');
  }
  if (!code && !photo) fail(422,'Provide a photo or item code.');
  return transaction(db,user,why,async()=>{
    const target=kind==='GRN'?await logisticsGrn(db,recordId,user,true):await requireLogisticsOrder(db,recordId,user,true);
    const orderId=kind==='GRN'?target.orderId:target.id;
    if (!orderId) fail(409,'Link the supplier PO to an order before recording store evidence.');
    // Recheck assignment under the same transaction as the evidence insert.
    await requireLogisticsOrder(db,orderId,user,true);
    if(body.version!==target.version)fail(409,'Record changed. Reload before recording evidence.');
    if(['POSTED','CANCELLED','DELIVERED'].includes(target.status))fail(409,'Terminal record evidence is immutable.');
    const lines=kind==='GRN'?target.lines:target.public_snapshot.lines;
    const lineIndex=lines.findIndex(l=>String(kind==='GRN'?l.poLineKey:l.id)===body.lineRef);
    if(lineIndex<0)fail(422,'Item line does not belong to this record.');
    if(body.shipmentId!=null && !await db.prepare("SELECT id FROM crm_shipments WHERE id=? AND sales_order_id=? AND status<>'DELIVERED'").get(id(body.shipmentId),orderId))fail(422,'Select an open shipment belonging to this order.');
    if(kind==='GRN' && code) {
      // Change only the actual received code. JSONB preserves every price/quantity
      // untouched; versioning invalidates an earlier independent review.
      await db.prepare("SELECT set_config('mehta.procurement_write','authorized',true)").get();
      await db.prepare("UPDATE crm_grns SET payload=jsonb_set(payload,?::text[],to_jsonb(?::text)),version=version+1 WHERE id=?")
        .run(['lines',String(lineIndex),'actualPartCode'],code,id(recordId));
    }
    const saved=await db.prepare('INSERT INTO logistics_evidence(sales_order_id,grn_id,shipment_id,kind,line_ref,item_code,photo_name,photo_mime,photo_bytes,photo_sha256,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(orderId,kind==='GRN'?id(recordId):null,body.shipmentId??null,kind,body.lineRef,code,photo?.name??null,photo?.mime??null,photo?.bytes??null,photo?.sha256??null,user.id);
    const data={id:saved.insertedId,orderId,kind,lineRef:body.lineRef,itemCode:code,photoName:photo?.name??null,version:target.version+(kind==='GRN'&&code?1:0)};
    await writeAudit(db,{userId:user.id,entity:'LOGISTICS_EVIDENCE',recordId:data.id,action:'APPEND',oldValue:kind==='GRN'&&code?{itemCode:lines[lineIndex].actualPartCode,version:target.version}:null,newValue:data,reason:why});
    return data;
  });
}
export async function evidencePhoto(db, evidenceId, user) {
  const row=await db.prepare('SELECT sales_order_id,photo_name,photo_mime,photo_bytes FROM logistics_evidence WHERE id=?').get(id(evidenceId));
  if(!row?.photo_bytes)fail(404,'Photo not found.');
  await requireLogisticsOrder(db,row.sales_order_id,user);
  return row;
}
export { logisticsOrderDetail };
