import { hashPassword, normalizeKey } from './security.js';
import { createDatabase } from './postgres.js';
import { applyMigrations } from './migrations.js';

export async function openDatabase(config) {
  const db = createDatabase(config);
  try {
    await applyMigrations(db.sql);
    await db.withConnection(async () => {
      await db.exec('BEGIN');
      try {
        await db.exec('LOCK TABLE users IN EXCLUSIVE MODE');
        await seedOwner(db, config);
        await backfillDocumentRevisions(db);
        await db.exec('COMMIT');
      } catch (error) { await db.exec('ROLLBACK'); throw error; }
    });
    return db;
  } catch (error) { await db.close(); throw error; }
}

async function seedOwner(db, config) {
  const count = (await db.prepare('SELECT COUNT(*) AS count FROM users').get()).count;
  if (count) return;
  (await db.prepare(`INSERT INTO users (name,email,role,status,password_hash,must_change_password)
              VALUES (?,?,?,?,?,1)`).run('System Owner', config.seedOwnerEmail.toLowerCase(), 'OWNER', 'ACTIVE', hashPassword(config.seedOwnerPassword)));
}

export async function writeAudit(db, { userId, entity, recordId, action, oldValue = null, newValue = null, reason = null, ipAddress = null }) {
  (await db.prepare(`INSERT INTO audit_logs(user_id,entity,record_id,action,old_value,new_value,reason,ip_address)
              VALUES(?,?,?,?,?,?,?,?)`).run(userId ?? null, entity, String(recordId), action,
    oldValue == null ? null : JSON.stringify(oldValue), newValue == null ? null : JSON.stringify(newValue), reason, ipAddress));
}

export async function customerView(db, id) {
  const customer = (await db.prepare(`SELECT c.*, u.name AS owner_name FROM customers c LEFT JOIN users u ON u.id=c.owner_id WHERE c.id=?`).get(id));
  if (!customer) return null;
  customer.contacts = (await db.prepare('SELECT id,name,designation,phone,email,is_primary FROM customer_contacts WHERE customer_id=? AND NOT is_deleted ORDER BY is_primary DESC,id').all(id));
  return customer;
}

export async function replaceContacts(db, customerId, contacts = []) {
  const old=await db.prepare('SELECT * FROM customer_contacts WHERE customer_id=? AND NOT is_deleted').all(customerId);
  const actor=(await db.prepare('SELECT updated_by FROM customers WHERE id=?').get(customerId)).updated_by;
  await db.prepare("UPDATE customer_contacts SET status='ARCHIVED',is_deleted=true,updated_at=now() WHERE customer_id=? AND NOT is_deleted").run(customerId);
  for(const row of old)await writeAudit(db,{userId:actor,entity:'CUSTOMER_CONTACT',recordId:row.id,action:'ARCHIVE',oldValue:row,newValue:{...row,status:'ARCHIVED',is_deleted:true},reason:'Contact list revised through existing customer route'});
  const add = db.prepare(`INSERT INTO customer_contacts(customer_id,name,designation,phone,email,is_primary) VALUES(?,?,?,?,?,?)`);
  for (const contact of contacts) {const result=await add.run(customerId, contact.name, contact.designation || null, contact.phone || null, contact.email?.toLowerCase() || null, (contact.isPrimary ?? contact.is_primary) ? 1 : 0);await writeAudit(db,{userId:actor,entity:'CUSTOMER_CONTACT',recordId:result.insertedId,action:'CREATE',newValue:contact,reason:'Contact list revised through existing customer route'});}
}

export async function enquiryView(db, id) {
  const row = (await db.prepare(`SELECT e.*,c.name AS customer_name,u.name AS assigned_name
    FROM enquiries e JOIN customers c ON c.id=e.customer_id LEFT JOIN users u ON u.id=e.assigned_to WHERE e.id=?`).get(id));
  if (!row) return null;
  row.lines = (await db.prepare(`SELECT l.*,i.part_code,i.uom FROM enquiry_lines l LEFT JOIN items i ON i.id=l.item_id
    WHERE l.enquiry_id=? AND NOT l.is_deleted ORDER BY l.position,l.id`).all(id));
  return row;
}

export async function quotationView(db, id) {
  const row = (await db.prepare(`SELECT q.*,c.name AS customer_name,e.enquiry_number,
    (SELECT MAX(revision_number) FROM quotation_revisions qr WHERE qr.quotation_id=q.id) AS revision_number,
    (SELECT email FROM customer_contacts cc WHERE cc.customer_id=c.id AND NOT cc.is_deleted ORDER BY cc.is_primary DESC,cc.id LIMIT 1) AS contact_email
    FROM quotations q JOIN customers c ON c.id=q.customer_id LEFT JOIN enquiries e ON e.id=q.enquiry_id WHERE q.id=?`).get(id));
  if (!row) return null;
  row.lines = (await db.prepare(`SELECT l.*,i.part_code FROM quotation_lines l LEFT JOIN items i ON i.id=l.item_id
    WHERE l.quotation_id=? AND NOT l.is_deleted ORDER BY l.position,l.id`).all(id));
  row.subtotal = row.lines.reduce((sum, line) => sum + line.quantity * line.unit_price * (1 - line.discount_percent / 100), 0);
  row.tax_total = row.lines.reduce((sum, line) => { const base=line.quantity*line.unit_price*(1-line.discount_percent/100); return sum+base*line.tax_percent/100; }, 0);
  row.total = row.subtotal + row.tax_total;
  return row;
}

export async function recordEnquiryRevision(db, enquiryId, userId, reason) {
  const snapshot=(await enquiryView(db,enquiryId)); if(!snapshot) throw new Error('Enquiry not found for revision.');
  const revision=Number((await db.prepare('SELECT COALESCE(MAX(revision_number),0)+1 AS n FROM enquiry_revisions WHERE enquiry_id=?').get(enquiryId)).n);
  (await db.prepare('INSERT INTO enquiry_revisions(enquiry_id,revision_number,snapshot_json,reason,created_by) VALUES(?,?,?,?,?)').run(enquiryId,revision,JSON.stringify(snapshot),reason,userId));
  return revision;
}

export async function recordQuotationRevision(db, quotationId, userId, reason) {
  const snapshot=(await quotationView(db,quotationId)); if(!snapshot) throw new Error('Quotation not found for revision.');
  const revision=Number((await db.prepare('SELECT COALESCE(MAX(revision_number),0)+1 AS n FROM quotation_revisions WHERE quotation_id=?').get(quotationId)).n);
  (await db.prepare('INSERT INTO quotation_revisions(quotation_id,revision_number,snapshot_json,reason,created_by) VALUES(?,?,?,?,?)').run(quotationId,revision,JSON.stringify(snapshot),reason,userId));
  return revision;
}

export async function enquiryRevisions(db, enquiryId) {
  return (await db.prepare(`SELECT r.id,r.revision_number,r.snapshot_json,r.reason,r.created_at,u.name AS created_by_name
    FROM enquiry_revisions r JOIN users u ON u.id=r.created_by WHERE r.enquiry_id=? ORDER BY r.revision_number DESC`).all(enquiryId)).map(row=>({...row,snapshot:JSON.parse(row.snapshot_json),snapshot_json:undefined}));
}

export async function quotationRevisions(db, quotationId) {
  return (await db.prepare(`SELECT r.id,r.revision_number,r.snapshot_json,r.reason,r.created_at,u.name AS created_by_name
    FROM quotation_revisions r JOIN users u ON u.id=r.created_by WHERE r.quotation_id=? ORDER BY r.revision_number DESC`).all(quotationId)).map(row=>({...row,snapshot:JSON.parse(row.snapshot_json),snapshot_json:undefined}));
}

async function backfillDocumentRevisions(db) {
  const enquiries=(await db.prepare('SELECT id,created_by FROM enquiries WHERE NOT EXISTS(SELECT 1 FROM enquiry_revisions r WHERE r.enquiry_id=enquiries.id)').all());
  for(const row of enquiries)(await recordEnquiryRevision(db,row.id,row.created_by,'Initial version (backfilled)'));
  const quotations=(await db.prepare('SELECT id,created_by FROM quotations WHERE NOT EXISTS(SELECT 1 FROM quotation_revisions r WHERE r.quotation_id=quotations.id)').all());
  for(const row of quotations)(await recordQuotationRevision(db,row.id,row.created_by,'Initial version (backfilled)'));
}

export async function salesOrderView(db, id) {
  const row = (await db.prepare(`SELECT o.*,c.name AS customer_name,q.quotation_number
    FROM sales_orders o JOIN customers c ON c.id=o.customer_id LEFT JOIN quotations q ON q.id=o.quotation_id WHERE o.id=?`).get(id));
  if (!row) return null;
  row.lines = (await db.prepare(`SELECT l.*,i.part_code FROM sales_order_lines l LEFT JOIN items i ON i.id=l.item_id
    WHERE l.sales_order_id=? AND NOT l.is_deleted ORDER BY l.position,l.id`).all(id));
  row.subtotal = row.lines.reduce((sum,line)=>sum+line.ordered_quantity*line.unit_price*(1-line.discount_percent/100),0);
  row.tax_total = row.lines.reduce((sum,line)=>{const base=line.ordered_quantity*line.unit_price*(1-line.discount_percent/100);return sum+base*line.tax_percent/100;},0);
  row.total = row.subtotal + row.tax_total;
  return row;
}

export async function detectCustomerDuplicates(db, input, excludeId = null) {
  const conditions = [];
  const params = [];
  const add = (sql, value) => { if (value) { conditions.push(sql); params.push(value); } };
  add('UPPER(REPLACE(c.gstin,\' \',\'\'))=?', normalizeKey(input.gstin));
  add('UPPER(REPLACE(c.pan,\' \',\'\'))=?', normalizeKey(input.pan));
  add('c.normalized_name=?', normalizeKey(input.name));
  const phones = (input.contacts ?? []).map((x) => normalizeKey(x.phone)).filter(Boolean);
  const emails = (input.contacts ?? []).map((x) => String(x.email || '').trim().toLowerCase()).filter(Boolean);
  if (phones.length) { conditions.push(`EXISTS(SELECT 1 FROM customer_contacts cc WHERE cc.customer_id=c.id AND NOT cc.is_deleted AND REPLACE(REPLACE(REPLACE(REPLACE(cc.phone,' ',''),'-',''),'(',''),')','') IN (${phones.map(() => '?').join(',')}))`); params.push(...phones); }
  if (emails.length) { conditions.push(`EXISTS(SELECT 1 FROM customer_contacts cc WHERE cc.customer_id=c.id AND NOT cc.is_deleted AND LOWER(cc.email) IN (${emails.map(() => '?').join(',')}))`); params.push(...emails); }
  if (!conditions.length) return [];
  if (excludeId) { conditions.push('c.id<>?'); params.push(excludeId); }
  const rows = (await db.prepare(`SELECT c.id,c.customer_code,c.name,c.gstin,c.pan,c.status FROM customers c WHERE (${conditions.slice(0, excludeId ? -1 : undefined).join(' OR ')})${excludeId ? ' AND '+conditions.at(-1) : ''} LIMIT 20`).all(...params));
  return rows.map((row) => ({ ...row, matchedFields: duplicateFields(row, input) }));
}

function duplicateFields(row, input) {
  const fields = [];
  if (row.gstin && normalizeKey(row.gstin) === normalizeKey(input.gstin)) fields.push('GSTIN');
  if (row.pan && normalizeKey(row.pan) === normalizeKey(input.pan)) fields.push('PAN');
  if (normalizeKey(row.name) === normalizeKey(input.name)) fields.push('NAME');
  if (!fields.length) fields.push('CONTACT');
  return fields;
}

export function parseJsonArray(value) {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
