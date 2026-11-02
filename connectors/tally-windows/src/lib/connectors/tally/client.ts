import type { AccountingVoucher, BusinessDataset } from "@/lib/engine/types";
import { request as httpRequest } from "node:http";
import {
  connectivityRequest,
  dayBookControlRequest,
  outstandingsRequest,
  payablesRequest,
  purchaseRegisterRequest,
  salesRegisterRequest,
  stockSummaryRequest,
  trialBalanceRequest,
} from "./requests";
import {
  allVouchersTDL,
  balanceSheetTDL,
  cashBankControlTDL,
  companyTDL,
  ledgersTDL,
  groupsTDL,
  profitAndLossTDL,
  stockTDL,
} from "./tdl";
import { buildDataset, parseAccountingVouchers, parseCompanies, parseCompanyName, parseTallyVouchers } from "./parse";
import type { SalesRecord } from "@/lib/engine/types";
import { parseTallyControlSnapshot } from "@/lib/reconciliation/tally-controls";

export interface TallyConfig {
  host: string; // "localhost" / "localhost"
  port?: number; // default 9000
  from?: string;
  to?: string;
  /** Exact Tally company name. Required when the gateway exposes more than one company. */
  company?: string;
}

function indiaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function currentFinancialYearStart(): string {
  const [year, month] = indiaToday().split("-").map(Number);
  return `${month >= 4 ? year : year - 1}-04-01`;
}

/** Tally commonly replies in UTF-16 (often LE). Decode by BOM, then heuristic. */
function decodeTally(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  // No BOM: if every other byte is a NUL, it's UTF-16LE without a BOM.
  const sample = b.subarray(0, Math.min(400, b.length));
  const nulls = sample.reduce((n, x) => n + (x === 0 ? 1 : 0), 0);
  return nulls > sample.length * 0.2
    ? new TextDecoder("utf-16le").decode(buf)
    : new TextDecoder("utf-8").decode(buf);
}

function decodeBuffer(buf: Buffer): string {
  return decodeTally(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

function tallyError(xml: string): string | null {
  return (xml.match(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/i)?.[1] ?? "").trim() || null;
}

/**
 * TallyPrime's HTTP listener is intentionally small and can close a response
 * socket without the framing undici/fetch expects. Node's raw HTTP client is
 * more tolerant, but we still accept a response only when the XML envelope is
 * complete. That prevents a socket reset from silently storing partial books.
 */
function postTallyOnce(c: TallyConfig, xml: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(xml, "utf8");
    let settled = false;
    const finish = (err?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(value ?? "");
    };

    const req = httpRequest(
      {
        host: c.host.trim(),
        port: c.port ?? 9000,
        method: "POST",
        path: "/",
        agent: false,
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "Content-Length": body.byteLength,
          Connection: "close",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let ended = false;

        const acceptIfComplete = () => {
          const text = decodeBuffer(Buffer.concat(chunks));
          if ((res.statusCode ?? 500) >= 400) {
            finish(new Error(`Tally HTTP ${res.statusCode}`));
            return;
          }
          if (!/<ENVELOPE\b/i.test(text) || !/<\/ENVELOPE>/i.test(text)) {
            finish(new Error("Tally closed the response before the XML was complete"));
            return;
          }
          const lineError = tallyError(text);
          if (lineError) {
            finish(new Error(`Tally: ${lineError}`));
            return;
          }
          finish(undefined, text);
        };

        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          ended = true;
          acceptIfComplete();
        });
        // Some Tally builds emit `aborted`/`close` after sending a complete XML
        // envelope. Validate the envelope instead of discarding valid data.
        res.on("aborted", acceptIfComplete);
        res.on("close", () => {
          if (!ended) acceptIfComplete();
        });
        res.on("error", (error) => finish(error));
      },
    );

    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Tally request timed out after ${Math.round(timeoutMs / 1000)} seconds`)));
    req.on("error", (error) => finish(error));
    req.end(body);
  });
}

async function postTally(c: TallyConfig, xml: string, timeoutMs = 60000, attempts = 3): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await postTallyOnce(c, xml, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 350));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Tally request failed");
}

async function requiredReport(c: TallyConfig, label: string, xml: string): Promise<string> {
  try { return await postTally(c, xml); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} extraction failed; no partial snapshot was published: ${message}`);
  }
}

async function controlReport(c: TallyConfig, label: string, xml: string): Promise<string> {
  try {
    return await postTally(c, xml, 90000);
  } catch (error) {
    console.warn(`Tally control report unavailable (${label}):`, error instanceof Error ? error.message : error);
    return "";
  }
}

function friendlyError(c: TallyConfig, e: unknown): string {
  const at = `${c.host}:${c.port ?? 9000}`;
  const msg = e instanceof Error ? e.message : String(e);
  if (/^(localhost|127\.)/i.test(c.host.trim()) && /ECONNREFUSED|refused|network|fetch failed/i.test(msg))
    return `Tally is not detected on this computer at ${at}. Open TallyPrime and your company, then enable F1 → Settings → Connectivity → Server, port ${c.port ?? 9000}.`;
  if (/timed out|timeout|aborted/i.test(msg))
    return `No response from Tally at ${at}. Check: same Wi-Fi, Windows firewall allows port ${c.port ?? 9000}, and a company is open.`;
  if (/ECONNREFUSED|refused/i.test(msg))
    return `Connection refused at ${at}. Tally's HTTP server isn't listening — enable it (F1 → Settings → Connectivity → set as Server, port ${c.port ?? 9000}) and reopen the company.`;
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg))
    return `Can't find host "${c.host}". Use the Windows laptop's LAN IP (run "ipconfig" → IPv4 Address), not its name.`;
  if (/ECONNRESET|network|fetch failed/i.test(msg))
    return `Network error reaching ${at}. Make sure both machines are on the same Wi-Fi and the firewall allows port ${c.port ?? 9000}.`;
  return `Could not reach Tally at ${at} — ${msg}`;
}

/** Reachability + company check. */
export async function testTally(
  c: TallyConfig,
): Promise<{ ok: boolean; company?: string; companies?: Array<{ name: string; displayName: string; guid?: string }>; requiresCompanySelection?: boolean; message: string }> {
  try {
    // A connection test is interactive: fail once with a useful diagnosis
    // instead of making the operator wait through three 30-second retries.
    // Full extraction paths keep their retries because they are background work.
    const companyXml = await postTally(c, companyTDL(), 30000, 1);
    const companies = parseCompanies(companyXml);
    const exactCompany = c.company?.trim();
    if (!companies.length) {
      return {
        ok: false,
        companies,
        message: "Tally is reachable, but no company is open. Open the required company in TallyPrime, then test the connection again.",
      };
    }
    if (exactCompany && !companies.some((company) => company.name === exactCompany)) {
      return {
        ok: false,
        companies,
        message: `The selected Tally company is no longer open. Refresh the company list and select it again.`,
      };
    }
    if (!exactCompany && companies.length > 1) {
      return {
        ok: true,
        companies,
        requiresCompanySelection: true,
        message: `${companies.length} companies are open in Tally. Select the company to test and sync.`,
      };
    }
    const selected = exactCompany || companies[0]?.name;
    // Trial Balance is a small built-in report and is consistently faster than
    // custom collections or Day Book on large companies.
    const { from, to } = range(c);
    const xml = await postTally(c, connectivityRequest(from, to, selected), 30000, 1);
    const ok = /ENVELOPE/i.test(xml);
    const company = selected ? normalizeSelectedCompany(selected) : (ok ? parseCompanyName(xml) || undefined : undefined);
    return {
      ok,
      company,
      companies,
      message: ok
        ? `Connected to ${company || "Tally"} at ${c.host}:${c.port ?? 9000}. Ready to sync.`
        : `Reached ${c.host}:${c.port ?? 9000}, but it did not return Tally XML. Is a company open in Tally?`,
    };
  } catch (e) {
    return { ok: false, message: friendlyError(c, e) };
  }
}

function normalizeSelectedCompany(company: string): string {
  return company.replace(/\s*[-–—]?\s*\(?\s*from\s+.*$/i, "").trim() || company;
}

function range(c: TallyConfig) {
  const to = c.to ?? indiaToday();
  const from = c.from ?? currentFinancialYearStart();
  return { from, to };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthRanges(from: string, to: string): Array<{ from: string; to: string }> {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const out: Array<{ from: string; to: string }> = [];

  for (let year = fromYear, month = fromMonth; year < toYear || (year === toYear && month <= toMonth); ) {
    const monthFrom = year === fromYear && month === fromMonth ? from : `${year}-${pad2(month)}-01`;
    const monthTo =
      year === toYear && month === toMonth
        ? to
        : `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;
    out.push({ from: monthFrom, to: monthTo });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return out;
}

async function fetchVoucherBook(c: TallyConfig, from: string, to: string): Promise<{ vouchers: AccountingVoucher[]; sales: SalesRecord[] }> {
  const vouchers: AccountingVoucher[] = [];
  const sales: SalesRecord[] = [];
  for (const chunk of monthRanges(from, to)) {
    // The explicit $Date formula is required: some Tally companies ignore
    // SVFROMDATE/SVTODATE on the built-in Day Book and return the UI period.
    const xml = await postTally(c, allVouchersTDL(chunk.from, chunk.to, c.company), 120000);
    vouchers.push(...parseAccountingVouchers(xml));
    sales.push(...parseTallyVouchers(xml));
  }
  return { vouchers, sales };
}

/** Pull sales, stock, P&L revenue, bill-wise outstanding, and vouchers into the canonical dataset. */
export async function syncTally(c: TallyConfig): Promise<BusinessDataset> {
  const { from, to } = range(c);
  // TallyPrime's local gateway is not a general-purpose concurrent API. Pull
  // reports one at a time so a large bill collection cannot reset another
  // voucher response mid-flight.
  const companyXml = await postTally(c, companyTDL(), 30000);
  const companies = parseCompanies(companyXml);
  if (!c.company && companies.length > 1) {
    throw new Error(`${companies.length} companies are open in Tally. Select the exact company before syncing.`);
  }
  if (c.company && !companies.some((company) => company.name === c.company)) {
    throw new Error("The selected Tally company is no longer open. Test the connection and select it again.");
  }
  const selectedCompany = c.company || companies[0]?.name;
  const selectedIdentity = companies.find((candidate) => candidate.name === selectedCompany);
  const selectedConfig = { ...c, company: selectedCompany };
  // Every requested report is part of one accounting snapshot. A transport
  // failure aborts publication; a valid empty report still returns Tally XML.
  const groupsXml = await requiredReport(selectedConfig, "Group hierarchy", groupsTDL(from, to, selectedCompany));
  const ledgersXml = await requiredReport(selectedConfig, "Ledger master", ledgersTDL(from, to, selectedCompany));
  const billsReceivableXml = await requiredReport(selectedConfig, "Bills receivable", outstandingsRequest(from, to, selectedCompany));
  const billsPayableXml = await requiredReport(selectedConfig, "Bills payable", payablesRequest(from, to, selectedCompany));
  const stockXml = await requiredReport(selectedConfig, "Stock summary", stockTDL(from, to, selectedCompany));
  const balanceSheetXml = await requiredReport(selectedConfig, "Balance Sheet", balanceSheetTDL(from, to, selectedCompany));
  const profitAndLossXml = await requiredReport(selectedConfig, "Profit and Loss", profitAndLossTDL(from, to, selectedCompany));
  const voucherBook = await fetchVoucherBook(selectedConfig, from, to);
  const salesRegisterXml = await controlReport(selectedConfig, "Sales Register", salesRegisterRequest(from, to, selectedCompany));
  const purchaseRegisterXml = await controlReport(selectedConfig, "Purchase Register", purchaseRegisterRequest(from, to, selectedCompany));
  const dayBookReportXml = await controlReport(selectedConfig, "Day Book", dayBookControlRequest(from, to, selectedCompany));
  const trialBalanceXml = await controlReport(selectedConfig, "Trial Balance", trialBalanceRequest(from, to, selectedCompany));
  const cashBankBooksXml = await controlReport(selectedConfig, "Cash/Bank ledger control", cashBankControlTDL(from, to, selectedCompany));
  const stockSummaryReportXml = await controlReport(selectedConfig, "Stock Summary", stockSummaryRequest(from, to, selectedCompany));
  const company = selectedCompany ? normalizeSelectedCompany(selectedCompany) : parseCompanyName(companyXml) || `Tally - ${c.host}`;
  const dataset = buildDataset(company, "", stockXml, profitAndLossXml, "", to, ledgersXml, voucherBook.vouchers, {
    receivableXml: billsReceivableXml,
    payableXml: billsPayableXml,
  }, groupsXml);
  const exactName = selectedIdentity?.name || selectedCompany || company;
  const guid = selectedIdentity?.guid;
  return {
    ...dataset,
    sales: voucherBook.sales,
    tallyControls: parseTallyControlSnapshot({
      salesRegisterXml,
      balanceSheetXml,
      purchaseRegisterXml,
      dayBookReportXml,
      trialBalanceXml,
      billsReceivableXml,
      billsPayableXml,
      cashBankBooksXml,
      stockSummaryXml: stockSummaryReportXml || stockXml,
    }),
    companyIdentity: {
      externalId: guid ? `guid:${guid}` : `name:${exactName.toLowerCase()}`,
      exactName,
      displayName: company,
      ...(guid ? { guid } : {}),
    },
    syncWindow: { from, to, receivedAt: new Date().toISOString(), channel: "direct" },
  };
}
