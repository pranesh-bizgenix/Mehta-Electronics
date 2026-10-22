import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { customerView, detectCustomerDuplicates, enquiryRevisions, enquiryView, parseJsonArray, quotationRevisions, quotationView, recordEnquiryRevision, recordQuotationRevision, replaceContacts, salesOrderView, writeAudit } from './db.js';
import { hasPermission, permissionsFor, ROLES } from './rbac.js';
import { escapeLike, hashPassword, normalizeKey, normalizeText, parseCookies, randomToken, safeEqual, tokenDigest, validatePassword, verifyPassword } from './security.js';
import { applyConnectorMasterSnapshot, reconcile, runTallySync } from './tally.js';
import { createQuotationPdf } from './quotation-pdf.js';
import { sendQuotationEmail } from './mailer.js';
import { createConnectorStore } from './connector-store.js';
import { importTallySession } from './tally-import.js';
import { tallyMasterList,masterDefinition } from './tally-masters.js';
import { overviewContext,workflowOverview,tallyOverview } from './overview.js';
import { storedTallyRoutes } from './tally-read-routes.js';
import { crmModuleRoutes } from './crm-module-routes.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const JSON_LIMIT = 1024 * 1024;
const loginAttempts = new Map();
const pairingAttempts = new Map();
const PAIRING_ATTEMPT_WINDOW_MS = 10 * 60_000;

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const route = (method, pattern, permission, handler) => ({ method, pattern, permission, handler });
const matchRoute = (pathname, pattern) => {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:([A-Za-z]+)/g, (_, key) => { keys.push(key); return '([^/]+)'; })}$`);
  const match = pathname.match(regex);
  return match ? Object.fromEntries(keys.map((key, i) => [key, decodeURIComponent(match[i + 1])])) : null;
};
const numberId = (value) => { const id = Number(value); if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Invalid record identifier.'); return id; };
const cleanNullable = (value) => normalizeText(value) || null;
const email = (value) => { const v = normalizeText(value).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null; };
const json = (res, status, data, headers = {}) => { const body = JSON.stringify(data); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', ...headers }); res.end(body); };
function assertPairingNotRateLimited(ip) {
  const entry = pairingAttempts.get(ip);
  if (entry && Date.now() - entry.startedAt < PAIRING_ATTEMPT_WINDOW_MS && entry.count >= 10) {
    throw new HttpError(429, 'Too many pairing attempts. Wait 10 minutes before trying again.');
  }
}
function recordPairingFailure(ip) {
  const now = Date.now();
  const entry = pairingAttempts.get(ip);
  if (!entry || now - entry.startedAt >= PAIRING_ATTEMPT_WINDOW_MS) pairingAttempts.set(ip, { startedAt: now, count: 1 });
  else entry.count += 1;
  if (pairingAttempts.size > 5000) {
    for (const [address, attempt] of pairingAttempts) {
      if (now - attempt.startedAt >= PAIRING_ATTEMPT_WINDOW_MS) pairingAttempts.delete(address);
    }
  }
}

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > JSON_LIMIT) throw new HttpError(413, 'Request body too large.'); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Request body must be valid JSON.'); }
}

async function readConnectorJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new HttpError(413, 'Connector request is too large.'); chunks.push(chunk); }
  try {
    const raw = Buffer.concat(chunks);
    const data = req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw, { maxOutputLength: 50 * 1024 * 1024 }) : raw;
    return JSON.parse(data.toString('utf8'));
  } catch { throw new HttpError(400, 'Connector payload is invalid.'); }
}

async function sessionUser(db, req, config) {
  const token = parseCookies(req.headers.cookie).crm_session;
  if (!token) return null;
  const row = (await db.prepare(`SELECT s.id AS session_id,s.csrf_token,s.expires_at,u.id,u.name,u.email,u.phone,u.role,u.status,u.must_change_password
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP`).get(tokenDigest(token)));
  if (!row || row.status !== 'ACTIVE') return null;
  (await db.prepare(`UPDATE sessions SET last_seen_at=CURRENT_TIMESTAMP,expires_at=(CURRENT_TIMESTAMP + (?::integer * INTERVAL '1 minute')) WHERE id=?`).run(String(config.sessionTtlMinutes), row.session_id));
  return row;
}

function validateContact(contact, index) {
  const name = normalizeText(contact?.name);
  const contactEmail = cleanNullable(contact?.email)?.toLowerCase();
  const phone = cleanNullable(contact?.phone)?.replace(/[^0-9]/g, '');
  if (!name) throw new HttpError(422, `Contact ${index + 1} requires a name.`);
  if (contactEmail && !email(contactEmail)) throw new HttpError(422, `Contact ${index + 1} has an invalid email.`);
  if (phone && (phone.length < 7 || phone.length > 15)) throw new HttpError(422, `Contact ${index + 1} has an invalid phone.`);
  return { name, designation: cleanNullable(contact.designation), phone, email: contactEmail, isPrimary: Boolean(contact.isPrimary) };
}

function validateCustomer(body, partial = false) {
  const out = {};
  const required = (key, value) => { if (!partial || key in body) { const v = normalizeText(value); if (!v) throw new HttpError(422, `${key} is required.`); out[key] = v; } };
  required('name', body.name);
  if (!partial || 'customerCode' in body) out.customerCode = cleanNullable(body.customerCode);
  if (!partial || 'gstin' in body) { out.gstin = cleanNullable(body.gstin)?.toUpperCase() ?? null; if (out.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(out.gstin)) throw new HttpError(422, 'GSTIN format is invalid.'); }
  if (!partial || 'pan' in body) { out.pan = cleanNullable(body.pan)?.toUpperCase() ?? null; if (out.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(out.pan)) throw new HttpError(422, 'PAN format is invalid.'); }
  for (const key of ['creditLimit', 'creditDays']) if (!partial || key in body) { const n = Number(body[key] ?? 0); if (!Number.isFinite(n) || n < 0 || (key === 'creditDays' && !Number.isInteger(n))) throw new HttpError(422, `${key} must be a non-negative number.`); out[key] = n; }
  if (!partial || 'ownerId' in body) out.ownerId = body.ownerId ? numberId(body.ownerId) : null;
  if (!partial || 'status' in body) { out.status = body.status || 'ACTIVE'; if (!['ACTIVE', 'INACTIVE', 'ON_HOLD'].includes(out.status)) throw new HttpError(422, 'Invalid customer status.'); }
  for (const key of ['billingAddress', 'shippingAddress', 'city', 'state', 'pincode', 'notes']) if (!partial || key in body) out[key] = cleanNullable(body[key]);
  if (!partial || 'contacts' in body) { if (!Array.isArray(body.contacts)) throw new HttpError(422, 'contacts must be an array.'); out.contacts = body.contacts.map(validateContact); }
  out.reason = cleanNullable(body.reason);
  return out;
}

function validateItem(body, partial = false) {
  const out = {};
  for (const key of ['partCode', 'description', 'uom']) if (!partial || key in body) { const value = normalizeText(body[key]); if (!value) throw new HttpError(422, `${key} is required.`); out[key] = value; }
  for (const key of ['brand', 'hsn']) if (!partial || key in body) out[key] = cleanNullable(body[key]);
  if (!partial || 'packSize' in body) { const value = Number(body.packSize ?? 1); if (!Number.isFinite(value) || value <= 0) throw new HttpError(422, 'packSize must be greater than zero.'); out.packSize = value; }
  for (const key of ['alternateCodes', 'supersededCodes']) if (!partial || key in body) { if (!Array.isArray(body[key] ?? [])) throw new HttpError(422, `${key} must be an array.`); out[key] = [...new Set((body[key] ?? []).map(normalizeText).filter(Boolean))]; }
  if (!partial || 'status' in body) { out.status = body.status || 'ACTIVE'; if (!['ACTIVE', 'INACTIVE', 'SUPERSEDED'].includes(out.status)) throw new HttpError(422, 'Invalid item status.'); }
  out.reason = cleanNullable(body.reason);
  return out;
}

const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
function validateEnquiry(body) {
  const customerId=numberId(body.customerId); const subject=normalizeText(body.subject); if(!subject) throw new HttpError(422,'subject is required.');
  const lines=Array.isArray(body.lines)?body.lines:[]; if(!lines.length) throw new HttpError(422,'At least one enquiry line is required.');
  return {customerId,subject,source:cleanNullable(body.source),expectedBy:body.expectedBy||null,assignedTo:body.assignedTo?numberId(body.assignedTo):undefined,notes:cleanNullable(body.notes),lines:lines.map((line,index)=>{const description=normalizeText(line.description);const quantity=Number(line.quantity);const targetPrice=line.targetPrice==null||line.targetPrice===''?null:Number(line.targetPrice);if(!description||!Number.isFinite(quantity)||quantity<=0||targetPrice!=null&&(!Number.isFinite(targetPrice)||targetPrice<0))throw new HttpError(422,`Invalid enquiry line ${index+1}.`);return {itemId:line.itemId?numberId(line.itemId):null,description,quantity,targetPrice};})};
}
function validateQuotation(body) {
  const customerId=numberId(body.customerId); if(!validDate(body.validUntil)) throw new HttpError(422,'A valid quotation expiry date is required.');
  const lines=Array.isArray(body.lines)?body.lines:[]; if(!lines.length) throw new HttpError(422,'At least one quotation line is required.');
  return {customerId,enquiryId:body.enquiryId?numberId(body.enquiryId):null,validUntil:body.validUntil,notes:cleanNullable(body.notes),terms:cleanNullable(body.terms),lines:lines.map((line,index)=>{const description=normalizeText(line.description);const uom=normalizeText(line.uom);const quantity=Number(line.quantity);const unitPrice=Number(line.unitPrice);const discountPercent=Number(line.discountPercent??0);const taxPercent=Number(line.taxPercent??18);if(!description||!uom||![quantity,unitPrice,discountPercent,taxPercent].every(Number.isFinite)||quantity<=0||unitPrice<0||discountPercent<0||discountPercent>100||taxPercent<0||taxPercent>100)throw new HttpError(422,`Invalid quotation line ${index+1}.`);return {itemId:line.itemId?numberId(line.itemId):null,description,uom,quantity,unitPrice,discountPercent,taxPercent};})};
}
async function nextNumber(db, table, prefix) {
  const sequences = { enquiries: 'enquiry_document_numbers', quotations: 'quotation_document_numbers', sales_orders: 'order_document_numbers' };
  if (!sequences[table]) throw new Error('Unsupported document type.');
  const { n } = await db.prepare('SELECT nextval(?::regclass) AS n').get(sequences[table]);
  return `${prefix}-${new Date().getUTCFullYear()}-${String(n).padStart(5,'0')}`;
}
async function assertReferences(db,data){if(!(await db.prepare("SELECT id FROM customers WHERE id=? AND status='ACTIVE'").get(data.customerId)))throw new HttpError(422,'Select an active customer.');if(data.assignedTo&&!(await db.prepare("SELECT id FROM users WHERE id=? AND status='ACTIVE'").get(data.assignedTo)))throw new HttpError(422,'Assigned user is unavailable.');for(const line of data.lines)if(line.itemId&&!(await db.prepare("SELECT id FROM items WHERE id=? AND status='ACTIVE'").get(line.itemId)))throw new HttpError(422,'One or more selected items are unavailable.');}

function pagination(url) {
  const page = Math.max(1, Math.min(100000, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1));
  const pageSize = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('pageSize') || '20', 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, phone: row.phone, role: row.role, status: row.status, primaryPermissions: permissionsFor(row.role), mustChangePassword: Boolean(row.must_change_password), createdAt: row.created_at, updatedAt: row.updated_at };
}

export function createApp({ db, config, fetchImpl = fetch, sendMailImpl = sendQuotationEmail }) {
  const connectorStore = createConnectorStore(config);
  const routes = [
    ...crmModuleRoutes({db,config,route,json,readJson}),
    ...storedTallyRoutes({db,config,route,json,readJson}),
    route('GET','/api/dashboard/tally','dashboard.read',async({res,user,url})=>{
      if(!config.tallyFinancialRoles.includes(user.role))throw new HttpError(403,'Tally financial overview requires an authorized financial role.');
      const context=await overviewContext(db,config,url);
      json(res,200,await tallyOverview(db,context));
    }),
    route('GET','/api/dashboard/quality','dashboard.read',async({res,user,url})=>{
      if(!config.tallyFinancialRoles.includes(user.role))throw new HttpError(403,'Tally financial overview requires an authorized financial role.');
      const context=await overviewContext(db,config,url);
      const args=[context.company?.id||null,context.period?.id||null];
      const warnings=await db.prepare('SELECT message,details FROM tally_import_warnings WHERE company_id=? AND session_id=? ORDER BY warning_key').all(...args);
      const quarantine=await db.prepare('SELECT dataset,record_index,reason FROM tally_import_quarantine WHERE company_id=? AND session_id=? ORDER BY dataset,record_index LIMIT 100').all(...args);
      json(res,200,{warnings,quarantine,parity:'Not checked: bill and report totals are not normalized yet.'});
    }),
    route('GET','/api/tally/companies','authenticated',async({res,user})=>{
      if(!hasPermission(user,'customers.read')&&!hasPermission(user,'items.read'))throw new HttpError(403,'Permission denied.');
      json(res,200,{data:await db.prepare('SELECT id,name FROM tally_companies ORDER BY name').all()});
    }),
    route('GET','/api/tally/masters/:kind','authenticated',async({res,user,params,url})=>{
      const definition=masterDefinition(params.kind);
      if(!definition)throw new HttpError(404,'Unknown Tally dataset.');
      if(!hasPermission(user,definition.permission))throw new HttpError(403,'Permission denied.');
      const companyId=url.searchParams.get('companyId');
      if(companyId&&!/^[0-9a-f-]{36}$/i.test(companyId))throw new HttpError(422,'Invalid company identifier.');
      json(res,200,await tallyMasterList(db,params.kind,url,{financial:config.tallyFinancialRoles.includes(user.role)}));
    }),
    route('GET','/api/tally/masters/:kind/:id','authenticated',async({res,user,params})=>{
      if(!config.tallyFinancialRoles.includes(user.role))throw new HttpError(403,'All-field financial records require an authorized financial role.');
      const definition=masterDefinition(params.kind);
      if(!definition)throw new HttpError(404,'Unknown Tally dataset.');
      const row=await db.prepare(`SELECT name,raw_record,fetched_at FROM ${definition.table} WHERE id=?`).get(params.id);
      if(!row)throw new HttpError(404,'Record not found.');
      json(res,200,{data:row});
    }),
    route('POST', '/api/auth/login', null, async ({ req, res, ip }) => {
      const key = `${ip}:${Date.now() >> 16}`; const count = loginAttempts.get(key) || 0;
      if (count >= 10) throw new HttpError(429, 'Too many login attempts. Try again later.');
      const body = await readJson(req); const loginEmail = email(body.email); const password = String(body.password || '');
      const user = loginEmail ? (await db.prepare('SELECT * FROM users WHERE email=?').get(loginEmail)) : null;
      const locked = user?.locked_until && new Date(user.locked_until) > new Date();
      if (!user || user.status !== 'ACTIVE' || locked || !verifyPassword(password, user.password_hash)) {
        loginAttempts.set(key, count + 1);
        if (user && user.status === 'ACTIVE') (await db.prepare(`UPDATE users SET failed_login_count=failed_login_count+1,locked_until=CASE WHEN failed_login_count>=4 THEN (CURRENT_TIMESTAMP + INTERVAL '15 minutes') ELSE locked_until END WHERE id=?`).run(user.id));
        (await writeAudit(db, { userId: user?.id, entity: 'AUTH', recordId: user?.id || loginEmail || 'unknown', action: 'LOGIN_FAILED', ipAddress: ip }));
        throw new HttpError(401, 'Invalid credentials or account unavailable.');
      }
      db.prepare('DELETE FROM sessions WHERE expires_at<=CURRENT_TIMESTAMP');
      (await db.prepare('UPDATE users SET failed_login_count=0,locked_until=NULL WHERE id=?').run(user.id));
      const token = randomToken(); const csrf = randomToken(24);
      (await db.prepare(`INSERT INTO sessions(user_id,token_hash,csrf_token,ip_address,user_agent,expires_at) VALUES(?,?,?,?,?,(CURRENT_TIMESTAMP + (?::integer * INTERVAL '1 minute')))`).run(user.id, tokenDigest(token), csrf, ip, String(req.headers['user-agent'] || '').slice(0, 500), String(config.sessionTtlMinutes)));
      (await writeAudit(db, { userId: user.id, entity: 'AUTH', recordId: user.id, action: 'LOGIN', ipAddress: ip }));
      const cookie = `crm_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.sessionTtlMinutes * 60}${config.isProduction ? '; Secure' : ''}`;
      json(res, 200, { user: publicUser(user), permissions: permissionsFor(user.role), csrfToken: csrf }, { 'set-cookie': cookie });
    }),
    route('POST', '/api/auth/logout', 'authenticated', async ({ req, res, user, ip }) => {
      const token = parseCookies(req.headers.cookie).crm_session; (await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenDigest(token)));
      (await writeAudit(db, { userId: user.id, entity: 'AUTH', recordId: user.id, action: 'LOGOUT', ipAddress: ip }));
      json(res, 200, { ok: true }, { 'set-cookie': `crm_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.isProduction ? '; Secure' : ''}` });
    }),
    route('GET', '/api/auth/me', 'authenticated', async ({ res, user }) => json(res, 200, { user: publicUser(user), permissions: permissionsFor(user.role), csrfToken: user.csrf_token })),
    route('POST', '/api/auth/change-password', 'authenticated', async ({ req, res, user, ip }) => {
      const body = await readJson(req); const stored = (await db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id));
      if (!verifyPassword(String(body.currentPassword || ''), stored.password_hash)) throw new HttpError(422, 'Current password is incorrect.');
      const error = validatePassword(body.newPassword); if (error) throw new HttpError(422, error);
      (await db.prepare('UPDATE users SET password_hash=?,must_change_password=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hashPassword(body.newPassword), user.id));
      (await db.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').run(user.id, user.session_id));
      (await writeAudit(db, { userId: user.id, entity: 'USER', recordId: user.id, action: 'PASSWORD_CHANGED', ipAddress: ip }));
      json(res, 200, { ok: true });
    }),
    route('GET', '/api/users', 'users.read', async ({ res }) => json(res, 200, { data: (await db.prepare('SELECT id,name,email,phone,role,status,created_at,updated_at FROM users ORDER BY name').all()).map(publicUser) })),
    route('POST', '/api/users', 'users.create', async ({ req, res, user, ip }) => {
      const body = await readJson(req); const name = normalizeText(body.name); const userEmail = email(body.email); const roleName = String(body.role || '').toUpperCase();
      if (!name || !userEmail || !ROLES.includes(roleName)) throw new HttpError(422, 'Valid name, email, and role are required.');
      const passwordError = validatePassword(body.password); if (passwordError) throw new HttpError(422, passwordError);
      try {
        const result = (await db.prepare(`INSERT INTO users(name,email,phone,role,status,password_hash,must_change_password) VALUES(?,?,?,?,?,?,1)`).run(name, userEmail, cleanNullable(body.phone), roleName, body.status || 'ACTIVE', hashPassword(body.password)));
        const created = (await db.prepare('SELECT id,name,email,phone,role,status,created_at,updated_at FROM users WHERE id=?').get(result.insertedId));
        (await writeAudit(db, { userId: user.id, entity: 'USER', recordId: created.id, action: 'CREATE', newValue: publicUser(created), reason: cleanNullable(body.reason), ipAddress: ip }));
        json(res, 201, { data: publicUser(created) });
      } catch (error) { if (error.code === '23505') throw new HttpError(409, 'A user with that email already exists.'); throw error; }
    }),
    route('PATCH', '/api/users/:id', 'users.update', async ({ req, res, params, user, ip }) => {
      const id = numberId(params.id); const old = (await db.prepare('SELECT id,name,email,phone,role,status,created_at,updated_at FROM users WHERE id=?').get(id)); if (!old) throw new HttpError(404, 'User not found.');
      const body = await readJson(req); const name = 'name' in body ? normalizeText(body.name) : old.name; const userEmail = 'email' in body ? email(body.email) : old.email; const roleName = 'role' in body ? String(body.role).toUpperCase() : old.role; const status = body.status || old.status;
      if (!name || !userEmail || !ROLES.includes(roleName) || !['ACTIVE','INACTIVE','LOCKED'].includes(status)) throw new HttpError(422, 'Invalid user fields.');
      if (id === user.id && status !== 'ACTIVE') throw new HttpError(422, 'You cannot deactivate your own account.');
      (await db.prepare('UPDATE users SET name=?,email=?,phone=?,role=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, userEmail, 'phone' in body ? cleanNullable(body.phone) : old.phone, roleName, status, id));
      if (status !== 'ACTIVE') (await db.prepare('DELETE FROM sessions WHERE user_id=?').run(id));
      const updated = (await db.prepare('SELECT id,name,email,phone,role,status,created_at,updated_at FROM users WHERE id=?').get(id));
      (await writeAudit(db, { userId: user.id, entity: 'USER', recordId: id, action: 'UPDATE', oldValue: publicUser(old), newValue: publicUser(updated), reason: cleanNullable(body.reason), ipAddress: ip }));
      json(res, 200, { data: publicUser(updated) });
    }),
    route('POST', '/api/users/:id/reset-password', 'users.update', async ({ req, res, params, user, ip }) => {
      const id = numberId(params.id); const body = await readJson(req); if (!(await db.prepare('SELECT id FROM users WHERE id=?').get(id))) throw new HttpError(404, 'User not found.');
      const error = validatePassword(body.temporaryPassword); if (error) throw new HttpError(422, error);
      (await db.prepare('UPDATE users SET password_hash=?,must_change_password=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hashPassword(body.temporaryPassword), id)); (await db.prepare('DELETE FROM sessions WHERE user_id=?').run(id));
      (await writeAudit(db, { userId: user.id, entity: 'USER', recordId: id, action: 'PASSWORD_RESET', reason: cleanNullable(body.reason), ipAddress: ip })); json(res, 200, { ok: true });
    }),
    route('POST', '/api/customers/duplicates', 'customers.duplicates', async ({ req, res }) => { const body = validateCustomer(await readJson(req), true); json(res, 200, { data: (await detectCustomerDuplicates(db, body, body.excludeId ? numberId(body.excludeId) : null)) }); }),
    route('GET', '/api/customers', 'customers.read', async ({ res, url }) => {
      const { page, pageSize, offset } = pagination(url); const search = normalizeText(url.searchParams.get('search')); const status = normalizeText(url.searchParams.get('status'));
      const where = []; const args = []; if (search) { const q = `%${escapeLike(search)}%`; where.push(`(c.name ILIKE ? ESCAPE '\\' OR c.customer_code ILIKE ? ESCAPE '\\' OR c.gstin ILIKE ? ESCAPE '\\' OR c.pan ILIKE ? ESCAPE '\\')`); args.push(q,q,q,q); } if (status) { where.push('c.status=?'); args.push(status); }
      const filter = where.length ? `WHERE ${where.join(' AND ')}` : ''; const total = (await db.prepare(`SELECT COUNT(*) AS count FROM customers c ${filter}`).get(...args)).count;
      const rows = (await db.prepare(`SELECT c.id,c.customer_code,c.name,c.gstin,c.pan,c.credit_limit,c.credit_days,c.status,c.created_at,c.updated_at,u.name AS owner_name FROM customers c LEFT JOIN users u ON u.id=c.owner_id ${filter} ORDER BY c.updated_at DESC,c.id DESC LIMIT ? OFFSET ?`).all(...args,pageSize,offset));
      json(res, 200, { data: rows, pagination: { page, pageSize, total, pages: Math.ceil(total/pageSize) } });
    }),
    route('POST', '/api/customers', 'customers.create', async ({ req, res, user, ip }) => {
      const body = validateCustomer(await readJson(req)); const duplicates = (await detectCustomerDuplicates(db, body)); if (duplicates.length && !body.reason) throw new HttpError(409, 'Potential duplicate customer found. Review it and provide a reason to proceed.', { duplicates });
      (await db.exec('BEGIN')); try {
        const result = (await db.prepare(`INSERT INTO customers(customer_code,name,normalized_name,gstin,pan,credit_limit,credit_days,owner_id,status,billing_address,shipping_address,city,state,pincode,notes,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(body.customerCode,body.name,normalizeKey(body.name),body.gstin,body.pan,body.creditLimit,body.creditDays,body.ownerId,body.status,body.billingAddress,body.shippingAddress,body.city,body.state,body.pincode,body.notes,user.id,user.id));
        (await replaceContacts(db, result.insertedId, body.contacts)); const created = (await customerView(db, result.insertedId)); (await writeAudit(db, { userId:user.id,entity:'CUSTOMER',recordId:created.id,action:'CREATE',newValue:created,reason:body.reason,ipAddress:ip })); (await db.exec('COMMIT')); json(res,201,{data:created,duplicateWarning:duplicates});
      } catch(error) { (await db.exec('ROLLBACK')); if(error.code === '23505') throw new HttpError(409,'Customer code or GSTIN already exists.'); throw error; }
    }),
    route('GET', '/api/customers/:id', 'customers.read', async ({ res, params }) => { const row=(await customerView(db,numberId(params.id))); if(!row) throw new HttpError(404,'Customer not found.'); json(res,200,{data:row}); }),
    route('PATCH', '/api/customers/:id', 'customers.update', async ({ req,res,params,user,ip }) => {
      const id=numberId(params.id); const old=(await customerView(db,id)); if(!old) throw new HttpError(404,'Customer not found.'); const body=validateCustomer(await readJson(req),true); const merged={...old,...body,contacts:body.contacts??old.contacts}; const duplicates=(await detectCustomerDuplicates(db,merged,id)); if(duplicates.length&&!body.reason) throw new HttpError(409,'Potential duplicate customer found. Review it and provide a reason to proceed.',{duplicates});
      (await db.exec('BEGIN')); try { (await db.prepare(`UPDATE customers SET customer_code=?,name=?,normalized_name=?,gstin=?,pan=?,credit_limit=?,credit_days=?,owner_id=?,status=?,billing_address=?,shipping_address=?,city=?,state=?,pincode=?,notes=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(merged.customerCode??old.customer_code,merged.name,normalizeKey(merged.name),merged.gstin,merged.pan,merged.creditLimit??old.credit_limit,merged.creditDays??old.credit_days,merged.ownerId??old.owner_id,merged.status,merged.billingAddress??old.billing_address,merged.shippingAddress??old.shipping_address,merged.city??old.city,merged.state??old.state,merged.pincode??old.pincode,merged.notes??old.notes,user.id,id)); if(body.contacts) (await replaceContacts(db,id,body.contacts)); const updated=(await customerView(db,id)); (await writeAudit(db,{userId:user.id,entity:'CUSTOMER',recordId:id,action:'UPDATE',oldValue:old,newValue:updated,reason:body.reason,ipAddress:ip})); (await db.exec('COMMIT')); json(res,200,{data:updated,duplicateWarning:duplicates}); } catch(error){(await db.exec('ROLLBACK')); if(error.code === '23505') throw new HttpError(409,'Customer code or GSTIN already exists.'); throw error;}
    }),
    route('GET', '/api/items', 'items.read', async ({ res,url }) => { const {page,pageSize,offset}=pagination(url); const search=normalizeText(url.searchParams.get('search')); const status=normalizeText(url.searchParams.get('status')); const where=[]; const args=[]; if(search){const q=`%${escapeLike(search)}%`;where.push(`(part_code ILIKE ? ESCAPE '\\' OR description ILIKE ? ESCAPE '\\' OR brand ILIKE ? ESCAPE '\\')`);args.push(q,q,q);} if(status){where.push('status=?');args.push(status);} const filter=where.length?`WHERE ${where.join(' AND ')}`:'';const total=(await db.prepare(`SELECT COUNT(*) AS count FROM items ${filter}`).get(...args)).count;const rows=(await db.prepare(`SELECT * FROM items ${filter} ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`).all(...args,pageSize,offset)).map((x)=>({...x,alternate_codes:parseJsonArray(x.alternate_codes),superseded_codes:parseJsonArray(x.superseded_codes)}));json(res,200,{data:rows,pagination:{page,pageSize,total,pages:Math.ceil(total/pageSize)}}); }),
    route('POST', '/api/items', 'items.create', async ({ req,res,user,ip }) => { const b=validateItem(await readJson(req)); try{const r=(await db.prepare(`INSERT INTO items(part_code,description,brand,hsn,uom,pack_size,alternate_codes,superseded_codes,status,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(b.partCode,b.description,b.brand,b.hsn,b.uom,b.packSize,JSON.stringify(b.alternateCodes),JSON.stringify(b.supersededCodes),b.status,user.id,user.id));const created=(await db.prepare('SELECT * FROM items WHERE id=?').get(r.insertedId));(await writeAudit(db,{userId:user.id,entity:'ITEM',recordId:created.id,action:'CREATE',newValue:created,reason:b.reason,ipAddress:ip}));json(res,201,{data:created});}catch(error){if(error.code === '23505')throw new HttpError(409,'Part code already exists.');throw error;} }),
    route('GET', '/api/items/:id', 'items.read', async ({ res,params }) => { const row=(await db.prepare('SELECT * FROM items WHERE id=?').get(numberId(params.id)));if(!row)throw new HttpError(404,'Item not found.');row.alternate_codes=parseJsonArray(row.alternate_codes);row.superseded_codes=parseJsonArray(row.superseded_codes);json(res,200,{data:row}); }),
    route('PATCH', '/api/items/:id', 'items.update', async ({ req,res,params,user,ip }) => { const id=numberId(params.id);const old=(await db.prepare('SELECT * FROM items WHERE id=?').get(id));if(!old)throw new HttpError(404,'Item not found.');const b=validateItem(await readJson(req),true);const v={partCode:b.partCode??old.part_code,description:b.description??old.description,brand:'brand'in b?b.brand:old.brand,hsn:'hsn'in b?b.hsn:old.hsn,uom:b.uom??old.uom,packSize:b.packSize??old.pack_size,alternateCodes:b.alternateCodes??parseJsonArray(old.alternate_codes),supersededCodes:b.supersededCodes??parseJsonArray(old.superseded_codes),status:b.status??old.status};try{(await db.prepare(`UPDATE items SET part_code=?,description=?,brand=?,hsn=?,uom=?,pack_size=?,alternate_codes=?,superseded_codes=?,status=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(v.partCode,v.description,v.brand,v.hsn,v.uom,v.packSize,JSON.stringify(v.alternateCodes),JSON.stringify(v.supersededCodes),v.status,user.id,id));const updated=(await db.prepare('SELECT * FROM items WHERE id=?').get(id));(await writeAudit(db,{userId:user.id,entity:'ITEM',recordId:id,action:'UPDATE',oldValue:old,newValue:updated,reason:b.reason,ipAddress:ip}));json(res,200,{data:updated});}catch(error){if(error.code === '23505')throw new HttpError(409,'Part code already exists.');throw error;} }),
    route('GET', '/api/enquiries', 'enquiries.read', async ({ res,url }) => { const {page,pageSize,offset}=pagination(url);const search=normalizeText(url.searchParams.get('search'));const statusFilter=normalizeText(url.searchParams.get('status'));const where=[];const args=[];if(search){const q=`%${escapeLike(search)}%`;where.push(`(e.enquiry_number ILIKE ? ESCAPE '\\' OR e.subject ILIKE ? ESCAPE '\\' OR c.name ILIKE ? ESCAPE '\\')`);args.push(q,q,q);}if(statusFilter){where.push('e.status=?');args.push(statusFilter);}const filter=where.length?`WHERE ${where.join(' AND ')}`:'';const total=(await db.prepare(`SELECT COUNT(*) AS n FROM enquiries e JOIN customers c ON c.id=e.customer_id ${filter}`).get(...args)).n;const rows=(await db.prepare(`SELECT e.id,e.enquiry_number,e.subject,e.expected_by,e.status,e.updated_at,c.name AS customer_name,u.name AS assigned_name,(SELECT COUNT(*) FROM enquiry_lines l WHERE l.enquiry_id=e.id AND NOT l.is_deleted) AS line_count FROM enquiries e JOIN customers c ON c.id=e.customer_id LEFT JOIN users u ON u.id=e.assigned_to ${filter} ORDER BY e.updated_at DESC,e.id DESC LIMIT ? OFFSET ?`).all(...args,pageSize,offset));json(res,200,{data:rows,pagination:{page,pageSize,total,pages:Math.ceil(total/pageSize)}}); }),
    route('POST', '/api/enquiries', 'enquiries.create', async ({ req,res,user,ip }) => { const b=validateEnquiry(await readJson(req));(await assertReferences(db,b));(await db.exec('BEGIN'));try{const number=(await nextNumber(db,'enquiries','ENQ'));const result=(await db.prepare(`INSERT INTO enquiries(enquiry_number,customer_id,subject,source,expected_by,assigned_to,notes,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?)`).run(number,b.customerId,b.subject,b.source,b.expectedBy,b.assignedTo??user.id,b.notes,user.id,user.id));const add=db.prepare(`INSERT INTO enquiry_lines(enquiry_id,item_id,description,quantity,target_price,position) VALUES(?,?,?,?,?,?)`);(await Promise.all(b.lines.map(async (line,index)=>(await add.run(result.insertedId,line.itemId,line.description,line.quantity,line.targetPrice,index)))));(await recordEnquiryRevision(db,result.insertedId,user.id,'Initial version'));const created=(await enquiryView(db,result.insertedId));(await writeAudit(db,{userId:user.id,entity:'ENQUIRY',recordId:created.id,action:'CREATE',newValue:created,ipAddress:ip}));(await db.exec('COMMIT'));json(res,201,{data:created});}catch(error){(await db.exec('ROLLBACK'));throw error;} }),
    route('GET', '/api/enquiries/:id', 'enquiries.read', async ({ res,params }) => {const row=(await enquiryView(db,numberId(params.id)));if(!row)throw new HttpError(404,'Enquiry not found.');json(res,200,{data:row});}),
    route('GET', '/api/enquiries/:id/revisions', 'enquiries.read', async ({ res,params }) => {const id=numberId(params.id);if(!(await enquiryView(db,id)))throw new HttpError(404,'Enquiry not found.');json(res,200,{data:(await enquiryRevisions(db,id))});}),
    route('PUT', '/api/enquiries/:id', 'enquiries.update', async ({ req,res,params,user,ip }) => {const id=numberId(params.id);const old=(await enquiryView(db,id));if(!old)throw new HttpError(404,'Enquiry not found.');if(!['NEW','QUALIFIED'].includes(old.status))throw new HttpError(422,'Only new or qualified enquiries can be edited.');const raw=await readJson(req);const reason=normalizeText(raw.reason);if(reason.length<3)throw new HttpError(422,'A revision reason is required.');const b=validateEnquiry(raw);(await assertReferences(db,b));(await db.exec('BEGIN'));try{(await db.prepare(`UPDATE enquiries SET customer_id=?,subject=?,source=?,expected_by=?,assigned_to=?,notes=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(b.customerId,b.subject,b.source,b.expectedBy,b.assignedTo??old.assigned_to,b.notes,user.id,id));(await db.prepare("UPDATE enquiry_lines SET status='ARCHIVED',is_deleted=true,updated_at=now() WHERE enquiry_id=? AND NOT is_deleted").run(id));const add=db.prepare(`INSERT INTO enquiry_lines(enquiry_id,item_id,description,quantity,target_price,position) VALUES(?,?,?,?,?,?)`);(await Promise.all(b.lines.map(async (line,index)=>(await add.run(id,line.itemId,line.description,line.quantity,line.targetPrice,index)))));const revision=(await recordEnquiryRevision(db,id,user.id,reason));const updated=(await enquiryView(db,id));(await writeAudit(db,{userId:user.id,entity:'ENQUIRY',recordId:id,action:'REVISE',oldValue:old,newValue:updated,reason,ipAddress:ip}));(await db.exec('COMMIT'));json(res,200,{data:updated,revision});}catch(error){(await db.exec('ROLLBACK'));throw error;}}),
    route('PATCH', '/api/enquiries/:id/status', 'enquiries.update', async ({ req,res,params,user,ip }) => {const id=numberId(params.id);const old=(await enquiryView(db,id));if(!old)throw new HttpError(404,'Enquiry not found.');const body=await readJson(req);const next=String(body.status||'').toUpperCase();const transitions={NEW:['QUALIFIED','CANCELLED'],QUALIFIED:['QUOTED','LOST','CANCELLED'],QUOTED:['WON','LOST','CANCELLED'],WON:[],LOST:[],CANCELLED:[]};if(!transitions[old.status].includes(next))throw new HttpError(422,`Cannot move an enquiry from ${old.status} to ${next||'that status'}.`);(await db.prepare(`UPDATE enquiries SET status=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(next,user.id,id));const updated=(await enquiryView(db,id));(await writeAudit(db,{userId:user.id,entity:'ENQUIRY',recordId:id,action:'STATUS_CHANGE',oldValue:{status:old.status},newValue:{status:next},reason:cleanNullable(body.reason),ipAddress:ip}));json(res,200,{data:updated});}),
    route('GET', '/api/quotations', 'quotations.read', async ({ res,url }) => {const {page,pageSize,offset}=pagination(url);const search=normalizeText(url.searchParams.get('search'));const statusFilter=normalizeText(url.searchParams.get('status'));const where=[];const args=[];if(search){const q=`%${escapeLike(search)}%`;where.push(`(q.quotation_number ILIKE ? ESCAPE '\\' OR c.name ILIKE ? ESCAPE '\\')`);args.push(q,q);}if(statusFilter){where.push('q.status=?');args.push(statusFilter);}const filter=where.length?`WHERE ${where.join(' AND ')}`:'';const total=(await db.prepare(`SELECT COUNT(*) AS n FROM quotations q JOIN customers c ON c.id=q.customer_id ${filter}`).get(...args)).n;const rows=(await db.prepare(`SELECT q.id,q.quotation_number,q.valid_until,q.status,q.updated_at,c.name AS customer_name,e.enquiry_number,ROUND(COALESCE(SUM(l.quantity*l.unit_price*(1-l.discount_percent/100)*(1+l.tax_percent/100)),0),2) AS total FROM quotations q JOIN customers c ON c.id=q.customer_id LEFT JOIN enquiries e ON e.id=q.enquiry_id LEFT JOIN quotation_lines l ON l.quotation_id=q.id AND NOT l.is_deleted ${filter} GROUP BY q.id,c.name,e.enquiry_number ORDER BY q.updated_at DESC,q.id DESC LIMIT ? OFFSET ?`).all(...args,pageSize,offset));json(res,200,{data:rows,pagination:{page,pageSize,total,pages:Math.ceil(total/pageSize)}});}),
    route('POST', '/api/quotations', 'quotations.create', async ({ req,res,user,ip }) => {const b=validateQuotation(await readJson(req));(await assertReferences(db,b));if(b.enquiryId){const enquiry=(await enquiryView(db,b.enquiryId));if(!enquiry)throw new HttpError(422,'Enquiry not found.');if(enquiry.customer_id!==b.customerId)throw new HttpError(422,'Quotation customer must match the enquiry.');}(await db.exec('BEGIN'));try{const number=(await nextNumber(db,'quotations','QTN'));const result=(await db.prepare(`INSERT INTO quotations(quotation_number,enquiry_id,customer_id,valid_until,notes,terms,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)`).run(number,b.enquiryId,b.customerId,b.validUntil,b.notes,b.terms,user.id,user.id));const add=db.prepare(`INSERT INTO quotation_lines(quotation_id,item_id,description,uom,quantity,unit_price,discount_percent,tax_percent,position) VALUES(?,?,?,?,?,?,?,?,?)`);(await Promise.all(b.lines.map(async (line,index)=>(await add.run(result.insertedId,line.itemId,line.description,line.uom,line.quantity,line.unitPrice,line.discountPercent,line.taxPercent,index)))));(await recordQuotationRevision(db,result.insertedId,user.id,'Initial version'));const created=(await quotationView(db,result.insertedId));(await writeAudit(db,{userId:user.id,entity:'QUOTATION',recordId:created.id,action:'CREATE',newValue:created,ipAddress:ip}));(await db.exec('COMMIT'));json(res,201,{data:created});}catch(error){(await db.exec('ROLLBACK'));throw error;}}),
    route('GET', '/api/quotations/:id', 'quotations.read', async ({ res,params }) => {const row=(await quotationView(db,numberId(params.id)));if(!row)throw new HttpError(404,'Quotation not found.');json(res,200,{data:row});}),
    route('GET', '/api/quotations/:id/revisions', 'quotations.read', async ({ res,params }) => {const id=numberId(params.id);if(!(await quotationView(db,id)))throw new HttpError(404,'Quotation not found.');json(res,200,{data:(await quotationRevisions(db,id))});}),
    route('PUT', '/api/quotations/:id', 'quotations.update', async ({ req,res,params,user,ip }) => {const id=numberId(params.id);const old=(await quotationView(db,id));if(!old)throw new HttpError(404,'Quotation not found.');if(old.status!=='DRAFT')throw new HttpError(422,'Only draft quotations can be edited.');const raw=await readJson(req);const reason=normalizeText(raw.reason);if(reason.length<3)throw new HttpError(422,'A revision reason is required.');const b=validateQuotation(raw);(await assertReferences(db,b));if(b.enquiryId){const enquiry=(await enquiryView(db,b.enquiryId));if(!enquiry||enquiry.customer_id!==b.customerId)throw new HttpError(422,'Quotation customer must match the enquiry.');}(await db.exec('BEGIN'));try{(await db.prepare(`UPDATE quotations SET enquiry_id=?,customer_id=?,valid_until=?,notes=?,terms=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(b.enquiryId,b.customerId,b.validUntil,b.notes,b.terms,user.id,id));(await db.prepare("UPDATE quotation_lines SET status='ARCHIVED',is_deleted=true WHERE quotation_id=? AND NOT is_deleted").run(id));const add=db.prepare(`INSERT INTO quotation_lines(quotation_id,item_id,description,uom,quantity,unit_price,discount_percent,tax_percent,position) VALUES(?,?,?,?,?,?,?,?,?)`);(await Promise.all(b.lines.map(async (line,index)=>(await add.run(id,line.itemId,line.description,line.uom,line.quantity,line.unitPrice,line.discountPercent,line.taxPercent,index)))));const revision=(await recordQuotationRevision(db,id,user.id,reason));const updated=(await quotationView(db,id));(await writeAudit(db,{userId:user.id,entity:'QUOTATION',recordId:id,action:'REVISE',oldValue:old,newValue:updated,reason,ipAddress:ip}));(await db.exec('COMMIT'));json(res,200,{data:updated,revision});}catch(error){(await db.exec('ROLLBACK'));throw error;}}),
    route('GET', '/api/quotations/:id/pdf', 'quotations.read', async ({ res,params,url }) => {const quote=(await quotationView(db,numberId(params.id)));if(!quote)throw new HttpError(404,'Quotation not found.');const pdf=await createQuotationPdf(config,quote);const mode=url.searchParams.get('download')==='1'?'attachment':'inline';res.writeHead(200,{'content-type':'application/pdf','content-disposition':`${mode}; filename="${quote.quotation_number}.pdf"`,'content-length':pdf.length,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(pdf);}),
    route('POST', '/api/quotations/:id/send-email', 'quotations.send', async ({ req,res,params,user,ip }) => {const id=numberId(params.id);const quote=(await quotationView(db,id));if(!quote)throw new HttpError(404,'Quotation not found.');if(!['DRAFT','SENT'].includes(quote.status))throw new HttpError(422,'Only draft or sent quotations can be emailed.');const body=await readJson(req);const to=email(body.to);if(!to)throw new HttpError(422,'A valid recipient email is required.');const subject=normalizeText(body.subject)||`Quotation ${quote.quotation_number} from ${config.companyName}`;const message=normalizeText(body.message)||`Please find quotation ${quote.quotation_number} attached.`;const pdf=await createQuotationPdf(config,quote);try{await sendMailImpl(config,{quote,to,subject,message,pdf});}catch(error){(await writeAudit(db,{userId:user.id,entity:'QUOTATION',recordId:id,action:'EMAIL_FAILED',newValue:{to,error:String(error.message).slice(0,200)},ipAddress:ip}));throw new HttpError(error.code==='SMTP_NOT_CONFIGURED'?503:502,error.code==='SMTP_NOT_CONFIGURED'?'Email delivery is not configured.':'Quotation email could not be delivered.');}(await db.exec('BEGIN'));try{if(quote.status==='DRAFT'){(await db.prepare(`UPDATE quotations SET status='SENT',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(user.id,id));if(quote.enquiry_id)(await db.prepare(`UPDATE enquiries SET status='QUOTED',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('NEW','QUALIFIED')`).run(user.id,quote.enquiry_id));}(await writeAudit(db,{userId:user.id,entity:'QUOTATION',recordId:id,action:'EMAIL_SENT',newValue:{to,subject},ipAddress:ip}));(await db.exec('COMMIT'));json(res,200,{ok:true,status:'SENT'});}catch(error){(await db.exec('ROLLBACK'));throw error;}}),
    route('PATCH', '/api/quotations/:id/status', 'quotations.status', async ({ req,res,params,user,ip }) => {const id=numberId(params.id);const old=(await quotationView(db,id));if(!old)throw new HttpError(404,'Quotation not found.');const body=await readJson(req);const next=String(body.status||'').toUpperCase();const transitions={DRAFT:['SENT','CANCELLED'],SENT:['ACCEPTED','REJECTED','EXPIRED','CANCELLED'],ACCEPTED:[],REJECTED:[],EXPIRED:[],CANCELLED:[]};if(!transitions[old.status].includes(next))throw new HttpError(422,`Cannot move a quotation from ${old.status} to ${next||'that status'}.`);(await db.exec('BEGIN'));try{(await db.prepare(`UPDATE quotations SET status=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(next,user.id,id));if(next==='SENT'&&old.enquiry_id)(await db.prepare(`UPDATE enquiries SET status='QUOTED',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('NEW','QUALIFIED')`).run(user.id,old.enquiry_id));const updated=(await quotationView(db,id));(await writeAudit(db,{userId:user.id,entity:'QUOTATION',recordId:id,action:'STATUS_CHANGE',oldValue:{status:old.status},newValue:{status:next},reason:cleanNullable(body.reason),ipAddress:ip}));(await db.exec('COMMIT'));json(res,200,{data:updated});}catch(error){(await db.exec('ROLLBACK'));throw error;}}),
    route('POST', '/api/quotations/:id/convert-to-order', 'orders.create', async ({ req,res,params,user,ip }) => {const quotation=(await quotationView(db,numberId(params.id)));if(!quotation)throw new HttpError(404,'Quotation not found.');if(quotation.status!=='ACCEPTED')throw new HttpError(422,'Only an accepted quotation can become a sales order.');if((await db.prepare('SELECT id FROM sales_orders WHERE quotation_id=?').get(quotation.id)))throw new HttpError(409,'This quotation already has a sales order.');const body=await readJson(req);for(const key of ['customerPoDate','promisedDate'])if(body[key]&&!validDate(body[key]))throw new HttpError(422,`${key} must be a valid date.`);(await db.exec('BEGIN'));try{const number=(await nextNumber(db,'sales_orders','SO'));const result=(await db.prepare(`INSERT INTO sales_orders(order_number,quotation_id,customer_id,customer_po_number,customer_po_date,promised_date,notes,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?)`).run(number,quotation.id,quotation.customer_id,cleanNullable(body.customerPoNumber),body.customerPoDate||null,body.promisedDate||null,cleanNullable(body.notes),user.id,user.id));const add=db.prepare(`INSERT INTO sales_order_lines(sales_order_id,item_id,description,uom,ordered_quantity,unit_price,discount_percent,tax_percent,position) VALUES(?,?,?,?,?,?,?,?,?)`);(await Promise.all(quotation.lines.map(async (line,index)=>(await add.run(result.insertedId,line.item_id,line.description,line.uom,line.quantity,line.unit_price,line.discount_percent,line.tax_percent,index)))));const created=(await salesOrderView(db,result.insertedId));(await writeAudit(db,{userId:user.id,entity:'SALES_ORDER',recordId:created.id,action:'CREATE_FROM_QUOTATION',newValue:created,ipAddress:ip}));(await db.exec('COMMIT'));json(res,201,{data:created});}catch(error){(await db.exec('ROLLBACK'));throw error;}}),
    route('GET', '/api/orders', 'orders.read', async ({ res,url }) => {const {page,pageSize,offset}=pagination(url);const search=normalizeText(url.searchParams.get('search'));const statusFilter=normalizeText(url.searchParams.get('status'));const where=[];const args=[];if(search){const q=`%${escapeLike(search)}%`;where.push(`(o.order_number ILIKE ? ESCAPE '\\' OR c.name ILIKE ? ESCAPE '\\' OR o.customer_po_number ILIKE ? ESCAPE '\\')`);args.push(q,q,q);}if(statusFilter){where.push('o.status=?');args.push(statusFilter);}const filter=where.length?`WHERE ${where.join(' AND ')}`:'';const total=(await db.prepare(`SELECT COUNT(*) AS n FROM sales_orders o JOIN customers c ON c.id=o.customer_id ${filter}`).get(...args)).n;const rows=(await db.prepare(`SELECT o.id,o.order_number,o.customer_po_number,o.promised_date,o.status,o.updated_at,c.name AS customer_name,q.quotation_number,ROUND(COALESCE(SUM(l.ordered_quantity*l.unit_price*(1-l.discount_percent/100)*(1+l.tax_percent/100)),0),2) AS total FROM sales_orders o JOIN customers c ON c.id=o.customer_id JOIN quotations q ON q.id=o.quotation_id LEFT JOIN sales_order_lines l ON l.sales_order_id=o.id ${filter} GROUP BY o.id,c.name,q.quotation_number ORDER BY o.updated_at DESC,o.id DESC LIMIT ? OFFSET ?`).all(...args,pageSize,offset));json(res,200,{data:rows,pagination:{page,pageSize,total,pages:Math.ceil(total/pageSize)}});}),
    route('GET', '/api/orders/:id', 'orders.read', async ({ res,params }) => {const row=(await salesOrderView(db,numberId(params.id)));if(!row)throw new HttpError(404,'Sales order not found.');json(res,200,{data:row});}),
    route('PATCH', '/api/orders/:id/status', 'orders.update', async ({ req,res,params,user,ip }) => {const id=numberId(params.id);const old=(await salesOrderView(db,id));if(!old)throw new HttpError(404,'Sales order not found.');const body=await readJson(req);const next=String(body.status||'').toUpperCase();const transitions={CONFIRMED:['PROCESSING','CANCELLED'],PROCESSING:['DISPATCHED','CANCELLED'],PARTIALLY_DISPATCHED:['DISPATCHED','CANCELLED'],DISPATCHED:['COMPLETED'],COMPLETED:[],CANCELLED:[]};if(!transitions[old.status].includes(next))throw new HttpError(422,`Cannot move a sales order from ${old.status} to ${next||'that status'}.`);(await db.prepare(`UPDATE sales_orders SET status=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(next,user.id,id));const updated=(await salesOrderView(db,id));(await writeAudit(db,{userId:user.id,entity:'SALES_ORDER',recordId:id,action:'STATUS_CHANGE',oldValue:{status:old.status},newValue:{status:next},reason:cleanNullable(body.reason),ipAddress:ip}));json(res,200,{data:updated});}),
    route('GET', '/api/audit-logs', 'audit.read', async ({ res,url }) => { const {page,pageSize,offset}=pagination(url);const entity=normalizeText(url.searchParams.get('entity'));const args=[];const filter=entity?(args.push(entity),'WHERE a.entity=?'):'';const total=(await db.prepare(`SELECT COUNT(*) AS count FROM audit_logs a ${filter}`).get(...args)).count;const rows=(await db.prepare(`SELECT a.*,u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ${filter} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`).all(...args,pageSize,offset));json(res,200,{data:rows,pagination:{page,pageSize,total,pages:Math.ceil(total/pageSize)}}); }),
    route('GET', '/api/tally/status', 'tally.read', async ({ res }) => json(res,200,{configured:Boolean(config.tallyUrl&&config.tallyCompany),readOnly:true,lastJob:(await db.prepare('SELECT * FROM crm_tally_sync_jobs ORDER BY id DESC LIMIT 1').get())||null})),
    route('POST', '/api/tally/sync', 'tally.sync', async ({ res,user,ip }) => { const result=(await db.prepare(`INSERT INTO crm_tally_sync_jobs(status,max_attempts,started_by) VALUES('PENDING',?,?)`).run(config.tallyMaxRetries,user.id));const jobId=Number(result.insertedId);(await writeAudit(db,{userId:user.id,entity:'TALLY_SYNC',recordId:jobId,action:'START',ipAddress:ip}));try{const counts=await runTallySync(db,config,jobId,fetchImpl);(await writeAudit(db,{userId:user.id,entity:'TALLY_SYNC',recordId:jobId,action:'SUCCEEDED',newValue:counts,ipAddress:ip}));json(res,200,{jobId,...counts});}catch(error){(await writeAudit(db,{userId:user.id,entity:'TALLY_SYNC',recordId:jobId,action:'FAILED',newValue:{error:error.message},ipAddress:ip}));throw new HttpError(502,'Tally read sync failed.',{jobId,error:error.message});} }),
    route('GET', '/api/reconciliation', 'tally.read', async ({ res }) => json(res,200,{data:(await reconcile(db))})),
    route('GET', '/api/tally-connector/status', 'tally.connector.manage', async ({ res }) => json(res, 200, await connectorStore.status())),
    route('POST', '/api/tally-connector/setup', 'tally.connector.manage', async ({ req, res, user, ip }) => {
      const body = await readJson(req); const setup = await connectorStore.setup({ profileName: body.profileName, companyName: body.companyName });
      (await writeAudit(db, { userId: user.id, entity: 'TALLY_CONNECTOR', recordId: setup.id, action: 'SETUP_CREDENTIAL_ISSUED', newValue: { profileName: setup.profileName, companyName: setup.companyName }, ipAddress: ip }));
      json(res, 201, { setup });
    }),
    route('POST', '/api/tally-connector/pairing', 'tally.connector.manage', async ({ req, res, user, ip }) => {
      const body = await readJson(req);
      const pairing = await connectorStore.createPairingCode({
        profileName: body.profileName,
        companyName: body.companyName,
        apiBaseUrl: body.apiBaseUrl
      });
      (await writeAudit(db, { userId: user.id, entity: 'TALLY_CONNECTOR', recordId: pairing.id, action: 'PAIRING_CODE_ISSUED', newValue: { profileName: pairing.profileName, companyName: pairing.companyName, expiresAt: pairing.expiresAt }, ipAddress: ip }));
      json(res, 201, { pairing });
    }),
    route('POST', '/api/tally-connector/:id/revoke', 'tally.connector.manage', async ({ res, params, user, ip }) => {
      await connectorStore.revoke(params.id); (await writeAudit(db, { userId: user.id, entity: 'TALLY_CONNECTOR', recordId: params.id, action: 'REVOKED', ipAddress: ip })); json(res, 200, { ok: true });
    }),
    route('GET', '/api/health', null, async ({ res }) => json(res, 200, await connectorStore.health())),
    route('POST', '/api/connectors/pair', null, async ({ req, res, ip }) => {
      assertPairingNotRateLimited(ip);
      const body = await readJson(req);
      let pairing;
      try {
        pairing = await connectorStore.pair(body);
      } catch (error) {
        if (error.status === 401) recordPairingFailure(ip);
        throw error;
      }
      pairingAttempts.delete(ip);
      json(res, 200, pairing);
    }),
    route('POST', '/api/connectors/refresh', null, async ({ req, res }) => {
      const body = await readJson(req);
      json(res, 200, await connectorStore.refresh(body.refreshToken));
    }),
    route('POST', '/api/connectors/heartbeat', null, async ({ req, res }) => {
      const connector = await connectorStore.authenticate(req.headers); const body = await readConnectorJson(req); json(res, 200, await connectorStore.heartbeat(connector, body));
    }),
    route('GET', '/api/connectors/company-config', null, async ({ req, res }) => {
      const connector = await connectorStore.authenticate(req.headers); json(res, 200, { ok: true, companies: [connector.expected_company_name] });
    }),
    route('POST', '/api/connectors/sync-job', null, async ({ req, res }) => {
      const connector = await connectorStore.authenticate(req.headers); const body = await readConnectorJson(req);
      if (body.action === 'start') return json(res, 200, { ok: true, ...(await connectorStore.startJob(connector, body)) });
      if (body.action === 'progress') return json(res, 200, { ok: true, ...(await connectorStore.progress(connector, body)) });
      if (body.action === 'complete') return json(res, 200, await connectorStore.completeJob(connector, body));
      throw new HttpError(422, 'Unknown connector sync-job action.');
    }),
    route('POST', '/api/ingest/tally/chunks', null, async ({ req, res }) => {
      const connector = await connectorStore.authenticate(req.headers); const body = await readConnectorJson(req);
      if (body.action === 'start') return json(res, 200, { ok: true, ...(await connectorStore.start(connector, body)) });
      if (body.action === 'append') { await connectorStore.append(connector, body); return json(res, 200, { ok: true, sequence: body.sequence }); }
      if (body.action === 'finalize') {
        if(!/^[0-9a-f-]{36}$/i.test(body.sessionId||''))throw new HttpError(422,'Invalid upload session.');
        const session=await db.prepare('SELECT id FROM tally_upload_sessions WHERE id=? AND connector_id=?').get(body.sessionId,connector.id);
        if(!session)throw new HttpError(404,'Upload session is unavailable.');
        const summary=await importTallySession(db,body.sessionId);
        if(summary.status==='failed')throw new HttpError(422,'Import failed; raw data retained. See Tally Connector for dataset errors.');
        return json(res,200,{ok:true,...summary});
      }
      throw new HttpError(422, 'Unknown connector upload action.');
    }),
    route('GET','/api/dashboard','dashboard.read',async({res,user,url})=>{
      const context=await overviewContext(db,config,url);
      const workflow=await workflowOverview(db);
      const financial=config.tallyFinancialRoles.includes(user.role);
      const stats={...workflow.stats,orderValue:Number(workflow.stats.order_value),pipeline:Number(workflow.stats.pipeline)};
      // Keep older open browser tabs compatible without exposing reconciliation to workflow-only roles.
      const reconciliation=financial?(await reconcile(db)).summary:undefined;
      json(res,200,{companies:context.companies,company:context.company,periods:context.periods,period:context.period,
        sync:context.sync,workflow,access:{financial},stats,recent:workflow.recent,...(reconciliation?{reconciliation}:{})});
    })
  ];

  const handler = async function handler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); const ip = req.socket.remoteAddress || '';
      if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/tally/')) return serveStatic(req,res,url.pathname);
      res.setHeader('x-content-type-options','nosniff'); res.setHeader('x-frame-options','DENY'); res.setHeader('referrer-policy','no-referrer'); res.setHeader('content-security-policy',"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
      const found = routes.map((r)=>({r,params:r.method===req.method?matchRoute(url.pathname,r.pattern):null})).find((x)=>x.params);
      if (!found) { const pathExists=routes.some((r)=>matchRoute(url.pathname,r.pattern)); throw new HttpError(pathExists?405:404,pathExists?'Method not allowed.':'Not found.'); }
      const user = (await sessionUser(db,req,config));
      if (found.r.permission) {
        if (!user) throw new HttpError(401,'Authentication required.');
        if (found.r.permission!=='authenticated'&&!hasPermission(user,found.r.permission)) throw new HttpError(403,'You do not have permission for this action.');
        if (!['GET','HEAD','OPTIONS'].includes(req.method) && !safeEqual(req.headers['x-csrf-token'] || '',user.csrf_token)) throw new HttpError(403,'Invalid CSRF token.');
      }
      await found.r.handler({req,res,url,params:found.params,user,ip});
    } catch(error) {
      if (res.headersSent) return res.end();
      const status=error.status||500; if(status===500) console.error(error); json(res,status,{error:error.message||'Internal server error.',...(error.details?{details:error.details}:{})});
    }
  };
  const handle = (req, res) => db.withConnection(() => handler(req, res)).catch(error => {
    console.error(error);
    if (!res.headersSent) json(res, 503, { error: 'Database is unavailable.' });
    else res.end();
  });
  handle.close = () => connectorStore.close();
  return handle;
}

function serveStatic(req,res,pathname) {
  if (!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'Method not allowed.'});
  const requested=pathname==='/'?'index.html':pathname.slice(1); const file=path.resolve(publicDir,requested); if(!file.startsWith(publicDir+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()) return json(res,404,{error:'Not found.'});
  const ext=path.extname(file);const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};const data=fs.readFileSync(file);res.writeHead(200,{'content-type':types[ext]||'application/octet-stream','content-length':data.length,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"});if(req.method==='HEAD')res.end();else res.end(data);
}
