// Stored-data boundary: no connector imports, HTTP clients, timers, or Tally writes.
import { writeAudit } from './db.js';
import { normalizeKey, escapeLike } from './security.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const badEncoding = value => (value.match(/[\u0080-\u009f\ufffd]|Ã.|Â.|â[€\u0080-\u00bf]|à[¤¥]|ð[Ÿ\u009f]/gu) || []).length;
const cp1252 = new Map([... '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'].map((char, index) => [char, [128,130,131,132,133,134,135,136,137,138,139,140,142,145,146,147,148,149,150,151,152,153,154,155,156,158,159][index]]));
export function displayText(value) {
  if (value == null) return null;
  let text = String(value);
  for (let pass = 0; pass < 2 && badEncoding(text); pass++) {
    const bytes = [];
    let valid = true;
    for (const char of text) {
      const point = char.codePointAt(0), byte = cp1252.get(char) ?? (point <= 255 ? point : null);
      if (byte === null) { valid = false; break; }
      bytes.push(byte);
    }
    if (!valid) break;
    try {
      const candidate = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
      if (badEncoding(candidate) >= badEncoding(text)) break;
      text = candidate;
    } catch { break; }
  }
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\u00a0/g, ' ');
}
export function companyDisplayName(value) {
  return displayText(value)?.replace(/(\(from\s+[^)]+\))(?:\s*\1)+/gi, '$1').trim();
}
export function pagination(url) {
  const integer = (key, fallback, max) => {
    const raw = url.searchParams.get(key);
    if (raw == null || raw === '') return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max) throw fail(422, `Invalid ${key}.`);
    return value;
  };
  return { page: integer('page', 1, 1000000), pageSize: integer('pageSize', 25, 100) };
}
const pageResult = (rows, total, meta) => ({ data: rows, pagination: { ...meta, total, pages: Math.ceil(total / meta.pageSize) } });
export async function readCompany(db, url) {
  const id = url.searchParams.get('companyId');
  if (id && !uuid.test(id)) throw fail(422, 'Invalid company identifier.');
  const row = id ? await db.prepare('SELECT id,name FROM tally_companies WHERE id=?').get(id)
    : await db.prepare('SELECT id,name FROM tally_companies ORDER BY name,id LIMIT 1').get();
  if (id && !row) throw fail(404, 'Imported company not found.');
  return row ? { ...row, display_name: companyDisplayName(row.name) } : null;
}
export async function readSync(db, company) {
  if (!company) return { status: 'not_received', lastSyncAt: null, lastSuccessfulSyncAt: null };
  const latest = await db.prepare(`SELECT status,started_at,completed_at,last_progress_at,message FROM tally_sync_jobs
    WHERE company_name=? ORDER BY started_at DESC,id DESC LIMIT 1`).get(company.name);
  const success = await db.prepare(`SELECT completed_at FROM tally_sync_jobs WHERE company_name=? AND status='stored'
    AND completed_at IS NOT NULL ORDER BY completed_at DESC,id DESC LIMIT 1`).get(company.name);
  return { status: latest?.status || 'not_received', lastSyncAt: latest?.completed_at || null,
    lastSuccessfulSyncAt: success?.completed_at || null, startedAt: latest?.started_at || null,
    lastProgressAt: latest?.last_progress_at || null, message: displayText(latest?.message) || null };
}
export function classifyLedgers(groups, ledgers) {
  const byName = new Map();
  for (const group of groups) {
    const list = byName.get(group.name) || []; list.push(group); byName.set(group.name, list);
  }
  const family = name => {
    const seen = new Set(); let current = name;
    while (current && !seen.has(current)) {
      seen.add(current);
      const key = current.toLowerCase();
      if (key === 'sundry debtors') return 'customers';
      if (key === 'sundry creditors') return 'vendors';
      if (['bank accounts','bank od a/c','cash-in-hand'].includes(key)) return 'banks';
      if (['direct expenses','indirect expenses'].includes(key)) return 'expenses';
      const candidates = byName.get(current) || [];
      if (candidates.length !== 1) return 'other';
      current = candidates[0].parent_name;
    }
    return 'other';
  };
  return ledgers.map(row => ({ ...row, category: family(row.parent_name) }));
}
export function groupHierarchy(groups) {
  const byName = new Map();
  for (const group of groups) { const rows = byName.get(group.name) || []; rows.push(group); byName.set(group.name, rows); }
  return groups.map(group => {
    const path = [group.name], seen = new Set([group.name]);
    let parent = group.parent_name, hierarchy_status = 'root';
    while (parent && !['primary','primary group'].includes(parent.toLowerCase())) {
      if (seen.has(parent)) { hierarchy_status = 'cycle'; break; }
      seen.add(parent); const rows = byName.get(parent) || [];
      if (rows.length !== 1) { hierarchy_status = rows.length ? 'ambiguous_parent' : 'missing_parent'; break; }
      path.unshift(parent); parent = rows[0].parent_name; hierarchy_status = 'resolved';
    }
    return { ...group, path, depth: path.length - 1, hierarchy_status };
  });
}
const displayRow = row => ({ ...row, original_name: row.name, display_name: displayText(row.name),
  display_group: displayText(row.parent_name),
  ...Object.fromEntries(['phone','email','address','contact_person','description'].filter(key=>Object.hasOwn(row,key)).map(key=>[`display_${key}`,displayText(row[key])])),
  ...(row.path ? {display_path:row.path.map(displayText)} : {}) });
export async function stockCoverage(db, company, financial) {
  if (!financial || !company) return null;
  const row = await db.prepare('SELECT * FROM crm_tally_stock_coverage WHERE company_id=?').get(company.id);
  const total = Number(row?.total_items || 0), valued = Number(row?.valued_items || 0), negative = Number(row?.negative_value_items || 0);
  return { scope:'company', totalItems: total, valuedItems: valued, missingValue: total - valued, negativeValueItems: negative,
    partial: total === 0 || valued !== total, label: !total || valued !== total ? 'Partial value' : negative ? 'Signed value · includes negative stock' : 'Complete signed value',
    totalValue: total && total === valued ? row.complete_signed_value : null,
    knownSignedValue: row?.signed_known_value ?? null,
    note: 'Signed source values are preserved. Missing values are excluded; a partial sum is not a stock total.' };
}
export async function readStoredTally(db, kind, url, { financial = false } = {}) {
  const meta = pagination(url), company = await readCompany(db, url);
  const sync = await readSync(db, company);
  if (!company) return { ...pageResult([], 0, meta), company, sync, coverage: null };
  const search = (url.searchParams.get('search') || '').trim().toLocaleLowerCase();
  const groupFilter = url.searchParams.get('group');
  let rows;
  if (kind === 'items') {
    const args = [company.id], where = ['company_id=?'];
    if (search) { where.push("(name ILIKE ? ESCAPE '\\' OR parent_name ILIKE ? ESCAPE '\\')"); args.push(`%${escapeLike(search)}%`, `%${escapeLike(search)}%`); }
    if (groupFilter) { where.push('parent_name=?'); args.push(groupFilter); }
    const total = (await db.prepare(`SELECT COUNT(*) AS n FROM tally_stock_items WHERE ${where.join(' AND ')}`).get(...args)).n;
    const sorts = ['name','parent_name','closing_quantity_text','closing_rate_text',...(financial ? ['closing_value'] : [])];
    const sort = sorts.includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'name';
    const direction = url.searchParams.get('direction') === 'desc' ? 'DESC' : 'ASC';
    rows = await db.prepare(`SELECT id,company_id,name,parent_name,description,hsn,base_unit,normalized_part_number,
      closing_quantity_text,closing_rate_text,fetched_at${financial ? ',closing_value::text AS closing_value' : ''}
      FROM tally_stock_items WHERE ${where.join(' AND ')} ORDER BY ${sort} ${direction},id LIMIT ? OFFSET ?`).all(...args, meta.pageSize, (meta.page - 1) * meta.pageSize);
    return { ...pageResult(rows.map(displayRow), total, meta), company, sync, financial, coverage: await stockCoverage(db, company, financial) };
  }
  const groups = await db.prepare('SELECT id,company_id,name,parent_name,fetched_at FROM tally_groups WHERE company_id=? ORDER BY name,id').all(company.id);
  if (kind === 'groups') rows = groupHierarchy(groups);
  else {
    const categories = ['customers','vendors','banks','expenses','other','ledgers'];
    if (!categories.includes(kind)) throw fail(404, 'Unknown stored dataset.');
    const ledgers = await db.prepare(`SELECT id,company_id,name,parent_name,phone,email,gstin,pan,address,contact_person,fetched_at
      ${financial ? ',closing_balance::text AS closing_balance,opening_balance::text AS opening_balance,dr_cr' : ''}
      FROM tally_ledgers WHERE company_id=? ORDER BY name,id`).all(company.id);
    rows = classifyLedgers(groups, ledgers).filter(row => kind === 'ledgers' || row.category === kind);
  }
  rows = rows.filter(row => (!groupFilter || row.parent_name === groupFilter) && (!search || [row.name, row.parent_name, displayText(row.name), row.phone, displayText(row.phone)].some(value => value?.toLocaleLowerCase().includes(search))));
  const sort = ['name','parent_name','phone','depth'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'name';
  const direction = url.searchParams.get('direction') === 'desc' ? -1 : 1;
  rows.sort((a,b) => direction * String(a[sort] ?? '').localeCompare(String(b[sort] ?? ''), undefined, { numeric: true }) || String(a.id).localeCompare(String(b.id)));
  return { ...pageResult(rows.slice((meta.page-1)*meta.pageSize, meta.page*meta.pageSize).map(displayRow), rows.length, meta), company, sync, financial, groupCount: groups.length };
}

export function reconcileExact(tally, crm) {
  const group = rows => {
    const map = new Map();
    rows.forEach(row => { const key = `${row.kind}:${row.name}`; const list = map.get(key) || []; list.push(row); map.set(key,list); });
    return map;
  };
  const sources = group(tally), targets = group(crm), result = [];
  for (const key of new Set([...sources.keys(), ...targets.keys()])) {
    const source = sources.get(key) || [], target = targets.get(key) || [], row = source[0] || target[0];
    const conflicts = [];
    if (source.length > 1) conflicts.push('Duplicate exact Tally name');
    if (target.length > 1) conflicts.push('Duplicate exact CRM name');
    if (target.some(item => item.company_ambiguous)) conflicts.push('CRM company is unassigned and the name exists in multiple companies');
    if (target.some(item => item.status && item.status !== 'ACTIVE')) conflicts.push('CRM record is inactive or archived');
    if (target.some(item => item.mapping_conflict)) conflicts.push('CRM name changed after the company mapping was created');
    if (source[0]?.gstin && target[0]?.gstin && source[0].gstin.toUpperCase() !== target[0].gstin.toUpperCase()) conflicts.push('GSTIN differs');
    if (source[0]?.uom && target[0]?.uom && source[0].uom !== target[0].uom) conflicts.push('Unit differs');
    const status = conflicts.length ? 'conflict' : !source.length ? 'missing_in_tally' : !target.length ? 'missing_in_crm' : 'matched';
    result.push({ kind: row.kind, name: row.name, display_name: displayText(row.name), status, conflicts, tally: source, crm: target });
  }
  return result.sort((a,b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
async function reconciliationRows(db, company) {
  const groups = await db.prepare('SELECT name,parent_name FROM tally_groups WHERE company_id=?').all(company.id);
  const ledgers = classifyLedgers(groups, await db.prepare('SELECT id,name,parent_name,gstin,phone FROM tally_ledgers WHERE company_id=?').all(company.id))
    .filter(row => ['customers','vendors'].includes(row.category)).map(row => ({ ...row, kind: row.category === 'customers' ? 'customer' : 'vendor' }));
  const tallyItems = (await db.prepare('SELECT id,name,base_unit AS uom FROM tally_stock_items WHERE company_id=?').all(company.id)).map(row => ({ ...row, kind: 'item' }));
  const parties = (await db.prepare(`SELECT p.id,p.name,p.party_role,p.customer_id,COALESCE(c.gstin,p.gstin) AS gstin,
    CASE WHEN p.status='ACTIVE' AND NOT p.is_deleted THEN COALESCE(c.status,p.status) ELSE p.status END AS status,
    (p.customer_id IS NOT NULL AND c.name IS DISTINCT FROM p.name) AS mapping_conflict
    FROM crm_parties p LEFT JOIN customers c ON c.id=p.customer_id WHERE p.company_id=?`).all(company.id))
    .map(row => ({ ...row, kind: row.party_role === 'CUSTOMER' ? 'customer' : 'vendor' }));
  const legacyCustomers = await db.prepare(`SELECT c.id,c.name,c.gstin,c.status,
    (SELECT count(DISTINCT company_id)>1 FROM tally_ledgers l WHERE l.name=c.name) AS company_ambiguous
    FROM customers c WHERE NOT EXISTS(SELECT 1 FROM crm_parties p WHERE p.customer_id=c.id)
    AND (SELECT count(*) FROM tally_companies)=1
    OR NOT EXISTS(SELECT 1 FROM crm_parties p WHERE p.customer_id=c.id) AND EXISTS(SELECT 1 FROM tally_ledgers l WHERE l.company_id=? AND l.name=c.name)`).all(company.id);
  const links = await db.prepare(`SELECT l.item_id AS id,l.tally_name AS name,i.uom,(i.part_code::text IS DISTINCT FROM l.tally_name) AS mapping_conflict,
    CASE WHEN l.status='ACTIVE' AND NOT l.is_deleted THEN i.status ELSE l.status END AS status FROM crm_tally_item_links l
    JOIN items i ON i.id=l.item_id WHERE l.company_id=?`).all(company.id);
  const legacyItems = await db.prepare(`SELECT i.id,i.part_code::text AS name,i.uom,i.status,
    (SELECT count(DISTINCT company_id)>1 FROM tally_stock_items s WHERE s.name=i.part_code::text) AS company_ambiguous
    FROM items i WHERE NOT EXISTS(SELECT 1 FROM crm_tally_item_links l WHERE l.item_id=i.id)
    AND ((SELECT count(*) FROM tally_companies)=1 OR EXISTS(SELECT 1 FROM tally_stock_items s WHERE s.company_id=? AND s.name=i.part_code::text))`).all(company.id);
  return reconcileExact([...ledgers, ...tallyItems], [...parties, ...legacyCustomers.map(row => ({ ...row, kind:'customer' })), ...links.map(row => ({ ...row, kind:'item' })), ...legacyItems.map(row => ({ ...row, kind:'item' }))]);
}
export async function readReconciliation(db, url) {
  const meta = pagination(url), company = await readCompany(db, url), sync = await readSync(db, company);
  const all = company ? await reconciliationRows(db, company) : [];
  const summary = { matched: 0, missing_in_crm: 0, missing_in_tally: 0, conflict: 0 };
  all.forEach(row => summary[row.status]++);
  const search = (url.searchParams.get('search') || '').toLocaleLowerCase(), kind = url.searchParams.get('kind'), status = url.searchParams.get('status');
  if (kind && !['customer','vendor','item'].includes(kind)) throw fail(422,'Invalid reconciliation kind.');
  if (status && !Object.hasOwn(summary,status)) throw fail(422,'Invalid reconciliation status.');
  const filtered = all.filter(row => (!kind || row.kind === kind) && (!status || row.status === status) && (!search || row.name.toLocaleLowerCase().includes(search) || row.display_name.toLocaleLowerCase().includes(search)));
  return { ...pageResult(filtered.slice((meta.page-1)*meta.pageSize, meta.page*meta.pageSize),filtered.length,meta), company,sync,summary };
}

export async function createCrmFromStored(db, body, user, ip) {
  if (!body || !['customer','vendor','item'].includes(body.kind) || !uuid.test(body.companyId || '') || typeof body.sourceId !== 'string') throw fail(422,'Select a company and stored source record.');
  return db.withConnection(async () => {
    await db.exec('BEGIN');
    try {
      // Serialize this additive import path; never lock or update source tables.
      await db.prepare('SELECT pg_advisory_xact_lock(?)').get(73429922);
      await db.prepare("SELECT set_config('mehta.actor_id',?,true),set_config('mehta.audit_reason',?,true)").get(String(user.id),'Create CRM record from stored Tally record');
      const company = await readCompany(db,new URL(`http://local/?companyId=${body.companyId}`));
      const table = body.kind === 'item' ? 'tally_stock_items' : 'tally_ledgers';
      const source = await db.prepare(`SELECT * FROM ${table} WHERE company_id=? AND id=?`).get(company.id,body.sourceId);
      if (!source) throw fail(404,'Stored source record not found.');
      const rows = await reconciliationRows(db,company);
      const entry = rows.find(row => row.kind === body.kind && row.name === source.name);
      if (!entry) throw fail(422,'Ledger is not in the requested customer/vendor group.');
      if (entry.status === 'matched') { await db.exec('COMMIT'); return { created:false, record:entry.crm[0] }; }
      if (entry.status !== 'missing_in_crm') throw fail(409,'Resolve reconciliation conflicts before creating a CRM record.');
      let id;
      if (body.kind === 'item') {
        if (!source.base_unit?.trim()) throw fail(422,'The stored item has no unit. Complete its CRM details manually.');
        const inserted = await db.prepare(`INSERT INTO items(part_code,description,hsn,uom,created_by,updated_by)
          VALUES(?,?,?,?,?,?)`).run(source.name,source.description || source.name,source.hsn,source.base_unit,user.id,user.id);
        id = inserted.insertedId;
        await db.prepare('INSERT INTO crm_tally_item_links(company_id,item_id,tally_name,created_by) VALUES(?,?,?,?)').run(company.id,id,source.name,user.id);
        await writeAudit(db,{userId:user.id,entity:'ITEM',recordId:id,action:'CREATE_FROM_STORED_TALLY',newValue:{companyId:company.id,sourceId:source.id,name:source.name},ipAddress:ip});
      } else {
        let customerId = null;
        if (body.kind === 'customer') {
          customerId = (await db.prepare(`INSERT INTO customers(name,normalized_name,gstin,pan,billing_address,created_by,updated_by)
            VALUES(?,?,?,?,?,?,?)`).run(source.name,normalizeKey(source.name),source.gstin,source.pan,source.address,user.id,user.id)).insertedId;
          await writeAudit(db,{userId:user.id,entity:'CUSTOMER',recordId:customerId,action:'CREATE_FROM_STORED_TALLY',newValue:{companyId:company.id,sourceId:source.id,name:source.name},ipAddress:ip});
          if (source.contact_person || source.phone || source.email) {
            await db.prepare(`INSERT INTO customer_contacts(customer_id,name,phone,email,is_primary) VALUES(?,?,?,?,1)`)
              .run(customerId,source.contact_person || source.name,source.phone,source.email);
            await writeAudit(db,{userId:user.id,entity:'CUSTOMER_CONTACT',recordId:customerId,action:'CREATE_FROM_STORED_TALLY',newValue:{phone:source.phone,email:source.email},ipAddress:ip});
          }
        }
        id = (await db.prepare(`INSERT INTO crm_parties(company_id,name,party_role,customer_id,phone,email,gstin,address,created_by)
          VALUES(?,?,?,?,?,?,?,?,?)`).run(company.id,source.name,body.kind === 'customer' ? 'CUSTOMER' : 'VENDOR',customerId,source.phone,source.email,source.gstin,source.address,user.id)).insertedId;
      }
      await db.exec('COMMIT'); return { created:true,record:{id,kind:body.kind,name:source.name} };
    } catch(error) {
      await db.exec('ROLLBACK');
      if (error.code === '23505') throw fail(409,'An existing CRM name, code or GSTIN conflicts with this record. Review it manually.');
      throw error;
    }
  });
}
