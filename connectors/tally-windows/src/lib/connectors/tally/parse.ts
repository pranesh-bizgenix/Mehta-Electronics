import { XMLParser } from "fast-xml-parser";
import type {
  AccountingVoucher,
  BalanceSheetNode,
  BillAllocation,
  Bill,
  BusinessDataset,
  InventoryItem,
  InvoiceStatus,
  ExpenseLedger,
  LedgerBalance,
  SalesRecord,
  VoucherInventoryLine,
  VoucherLedgerLine,
} from "@/lib/engine/types";
import { buildReconciliationPack, type ReconciliationPack } from "@/lib/reconciliation/engine";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
  // Tally tag names contain dots (ALLINVENTORYENTRIES.LIST) keep them literal.
});

const arr = <T>(v: T | T[] | undefined): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

const isoDate = (yyyymmdd: unknown): string => {
  const raw = yyyymmdd && typeof yyyymmdd === "object" && "#text" in (yyyymmdd as Record<string, unknown>)
    ? (yyyymmdd as Record<string, unknown>)["#text"]
    : yyyymmdd;
  const s = String(raw ?? "").trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (!s) return "";
  const d = new Date(s);
  return isNaN(+d) ? "" : d.toISOString().slice(0, 10);
};

const maybeIsoDate = (value: unknown): string | null => {
  const s = cleanText(value);
  if (!s) return null;
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(+d) ? null : d.toISOString().slice(0, 10);
};
/** Real Tally tags carry attributes (e.g. <CLOSINGBALANCE TYPE="Amount">123</â€¦>),
 * so fast-xml-parser nests the value under "#text". Unwrap that to a string. */
function txt(v: unknown): string {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("#text" in o) return String(o["#text"] ?? "");
    return ""; // attributes-only / empty element
  }
  return v == null ? "" : String(v);
}

function cleanText(v: unknown): string {
  const value = txt(v).trim();
  if (value) return value;
  if (!v || typeof v !== "object") return v == null ? "" : String(v).trim();
  const o = v as Record<string, unknown>;
  for (const key of ["@_NAME", "NAME", "LEDGERNAME", "STOCKITEMNAME", "PARTYLEDGERNAME", "PARTYNAME", "BASICBUYERNAME"]) {
    const nested = cleanText(o[key]);
    if (nested) return nested;
  }
  return "";
}

const numOf = (v: unknown): number => {
  const raw = txt(v).trim();
  const m = raw.replace(/[, ]/g, "").match(/-?[\d.]+/);
  const value = m ? parseFloat(m[0]) : 0;
  return /^\s*\(/.test(raw) || /\bcr\b/i.test(raw) ? -Math.abs(value) : value;
};
const qtyOf = (v: unknown): number => Math.abs(numOf(v));

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'");
}

export function normalizeCompanyName(raw: unknown): string | null {
  const name = txt(raw)
    .replace(/\s*[-â€“â€”]?\s*\(?\s*from\s+.*$/i, "")
    .replace(/\s*\(\s*from\s+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return name || null;
}

function latestIsoDate(dates: Array<string | undefined>): string {
  const valid = dates
    .map((d) => String(d ?? ""))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return valid.length ? valid.reduce((m, d) => (d > m ? d : m), valid[0]) : new Date().toISOString().slice(0, 10);
}

/** Tally balances come as "5000.00", "-5000.00", or "5000.00 Cr"/"Dr".
 * Returns signed as Tally exports it (sign convention varies; KPIs take
 * magnitude per group, which is sign-homogeneous). */
function balanceOf(raw: unknown): number {
  const s = txt(raw);
  const n = numOf(raw);
  if (/\bcr\b/i.test(s)) return -Math.abs(n);
  if (/\bdr\b/i.test(s)) return Math.abs(n);
  return n;
}

/** Recursively collect every element stored under one of `tags`. */
function collectByTag(node: unknown, tags: string[], out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
    if (tags.includes(key)) {
      for (const v of arr<any>(val)) out.push(v);
    } else if (typeof val === "object") {
      collectByTag(val, tags, out);
    }
  }
  return out;
}

export function parseCompanyName(xml: string): string | null {
  if (!xml) return null;
  const root = parser.parse(xml);
  const candidates = collectByTag(root, [
    "SVCURRENTCOMPANY",
    "REMOTECMPNAME",
    "CURRENTCOMPANY",
    "COMPANYNAME",
    "CMPNAME",
  ]);
  for (const c of candidates) {
    const name = normalizeCompanyName(c);
    if (name) return name;
  }
  const companies = collectByTag(root, ["COMPANY"]);
  for (const c of companies) {
    const name = normalizeCompanyName(c?.["@_NAME"] ?? c?.NAME ?? c?.REMOTECMPNAME ?? c?.CMPNAME);
    if (name) return name;
  }
  return null;
}

/** Return every company exposed by the Tally gateway. The exact name is kept
 * because it must be sent back through SVCURRENTCOMPANY for multi-company
 * books; the normalised label is only for display. */
export function parseCompanies(xml: string): Array<{ name: string; displayName: string; guid?: string }> {
  if (!xml) return [];
  const root = parser.parse(xml);
  const seen = new Set<string>();
  const out: Array<{ name: string; displayName: string; guid?: string }> = [];
  for (const company of collectByTag(root, ["COMPANY"])) {
    const name = txt(company?.["@_NAME"] ?? company?.NAME ?? company?.SVCURRENTCOMPANY).replace(/\s+/g, " ").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const guid = txt(company?.GUID).trim() || undefined;
    out.push({ name, displayName: normalizeCompanyName(name) || name, ...(guid ? { guid } : {}) });
  }
  return out;
}

function statusOf(raw: unknown, date: string): InvoiceStatus {
  const s = txt(raw).toLowerCase();
  if (s.includes("overdue")) return "overdue";
  if (s.includes("pending") || s.includes("unpaid")) return "pending";
  if (s.includes("paid") || s.includes("settled")) return "paid";
  // Tally sales vouchers do not prove settlement. Unknown status remains open
  // until bill-wise/receipt evidence says otherwise.
  return "pending";
}

/** Recursively collect every VOUCHER object anywhere in the parsed tree. */
function collectVouchers(node: unknown, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
    if (key === "VOUCHER") {
      for (const v of arr<any>(val)) out.push(v);
    } else if (typeof val === "object") {
      collectVouchers(val, out);
    }
  }
  return out;
}

function pickParty(v: any): string {
  for (const f of ["PARTYLEDGERNAME", "PARTYNAME", "BASICBUYERNAME", "BASICBASEPARTYNAME", "CONSIGNEENAME", "LedgerName", "LEDGERNAME"]) {
    const value = cleanText(v[f]);
    if (value) return value;
  }
  // fall back to the first ledger entry name (real exports use ALLLEDGERENTRIES.LIST)
  const led = arr<any>(v["ALLLEDGERENTRIES.LIST"] ?? v["LEDGERENTRIES.LIST"]);
  const party = led.find((l) => numOf(l.AMOUNT) < 0); // Dr party in a sale
  return cleanText(party?.LEDGERNAME) || cleanText(party?.["@_NAME"]) || cleanText(led[0]?.LEDGERNAME) || cleanText(led[0]?.["@_NAME"]) || "Unknown";
}

function pickVoucherDate(v: any): string {
  for (const field of ["DATE", "Date", "BASICVOUCHERDATE", "BASICINVOICEDATE", "EFFECTIVEDATE", "BILLDATE", "Bill Date", "REFERENCEDATE"]) {
    const date = maybeIsoDate(v[field]);
    if (date) return date;
  }
  return "";
}

function pickRegion(v: any): string {
  for (const f of ["BASICBUYERSTATE", "PLACEOFSUPPLY", "STATENAME", "CONSIGNEESTATENAME", "GSTBUYERSTATE", "LEDSTATENAME"]) {
    const value = txt(v[f]).trim();
    if (value) return value;
  }
  return "Unspecified";
}

/** Tally gives due as a real date OR a credit period like "60 DAYS". Resolve both. */
function dueDateFrom(v: any, date: string): string {
  const raw = txt(
    v.BASICDUEDATEOFPYMT ??
    v.BILLCREDITPERIOD ??
    v.ORDERDUEDATE ??
    v.DUEDATE ??
    v.DueDate ??
    v.BillDueDate ??
    ""
  ).trim();
  const days = raw.match(/(\d+)\s*day/i);
  if (days) return new Date(+new Date(date) + Number(days[1]) * 86400000).toISOString().slice(0, 10);
  if (/^\d{8}$/.test(raw)) return isoDate(raw);
  const d = new Date(raw);
  if (raw && !isNaN(+d)) return d.toISOString().slice(0, 10);
  return new Date(+new Date(date) + 30 * 86400000).toISOString().slice(0, 10); // default 30d
}

function voucherAmount(v: any): number {
  const inv = arr<any>(v["ALLINVENTORYENTRIES.LIST"] ?? v["INVENTORYENTRIES.LIST"]);
  if (inv.length) return inv.reduce((s, e) => s + qtyOf(e.AMOUNT), 0);
  const led = arr<any>(v["ALLLEDGERENTRIES.LIST"] ?? v["LEDGERENTRIES.LIST"]);
  // invoice value = largest absolute ledger amount (the party/total line)
  return led.reduce(
    (m, l) => Math.max(m, qtyOf(l.AMOUNT)),
    qtyOf(v.AMOUNT ?? v.Amount ?? v.AMOUNT2 ?? v.Amount2 ?? v.AMOUNT1 ?? v.Amount1),
  );
}

function voucherTypeOf(v: any): string {
  return cleanText(v["@_VCHTYPE"]) || cleanText(v.VOUCHERTYPENAME) || cleanText(v.VCHTYPE) || cleanText(v.VoucherType) || cleanText(v.VOUCHERTYPE);
}

function signedAmountOf(raw: unknown): number {
  const s = txt(raw);
  const n = numOf(raw);
  if (/\bcr\b/i.test(s)) return -Math.abs(n);
  if (/\bdr\b/i.test(s)) return Math.abs(n);
  return n;
}

function parseBillAllocations(list: unknown): BillAllocation[] {
  return arr<any>(list)
    .map((b) => ({
      billRef: txt(b.NAME ?? b.BILLREF ?? b["@_NAME"]).trim(),
      billType: txt(b.BILLTYPE ?? b.TYPE).trim() || "Unknown",
      amount: signedAmountOf(b.AMOUNT),
    }))
    .filter((b) => b.billRef && b.amount);
}

function parseVoucherLedgerLines(v: any): VoucherLedgerLine[] {
  return arr<any>(v["ALLLEDGERENTRIES.LIST"] ?? v["LEDGERENTRIES.LIST"])
    .map((l) => {
      const amount = signedAmountOf(l.AMOUNT);
      const entryType: VoucherLedgerLine["entryType"] = amount >= 0 ? "debit" : "credit";
      return {
        ledgerName: cleanText(l.LEDGERNAME) || cleanText(l["@_NAME"]) || "Unknown",
        amount,
        entryType,
        billAllocations: parseBillAllocations(l["BILLALLOCATIONS.LIST"]),
      };
    })
    .filter((l) => l.ledgerName && l.amount);
}

function parseVoucherInventoryLines(v: any): VoucherInventoryLine[] {
  return arr<any>(v["ALLINVENTORYENTRIES.LIST"] ?? v["INVENTORYENTRIES.LIST"])
    .map((e) => {
      const qty = qtyOf(e.ACTUALQTY ?? e.BILLEDQTY) || 1;
      const amount = qtyOf(e.AMOUNT);
      return {
        itemName: cleanText(e.STOCKITEMNAME) || cleanText(e["@_NAME"]) || "Unspecified",
        qty,
        rate: qty ? amount / qty : numOf(e.RATE),
        amount,
      };
    })
    .filter((l) => l.amount > 0);
}

function isSale(v: any): boolean {
  const t = voucherTypeOf(v).toLowerCase();
  if (t) return t.includes("sale") && !/credit note|debit note|sales? order/.test(t);
  // no type given â†’ treat as sale if it has inventory or a positive value
  return voucherAmount(v) > 0;
}

/** Parse voucher-family XML (sales/receipt/credit note/debit note/journal) into
 * stable accounting objects for DB persistence. */
export function parseAccountingVouchers(xml: string, allowVoucherTypes?: string[]): AccountingVoucher[] {
  if (!xml) return [];
  const root = parser.parse(xml);
  const allow = allowVoucherTypes?.length
    ? new Set(allowVoucherTypes.map((t) => t.trim().toLowerCase()))
    : null;
  return collectVouchers(root)
    .map((v, idx): AccountingVoucher => ({
      ...(txt(v.GUID).trim() ? { guid: txt(v.GUID).trim() } : {}),
      ...(Number.isFinite(Number(txt(v.ALTERID))) && Number(txt(v.ALTERID)) > 0 ? { alterId: Number(txt(v.ALTERID)) } : {}),
      voucherType: voucherTypeOf(v) || "Unknown",
      voucherNo: cleanText(v.VOUCHERNUMBER) || cleanText(v.REFERENCE) || `V-${idx + 1}`,
      date: pickVoucherDate(v),
      party: pickParty(v),
      narration: txt(v.NARRATION).trim(),
      amount: voucherAmount(v),
      ledgerLines: parseVoucherLedgerLines(v),
      inventoryLines: parseVoucherInventoryLines(v),
    }))
    .filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v.date))
    .filter((v) => (allow ? allow.has(v.voucherType.trim().toLowerCase()) : true));
}

/** Parse Tally XML (Day Book / Sales Register export) â†’ sales records. Robust to nesting. */
export function parseTallyVouchers(xml: string): SalesRecord[] {
  const root = parser.parse(xml);
  const vouchers = collectVouchers(root).filter(isSale);
  const out: SalesRecord[] = [];
  for (const v of vouchers) {
    const date = pickVoucherDate(v);
    if (!date) continue;
    const dueDate = dueDateFrom(v, date);
    const customer = pickParty(v);
    const region = pickRegion(v);
    const status = statusOf(v.GISSTATUS, date);
    const invoiceNo = txt(v.VOUCHERNUMBER ?? v.VoucherNumber ?? v.REFERENCE ?? v.Reference).trim() || `V-${out.length + 1}`;
    const entries = arr<any>(v["ALLINVENTORYENTRIES.LIST"] ?? v["INVENTORYENTRIES.LIST"]);
    if (entries.length) {
      for (const e of entries) {
        const q = qtyOf(e.ACTUALQTY ?? e.BILLEDQTY) || 1;
        const amount = qtyOf(e.AMOUNT);
        out.push({
          invoiceNo, date, dueDate,
          customerName: customer, region,
          productName: txt(e.STOCKITEMNAME).trim() || "Unspecified",
          category: "General",
          qty: q, unitPrice: q ? amount / q : numOf(e.RATE), amount, status,
        });
      }
    } else {
      // no item-level detail one record at voucher level
      const amount = voucherAmount(v);
      if (amount > 0) {
        out.push({
          invoiceNo, date, dueDate,
          customerName: customer, region,
          productName: txt(v.STOCKITEMNAME ?? v.ItemName).trim() || "Sales", category: "General",
          qty: 1, unitPrice: amount, amount, status,
        });
      }
    }
  }
  return out;
}

/** Parse Tally Stock Summary XML â†’ inventory items. */
export function parseStockSummary(xml: string): InventoryItem[] {
  const root = parser.parse(xml);
  const items: any[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    for (const [k, val] of Object.entries(n as Record<string, unknown>)) {
      if (k === "STOCKITEM") items.push(...arr<any>(val));
      else if (typeof val === "object") walk(val);
    }
  };
  walk(root);
  return items.flatMap((s, i): InventoryItem[] => {
    // Negative stock is an accounting exception, not a positive quantity.
    // Preserve its sign so the item-level book can reconcile to Tally's
    // independent Stock Summary and GI can flag the exception honestly.
    const stock = numOf(s.CLOSINGBALANCE);
    // Closing Value is Tally's authoritative item valuation. Prefer it over
    // display Closing Rate so signed/negative stock still rolls up exactly to
    // Stock Summary; use rate only when value is genuinely unavailable.
    const closingValue = numOf(s.CLOSINGVALUE);
    const unitCost = stock && closingValue ? closingValue / stock : numOf(s.CLOSINGRATE);
    const aging = s.GISAGING != null ? numOf(s.GISAGING) : 30;
    const itemName = txt(s.NAME ?? s["@_NAME"]).trim();
    if (!itemName) return [];
    return [{
      sku: txt(s.SKU).trim() || `T-${i + 1}`,
      itemName,
      category: "General",
      currentStock: stock,
      closingValue,
      reorderLevel: 0,
      unitCost,
      // Stock Summary does not provide a defensible selling price. Never
      // fabricate a margin input from cost.
      sellingPrice: 0,
      lastSaleDate: null,
      agingDays: aging,
    }];
  });
}

/** Parse the GISLedgers TDL collection â†’ ledger closing balances (balance sheet). */
function parseGroupParents(xml: string): Map<string, { name: string; parent: string }> {
  const groups = new Map<string, { name: string; parent: string }>();
  if (!xml) return groups;
  const root = parser.parse(xml);
  for (const group of collectByTag(root, ["GROUP"])) {
    const name = txt(group?.["@_NAME"] ?? group?.NAME).replace(/\s+/g, " ").trim();
    if (!name) continue;
    const parent = txt(group?.PARENT).replace(/\s+/g, " ").trim();
    groups.set(name.toLowerCase(), { name, parent });
  }
  return groups;
}

function groupPath(group: string, parents: Map<string, { name: string; parent: string }>): string {
  const path: string[] = [];
  const seen = new Set<string>();
  let current = group;
  while (current && !seen.has(current.toLowerCase()) && path.length < 20) {
    path.push(current);
    seen.add(current.toLowerCase());
    current = parents.get(current.toLowerCase())?.parent || "";
  }
  return path.join(" > ");
}

const BALANCE_SHEET_ROOTS = /^(capital accounts?|fixed assets?|loans\s*\(liability\)|loans\s*\(asset\)|investments?|current liabilities|current assets|profit and loss a\/c)$/i;

/** Build the full Balance Sheet tree directly from Tally Group and Ledger
 * masters. This keeps every nested group and ledger, not only report totals. */
export function parseBalanceSheetHierarchy(ledgersXml: string, groupsXml: string): BalanceSheetNode[] {
  if (!groupsXml) return [];
  const groupRoot = parser.parse(groupsXml);
  const ledgerRoot = ledgersXml ? parser.parse(ledgersXml) : null;
  type Mutable = BalanceSheetNode & { children: Mutable[] };
  const groups = new Map<string, Mutable>();
  for (const raw of collectByTag(groupRoot, ["GROUP"])) {
    const name = txt(raw?.["@_NAME"] ?? raw?.NAME).replace(/\s+/g, " ").trim();
    if (!name) continue;
    const parentName = txt(raw?.PARENT).replace(/\s+/g, " ").trim() || null;
    const closing = balanceOf(raw?.CLOSINGBALANCE), opening = balanceOf(raw?.OPENINGBALANCE);
    groups.set(name.toLowerCase(), { nodeType: "group", name, parentName, path: [], opening, closing, side: closing > 0 ? "debit" : closing < 0 ? "credit" : "zero", ...(txt(raw?.GUID).trim() ? { guid: txt(raw.GUID).trim() } : {}), ...(numOf(raw?.ALTERID) ? { alterId: numOf(raw.ALTERID) } : {}), ...(numOf(raw?.MASTERID) ? { masterId: numOf(raw.MASTERID) } : {}), ...(maybeIsoDate(raw?.CREATEDDATE) ? { createdDate: maybeIsoDate(raw.CREATEDDATE)! } : {}), ...(maybeIsoDate(raw?.MODIFYDATE) ? { modifiedDate: maybeIsoDate(raw.MODIFYDATE)! } : {}), children: [] });
  }
  for (const group of groups.values()) {
    if (!group.parentName) continue;
    groups.get(group.parentName.toLowerCase())?.children.push(group);
  }
  for (const raw of collectByTag(ledgerRoot, ["LEDGER"])) {
    const name = txt(raw?.["@_NAME"] ?? raw?.NAME ?? raw?.LEDGERNAME).trim();
    const parentName = txt(raw?.PARENT ?? raw?.PARENTNAME).replace(/\s+/g, " ").trim();
    if (!name || !parentName) continue;
    const closing = balanceOf(raw?.CLOSINGBALANCE), opening = balanceOf(raw?.OPENINGBALANCE);
    const node: Mutable = { nodeType: "ledger", name, parentName, path: [], opening, closing, side: closing > 0 ? "debit" : closing < 0 ? "credit" : "zero", ...(txt(raw?.GUID).trim() ? { guid: txt(raw.GUID).trim() } : {}), ...(numOf(raw?.ALTERID) ? { alterId: numOf(raw.ALTERID) } : {}), ...(numOf(raw?.MASTERID) ? { masterId: numOf(raw.MASTERID) } : {}), ...(maybeIsoDate(raw?.CREATEDDATE) ? { createdDate: maybeIsoDate(raw.CREATEDDATE)! } : {}), ...(maybeIsoDate(raw?.MODIFYDATE) ? { modifiedDate: maybeIsoDate(raw.MODIFYDATE)! } : {}), children: [] };
    groups.get(parentName.toLowerCase())?.children.push(node);
  }
  const setPaths = (node: Mutable, parents: string[]) => { node.path = [...parents, node.name]; (node.children as Mutable[]).forEach((child) => setPaths(child, node.path)); };
  const roots = [...groups.values()].filter((group) => BALANCE_SHEET_ROOTS.test(group.name));
  roots.forEach((root) => setPaths(root, []));
  return roots;
}
export function parseLedgers(xml: string, groupsXml = ""): LedgerBalance[] {
  if (!xml) return [];
  const root = parser.parse(xml);
  const groups = parseGroupParents(groupsXml);
  const nodes = collectByTag(root, ["LEDGER"]);
  const out: LedgerBalance[] = [];
  for (const l of nodes) {
    const name = txt(l["@_NAME"] ?? l.NAME ?? l.LEDGERNAME).trim();
    if (!name) continue;
    const directGroup = (txt(l.PARENT) || txt(l.PARENTNAME) || "Unspecified").trim();
    out.push({
      name,
      group: groupPath(directGroup, groups),
      closing: balanceOf(l.CLOSINGBALANCE),
      opening: balanceOf(l.OPENINGBALANCE),
      ...(txt(l.ISBILLWISEON).trim() ? { billWiseEnabled: /^yes$/i.test(txt(l.ISBILLWISEON).trim()) } : {}),
    });
  }
// Balance Sheet Closing Stock is a rolled-up group control and can differ
  // slightly from the signed sum of Stock Summary item rows. Preserve it as
  // a synthetic balance row so owner-facing KPIs match Tally Balance Sheet.
  if (groupsXml) {
    const groupRoot = parser.parse(groupsXml);
    for (const group of collectByTag(groupRoot, ["GROUP"])) {
      const name = txt(group?.["@_NAME"] ?? group?.NAME).replace(/\s+/g, " ").trim();
      if (!/^(closing stock|stock[- ]?in[- ]?hand)$/i.test(name)) continue;
      const parent = txt(group?.PARENT).replace(/\s+/g, " ").trim();
      out.push({
        name,
        group: ["Balance Sheet Group", groupPath(parent, groups)].filter(Boolean).join(" > "),
        closing: balanceOf(group?.CLOSINGBALANCE),
        opening: balanceOf(group?.OPENINGBALANCE),
      });
    }
  }
  return out;
}

const SALARY_RE = /salary|salaries|wages|payroll|staff cost|employee|bonus|incentive|remuneration|labou?r/i;
const EXPENSE_GROUP_RE = /\bexpenses?\b/i;
const PURCHASE_GROUP_RE = /^purchase accounts?$/i;

export function parseExpenses(xml: string, groupsXml = ""): ExpenseLedger[] {
  if (!xml) return [];
  const root = parser.parse(xml);
  const groups = parseGroupParents(groupsXml);
  const nodes = collectByTag(root, ["LEDGER"]);
  const out: ExpenseLedger[] = [];
  for (const l of nodes) {
    const name = txt(l["@_NAME"] ?? l.NAME ?? l.LEDGERNAME).trim();
    if (!name) continue;
    const directGroup = (txt(l.PARENT) || txt(l.PARENTNAME) || "Unspecified").trim();
    const group = groupPath(directGroup, groups);
    const isSalary = SALARY_RE.test(`${name} ${group}`);
    const isExpense = isSalary || EXPENSE_GROUP_RE.test(group) || PURCHASE_GROUP_RE.test(group);
    if (!isExpense) continue;
    const amount = Math.abs(balanceOf(l.CLOSINGBALANCE));
    if (!amount) continue;
    out.push({ name, group, amount, kind: isSalary ? "salary" : "expense" });
  }
  return out.sort((a, b) => b.amount - a.amount);
}
/** Parse the GISBills TDL collection â†’ outstanding bills with real aging. */
export function parseBills(xml: string, asOfDate?: string, forcedKind?: Bill["kind"]): Bill[] {
  if (!xml) return [];
  const root = parser.parse(xml);
  const envelope = root?.ENVELOPE ?? root;
  const fixed = arr<any>(envelope?.BILLFIXED);
  if (fixed.length) {
    const closings = arr<unknown>(envelope?.BILLCL);
    const dueDates = arr<unknown>(envelope?.BILLDUE);
    const asOf = asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(asOfDate) ? +new Date(asOfDate) : Date.now();
    return fixed.flatMap((b, index): Bill[] => {
      const signedAmount = balanceOf(closings[index]);
      const amount = Math.abs(signedAmount);
      if (!amount) return [];
      const date = isoDate(txt(b.BILLDATE));
      if (!date) return [];
      const dueDate = isoDate(txt(dueDates[index]) || date) || date;
      return [{
        party: (txt(b.BILLPARTY) || "Unknown").trim(),
        ref: (txt(b.BILLREF) || `B-${index + 1}`).trim(),
        date,
        dueDate,
        amount,
        signedAmount,
        overdueDays: +new Date(dueDate) < asOf ? Math.floor((asOf - +new Date(dueDate)) / 86400000) : 0,
        kind: forcedKind ?? (balanceOf(closings[index]) < 0 ? "receivable" : "payable"),
      }];
    });
  }
  const nodes = collectByTag(root, ["BILLS", "BILL", "BILLOUTSTANDING", "RECEIVABLE"]);
  const asOf = asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(asOfDate) ? +new Date(asOfDate) : Date.now();
  const out: Bill[] = [];
  for (const b of nodes) {
    const signed = balanceOf(b.CLOSINGBALANCE ?? b.PENDINGAMOUNT ?? b.AMOUNT ?? b.Amount ?? b.OPENINGBALANCE);
    if (!signed) continue;
    const date = isoDate(txt(b.BILLDATE) || txt(b.BillDate) || txt(b.DATE) || txt(b.Date));
    if (!date) continue;
    const dueDate = dueDateFrom(
      {
        BILLCREDITPERIOD: txt(b.BILLCREDITPERIOD) || txt(b.DueDate),
        BASICDUEDATEOFPYMT: txt(b.DUEDATE) || txt(b.DueDate),
        DueDate: txt(b.DueDate),
      },
      date,
    );
    const overdueDays = +new Date(dueDate) < asOf ? Math.floor((asOf - +new Date(dueDate)) / 86400000) : 0;
    const party = (txt(b.PARTY) || txt(b.PARENT) || txt(b.LEDGERNAME) || txt(b.LedgerName) || txt(b["@_NAME"]) || "Unknown").trim();
    const ref = (txt(b["@_NAME"]) || txt(b.NAME) || txt(b.BILLREF) || txt(b.BILLNO) || txt(b.VoucherNumber) || `B-${out.length + 1}`).trim();
    const billType = txt(b.Billtype) || txt(b.BILLTYPE);
    out.push({
      party,
      ref,
      date,
      dueDate,
      amount: Math.abs(signed),
      signedAmount: signed,
      overdueDays,
      // Sundry Debtors bills = receivable; sign convention varies, so classify by
      // the bill's parent group when present, else by sign.
      kind: forcedKind ?? (
        /debtor|receivable/i.test(txt(b.PARENT)) || /new ref|agst ref/i.test(billType) || root?.RECEIVABLE != null
          ? "receivable"
          : /creditor|payable/i.test(txt(b.PARENT))
            ? "payable"
            : signed >= 0
              ? "payable"
              : "receivable"),
    });
  }
  return out;
}

function normalizeReportLabel(raw: string): string {
  return decodeXmlEntities(raw).replace(/\s+/g, " ").replace(/[:]+$/g, "").trim().toLowerCase();
}

/** Tally Profit & Loss export is a flat row stream:
 * DSPACCNAME/DSPDISPNAME -> PLAMT/BSMAINAMT. We read the exact Sales Accounts
 * and Direct Incomes rows so dashboard revenue matches Tally's own P&L. */
export function parseProfitAndLossRevenue(xml: string): number | null {
  if (!xml) return null;
  const rowRe =
    /<DSPACCNAME>\s*<DSPDISPNAME>([\s\S]*?)<\/DSPDISPNAME>\s*<\/DSPACCNAME>\s*<PLAMT>([\s\S]*?)<\/PLAMT>/gi;
  let matched = false;
  let total = 0;

  for (const match of xml.matchAll(rowRe)) {
    const label = normalizeReportLabel(match[1] ?? "");
    if (!["sales accounts", "sales account", "direct incomes", "direct income"].includes(label)) continue;
    const amountXml = match[2] ?? "";
    const amount =
      numOf((amountXml.match(/<BSMAINAMT[^>]*>([\s\S]*?)<\/BSMAINAMT>/i) || [])[1]) ||
      numOf((amountXml.match(/<PLSUBAMT[^>]*>([\s\S]*?)<\/PLSUBAMT>/i) || [])[1]);
    total += Math.abs(amount);
    matched = true;
  }

  return matched ? total : null;
}

export function buildDataset(
  company: string,
  dayBookXml: string,
  stockXml: string,
  profitAndLossXml = "",
  billsXml = "",
  asOfOverride?: string,
  ledgersXml = "",
  vouchersInput: string | AccountingVoucher[] = "",
  billReports?: { receivableXml?: string; payableXml?: string },
  groupsXml = "",
): BusinessDataset {
  const sales = parseTallyVouchers(dayBookXml);
  const inventory = parseStockSummary(stockXml);
  const profitAndLossRevenue = parseProfitAndLossRevenue(profitAndLossXml);
  const asOf = asOfOverride && /^\d{4}-\d{2}-\d{2}$/.test(asOfOverride) ? asOfOverride : latestIsoDate(sales.map((r) => r.date));
  const bills = billReports
    ? [
        ...parseBills(billReports.receivableXml || "", asOf, "receivable"),
        ...parseBills(billReports.payableXml || "", asOf, "payable"),
      ]
    : parseBills(billsXml, asOf);
  const ledgers = parseLedgers(ledgersXml, groupsXml);
  const balanceSheetHierarchy = parseBalanceSheetHierarchy(ledgersXml, groupsXml);
  const expenses = parseExpenses(ledgersXml, groupsXml);
  const vouchers = Array.isArray(vouchersInput)
    ? vouchersInput
    : parseAccountingVouchers(vouchersInput || dayBookXml);
  return {
    company: normalizeCompanyName(company) || company,
    currency: "INR",
    source: "tally",
    asOf,
    sales,
    inventory,
    ...(profitAndLossRevenue !== null ? { profitAndLossRevenue } : {}),
    ...(balanceSheetHierarchy.length ? { balanceSheetHierarchy } : {}),
    ...(ledgers.length ? { ledgers } : {}),
    ...(expenses.length ? { expenses } : {}),
    ...(bills.length ? { bills } : {}),
    ...(vouchers.length ? { vouchers } : {}),
    ...(bills.length ? { billKindMapping: "tally-signed-v2" as const } : {}),
    ...(bills.length ? { billAgeingAsOf: asOf } : {}),
  };
}

export type TallyDataQuality = {
  ok: boolean;
  score: number;
  businessProfile: "service_leaning" | "inventory_leaning" | "mixed" | "insufficient_evidence";
  domainGates: Record<"identity" | "sales" | "purchases" | "cash" | "receivables" | "payables" | "inventory", "verified" | "review" | "unavailable" | "not_applicable">;
  errors: string[];
  warnings: string[];
  reconciliation: ReconciliationPack;
  checks: {
    salesVoucherCount: number;
    salesInvoiceCount: number;
    salesReconciliationPct: number;
    receivableBills: number;
    payableBills: number;
    ledgerRows: number;
    stockCostCoveragePct: number;
    latestFlowDate: string | null;
    flowLagDays: number | null;
    duplicateSalesRows: number;
    duplicateVoucherKeys: number;
    vouchersWithoutLines: number;
    unbalancedVouchers: number;
    profitAndLossDifferencePct: number | null;
    grossSalesTotal: number;
    salesReturnAdjustments: number;
    netSalesControlTotal: number;
    tradeReceivablesDifferencePct: number | null;
    tradePayablesDifferencePct: number | null;
    inventoryMovementCoveragePct: number;
    purchaseVoucherCount: number;
    moneyVoucherCount: number;
  };
};

/** Fail closed when Tally returned lots of sales vouchers but the sales parser
 * could not turn them into invoices. This prevents impressive-looking but
 * materially incomplete dashboards from being published. */
export function assessTallyDataQuality(d: BusinessDataset): TallyDataQuality {
  const reconciliationPack = buildReconciliationPack(d);
  const saleVouchers = (d.vouchers ?? []).filter((v) => {
    const type = v.voucherType || "";
    return /(^|\b)sale(s)?(\b|$)/i.test(type) && !/credit|debit|order/i.test(type);
  });
  const invoiceCount = new Set(d.sales.map((row) => row.invoiceNo)).size;
  const reconciliation = saleVouchers.length ? invoiceCount / saleVouchers.length : d.sales.length ? 1 : 0;
  const receivableBills = (d.bills ?? []).filter((bill) => bill.kind === "receivable").length;
  const payableBills = (d.bills ?? []).filter((bill) => bill.kind === "payable").length;
  const pricedStock = d.inventory.filter((item) => item.currentStock === 0 || item.unitCost > 0).length;
  const stockCostCoverage = d.inventory.length ? pricedStock / d.inventory.length : 1;
  const salesKeys = new Set<string>();
  let duplicateSalesRows = 0;
  for (const row of d.sales) {
    const key = [row.invoiceNo, row.date, row.customerName, row.productName, row.qty, row.amount].join("|").toLowerCase();
    if (salesKeys.has(key)) duplicateSalesRows += 1;
    else salesKeys.add(key);
  }
  const voucherKeys = new Set<string>();
  let duplicateVoucherKeys = 0;
  let vouchersWithoutLines = 0;
  let unbalancedVouchers = 0;
  const movementNames = new Set<string>();
  for (const voucher of d.vouchers ?? []) {
    const key = (voucher.guid || `${voucher.voucherType}|${voucher.voucherNo}|${voucher.date}`).toLowerCase();
    if (voucherKeys.has(key)) duplicateVoucherKeys += 1;
    else voucherKeys.add(key);
    if (!voucher.ledgerLines.length && !voucher.inventoryLines.length) vouchersWithoutLines += 1;
    if (voucher.ledgerLines.length && Math.abs(voucher.ledgerLines.reduce((sum, line) => sum + line.amount, 0)) > 1) {
      unbalancedVouchers += 1;
    }
    for (const line of voucher.inventoryLines) if (line.itemName) movementNames.add(line.itemName.trim().toLowerCase());
  }
  const flowDates = [...d.sales.map((row) => row.date), ...(d.vouchers ?? []).map((voucher) => voucher.date)]
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const latestFlowDate = flowDates.length ? flowDates.reduce((latest, date) => date > latest ? date : latest) : null;
  const flowLagDays = latestFlowDate
    ? Math.max(0, Math.floor((+new Date(`${d.asOf}T00:00:00Z`) - +new Date(`${latestFlowDate}T00:00:00Z`)) / 86400000))
    : null;
  const explicitSyncWindow = Boolean(d.syncWindow?.from && d.syncWindow?.to);
  const salesTotal = d.sales.reduce((sum, row) => sum + Math.abs(row.amount), 0);
  const salesReturnAdjustments = (d.vouchers ?? [])
    .filter((voucher) => /return|credit note/i.test(voucher.voucherType) && !/purchase|supplier|debit/i.test(voucher.voucherType))
    .reduce((sum, voucher) => sum + Math.abs(voucher.amount), 0);
  const netSalesControlTotal = Math.max(0, salesTotal - salesReturnAdjustments);
  const profitAndLossDifferencePct = d.profitAndLossRevenue != null && d.profitAndLossRevenue !== 0
    ? Math.abs(netSalesControlTotal - Math.abs(d.profitAndLossRevenue)) / Math.abs(d.profitAndLossRevenue) * 100
    : null;
  const debtorNames = new Set((d.ledgers ?? []).filter((ledger) => /debtor|receivable/i.test(ledger.group)).map((ledger) => ledger.name.trim().toLowerCase()));
  const creditorNames = new Set((d.ledgers ?? []).filter((ledger) => /creditor|payable/i.test(ledger.group)).map((ledger) => ledger.name.trim().toLowerCase()));
  const debtorLedgerTotal = Math.abs((d.ledgers ?? []).filter((ledger) => /debtor|receivable/i.test(ledger.group)).reduce((sum, ledger) => sum + ledger.closing, 0));
  const creditorLedgerTotal = Math.abs((d.ledgers ?? []).filter((ledger) => /creditor|payable/i.test(ledger.group)).reduce((sum, ledger) => sum + ledger.closing, 0));
  // Tally's Bills Receivable/Payable reports split rows by balance sign, not by
  // the ledger's accounting group. A debtor can therefore appear in both
  // reports (invoice on one side, credit note/advance on the other). Reconcile
  // every signed bill row back to the party's debtor/creditor ledger group.
  const tradeReceivableBills = (d.bills ?? []).filter((bill) => debtorNames.has(bill.party.trim().toLowerCase()));
  const tradePayableBills = (d.bills ?? []).filter((bill) => creditorNames.has(bill.party.trim().toLowerCase()));
  // Bill reports can include opposite-sign adjustments/advances. Reconcile the
  // signed net to the signed ledger control, while keeping positive magnitudes
  // for the customer/supplier action queues.
  const tradeReceivables = Math.abs(tradeReceivableBills.reduce((sum, bill) => sum + (bill.signedAmount ?? bill.amount), 0));
  const tradePayables = Math.abs(tradePayableBills.reduce((sum, bill) => sum + (bill.signedAmount ?? bill.amount), 0));
  const tradeReceivablesDifferencePct = debtorLedgerTotal ? Math.abs(tradeReceivables - debtorLedgerTotal) / debtorLedgerTotal * 100 : null;
  const tradePayablesDifferencePct = creditorLedgerTotal ? Math.abs(tradePayables - creditorLedgerTotal) / creditorLedgerTotal * 100 : null;
  const movementCovered = d.inventory.filter((item) => Boolean(item.lastSaleDate) || movementNames.has(item.itemName.trim().toLowerCase())).length;
  const inventoryMovementCoverage = d.inventory.length ? movementCovered / d.inventory.length : 1;
  const purchaseVoucherCount = (d.vouchers ?? []).filter((voucher) => /purchase|debit note/i.test(voucher.voucherType) && !/order/i.test(voucher.voucherType)).length;
  const moneyVoucherCount = (d.vouchers ?? []).filter((voucher) => /receipt|payment|contra/i.test(voucher.voucherType)).length;
  const hasInventoryEvidence = d.inventory.length > 0 || (d.vouchers ?? []).some((voucher) => voucher.inventoryLines.length > 0);
  const hasSalesEvidence = saleVouchers.length > 0 || d.sales.length > 0;
  const businessProfile: TallyDataQuality["businessProfile"] = !hasSalesEvidence && !(d.ledgers?.length ?? 0)
    ? "insufficient_evidence"
    : hasInventoryEvidence && purchaseVoucherCount > 0
      ? "inventory_leaning"
      : !hasInventoryEvidence && hasSalesEvidence
        ? "service_leaning"
        : "mixed";
  const hasCashLedgers = (d.ledgers ?? []).some((ledger) => /bank accounts?|cash[- ]?in[- ]?hand/i.test(ledger.group));
  const errors: string[] = [];
  const warnings: string[] = [];

  if (saleVouchers.length >= 20 && reconciliation < 0.8) {
    errors.push(`Only ${invoiceCount} sales invoices reconciled from ${saleVouchers.length} sales vouchers.`);
  }
  if ((d.bills?.length ?? 0) > 0 && (!receivableBills || !payableBills)) {
    warnings.push("Only one side of bill-wise outstandings was captured.");
  }
  if ((d.bills?.length ?? 0) > 0 && !(d.ledgers?.length ?? 0)) {
    warnings.push("Outstanding bills arrived without ledger masters.");
  }
  if (!latestFlowDate && ((d.ledgers?.length ?? 0) > 0 || (d.bills?.length ?? 0) > 0)) {
    warnings.push("Balance and outstanding reports arrived, but no valid dated voucher flow was returned for the selected period.");
  }
  if (d.inventory.length >= 20 && stockCostCoverage < 0.7) {
    warnings.push(`Cost/value is missing for ${d.inventory.length - pricedStock} stock items.`);
  }

  if (flowLagDays !== null && flowLagDays > 120 && !explicitSyncWindow) errors.push(`Dated transaction flow is ${flowLagDays} days behind the ${d.asOf} balance date.`);
  else if (flowLagDays !== null && flowLagDays > 45) warnings.push(`Dated transaction flow is ${flowLagDays} days behind the selected ${d.asOf} balance date.`);
  if (d.sales.length && duplicateSalesRows / d.sales.length > 0.02) errors.push(`${duplicateSalesRows} duplicate sales rows exceed the 2% trust limit.`);
  else if (duplicateSalesRows) warnings.push(`${duplicateSalesRows} duplicate sales rows require reconciliation.`);
  if (duplicateVoucherKeys) warnings.push(`${duplicateVoucherKeys} duplicate voucher keys require AlterID/GUID reconciliation.`);
  if (vouchersWithoutLines) warnings.push(`${vouchersWithoutLines} vouchers have no ledger or inventory lines.`);
  if (unbalancedVouchers) warnings.push(`${unbalancedVouchers} vouchers do not balance within ₹1.`);
  if (profitAndLossDifferencePct !== null && profitAndLossDifferencePct > 2) {
    const message = `Sales lines differ from Profit & Loss revenue by ${profitAndLossDifferencePct.toFixed(2)}%.`;
    if (explicitSyncWindow) warnings.push(message);
    else errors.push(message);
  }
  else if (profitAndLossDifferencePct !== null && profitAndLossDifferencePct > 0.25) warnings.push(`Sales lines differ from Profit & Loss revenue by ${profitAndLossDifferencePct.toFixed(2)}%.`);
  if (tradeReceivablesDifferencePct !== null && tradeReceivablesDifferencePct > 5) {
    const message = `Trade receivable bills differ from debtor ledgers by ${tradeReceivablesDifferencePct.toFixed(2)}%.`;
    if (explicitSyncWindow) warnings.push(message);
    else errors.push(message);
  }
  else if (tradeReceivablesDifferencePct !== null && tradeReceivablesDifferencePct > 0.5) warnings.push(`Trade receivable bills differ from debtor ledgers by ${tradeReceivablesDifferencePct.toFixed(2)}%.`);
  if (tradePayablesDifferencePct !== null && tradePayablesDifferencePct > 5) {
    const message = `Trade payable bills differ from creditor ledgers by ${tradePayablesDifferencePct.toFixed(2)}%.`;
    if (explicitSyncWindow) warnings.push(message);
    else errors.push(message);
  }
  else if (tradePayablesDifferencePct !== null && tradePayablesDifferencePct > 0.5) warnings.push(`Trade payable bills differ from creditor ledgers by ${tradePayablesDifferencePct.toFixed(2)}%.`);
  if (d.inventory.length >= 20 && inventoryMovementCoverage < 0.6) warnings.push(`Movement evidence covers only ${Math.round(inventoryMovementCoverage * 100)}% of stock items; ageing advice remains blocked.`);
  for (const control of reconciliationPack.controls) {
    if (control.status === "failed" && !["receivables", "payables", "sales_register"].includes(control.id)) {
      const message = `${control.label} failed: ${control.reason}`;
      if (explicitSyncWindow) warnings.push(message);
      else errors.push(message);
    } else if (control.status === "review" || control.status === "unavailable") {
      warnings.push(`${control.label}: ${control.reason}`);
    }
  }

  const deductions = errors.length * 50 + warnings.length * 10;
  const domainGates: TallyDataQuality["domainGates"] = {
    identity: reconciliationPack.domainGates.identity === "verified" ? "verified" : "review",
    sales: !hasSalesEvidence
      ? "unavailable"
      : reconciliation >= 0.8 && profitAndLossDifferencePct !== null && profitAndLossDifferencePct <= 2
        && reconciliationPack.domainGates.sales === "verified"
        ? "verified"
        : "review",
    purchases: purchaseVoucherCount > 0
      ? reconciliationPack.domainGates.purchases === "verified" ? "verified" : "review"
      : "unavailable",
    cash: moneyVoucherCount > 0 && hasCashLedgers
      ? reconciliationPack.domainGates.cash === "verified" ? "verified" : "review"
      : moneyVoucherCount > 0 || hasCashLedgers ? "review" : "unavailable",
    receivables: !debtorLedgerTotal && !tradeReceivableBills.length
      ? "unavailable"
      : tradeReceivablesDifferencePct !== null && tradeReceivablesDifferencePct <= 5
        && reconciliationPack.domainGates.receivables === "verified"
        ? "verified"
        : "review",
    payables: !creditorLedgerTotal && !tradePayableBills.length
      ? "unavailable"
      : tradePayablesDifferencePct !== null && tradePayablesDifferencePct <= 5
        && reconciliationPack.domainGates.payables === "verified"
        ? "verified"
        : "review",
    inventory: businessProfile === "service_leaning"
      ? "not_applicable"
      : !hasInventoryEvidence
        ? "unavailable"
        : stockCostCoverage >= 0.7 && inventoryMovementCoverage >= 0.6
          && reconciliationPack.domainGates.inventory === "verified"
          ? "verified"
          : "review",
  };
  return {
    ok: errors.length === 0,
    score: Math.max(0, 100 - deductions),
    businessProfile,
    domainGates,
    errors,
    warnings,
    reconciliation: reconciliationPack,
    checks: {
      salesVoucherCount: saleVouchers.length,
      salesInvoiceCount: invoiceCount,
      salesReconciliationPct: Math.round(reconciliation * 100),
      receivableBills,
      payableBills,
      ledgerRows: d.ledgers?.length ?? 0,
      stockCostCoveragePct: Math.round(stockCostCoverage * 100),
      latestFlowDate,
      flowLagDays,
      duplicateSalesRows,
      duplicateVoucherKeys,
      vouchersWithoutLines,
      unbalancedVouchers,
      profitAndLossDifferencePct: profitAndLossDifferencePct === null ? null : Number(profitAndLossDifferencePct.toFixed(2)),
      grossSalesTotal: Number(salesTotal.toFixed(2)),
      salesReturnAdjustments: Number(salesReturnAdjustments.toFixed(2)),
      netSalesControlTotal: Number(netSalesControlTotal.toFixed(2)),
      tradeReceivablesDifferencePct: tradeReceivablesDifferencePct === null ? null : Number(tradeReceivablesDifferencePct.toFixed(2)),
      tradePayablesDifferencePct: tradePayablesDifferencePct === null ? null : Number(tradePayablesDifferencePct.toFixed(2)),
      inventoryMovementCoveragePct: Math.round(inventoryMovementCoverage * 100),
      purchaseVoucherCount,
      moneyVoucherCount,
    },
  };
}

/** Build a dataset from a single uploaded Tally XML export (vouchers + any stock items in it). */
export function datasetFromTallyXmlFile(xml: string, company: string): BusinessDataset {
  const sales = parseTallyVouchers(xml);
  const inventory = parseStockSummary(xml); // present if it's a combined/stock export
  const vouchers = parseAccountingVouchers(xml);
  const asOf = latestIsoDate(sales.map((r) => r.date));
  return {
    company: normalizeCompanyName(company) || company,
    currency: "INR",
    source: "tally",
    asOf,
    sales,
    inventory,
    ...(vouchers.length ? { vouchers } : {}),
  };
}
