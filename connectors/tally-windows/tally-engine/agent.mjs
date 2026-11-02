#!/usr/bin/env node
/**
 * GIS Tally Engine - runs ON the Windows PC where Tally lives.
 * Pulls the company's Day Book month by month plus stock/P&L exports from the
 * local Tally gateway (localhost:9000), then pushes the XML to Growth Intelligence.
 *
 * Run:  node agent.mjs            (one sync)
 *       node agent.mjs --watch    (sync every N minutes, see config.intervalMinutes)
 */
import { gzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { monthRanges, resolveSyncWindow } from "./date-ranges.mjs";

const here = dirname(fileURLToPath(import.meta.url));
function loadConfig() {
  let file = {};
  const p = join(here, "config.json");
  if (existsSync(p)) {
    try {
      file = JSON.parse(readFileSync(p, "utf8"));
    } catch {}
  }

  return {
    tallyUrl: process.env.TALLY_URL || file.tallyUrl || "http://localhost:9000",
    giUrl: (process.env.GI_URL || file.giUrl || "http://localhost:3122").replace(/\/$/, ""),
    token: process.env.GI_TOKEN || file.token || "",
    orgId: process.env.GI_ORG_ID || file.orgId || "",
    company: process.env.COMPANY || file.company || "",
    from: process.env.FROM || file.from || "current-fy",
    to: process.env.TO || file.to || "today",
    intervalMinutes: Number(process.env.INTERVAL || file.intervalMinutes || 60),
  };
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const ymd = (s) => s.replace(/-/g, "");
const xmlText = (value) => String(value || "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

function staticVariables(from, to, company) {
  return `<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>` +
    (from && to ? `<SVFROMDATE TYPE="Date">${ymd(from)}</SVFROMDATE><SVTODATE TYPE="Date">${ymd(to)}</SVTODATE>` : "") +
    (company ? `<SVCURRENTCOMPANY>${xmlText(company)}</SVCURRENTCOMPANY>` : "");
}

function reqEnvelope(reportId, from, to, company, explode = false) {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>${reportId}</ID></HEADER><BODY><DESC><STATICVARIABLES>${staticVariables(from, to, company)}${explode ? "<EXPLODEFLAG>Yes</EXPLODEFLAG>" : ""}</STATICVARIABLES></DESC></BODY></ENVELOPE>`;
}

function collectionReq(id, type, fetch, from, to, company, filterXml = "", systemXml = "") {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>${id}</ID></HEADER><BODY><DESC><STATICVARIABLES>${staticVariables(from, to, company)}</STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="${id}" ISMODIFY="No" ISINITIALIZE="Yes"><TYPE>${type}</TYPE>${filterXml}<FETCH>${fetch.join(",")}</FETCH></COLLECTION>${systemXml}</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}

const voucherFetch = [
  "GUID", "ALTERID", "MASTERID",
  "DATE", "VOUCHERTYPENAME", "VOUCHERNUMBER", "REFERENCE", "PARTYLEDGERNAME", "PARTYNAME",
  "BASICBUYERNAME", "BASICBUYERSTATE", "PLACEOFSUPPLY", "NARRATION", "AMOUNT",
  "ALLLEDGERENTRIES.LIST", "ALLINVENTORYENTRIES.LIST",
];

const allVouchersReq = (from, to, company) => collectionReq(
  "GISAllVouchers",
  "Voucher",
  voucherFetch,
  from,
  to,
  company,
  "<FILTER>GISVoucherDateFilter</FILTER>",
  '<SYSTEM TYPE="Formulae" NAME="GISVoucherDateFilter">$Date &gt;= ##SVFromDate AND $Date &lt;= ##SVToDate</SYSTEM>',
);

const ledgersReq = (from, to, company) =>
  collectionReq(
    "GISLedgers",
    "Ledger",
    [
      "NAME", "PARENT", "OPENINGBALANCE", "CLOSINGBALANCE", "CURRENCYNAME", "ISBILLWISEON",
      "GUID", "ALTERID", "MASTERID", "CREATEDDATE", "MODIFYDATE",
      "LEDGERMOBILE", "LEDGERMOBILENO", "LEDGERMOBILENUMBER", "LEDMOBILE", "LEDMOBILENO",
      "MOBILENUMBER", "MOBILE", "PRIMARYMOBILE", "PRIMARYMOBILENO", "PRIMARYMOBILENUMBER",
      "LEDGERPHONE", "LEDGERPHONENO", "LEDPHONE", "LEDPHONENO", "PHONENUMBER", "PHONE",
      "EMAIL", "EMAILID", "LEDGERCONTACT", "CONTACTPERSON",
      "CONTACTDETAILS.LIST", "CONTACTDETAILS.LIST.MOBILE", "CONTACTDETAILS.LIST.PHONE", "CONTACTDETAILS.LIST.EMAIL",
      "ADDRESS", "ADDRESS.LIST", "ADDRESS.LIST.ADDRESS",
    ],
    from,
    to,
    company,
  );

const groupsReq = (from, to, company) => collectionReq("GISGroups", "Group", ["NAME", "PARENT", "OPENINGBALANCE", "CLOSINGBALANCE", "GUID", "ALTERID", "MASTERID", "CREATEDDATE", "MODIFYDATE"], from, to, company);
const companiesReq = () => collectionReq("GISCompanies", "Company", ["NAME", "GUID"], undefined, undefined, undefined);
const stockReq = (from, to, company) =>
  collectionReq("GISStock", "StockItem", ["NAME", "PARENT", "BASEUNITS", "CLOSINGBALANCE", "CLOSINGVALUE", "CLOSINGRATE"], from, to, company);
const cashBankControlReq = (from, to, company) => collectionReq(
  "GISCashBankControl",
  "Ledger",
  ["NAME", "PARENT", "CLOSINGBALANCE"],
  from,
  to,
  company,
  "<FILTER>GISCashBankFilter</FILTER>",
  '<SYSTEM TYPE="Formulae" NAME="GISCashBankFilter">$$IsLedOfGrp:$Name:$$GroupBank OR $$IsLedOfGrp:$Name:$$GroupCash</SYSTEM>',
);

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function openCompanies(xml) {
  return [...xml.matchAll(/<COMPANY\b([^>]*)>([\s\S]*?)<\/COMPANY>/gi)]
    .map((match) => {
      const name = decodeXmlText(match[1].match(/\bNAME="([^"]+)"/i)?.[1] || match[2].match(/<NAME>([\s\S]*?)<\/NAME>/i)?.[1]).trim();
      const guid = decodeXmlText(match[2].match(/<GUID>([\s\S]*?)<\/GUID>/i)?.[1]).trim();
      return { name, ...(guid ? { guid } : {}) };
    })
    .filter((company) => company.name);
}

function decode(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);

  const sample = b.subarray(0, Math.min(400, b.length));
  let nulls = 0;
  for (const x of sample) if (x === 0) nulls++;
  return nulls > sample.length * 0.2
    ? new TextDecoder("utf-16le").decode(buf)
    : new TextDecoder("utf-8").decode(buf);
}

function decodeBuffer(buf) {
  return decode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function postTallyOnce(cfg, xml, timeoutMs = 120000) {
  const url = new URL(cfg.tallyUrl);
  return new Promise((resolve, reject) => {
    const body = Buffer.from(xml, "utf8");
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value || "");
    };

    const req = httpRequest(
      {
        hostname: url.hostname,
        port: Number(url.port || 9000),
        path: url.pathname || "/",
        method: "POST",
        agent: false,
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "Content-Length": body.byteLength,
          Connection: "close",
        },
      },
      (res) => {
        const chunks = [];
        let ended = false;
        const acceptIfComplete = () => {
          const text = decodeBuffer(Buffer.concat(chunks));
          if ((res.statusCode || 500) >= 400) return finish(new Error(`Tally HTTP ${res.statusCode}`));
          if (!/<ENVELOPE\b/i.test(text) || !/<\/ENVELOPE>/i.test(text)) {
            return finish(new Error("Tally closed the response before the XML was complete"));
          }
          const lineError = (text.match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/i)?.[1] || "").trim();
          return lineError ? finish(new Error(`Tally: ${lineError}`)) : finish(null, text);
        };
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => { ended = true; acceptIfComplete(); });
        res.on("aborted", acceptIfComplete);
        res.on("close", () => { if (!ended) acceptIfComplete(); });
        res.on("error", (error) => finish(error));
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Tally request timed out after ${Math.round(timeoutMs / 1000)} seconds`)));
    req.on("error", (error) => finish(error));
    req.end(body);
  });
}

async function postTally(cfg, xml) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await postTallyOnce(cfg, xml);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError || new Error("Tally request failed");
}

async function postGi(cfg, payload) {
  const body = gzipSync(Buffer.from(JSON.stringify(payload)));
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(`${cfg.giUrl}/api/ingest/tally/chunks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Encoding": "gzip", "x-gi-token": cfg.token, "x-gi-org": cfg.orgId },
        body,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) {
        const error = new Error(out.message || out.error || `GI HTTP ${res.status}`);
        error.status = res.status;
        throw error;
      }
      return out;
    } catch (error) {
      lastError = error;
      if (error.status && error.status < 500) throw error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError || new Error("GI upload failed");
}

function textChunks(value, size = 4_500_000) {
  const out = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(value.length, start + size);
    if (end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1])) end -= 1;
    out.push(value.slice(start, end));
    start = end;
  }
  return out;
}

async function pushResumable(cfg, metadata, fields) {
  const started = await postGi(cfg, { action: "start", ...metadata });
  let uploaded = 0;
  for (const [field, content] of Object.entries(fields)) {
    if (!content) continue;
    const chunks = textChunks(content);
    for (let sequence = 0; sequence < chunks.length; sequence += 1) {
      await postGi(cfg, { action: "append", sessionId: started.sessionId, field, sequence, content: chunks[sequence] });
      uploaded += 1;
      log(`  upload ${field} ${sequence + 1}/${chunks.length}`);
    }
  }
  log(`Uploaded ${uploaded} durable chunks. Finalising accounting controls ...`);
  return postGi(cfg, { action: "finalize", sessionId: started.sessionId });
}

async function syncOnce(cfg) {
  if (!cfg.orgId) throw new Error("Missing orgId in config.json. Open https://gi.bizgenix.ai/connections, copy Organization ID from Tally Engine, or run: node setup.mjs");
  if (!cfg.token) throw new Error("Missing token in config.json. Open https://gi.bizgenix.ai/connections, copy Agent token from Tally Engine, or run: node setup.mjs");
  const companies = openCompanies(await postTally(cfg, companiesReq()));
  const selectedCompany = cfg.company.trim() || (companies.length === 1 ? companies[0].name : "");
  if (!selectedCompany) throw new Error(`${companies.length} companies are open. Set the exact Tally company name in config.json.`);
  const selectedIdentity = companies.find((company) => company.name === selectedCompany);
  if (companies.length && !selectedIdentity) {
    throw new Error(`Configured company "${selectedCompany}" is not open in Tally.`);
  }
  const { from, to } = resolveSyncWindow(cfg);
  log(`Pulling "${selectedCompany}" @ ${cfg.tallyUrl}  (${from} -> ${to})`);

  const voucherNodes = [];
  for (const [mf, mt] of monthRanges(from, to)) {
    const xml = await postTally(cfg, allVouchersReq(mf, mt, selectedCompany));
    const nodes = xml.match(/<VOUCHER\b[\s\S]*?<\/VOUCHER>/gi) || [];
    voucherNodes.push(...nodes);
    log(`  ${mf.slice(0, 7)} -> ${nodes.length} vouchers`);
  }

  const dayBookXml = `<ENVELOPE><BODY><DATA><COLLECTION>${voucherNodes.join("\n")}</COLLECTION></DATA></BODY></ENVELOPE>`;
  const required = async (label, xml) => {
    try { return await postTally(cfg, xml); }
    catch (e) { throw new Error(`${label} extraction failed; no partial snapshot was published: ${e.message}`); }
  };
  const control = async (label, xml) => {
    try { return await postTally(cfg, xml); }
    catch (e) {
      log(`  control unavailable: ${label} (${e.message})`);
      return "";
    }
  };

  const stockXml = await required("stock item collection", stockReq(from, to, selectedCompany));
  const balanceSheetXml = await required("balance sheet", reqEnvelope("Balance Sheet", from, to, selectedCompany));
  const profitAndLossXml = await required("profit and loss", reqEnvelope("Profit and Loss", from, to, selectedCompany));
  const billsReceivableXml = await required("bills receivable", reqEnvelope("Bills Receivable", from, to, selectedCompany));
  const billsPayableXml = await required("bills payable", reqEnvelope("Bills Payable", from, to, selectedCompany));
  const ledgersXml = await required("ledgers", ledgersReq(from, to, selectedCompany));
  const groupsXml = await required("groups", groupsReq(from, to, selectedCompany));
  const salesRegisterXml = await control("Sales Register", reqEnvelope("Sales Register", from, to, selectedCompany, true));
  const purchaseRegisterXml = await control("Purchase Register", reqEnvelope("Purchase Register", from, to, selectedCompany, true));
  const dayBookReportXml = await control("Day Book", reqEnvelope("Day Book", from, to, selectedCompany, true));
  const trialBalanceXml = await control("Trial Balance", reqEnvelope("Trial Balance", from, to, selectedCompany));
  const cashBankControlXml = await control("Cash/Bank ledger control", cashBankControlReq(from, to, selectedCompany));
  const stockSummaryReportXml = await control("Stock Summary", reqEnvelope("Stock Summary", from, to, selectedCompany));
  const billCount =
    (billsReceivableXml.match(/<BILLFIXED\b/gi) || []).length +
    (billsPayableXml.match(/<BILLFIXED\b/gi) || []).length;
  const ledgerCount = (ledgersXml.match(/<LEDGER\b/gi) || []).length;

  log(`Collected ${voucherNodes.length} vouchers, ${billCount} bills, ${ledgerCount} ledgers. Starting resumable push to ${cfg.giUrl} ...`);
  const out = await pushResumable(
    cfg,
    { company: selectedCompany, companyGuid: selectedIdentity?.guid, from, to },
    {
      vouchersXml: dayBookXml,
      stockXml,
      balanceSheetXml,
      profitAndLossXml,
      billsReceivableXml,
      billsPayableXml,
      ledgersXml,
      groupsXml,
      salesRegisterXml,
      purchaseRegisterXml,
      dayBookReportXml,
      trialBalanceXml,
      cashBankControlXml,
      stockSummaryReportXml,
    },
  );
  log(`Synced: ${out.salesRows} sales | ${out.billRows || 0} bills | ${out.inventoryRows} stock -> "${out.company}" · ${out.datasetVersion || "version pending"}`);
}

const cfg = loadConfig();
if (process.argv.includes("--watch")) {
  log(`Watch mode - every ${cfg.intervalMinutes} min. Ctrl+C to stop.`);
  const run = () => syncOnce(cfg).catch((e) => log("error:", e.message));
  run();
  setInterval(run, cfg.intervalMinutes * 60000);
} else {
  syncOnce(cfg).catch((e) => {
    log("error:", e.message);
    process.exit(1);
  });
}
