import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword, normalizeKey } from './security.js';
import { applyMigrations } from './migrations.js';

const schema = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  role TEXT NOT NULL CHECK(role IN ('EXECUTIVE','MANAGER','ACCOUNTS','OWNER')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','LOCKED')),
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_code TEXT UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  gstin TEXT COLLATE NOCASE,
  pan TEXT COLLATE NOCASE,
  credit_limit REAL NOT NULL DEFAULT 0 CHECK(credit_limit >= 0),
  credit_days INTEGER NOT NULL DEFAULT 0 CHECK(credit_days >= 0),
  owner_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','ON_HOLD')),
  billing_address TEXT,
  shipping_address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  notes TEXT,
  tally_guid TEXT UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_gstin_unique ON customers(gstin) WHERE gstin IS NOT NULL AND gstin <> '';

CREATE TABLE IF NOT EXISTS customer_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  name TEXT NOT NULL,
  designation TEXT,
  phone TEXT,
  email TEXT COLLATE NOCASE,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL,
  brand TEXT,
  hsn TEXT,
  uom TEXT NOT NULL,
  pack_size REAL NOT NULL DEFAULT 1 CHECK(pack_size > 0),
  alternate_codes TEXT NOT NULL DEFAULT '[]',
  superseded_codes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','SUPERSEDED')),
  tally_guid TEXT UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enquiry_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  subject TEXT NOT NULL,
  source TEXT,
  expected_by TEXT,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','QUALIFIED','QUOTED','WON','LOST','CANCELLED')),
  assigned_to INTEGER REFERENCES users(id),
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS enquiry_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enquiry_id INTEGER NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id),
  description TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity > 0),
  target_price REAL CHECK(target_price IS NULL OR target_price >= 0),
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS quotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
  enquiry_id INTEGER REFERENCES enquiries(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED','CANCELLED')),
  notes TEXT,
  terms TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quotation_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id),
  description TEXT NOT NULL,
  uom TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  discount_percent REAL NOT NULL DEFAULT 0 CHECK(discount_percent >= 0 AND discount_percent <= 100),
  tax_percent REAL NOT NULL DEFAULT 18 CHECK(tax_percent >= 0 AND tax_percent <= 100),
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS enquiry_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enquiry_id INTEGER NOT NULL REFERENCES enquiries(id),
  revision_number INTEGER NOT NULL CHECK(revision_number > 0),
  snapshot_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(enquiry_id, revision_number)
);

CREATE TABLE IF NOT EXISTS quotation_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quotation_id INTEGER NOT NULL REFERENCES quotations(id),
  revision_number INTEGER NOT NULL CHECK(revision_number > 0),
  snapshot_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(quotation_id, revision_number)
);

CREATE TABLE IF NOT EXISTS sales_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
  quotation_id INTEGER NOT NULL UNIQUE REFERENCES quotations(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  customer_po_number TEXT,
  customer_po_date TEXT,
  promised_date TEXT,
  status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK(status IN ('CONFIRMED','PROCESSING','PARTIALLY_DISPATCHED','DISPATCHED','COMPLETED','CANCELLED')),
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  updated_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sales_order_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  item_id INTEGER REFERENCES items(id),
  description TEXT NOT NULL,
  uom TEXT NOT NULL,
  ordered_quantity REAL NOT NULL CHECK(ordered_quantity > 0),
  fulfilled_quantity REAL NOT NULL DEFAULT 0 CHECK(fulfilled_quantity >= 0 AND fulfilled_quantity <= ordered_quantity),
  unit_price REAL NOT NULL CHECK(unit_price >= 0),
  discount_percent REAL NOT NULL DEFAULT 0 CHECK(discount_percent >= 0 AND discount_percent <= 100),
  tax_percent REAL NOT NULL DEFAULT 18 CHECK(tax_percent >= 0 AND tax_percent <= 100),
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tally_sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','RETRY_SCHEDULED')),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  started_by INTEGER REFERENCES users(id),
  started_at TEXT,
  completed_at TEXT,
  next_retry_at TEXT,
  error_message TEXT,
  customer_count INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tally_customers (
  guid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  gstin TEXT,
  pan TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tally_items (
  guid TEXT PRIMARY KEY,
  part_code TEXT NOT NULL,
  description TEXT,
  brand TEXT,
  hsn TEXT,
  uom TEXT,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  entity TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS customers_search ON customers(normalized_name, status);
CREATE INDEX IF NOT EXISTS contacts_phone ON customer_contacts(phone);
CREATE INDEX IF NOT EXISTS contacts_email ON customer_contacts(email);
CREATE INDEX IF NOT EXISTS items_search ON items(part_code, brand, status);
CREATE INDEX IF NOT EXISTS enquiries_customer_status ON enquiries(customer_id, status, updated_at);
CREATE INDEX IF NOT EXISTS enquiry_lines_enquiry ON enquiry_lines(enquiry_id, position);
CREATE INDEX IF NOT EXISTS quotations_customer_status ON quotations(customer_id, status, updated_at);
CREATE INDEX IF NOT EXISTS quotation_lines_quotation ON quotation_lines(quotation_id, position);
CREATE INDEX IF NOT EXISTS enquiry_revisions_document ON enquiry_revisions(enquiry_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS quotation_revisions_document ON quotation_revisions(quotation_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS sales_orders_customer_status ON sales_orders(customer_id, status, updated_at);
CREATE INDEX IF NOT EXISTS sales_order_lines_order ON sales_order_lines(sales_order_id, position);
CREATE INDEX IF NOT EXISTS audit_entity_record ON audit_logs(entity, record_id, created_at);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

CREATE TRIGGER IF NOT EXISTS audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'Audit logs are immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'Audit logs are immutable'); END;
CREATE TRIGGER IF NOT EXISTS enquiry_revisions_no_update BEFORE UPDATE ON enquiry_revisions
BEGIN SELECT RAISE(ABORT, 'Enquiry revisions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS enquiry_revisions_no_delete BEFORE DELETE ON enquiry_revisions
BEGIN SELECT RAISE(ABORT, 'Enquiry revisions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS quotation_revisions_no_update BEFORE UPDATE ON quotation_revisions
BEGIN SELECT RAISE(ABORT, 'Quotation revisions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS quotation_revisions_no_delete BEFORE DELETE ON quotation_revisions
BEGIN SELECT RAISE(ABORT, 'Quotation revisions are immutable'); END;
`;

export function openDatabase(config) {
  if (config.databasePath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(config.databasePath)), { recursive: true });
  const db = new DatabaseSync(config.databasePath);
  try {
    db.exec(schema);
    applyMigrations(db);
    seedOwner(db, config);
    backfillDocumentRevisions(db);
    db.exec('PRAGMA optimize');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function seedOwner(db, config) {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count) return;
  db.prepare(`INSERT INTO users (name,email,role,status,password_hash,must_change_password)
              VALUES (?,?,?,?,?,1)`).run('System Owner', config.seedOwnerEmail.toLowerCase(), 'OWNER', 'ACTIVE', hashPassword(config.seedOwnerPassword));
}

export function writeAudit(db, { userId, entity, recordId, action, oldValue = null, newValue = null, reason = null, ipAddress = null }) {
  db.prepare(`INSERT INTO audit_logs(user_id,entity,record_id,action,old_value,new_value,reason,ip_address)
              VALUES(?,?,?,?,?,?,?,?)`).run(userId ?? null, entity, String(recordId), action,
    oldValue == null ? null : JSON.stringify(oldValue), newValue == null ? null : JSON.stringify(newValue), reason, ipAddress);
}

export function customerView(db, id) {
  const customer = db.prepare(`SELECT c.*, u.name AS owner_name FROM customers c LEFT JOIN users u ON u.id=c.owner_id WHERE c.id=?`).get(id);
  if (!customer) return null;
  customer.contacts = db.prepare('SELECT id,name,designation,phone,email,is_primary FROM customer_contacts WHERE customer_id=? ORDER BY is_primary DESC,id').all(id);
  return customer;
}

export function replaceContacts(db, customerId, contacts = []) {
  db.prepare('DELETE FROM customer_contacts WHERE customer_id=?').run(customerId);
  const add = db.prepare(`INSERT INTO customer_contacts(customer_id,name,designation,phone,email,is_primary) VALUES(?,?,?,?,?,?)`);
  for (const contact of contacts) add.run(customerId, contact.name, contact.designation || null, contact.phone || null, contact.email?.toLowerCase() || null, contact.isPrimary ? 1 : 0);
}

export function enquiryView(db, id) {
  const row = db.prepare(`SELECT e.*,c.name AS customer_name,u.name AS assigned_name
    FROM enquiries e JOIN customers c ON c.id=e.customer_id LEFT JOIN users u ON u.id=e.assigned_to WHERE e.id=?`).get(id);
  if (!row) return null;
  row.lines = db.prepare(`SELECT l.*,i.part_code,i.uom FROM enquiry_lines l LEFT JOIN items i ON i.id=l.item_id
    WHERE l.enquiry_id=? ORDER BY l.position,l.id`).all(id);
  return row;
}

export function quotationView(db, id) {
  const row = db.prepare(`SELECT q.*,c.name AS customer_name,e.enquiry_number,
    (SELECT MAX(revision_number) FROM quotation_revisions qr WHERE qr.quotation_id=q.id) AS revision_number,
    (SELECT email FROM customer_contacts cc WHERE cc.customer_id=c.id ORDER BY cc.is_primary DESC,cc.id LIMIT 1) AS contact_email
    FROM quotations q JOIN customers c ON c.id=q.customer_id LEFT JOIN enquiries e ON e.id=q.enquiry_id WHERE q.id=?`).get(id);
  if (!row) return null;
  row.lines = db.prepare(`SELECT l.*,i.part_code FROM quotation_lines l LEFT JOIN items i ON i.id=l.item_id
    WHERE l.quotation_id=? ORDER BY l.position,l.id`).all(id);
  row.subtotal = row.lines.reduce((sum, line) => sum + line.quantity * line.unit_price * (1 - line.discount_percent / 100), 0);
  row.tax_total = row.lines.reduce((sum, line) => { const base=line.quantity*line.unit_price*(1-line.discount_percent/100); return sum+base*line.tax_percent/100; }, 0);
  row.total = row.subtotal + row.tax_total;
  return row;
}

export function recordEnquiryRevision(db, enquiryId, userId, reason) {
  const snapshot=enquiryView(db,enquiryId); if(!snapshot) throw new Error('Enquiry not found for revision.');
  const revision=Number(db.prepare('SELECT COALESCE(MAX(revision_number),0)+1 AS n FROM enquiry_revisions WHERE enquiry_id=?').get(enquiryId).n);
  db.prepare('INSERT INTO enquiry_revisions(enquiry_id,revision_number,snapshot_json,reason,created_by) VALUES(?,?,?,?,?)').run(enquiryId,revision,JSON.stringify(snapshot),reason,userId);
  return revision;
}

export function recordQuotationRevision(db, quotationId, userId, reason) {
  const snapshot=quotationView(db,quotationId); if(!snapshot) throw new Error('Quotation not found for revision.');
  const revision=Number(db.prepare('SELECT COALESCE(MAX(revision_number),0)+1 AS n FROM quotation_revisions WHERE quotation_id=?').get(quotationId).n);
  db.prepare('INSERT INTO quotation_revisions(quotation_id,revision_number,snapshot_json,reason,created_by) VALUES(?,?,?,?,?)').run(quotationId,revision,JSON.stringify(snapshot),reason,userId);
  return revision;
}

export function enquiryRevisions(db, enquiryId) {
  return db.prepare(`SELECT r.id,r.revision_number,r.snapshot_json,r.reason,r.created_at,u.name AS created_by_name
    FROM enquiry_revisions r JOIN users u ON u.id=r.created_by WHERE r.enquiry_id=? ORDER BY r.revision_number DESC`).all(enquiryId).map(row=>({...row,snapshot:JSON.parse(row.snapshot_json),snapshot_json:undefined}));
}

export function quotationRevisions(db, quotationId) {
  return db.prepare(`SELECT r.id,r.revision_number,r.snapshot_json,r.reason,r.created_at,u.name AS created_by_name
    FROM quotation_revisions r JOIN users u ON u.id=r.created_by WHERE r.quotation_id=? ORDER BY r.revision_number DESC`).all(quotationId).map(row=>({...row,snapshot:JSON.parse(row.snapshot_json),snapshot_json:undefined}));
}

function backfillDocumentRevisions(db) {
  const enquiries=db.prepare('SELECT id,created_by FROM enquiries WHERE NOT EXISTS(SELECT 1 FROM enquiry_revisions r WHERE r.enquiry_id=enquiries.id)').all();
  for(const row of enquiries)recordEnquiryRevision(db,row.id,row.created_by,'Initial version (backfilled)');
  const quotations=db.prepare('SELECT id,created_by FROM quotations WHERE NOT EXISTS(SELECT 1 FROM quotation_revisions r WHERE r.quotation_id=quotations.id)').all();
  for(const row of quotations)recordQuotationRevision(db,row.id,row.created_by,'Initial version (backfilled)');
}

export function salesOrderView(db, id) {
  const row = db.prepare(`SELECT o.*,c.name AS customer_name,q.quotation_number
    FROM sales_orders o JOIN customers c ON c.id=o.customer_id JOIN quotations q ON q.id=o.quotation_id WHERE o.id=?`).get(id);
  if (!row) return null;
  row.lines = db.prepare(`SELECT l.*,i.part_code FROM sales_order_lines l LEFT JOIN items i ON i.id=l.item_id
    WHERE l.sales_order_id=? ORDER BY l.position,l.id`).all(id);
  row.subtotal = row.lines.reduce((sum,line)=>sum+line.ordered_quantity*line.unit_price*(1-line.discount_percent/100),0);
  row.tax_total = row.lines.reduce((sum,line)=>{const base=line.ordered_quantity*line.unit_price*(1-line.discount_percent/100);return sum+base*line.tax_percent/100;},0);
  row.total = row.subtotal + row.tax_total;
  return row;
}

export function detectCustomerDuplicates(db, input, excludeId = null) {
  const conditions = [];
  const params = [];
  const add = (sql, value) => { if (value) { conditions.push(sql); params.push(value); } };
  add('UPPER(REPLACE(c.gstin,\' \',\'\'))=?', normalizeKey(input.gstin));
  add('UPPER(REPLACE(c.pan,\' \',\'\'))=?', normalizeKey(input.pan));
  add('c.normalized_name=?', normalizeKey(input.name));
  const phones = (input.contacts ?? []).map((x) => normalizeKey(x.phone)).filter(Boolean);
  const emails = (input.contacts ?? []).map((x) => String(x.email || '').trim().toLowerCase()).filter(Boolean);
  if (phones.length) { conditions.push(`EXISTS(SELECT 1 FROM customer_contacts cc WHERE cc.customer_id=c.id AND REPLACE(REPLACE(REPLACE(REPLACE(cc.phone,' ',''),'-',''),'(',''),')','') IN (${phones.map(() => '?').join(',')}))`); params.push(...phones); }
  if (emails.length) { conditions.push(`EXISTS(SELECT 1 FROM customer_contacts cc WHERE cc.customer_id=c.id AND LOWER(cc.email) IN (${emails.map(() => '?').join(',')}))`); params.push(...emails); }
  if (!conditions.length) return [];
  if (excludeId) { conditions.push('c.id<>?'); params.push(excludeId); }
  const rows = db.prepare(`SELECT c.id,c.customer_code,c.name,c.gstin,c.pan,c.status FROM customers c WHERE (${conditions.slice(0, excludeId ? -1 : undefined).join(' OR ')})${excludeId ? ' AND '+conditions.at(-1) : ''} LIMIT 20`).all(...params);
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
