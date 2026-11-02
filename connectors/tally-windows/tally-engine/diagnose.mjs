#!/usr/bin/env node
// GIS Tally Diagnostic — probes a live Tally gateway and reports EXACTLY what
// each report returns, so we can build the connector against real evidence
// instead of guessing. Run on a machine that can reach the Tally PC.
//
//   node diagnose.mjs <host> [port] [fromYYYYMMDD] [toYYYYMMDD]
//   node diagnose.mjs 192.168.1.2 9000
//
// Writes full raw XML for each report to ./tally-diag/<report>.xml and prints a
// summary table. Zip the tally-diag folder and send it back. No deps (Node 18+).
//
// Strategy: balance/ledger reports FIRST (fast, point-in-time — this is the data
// we actually need). Heavy voucher dumps LAST and over a SMALL range (just to
// capture the XML shape, not 4 years of data). 25s cap per report so nothing hangs.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [, , host = "localhost", port = "9000", fromArg, toArg] = process.argv;

const today = new Date();
const yyyymmdd = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
// Full company range for balances; a 31-day window for voucher SHAPE samples.
const FULL_FROM = fromArg || "20220401";
const FULL_TO = toArg || yyyymmdd(today);
const SAMPLE_FROM = yyyymmdd(new Date(today.getTime() - 31 * 86400000));
const SAMPLE_TO = FULL_TO;

const OUT = join(process.cwd(), "tally-diag");
mkdirSync(OUT, { recursive: true });

// scope: "balance" = full range, point-in-time closing balances (FAST).
// scope: "sample" = small 31-day window, just to see the voucher XML shape.
const REPORTS = [
  { id: "Trial Balance", file: "trial-balance", scope: "balance" },
  { id: "Group Summary", file: "group-summary", scope: "balance" },
  { id: "Balance Sheet", file: "balance-sheet", scope: "balance" },
  { id: "Bills Receivable", file: "bills-receivable", scope: "balance" },
  { id: "Bills Payable", file: "bills-payable", scope: "balance" },
  { id: "Stock Summary", file: "stock-summary", scope: "balance" },
  { id: "List of Accounts", file: "masters", scope: "balance" },
  { id: "Ledger", file: "ledger", scope: "balance" },
  // heavy voucher dumps last, small range = quick shape sample
  { id: "Sales Register", file: "sales-register", scope: "sample" },
  { id: "Day Book", file: "daybook", scope: "sample" },
  { id: "Voucher Register", file: "voucher-register", scope: "sample" },
];

function envelope(reportId, from, to) {
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>${reportId}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVFROMDATE TYPE="Date">${from}</SVFROMDATE>
        <SVTODATE TYPE="Date">${to}</SVTODATE>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

// Tally usually replies in UTF-16LE. Decode by BOM, then by NUL heuristic.
function decode(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  const sample = b.subarray(0, Math.min(400, b.length));
  const nulls = sample.reduce((n, x) => n + (x === 0 ? 1 : 0), 0);
  return nulls > sample.length * 0.2
    ? new TextDecoder("utf-16le").decode(buf)
    : new TextDecoder("utf-8").decode(buf);
}

const count = (s, re) => (s.match(re) || []).length;

async function probe({ id, file, scope }) {
  const url = `http://${host}:${port}`;
  const [from, to] = scope === "sample" ? [SAMPLE_FROM, SAMPLE_TO] : [FULL_FROM, FULL_TO];
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8" },
      body: envelope(id, from, to),
      signal: AbortSignal.timeout(25000),
    });
    const xml = decode(await res.arrayBuffer());
    writeFileSync(join(OUT, `${file}.xml`), xml, "utf8");
    const lineErr = /<LINEERROR>([^<]*)<\/LINEERROR>/i.exec(xml);
    return {
      http: res.status,
      bytes: xml.length,
      vouchers: count(xml, /<VOUCHER[ >]/gi),
      ledgers: count(xml, /<LEDGER[ >]/gi),
      stockItems: count(xml, /<STOCKITEM[ >]/gi),
      bills: count(xml, /<BILL[ >]|<BILLFIXED/gi),
      rows: count(xml, /<DSPACCNAME>/gi),
      lineError: lineErr ? lineErr[1].trim().slice(0, 60) : "",
    };
  } catch (e) {
    writeFileSync(join(OUT, `${file}.ERROR.txt`), String(e?.message || e), "utf8");
    return { http: "ERR", error: String(e?.message || e).slice(0, 60) };
  }
}

console.log(`\nGIS Tally Diagnostic → http://${host}:${port}`);
console.log(`balances ${FULL_FROM}–${FULL_TO} · voucher samples ${SAMPLE_FROM}–${SAMPLE_TO}\n`);
for (const r of REPORTS) {
  process.stdout.write(`  ${r.id.padEnd(18)} … `);
  const res = await probe(r);
  if (res.http === "ERR") console.log(`ERROR: ${res.error}`);
  else
    console.log(
      `HTTP ${res.http} | ${String(res.bytes).padStart(8)} chars | ` +
        `vch:${res.vouchers} led:${res.ledgers} stk:${res.stockItems} ` +
        `bill:${res.bills} row:${res.rows}` +
        (res.lineError ? ` | LINEERROR: ${res.lineError}` : ""),
    );
}

console.log(`\n✓ Raw XML saved to: ${OUT}`);
console.log(`Next: zip that folder (or screenshot this table) and send it back.\n`);
