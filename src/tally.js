import { normalizeKey } from './security.js';

const escapeXml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const decodeXml = (value = '') => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();

function exportRequest(company, collection, type) {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>${collection}</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="${collection}"><TYPE>${type}</TYPE><FETCH>GUID,NAME,PARTYGSTIN,INCOMETAXNUMBER,LEDGERPHONE,EMAIL,ADDRESS,BASEUNITS,GSTAPPLICABLE,HSNCODE,DESCRIPTION</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}

const tag = (xml, names) => {
  for (const name of names) {
    const found = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (found) return decodeXml(found[1].replace(/<[^>]+>/g, ' '));
  }
  return '';
};

const blocks = (xml, element) => [...xml.matchAll(new RegExp(`<${element}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${element}>`, 'gi'))].map((x) => x[1]);

export function parseTallyCustomers(xml) {
  const error = tag(xml, ['LINEERROR']);
  if (error) throw new Error(`Tally error: ${error}`);
  return blocks(xml, 'LEDGER').map((raw) => ({
    guid: tag(raw, ['GUID', 'REMOTEID']) || `ledger-${normalizeKey(tag(raw, ['NAME']))}`,
    name: tag(raw, ['NAME']),
    gstin: tag(raw, ['PARTYGSTIN', 'GSTIN']),
    pan: tag(raw, ['INCOMETAXNUMBER', 'PAN']),
    phone: tag(raw, ['LEDGERPHONE', 'PHONE']),
    email: tag(raw, ['EMAIL']),
    address: tag(raw, ['ADDRESS'])
  })).filter((x) => x.name);
}

export function parseTallyItems(xml) {
  const error = tag(xml, ['LINEERROR']);
  if (error) throw new Error(`Tally error: ${error}`);
  return blocks(xml, 'STOCKITEM').map((raw) => ({
    guid: tag(raw, ['GUID', 'REMOTEID']) || `item-${normalizeKey(tag(raw, ['NAME']))}`,
    partCode: tag(raw, ['NAME', 'PARTNO']),
    description: tag(raw, ['DESCRIPTION', 'BASICUSERDESCRIPTION']),
    brand: tag(raw, ['BRAND']),
    hsn: tag(raw, ['HSNCODE', 'GSTHSNCODE']),
    uom: tag(raw, ['BASEUNITS'])
  })).filter((x) => x.partCode);
}

async function requestWithRetry(config, body, fetchImpl, onAttempt) {
  let lastError;
  for (let attempt = 1; attempt <= config.tallyMaxRetries; attempt += 1) {
    onAttempt(attempt);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.tallyTimeoutMs);
    try {
      const response = await fetchImpl(config.tallyUrl, { method: 'POST', headers: { 'content-type': 'application/xml; charset=utf-8' }, body, signal: controller.signal });
      if (!response.ok) throw new Error(`Tally HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < config.tallyMaxRetries) await new Promise((resolve) => setTimeout(resolve, Math.min(100 * (2 ** (attempt - 1)), 1000)));
    } finally { clearTimeout(timer); }
  }
  throw lastError;
}

export async function runTallySync(db, config, jobId, fetchImpl = fetch) {
  const updateAttempt = db.prepare("UPDATE tally_sync_jobs SET status='RUNNING',attempt=?,started_at=COALESCE(started_at,CURRENT_TIMESTAMP),error_message=NULL WHERE id=?");
  try {
    const customersXml = await requestWithRetry(config, exportRequest(config.tallyCompany, 'CRM Ledgers', 'Ledger'), fetchImpl, (attempt) => updateAttempt.run(attempt, jobId));
    const itemsXml = await requestWithRetry(config, exportRequest(config.tallyCompany, 'CRM Stock Items', 'Stock Item'), fetchImpl, (attempt) => updateAttempt.run(attempt, jobId));
    const customers = parseTallyCustomers(customersXml);
    const items = parseTallyItems(itemsXml);

    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM tally_customers; DELETE FROM tally_items;');
      const addCustomer = db.prepare(`INSERT INTO tally_customers(guid,name,gstin,pan,phone,email,address,raw_json) VALUES(?,?,?,?,?,?,?,?)`);
      customers.forEach((x) => addCustomer.run(x.guid, x.name, x.gstin || null, x.pan || null, x.phone || null, x.email || null, x.address || null, JSON.stringify(x)));
      const addItem = db.prepare(`INSERT INTO tally_items(guid,part_code,description,brand,hsn,uom,raw_json) VALUES(?,?,?,?,?,?,?)`);
      items.forEach((x) => addItem.run(x.guid, x.partCode, x.description || null, x.brand || null, x.hsn || null, x.uom || null, JSON.stringify(x)));
      db.prepare("UPDATE tally_sync_jobs SET status='SUCCEEDED',completed_at=CURRENT_TIMESTAMP,customer_count=?,item_count=? WHERE id=?").run(customers.length, items.length, jobId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { customers: customers.length, items: items.length };
  } catch (error) {
    const job = db.prepare('SELECT attempt,max_attempts FROM tally_sync_jobs WHERE id=?').get(jobId);
    const retry = job.attempt < job.max_attempts;
    db.prepare(`UPDATE tally_sync_jobs SET status=?,completed_at=CURRENT_TIMESTAMP,next_retry_at=?,error_message=? WHERE id=?`).run(
      retry ? 'RETRY_SCHEDULED' : 'FAILED', retry ? new Date(Date.now() + (2 ** job.attempt) * 60_000).toISOString() : null, String(error.message).slice(0, 1000), jobId);
    throw error;
  }
}

function customerConflicts(crm, tally) {
  const fields = [];
  for (const [field, left, right] of [['name', crm.name, tally.name], ['gstin', crm.gstin, tally.gstin], ['pan', crm.pan, tally.pan]]) {
    if (left && right && normalizeKey(left) !== normalizeKey(right)) fields.push({ field, crm: left, tally: right });
  }
  return fields;
}

function itemConflicts(crm, tally) {
  const fields = [];
  for (const [field, left, right] of [['description', crm.description, tally.description], ['brand', crm.brand, tally.brand], ['hsn', crm.hsn, tally.hsn], ['uom', crm.uom, tally.uom]]) {
    if (left && right && normalizeKey(left) !== normalizeKey(right)) fields.push({ field, crm: left, tally: right });
  }
  return fields;
}

export function reconcile(db) {
  const crmCustomers = db.prepare('SELECT id,name,gstin,pan,tally_guid FROM customers').all();
  const tallyCustomers = db.prepare('SELECT * FROM tally_customers').all();
  const matchedTallyCustomers = new Set();
  const customerMatches = [];
  const missingInTallyCustomers = [];
  for (const crm of crmCustomers) {
    const tally = tallyCustomers.find((x) => (crm.tally_guid && x.guid === crm.tally_guid) || (crm.gstin && normalizeKey(x.gstin) === normalizeKey(crm.gstin)) || (crm.pan && normalizeKey(x.pan) === normalizeKey(crm.pan)) || normalizeKey(x.name) === normalizeKey(crm.name));
    if (!tally) missingInTallyCustomers.push(crm);
    else { matchedTallyCustomers.add(tally.guid); customerMatches.push({ crm, tally, conflicts: customerConflicts(crm, tally) }); }
  }
  const missingInCrmCustomers = tallyCustomers.filter((x) => !matchedTallyCustomers.has(x.guid));

  const crmItems = db.prepare('SELECT id,part_code,description,brand,hsn,uom,alternate_codes,tally_guid FROM items').all();
  const tallyItems = db.prepare('SELECT * FROM tally_items').all();
  const matchedTallyItems = new Set();
  const itemMatches = [];
  const missingInTallyItems = [];
  for (const crm of crmItems) {
    const codes = [crm.part_code, ...JSON.parse(crm.alternate_codes || '[]')].map(normalizeKey);
    const tally = tallyItems.find((x) => (crm.tally_guid && x.guid === crm.tally_guid) || codes.includes(normalizeKey(x.part_code)));
    if (!tally) missingInTallyItems.push(crm);
    else { matchedTallyItems.add(tally.guid); itemMatches.push({ crm, tally, conflicts: itemConflicts(crm, tally) }); }
  }
  const missingInCrmItems = tallyItems.filter((x) => !matchedTallyItems.has(x.guid));
  return {
    summary: {
      customerMatches: customerMatches.length, customerConflicts: customerMatches.filter((x) => x.conflicts.length).length,
      customersMissingInCrm: missingInCrmCustomers.length, customersMissingInTally: missingInTallyCustomers.length,
      itemMatches: itemMatches.length, itemConflicts: itemMatches.filter((x) => x.conflicts.length).length,
      itemsMissingInCrm: missingInCrmItems.length, itemsMissingInTally: missingInTallyItems.length
    },
    customers: { matches: customerMatches, missingInCrm: missingInCrmCustomers, missingInTally: missingInTallyCustomers },
    items: { matches: itemMatches, missingInCrm: missingInCrmItems, missingInTally: missingInTallyItems }
  };
}
