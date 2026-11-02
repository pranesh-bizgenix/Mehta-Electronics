import type { AccountingVoucher, BusinessDataset, SalesRecord } from "@/lib/engine/types";
import { inr, inrFull } from "@/lib/engine/kpis";
import { customerReceivableBills, supplierPayableBills, groupBalance, isTallyBillOverdue } from "@/lib/engine/financials";
import { operatingPeriod, type OperatingPeriod } from "@/lib/engine/period";
import { buildCostCommand } from "@/lib/engine/cost-command";
import { buildPlanningCommand } from "@/lib/engine/planning-command";
import { emptyBudgetPlan } from "@/lib/budget-plan/types";
import { buildGrowthCommand } from "@/lib/engine/growth-command";
import { buildFundingCommand } from "@/lib/engine/funding-command";
import { emptyFundingPlan } from "@/lib/funding-plan/types";
import { buildScenarioLab } from "@/lib/engine/scenario-lab";
import { emptyScenarioPlan } from "@/lib/scenario-plan/types";
import type {
  AnalyseOptions,
  AnalystAction,
  AnalystChart,
  AnalystEvidence,
  AnalystIntent,
  AnalystPeriod,
  AnalystResponse,
  AnalystSection,
  AnalystStatus,
  AnalystTable,
} from "./types";

const DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
const uniq = (values: string[]) => new Set(values.map(clean).filter(Boolean)).size;
const amount = <T>(rows: T[], value: (row: T) => number) => rows.reduce((sum, row) => sum + value(row), 0);
const percent = (value: number, total: number) => total ? (value / total) * 100 : 0;
const formatDate = (value: string | null) => value && ISO_DATE.test(value)
  ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
  : "not available";

function groupBy<T>(rows: T[], key: (row: T) => string, value: (row: T) => number) {
  const grouped = new Map<string, number>();
  for (const row of rows) {
    const name = clean(key(row)) || "Unspecified";
    grouped.set(name, (grouped.get(name) ?? 0) + value(row));
  }
  return [...grouped].map(([name, total]) => ({ name, value: total })).sort((a, b) => b.value - a.value);
}

function dateRange(values: string[]): { from: string | null; to: string | null } {
  const valid = values.filter((value) => ISO_DATE.test(value)).sort();
  return { from: valid[0] ?? null, to: valid.at(-1) ?? null };
}

function previousMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 2, 1));
  return date.toISOString().slice(0, 7);
}

function endOfMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10);
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

function namedMonths(question: string) {
  const matches = [...question.toLowerCase().matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/g)];
  return [...new Set(matches.map((match) => `${match[2]}-${MONTHS[match[1]]}`))].sort();
}

function resolvePeriod(data: BusinessDataset, question: string, selected: OperatingPeriod, previous?: AnalystPeriod): AnalystPeriod {
  const q = question.toLowerCase();
  const flowDates = [
    ...data.sales.map((row) => row.date),
    ...(data.vouchers ?? [])
      .filter((row) => row.voucherType !== "Unknown" && (row.amount || row.ledgerLines.length || row.inventoryLines.length))
      .map((row) => row.date),
  ];
  const range = dateRange(flowDates);
  const salesRange = dateRange(data.sales.map((row) => row.date));
  let id: AnalystPeriod["id"] = selected;
  let window = operatingPeriod(data.asOf, selected);
  let label = window.label;
  let from = window.from;
  let to = window.to;
  const explicitMonths = namedMonths(question);

  if (previous && /^(why|how|show|break|compare|what about|and|which|who|those|that|it|now)\b/.test(q.trim()) && !explicitMonths.length && !/\b(fy|financial year|month|history|current|previous|all|overall|lifetime)\b/.test(q)) {
    id = previous.id;
    from = previous.from;
    to = previous.to;
    label = from ? `${formatDate(from)} – ${formatDate(to)}` : "All available history";
  }

  const fy = q.match(/(?:fy|financial year)\s*(20\d{2})\s*(?:-|–|to|\/)?\s*(?:20)?(\d{2})?/i);
  if (explicitMonths.length) {
    id = "custom";
    from = `${explicitMonths[0]}-01`;
    to = endOfMonth(explicitMonths.at(-1)!);
    label = explicitMonths.length === 1
      ? new Date(`${explicitMonths[0]}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
      : `${new Date(`${explicitMonths[0]}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })} vs ${new Date(`${explicitMonths.at(-1)}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`;
  } else if (fy) {
    const year = Number(fy[1]);
    id = "custom";
    from = `${year}-04-01`;
    to = `${year + 1}-03-31`;
    label = `FY ${year}–${String(year + 1).slice(-2)}`;
  } else if (/\b(this|current) month\b/.test(q)) {
    const month = data.asOf.slice(0, 7);
    id = "custom";
    from = `${month}-01`;
    to = data.asOf;
    label = `Current month · ${new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}`;
  } else if (/\b(last|previous|latest complete) month\b/.test(q) && salesRange.to) {
    const latestMonth = salesRange.to.slice(0, 7);
    const completeMonth = Number(salesRange.to.slice(8, 10)) < 28 ? previousMonth(latestMonth) : latestMonth;
    id = "custom";
    from = `${completeMonth}-01`;
    to = endOfMonth(completeMonth);
    label = `Latest complete sales month · ${new Date(`${completeMonth}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}`;
  } else if (/\b(all|overall|lifetime|entire|full)\s+(history|period|data)?\b/.test(q)) {
    id = "all";
    from = null;
    to = data.asOf;
    label = "All available history";
  }

  const latestFlowDate = range.to;
  const lagDays = latestFlowDate ? Math.floor((+new Date(`${data.asOf}T00:00:00`) - +new Date(`${latestFlowDate}T00:00:00`)) / DAY) : Infinity;
  return {
    id,
    label,
    from,
    to,
    asOf: data.asOf,
    latestFlowDate,
    flowFreshness: latestFlowDate ? (lagDays > 62 ? "stale" : "current") : "missing",
    balanceLabel: `Balance snapshot · ${formatDate(data.asOf)}`,
  };
}

function inPeriod(date: string, period: AnalystPeriod) {
  return ISO_DATE.test(date) && (!period.from || date >= period.from) && date <= period.to;
}

function detectIntents(question: string, previous: AnalystIntent[] = []): AnalystIntent[] {
  const q = question.toLowerCase();
  const found: AnalystIntent[] = [];
  const add = (intent: AnalystIntent, re: RegExp) => { if (re.test(q) && !found.includes(intent)) found.push(intent); };

  add("products", /\b(product|products|item|items|sku|skus|mix)\b/);
  add("regions", /\b(region|regions|state|states|territor|geograph|market)\b/);
  add("receivables", /\b(receivable|receivables|debtor|debtors|outstanding|overdue|owed to (?:us|me)|who owes|collect|collection)\b/);
  add("payables", /\b(payable|payables|creditor|creditors|supplier dues|we owe|owe suppliers|vendors?|vendor payments?|supplier payments?|payments? to vendors?|payments? to suppliers?)\b/);
  add("inventory", /\b(inventory|stock|overstock|slow[- ]?moving|dead stock|stock ageing)\b/);
  add("salary", /\b(salary|salaries|payroll|wages|staff cost|labou?r cost|bonus)\b/);
  add("cash_movement", /\b(cash flow|cashflow|cash movement|receipts? and payments?|receipt vouchers?|payment vouchers?|money in|money out|cash in|cash out|liquidity|bank balance|cash balance)\b/);
  add("profitability", /\b(profit|profitability|margin|gross margin|net margin|ebitda|cogs)\b/);
  add("expenses", /\b(expenses?|operating costs?|opex|costs? leak|costs? reduction|spend)\b/);
  add("budget", /\b(budget|plan vs actual|actual vs plan|over (?:budget|plan)|variance|target attainment)\b/);
  add("procurement", /\b(procurement|purchase prices?|buying prices?|supplier prices?|supplier concentration|vendor concentration|purchase plan|purchase budget)\b/);
  add("growth_bridge", /\b(why (?:did )?sales (?:change|move)|sales bridge|revenue bridge|price volume|volume mix|price mix|sales drivers?)\b/);
  add("customer_momentum", /\b(customers? (?:(?:going|went) )?quiet|inactive customers?|dormant customers?|win[- ]?back|losing customers?|customer momentum|re[- ]?engage|customers? dropped|dropped customers?)\b/);
  add("funding", /\b(funding|borrowings?|debt|loans?|overdraft|cash credit|finance cost|interest burden|lender|repric|refinanc|sanctioned limit|headroom)\b/);
  add("scenario", /\b(scenario|what[- ]?if|forecast|projection|next quarter|next year|cash release case|upside|downside)\b/);
  add("customers", /\b(top customers?|buyers?|customer concentration)\b/);
  add("revenue", /\b(revenue|sales|turnover|aov|average order|growth|momentum|trend|month[- ]on[- ]month)\b/);

  // The fair-period growth bridge is the controlling sales comparison. Do not
  // append the generic monthly revenue section and create a second denominator.
  if (found.includes("growth_bridge")) {
    const revenueIndex = found.indexOf("revenue");
    if (revenueIndex >= 0) found.splice(revenueIndex, 1);
  }

  if (!found.length && previous.length && /^(why|how|show|break|compare|what about|and|which|who|those|that|it|now)\b/.test(q.trim())) {
    if (/\btop\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(q)) {
      const ranking = previous.find((intent) => intent === "products" || intent === "regions" || intent === "customers" || intent === "receivables" || intent === "payables");
      if (ranking) return [ranking];
    }
    return previous;
  }
  const keywords: Record<AnalystIntent, RegExp> = {
    revenue: /\b(revenue|sales|turnover|aov|growth|momentum|trend|month)/,
    products: /\b(product|item|sku|mix)/,
    regions: /\b(region|state|territor|geograph|market)/,
    customers: /\b(customer|buyer|churn|quiet|inactive)/,
    receivables: /\b(receivable|debtor|outstanding|overdue|owed|collect)/,
    payables: /\b(payable|creditor|supplier|vendor|we owe)/,
    inventory: /\b(inventory|stock|overstock|slow|dead)/,
    salary: /\b(salary|payroll|wages|staff|labou?r|bonus)/,
    cash_movement: /\b(cash|receipt|payment|liquidity|bank)/,
    profitability: /\b(profit|margin|ebitda|cogs)/,
    expenses: /\b(expenses?|costs?|opex|spend)/,
    budget: /\b(budget|plan|variance|target)/,
    procurement: /\b(procurement|purchase|supplier|vendor|buying)/,
    growth_bridge: /\b(why|bridge|price|volume|driver)/,
    customer_momentum: /\b(quiet|inactive|dormant|win|losing|momentum|engage)/,
    funding: /\b(funding|borrow|debt|loan|overdraft|interest|lender|reprice|refinanc|headroom)/,
    scenario: /\b(scenario|what|forecast|projection|next|upside|downside)/,
  };
  return found.sort((a, b) => q.search(keywords[a]) - q.search(keywords[b])).slice(0, 4);
}

function requestedLimit(question: string, fallback = 10) {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const match = question.toLowerCase().match(/\btop\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (!match) return fallback;
  return Math.max(1, Math.min(20, Number(match[1]) || words[match[1]] || fallback));
}

function evidenceHref(kpi: string, period: AnalystPeriod) {
  const params = new URLSearchParams({ kpi, asOf: period.asOf });
  if (period.id !== "custom") params.set("period", period.id);
  if (period.from) params.set("from", period.from);
  if (period.id === "custom") params.set("to", period.to);
  return `/data?${params.toString()}`;
}

function baseActions(kpi: string, period: AnalystPeriod): AnalystAction[] {
  return [{ label: "Open ledger evidence", description: "Inspect the rows behind this answer.", href: evidenceHref(kpi, period), kind: "evidence" }];
}

function salesEvidence(rows: SalesRecord[], period: AnalystPeriod, label = "Dated sales lines"): AnalystEvidence {
  return {
    id: `sales:${period.from ?? "start"}:${period.to}`,
    source: "sales",
    label,
    detail: `${rows.length.toLocaleString("en-IN")} line rows across ${uniq(rows.map((row) => row.invoiceNo)).toLocaleString("en-IN")} invoices · ${period.label}`,
    rowCount: rows.length,
    href: evidenceHref("revenue", period),
  };
}

function emptySection(intent: AnalystIntent, title: string, summary: string, limitation: string, action: AnalystAction): AnalystSection {
  return {
    id: intent,
    intent,
    title,
    summary,
    status: "insufficient_data",
    confidence: 1,
    metrics: [],
    calculation: [],
    evidence: [],
    limitations: [limitation],
    actions: [action],
  };
}

function evidenceAvailability(data: BusinessDataset) {
  const items: string[] = [];
  if (data.sales.length) items.push(`${data.sales.length.toLocaleString("en-IN")} sales lines`);
  if (data.bills?.length) items.push(`${data.bills.length.toLocaleString("en-IN")} bills`);
  if (data.vouchers?.length) items.push(`${data.vouchers.length.toLocaleString("en-IN")} vouchers`);
  if (data.ledgers?.length) items.push(`${data.ledgers.length.toLocaleString("en-IN")} ledgers`);
  if (data.inventory.length) items.push(`${data.inventory.length.toLocaleString("en-IN")} stock rows`);
  return items;
}

function latestVoucherDate(data: BusinessDataset) {
  return dateRange((data.vouchers ?? [])
    .filter((voucher) => voucher.voucherType !== "Unknown" && (voucher.amount || voucher.ledgerLines.length || voucher.inventoryLines.length))
    .map((voucher) => voucher.date)).to;
}

function buildGuidancePrompts(data: BusinessDataset) {
  const prompts: string[] = [];
  if (data.sales.length) prompts.push("What is the latest supported sales period?");
  if ((data.vouchers ?? []).some((voucher) => /receipt|payment/i.test(voucher.voucherType))) {
    prompts.push("Show cash movement from receipt and payment vouchers");
  }
  if (data.bills?.length) prompts.push("Show supplier payables and reconciliation gaps");
  if ((data.vouchers ?? []).length || (data.ledgers ?? []).length) {
    prompts.push("How much payroll cost is visible in all available history?");
  }
  if (data.inventory.length) prompts.push("What can you support about inventory value and reconciliation?");
  if ((data.vouchers ?? []).some((voucher) => /purchase/i.test(voucher.voucherType))) {
    prompts.push("Where are supplier prices moving?");
  }
  if (!prompts.length) {
    prompts.push(
      "Show my trade receivables",
      "What is the latest supported sales period?",
      "Show supplier payables and reconciliation gaps",
    );
  }
  return [...new Set(prompts)].slice(0, 4);
}

function guidedUnsupportedResponse(data: BusinessDataset, question: string, period: AnalystPeriod) {
  const q = question.toLowerCase().trim();
  const available = evidenceAvailability(data);
  const latestVoucher = latestVoucherDate(data);
  const prompts = buildGuidancePrompts(data);
  const latestFlow = period.latestFlowDate ? `Transaction flow is visible through ${formatDate(period.latestFlowDate)}.` : "No dated transaction flow is visible yet.";
  const voucherFlow = latestVoucher && latestVoucher !== period.latestFlowDate
    ? `Voucher-backed flow is visible through ${formatDate(latestVoucher)}.`
    : "";
  const evidenceLine = available.length
    ? `Right now GI can see ${available.join(", ")}.`
    : "Right now GI does not have connected dated evidence to answer from.";

  if (/\b(company name|which company|what company|what is my company)\b/.test(q)) {
    return {
      status: "limited" as const,
      answer: `${clean(data.company)} is the connected company in view. ${evidenceLine} Ask about sales, receivables, payables, inventory, payroll, cash movement, expenses or funding and GI will stay grounded in those books.`,
      followUps: prompts,
      limitations: ["Ask GI is a governed books analyst. It answers from connected business evidence, not as a general chat assistant."],
    };
  }

  if (/^(hi|hello|hey|help|start|what can you do)\b/.test(q)) {
    return {
      status: "limited" as const,
      answer: `${evidenceLine} ${latestFlow} Ask GI works best when the question points to a books topic such as sales, receivables, payables, inventory, payroll, cash movement, expenses or funding.`,
      followUps: prompts,
      limitations: ["GI calculates first and only narrates when the question maps to supported accounting evidence."],
    };
  }

  if (/\b(employee|employees|staff|team|working hard|hardest|productiv|performance|best performer)\b/.test(q)) {
    return {
      status: "limited" as const,
      answer: `I understood this as an employee-performance question. ${evidenceLine} The books may support payroll cost when salary or payroll ledgers are matched, but they cannot prove who is "working hard" or rank employee productivity from accounting vouchers alone.`,
      followUps: [
        "How much payroll cost is visible in all available history?",
        "Which costs are over plan?",
        ...prompts,
      ].filter((value, index, all) => all.indexOf(value) === index).slice(0, 4),
      limitations: ["Employee productivity is not stored as verified accounting evidence in this dataset; GI can only ground payroll-cost questions when the ledgers support them."],
    };
  }

  if (/\bvouchers?\b/.test(q)) {
    return {
      status: "limited" as const,
      answer: `I understood this as a voucher-exploration question. ${evidenceLine} ${latestFlow} ${voucherFlow} GI does not treat generic raw-voucher browsing as a verified calculation yet, so narrow it to sales, purchase, receipt, payment, payroll, expense or finance-cost evidence and I will route it to the closest grounded answer.`,
      followUps: [
        "Show cash movement from receipt and payment vouchers",
        "Show supplier payables and reconciliation gaps",
        "How much payroll cost is visible in all available history?",
        "Which costs are over plan?",
      ].filter((value, index, all) => all.indexOf(value) === index).slice(0, 4),
      limitations: ["Voucher rows exist in the connected dataset, but Ask GI still answers through allow-listed finance questions rather than acting as a raw voucher browser."],
    };
  }

  if (/\b(latest|recent|recently|newest|last transaction|what happened|activity)\b/.test(q)) {
    return {
      status: "limited" as const,
      answer: `I understood this as a latest-activity question. ${latestFlow} ${voucherFlow} To make a verified claim, I still need the activity narrowed to sales, supplier dues, cash movement, payroll, expenses or funding.`,
      followUps: prompts,
      limitations: ["GI will not improvise a meaning for 'latest activity' because different accounting topics can point to different evidence and different dates."],
    };
  }

  return {
    status: "limited" as const,
    answer: `${evidenceLine} ${latestFlow} GI only makes verified claims when the question maps to a supported books calculation. Ask about sales, receivables, payables, inventory, payroll, cash movement, expenses or funding, and it will show the evidence and the limits.`,
    followUps: prompts,
    limitations: ["GI is intentionally narrower than a general chatbot so it can stay evidence-led and avoid making unsupported financial claims."],
  };
}

function revenueSection(data: BusinessDataset, period: AnalystPeriod, question: string): AnalystSection {
  const comparedMonths = namedMonths(question);
  const rows = data.sales.filter((row) => inPeriod(row.date, period) && (comparedMonths.length > 1 ? comparedMonths.includes(row.date.slice(0, 7)) : true));
  if (!rows.length) {
    return emptySection(
      "revenue",
      "Revenue performance",
      `I can’t support a revenue claim for ${period.label}: there are no dated sales rows in that window.`,
      `The connected sales flow ends on ${formatDate(dateRange(data.sales.map((row) => row.date)).to)}; the ${formatDate(data.asOf)} balance snapshot does not make that flow current.`,
      { label: "Repair current sales flow", description: "Review Tally period coverage in Data Spine.", href: "/connections", kind: "connection" },
    );
  }
  const revenue = amount(rows, (row) => row.amount);
  const invoices = uniq(rows.map((row) => row.invoiceNo));
  const byMonth = groupBy(rows, (row) => row.date.slice(0, 7), (row) => row.amount)
    .sort((a, b) => a.name.localeCompare(b.name));
  const latest = byMonth.at(-1);
  const prior = byMonth.at(-2);
  const movement = latest && prior && prior.value ? ((latest.value - prior.value) / prior.value) * 100 : null;
  const stale = period.flowFreshness === "stale";
  const partialLatest = Boolean(latest && period.latestFlowDate && latest.name === period.latestFlowDate.slice(0, 7) && period.latestFlowDate < endOfMonth(latest.name));
  const summary = movement == null
    ? `${inr(revenue)} of gross dated sales is supported by ${invoices.toLocaleString("en-IN")} invoices in ${period.label}.`
    : `${inr(revenue)} of gross dated sales is supported in ${period.label}. ${partialLatest ? `Available ${latest!.name} rows through ${formatDate(period.latestFlowDate)} are ` : "The last two available months moved "}${movement >= 0 ? "up" : "down"} ${Math.abs(movement).toFixed(1)}% (${inr(prior!.value)} to ${inr(latest!.value)})${partialLatest ? "; this is not a full-month comparison." : "."}`;
  const table: AnalystTable = {
    title: "Monthly sales evidence",
    columns: [
      { key: "month", label: "Month" },
      { key: "revenue", label: "Gross sales", format: "currency" },
    ],
    rows: byMonth.slice(-12).map((row) => ({ month: row.name, revenue: row.value })),
  };
  const chart: AnalystChart = { type: "line", title: "Gross sales by month", categoryKey: "month", valueKey: "revenue", valueFormat: "currency", data: table.rows };
  return {
    id: "revenue",
    intent: "revenue",
    title: "Revenue performance",
    summary,
    status: stale ? "limited" : "answered",
    confidence: 0.94,
    metrics: [
      { label: "Gross sales", value: revenue, format: "currency", note: period.label },
      { label: "Invoices", value: invoices, format: "number" },
      { label: "Average invoice", value: invoices ? revenue / invoices : 0, format: "currency" },
      ...(movement == null ? [] : [{ label: "Latest movement", value: movement, format: "percent" as const }]),
    ],
    calculation: [
      { label: "Gross sales", formula: `Sum of ${rows.length.toLocaleString("en-IN")} dated sales-line amounts`, result: inrFull(revenue) },
      { label: "Average invoice", formula: `${inrFull(revenue)} ÷ ${invoices.toLocaleString("en-IN")} unique invoice numbers`, result: inrFull(invoices ? revenue / invoices : 0) },
    ],
    evidence: [salesEvidence(rows, period)],
    limitations: [
      "This is gross sales-voucher value. Credit notes are not yet netted into product and customer sales.",
      ...(partialLatest ? [`${latest!.name} is partial through ${formatDate(period.latestFlowDate)}; the movement is shown as covered-to-date, not a completed-month trend.`] : []),
      ...(stale ? [`The latest meaningful transaction flow is ${formatDate(period.latestFlowDate)}; this is historical performance, not a current-period claim.`] : []),
    ],
    table,
    chart,
    actions: [
      ...baseActions("revenue", period),
      { label: "Open Performance", description: "Compare operating periods and management signals.", href: "/review", kind: "review" },
    ],
  };
}

function rankingSection(input: {
  intent: "products" | "regions" | "customers";
  title: string;
  dimension: string;
  rows: SalesRecord[];
  key: (row: SalesRecord) => string;
  coverage?: number;
  period: AnalystPeriod;
  question: string;
}): AnalystSection {
  const { intent, title, dimension, rows, key, period } = input;
  if (!rows.length) return emptySection(intent, title, `I can’t rank ${dimension} for ${period.label}.`, "No dated sales rows are available for this period.", { label: "Review Data Spine", description: `Connect ${dimension} sales detail.`, href: "/connections", kind: "connection" });
  if (input.coverage != null && input.coverage < 0.3) return emptySection(intent, title, `I won’t rank ${dimension}: fewer than 30% of sales rows contain usable ${dimension} data.`, `Coverage is ${(input.coverage * 100).toFixed(0)}%, which is too low for a defensible ranking.`, { label: "Improve data coverage", description: `Complete ${dimension} fields in Tally.`, href: "/connections", kind: "connection" });
  const ranked = groupBy(rows, key, (row) => row.amount).filter((row) => !/^(unspecified|unknown)$/i.test(row.name));
  if (!ranked.length) return emptySection(intent, title, `I can’t rank ${dimension} from the connected rows.`, `Usable ${dimension} labels are missing.`, { label: "Improve data coverage", description: `Complete ${dimension} fields in Tally.`, href: "/connections", kind: "connection" });
  const total = amount(rows, (row) => row.amount);
  const topFive = amount(ranked.slice(0, 5), (row) => row.value);
  const label = intent === "customers" ? "buyer" : intent === "products" ? "product" : "region";
  const limit = requestedLimit(input.question);
  const table: AnalystTable = {
    title: `Top ${dimension} by gross sales`,
    columns: [
      { key: "rank", label: "#", format: "number" },
      { key: "name", label: label[0].toUpperCase() + label.slice(1) },
      { key: "value", label: "Gross sales", format: "currency" },
      { key: "share", label: "Share", format: "percent" },
    ],
    rows: ranked.slice(0, limit).map((row, index) => ({ rank: index + 1, name: row.name, value: row.value, share: percent(row.value, total) })),
  };
  return {
    id: intent,
    intent,
    title,
    summary: `${ranked[0].name} leads with ${inr(ranked[0].value)} (${percent(ranked[0].value, total).toFixed(1)}% of measured gross sales). The top five account for ${percent(topFive, total).toFixed(1)}%.`,
    status: period.flowFreshness === "stale" ? "limited" : "answered",
    confidence: input.coverage == null ? 0.92 : Math.min(0.96, input.coverage),
    metrics: [
      { label: "Leader", value: ranked[0].name, format: "text" },
      { label: "Leader sales", value: ranked[0].value, format: "currency" },
      { label: "Top-five share", value: percent(topFive, total), format: "percent" },
    ],
    calculation: [{ label: `Rank ${dimension}`, formula: `Group ${rows.length.toLocaleString("en-IN")} sales lines by ${label}, then sum line amount`, result: `${ranked.length.toLocaleString("en-IN")} ranked ${dimension}` }],
    evidence: [salesEvidence(rows, period, `${dimension[0].toUpperCase() + dimension.slice(1)} sales lines`)],
    limitations: [
      "Rankings use gross sales-voucher value; credit notes are not netted.",
      ...(period.flowFreshness === "stale" ? [`Sales flow ends ${formatDate(period.latestFlowDate)}; this does not describe current momentum.`] : []),
    ],
    table,
    chart: { type: "bar", title: `Top ${dimension}`, categoryKey: "name", valueKey: "value", valueFormat: "currency", data: table.rows.slice(0, 7) },
    actions: [...baseActions("revenue", period), { label: "Take this to Action Center", description: "Turn the finding into an owned, controlled action.", href: "/automations", kind: "action_center" }],
  };
}

function receivablesSection(data: BusinessDataset, period: AnalystPeriod, question: string): AnalystSection {
  const bills = customerReceivableBills(data);
  if (!bills.length) return emptySection("receivables", "Trade receivables", "I can’t calculate trade receivables from the connected dataset.", "No invoice-level bills matched customer/debtor ledgers.", { label: "Connect receivable bills", description: "Sync Bills Receivable and debtor ledgers from Tally.", href: "/connections", kind: "connection" });
  const total = amount(bills, (bill) => bill.amount);
  const overdue = bills.filter((bill) => isTallyBillOverdue(bill, data.asOf));
  const overdueTotal = amount(overdue, (bill) => bill.amount);
  const chaseMode = /\b(overdue|chase|collect|collection)\b/i.test(question);
  const ranked = groupBy(chaseMode ? overdue : bills, (bill) => bill.party, (bill) => bill.amount);
  const oldest = [...bills].sort((a, b) => b.overdueDays - a.overdueDays)[0];
  const table: AnalystTable = {
    title: chaseMode ? "Largest overdue trade receivables" : "Largest trade receivable exposures",
    columns: [
      { key: "name", label: "Customer" },
      { key: "value", label: "Outstanding", format: "currency" },
      { key: "share", label: "Share", format: "percent" },
    ],
    rows: ranked.slice(0, 10).map((row) => ({ name: row.name, value: row.value, share: percent(row.value, total) })),
  };
  return {
    id: "receivables",
    intent: "receivables",
    title: "Trade receivables",
    summary: `${inr(total)} is outstanding across ${bills.length.toLocaleString("en-IN")} customer bills, and ${inr(overdueTotal)} (${percent(overdueTotal, total).toFixed(1)}%) is overdue. ${ranked[0] ? `${ranked[0].name} is the largest exposure at ${inr(ranked[0].value)}.` : ""}`,
    status: "answered",
    confidence: 0.96,
    metrics: [
      { label: "Trade receivables", value: total, format: "currency", note: period.balanceLabel },
      { label: "Overdue", value: overdueTotal, format: "currency" },
      { label: "Overdue share", value: percent(overdueTotal, total), format: "percent" },
      { label: "Oldest bill", value: `${oldest?.overdueDays ?? 0} days`, format: "text" },
    ],
    calculation: [
      { label: "Trade receivables", formula: "Sum open Bills Receivable only for parties classified in debtor/receivable ledger groups", result: inrFull(total) },
      { label: "Overdue", formula: `Sum ${overdue.length.toLocaleString("en-IN")} trade bills with overdue days > 0`, result: inrFull(overdueTotal) },
    ],
    evidence: [{ id: `bills:receivable:${data.asOf}`, source: "bills", label: "Customer receivable bills", detail: `${bills.length.toLocaleString("en-IN")} bills matched to debtor ledgers · as of ${formatDate(data.asOf)}`, rowCount: bills.length, href: evidenceHref("tradeReceivables", period) }],
    limitations: ["Non-trade advances, tax, loans and other balances are excluded from this collection view."],
    table,
    chart: { type: "bar", title: "Who owes the most", categoryKey: "name", valueKey: "value", valueFormat: "currency", data: table.rows.slice(0, 7) },
    actions: [
      ...baseActions("tradeReceivables", period),
      { label: "Open collection queue", description: "Prepare reminders, promises and approved follow-up.", href: "/automations#collections", kind: "collection" },
    ],
  };
}

function payablesSection(data: BusinessDataset, period: AnalystPeriod): AnalystSection {
  const bills = supplierPayableBills(data);
  if (!bills.length) return emptySection("payables", "Trade payables", "I can’t calculate supplier dues from the connected dataset.", "No invoice-level bills matched creditor/payable ledger groups.", { label: "Connect payable bills", description: "Sync Bills Payable and creditor ledgers from Tally.", href: "/connections", kind: "connection" });
  const total = amount(bills, (bill) => bill.amount);
  const overdue = amount(bills.filter((bill) => isTallyBillOverdue(bill, data.asOf)), (bill) => bill.amount);
  const ledgerTotal = groupBalance(data.ledgers ?? [], /creditor|payable/i);
  const difference = Math.abs(total - ledgerTotal);
  const reconciled = ledgerTotal > 0 && percent(difference, Math.max(total, ledgerTotal)) <= 2;
  const ranked = groupBy(bills, (bill) => bill.party, (bill) => bill.amount);
  const table: AnalystTable = {
    title: "Largest supplier bill exposures",
    columns: [{ key: "name", label: "Supplier" }, { key: "value", label: "Open bills", format: "currency" }, { key: "share", label: "Share", format: "percent" }],
    rows: ranked.slice(0, 10).map((row) => ({ name: row.name, value: row.value, share: percent(row.value, total) })),
  };
  return {
    id: "payables",
    intent: "payables",
    title: "Trade payables",
    summary: `${inr(total)} appears in supplier-classified open bills; ${inr(overdue)} is overdue. ${reconciled ? "The bill and creditor-ledger totals are closely reconciled." : `This does not reconcile to the ${inr(ledgerTotal)} net creditor-ledger balance, so I won’t present it as an accounting-final amount.`}`,
    status: reconciled ? "answered" : "limited",
    confidence: reconciled ? 0.94 : 0.68,
    metrics: [
      { label: "Open supplier bills", value: total, format: "currency" },
      { label: "Creditor ledgers", value: ledgerTotal, format: "currency" },
      { label: "Unreconciled difference", value: difference, format: "currency" },
    ],
    calculation: [{ label: "Supplier bills", formula: `Sum ${bills.length.toLocaleString("en-IN")} open bills matched to creditor ledger parties`, result: inrFull(total) }],
    evidence: [
      { id: `bills:payable:${data.asOf}`, source: "bills", label: "Supplier payable bills", detail: `${bills.length.toLocaleString("en-IN")} trade-classified bills · as of ${formatDate(data.asOf)}`, rowCount: bills.length },
      { id: `ledgers:creditor:${data.asOf}`, source: "ledgers", label: "Creditor ledger balance", detail: `Net closing balance used as the reconciliation control · ${formatDate(data.asOf)}`, rowCount: (data.ledgers ?? []).filter((row) => /creditor|payable/i.test(row.group)).length },
    ],
    limitations: reconciled ? [] : ["Supplier bills and creditor ledgers are materially different. Payment sequencing is useful, but the total requires reconciliation before an accounting claim."],
    table,
    chart: { type: "bar", title: "Largest supplier dues", categoryKey: "name", valueKey: "value", valueFormat: "currency", data: table.rows.slice(0, 7) },
    actions: [...baseActions("tradePayables", period), { label: "Open Action Center", description: "Sequence suppliers against collections and cash.", href: "/automations", kind: "action_center" }],
  };
}

function inventorySection(data: BusinessDataset, period: AnalystPeriod): AnalystSection {
  const rows = data.inventory.filter((item) => (item.closingValue ?? item.currentStock * item.unitCost) !== 0);
  if (!rows.length) return emptySection("inventory", "Inventory position", "I can’t calculate inventory value from the connected dataset.", "Stock quantity and cost are not both available.", { label: "Connect stock valuation", description: "Sync stock masters with quantity and cost.", href: "/connections", kind: "connection" });
  const ranked = rows.map((item) => ({ name: clean(item.itemName), value: item.closingValue ?? item.currentStock * item.unitCost, qty: item.currentStock })).sort((a, b) => b.value - a.value);
  const total = amount(ranked, (row) => row.value);
  const ledgerTotal = groupBalance(data.ledgers ?? [], /stock|inventor/i);
  const difference = Math.abs(total - ledgerTotal);
  const reconciled = ledgerTotal > 0 && percent(difference, Math.max(total, ledgerTotal)) <= 5;
  const table: AnalystTable = {
    title: "Largest item-level stock values",
    columns: [{ key: "name", label: "Item" }, { key: "qty", label: "Quantity", format: "number" }, { key: "value", label: "Value at current cost", format: "currency" }],
    rows: ranked.slice(0, 10),
  };
  return {
    id: "inventory",
    intent: "inventory",
    title: "Inventory position",
    summary: `${inr(total)} is the item-level stock value using current quantity × current cost. ${reconciled ? "It is close to the stock-ledger control." : `It differs from the ${inr(ledgerTotal)} stock-ledger balance, so I won’t call the item total accounting-final or infer current ageing.`}`,
    status: reconciled ? "answered" : "limited",
    confidence: reconciled ? 0.9 : 0.62,
    metrics: [
      { label: "Item valuation", value: total, format: "currency" },
      { label: "Stock ledgers", value: ledgerTotal, format: "currency" },
      { label: "Costed items", value: rows.length, format: "number" },
    ],
    calculation: [{ label: "Item valuation", formula: `Sum current stock × unit cost for ${rows.length.toLocaleString("en-IN")} items`, result: inrFull(total) }],
    evidence: [
      { id: `inventory:${data.asOf}`, source: "inventory", label: "Stock-item snapshot", detail: `${rows.length.toLocaleString("en-IN")} positive-quantity, positive-cost items · ${formatDate(data.asOf)}`, rowCount: rows.length },
      { id: `ledgers:stock:${data.asOf}`, source: "ledgers", label: "Stock ledger control", detail: `Closing stock/inventory ledger balance · ${formatDate(data.asOf)}`, rowCount: (data.ledgers ?? []).filter((row) => /stock|inventor/i.test(row.group)).length },
    ],
    limitations: [
      ...(reconciled ? [] : ["Item valuation and stock ledgers are materially unreconciled."]),
      "The connected item master does not provide reliable current last-movement dates, so GI refuses a current slow/dead-stock claim.",
    ],
    table,
    chart: { type: "bar", title: "Largest stock positions", categoryKey: "name", valueKey: "value", valueFormat: "currency", data: table.rows.slice(0, 7) },
    actions: [...baseActions("closingStock", period), { label: "Reconcile in Data Spine", description: "Repair valuation and movement coverage before reorder action.", href: "/connections", kind: "connection" }],
  };
}

function salarySection(data: BusinessDataset, period: AnalystPeriod): AnalystSection {
  const summaryRows = period.id === "all" ? (data.expenses ?? []).filter((row) => row.kind === "salary") : [];
  const voucherLines = (data.vouchers ?? [])
    .filter((voucher) => inPeriod(voucher.date, period))
    .flatMap((voucher) => voucher.ledgerLines.map((line) => ({ voucher, line })))
    .filter(({ line }) => /salary|salaries|payroll|wages|staff cost|bonus|incentive|employee cost|labou?r/i.test(line.ledgerName));
  if (!summaryRows.length && !voucherLines.length) {
    return emptySection("salary", "Salary and payroll", "I can’t support a salary or payroll total from the connected data.", "No classified salary-expense summary or dated salary ledger lines were found. GI will not infer payroll from ledger names that do not match.", { label: "Connect expense classifications", description: "Sync dated P&L expense ledger detail.", href: "/connections", kind: "connection" });
  }
  const total = summaryRows.length ? amount(summaryRows, (row) => Math.abs(row.amount)) : amount(voucherLines, ({ line }) => Math.abs(line.amount));
  const table: AnalystTable = {
    title: "Matched payroll ledgers",
    columns: [{ key: "name", label: "Ledger" }, { key: "value", label: "Amount", format: "currency" }],
    rows: summaryRows.length
      ? groupBy(summaryRows, (row) => row.name, (row) => Math.abs(row.amount)).slice(0, 10)
      : groupBy(voucherLines, ({ line }) => line.ledgerName, ({ line }) => Math.abs(line.amount)).slice(0, 10),
  };
  return {
    id: "salary",
    intent: "salary",
    title: "Salary and payroll",
    summary: `${inr(total)} is supported by ${summaryRows.length ? "the classified expense summary" : "dated ledger lines with salary/payroll names"} for ${period.label}.`,
    status: summaryRows.length ? "answered" : "limited",
    confidence: summaryRows.length ? 0.9 : 0.72,
    metrics: [{ label: "Matched payroll", value: total, format: "currency" }],
    calculation: [{ label: "Payroll total", formula: summaryRows.length ? `Sum ${summaryRows.length} classified salary expense ledgers` : `Sum ${voucherLines.length} dated ledger lines matching salary/payroll terms`, result: inrFull(total) }],
    evidence: [{ id: `payroll:${period.from ?? "start"}:${period.to}`, source: summaryRows.length ? "ledgers" : "vouchers", label: "Matched payroll evidence", detail: `${summaryRows.length || voucherLines.length} matched records · ${period.label}`, rowCount: summaryRows.length || voucherLines.length }],
    limitations: summaryRows.length ? [] : ["Name-based classification is directional; accounting-grade payroll needs a mapped P&L expense hierarchy."],
    table,
    actions: [{ label: "Open ledger evidence", description: "Inspect the connected ledger and voucher rows.", href: `/data?asOf=${period.asOf}`, kind: "evidence" }, { label: "Review cost control", description: "Take the verified cost line into Performance.", href: "/review", kind: "review" }],
  };
}

function cashMovementSection(data: BusinessDataset, period: AnalystPeriod): AnalystSection {
  const vouchers = (data.vouchers ?? []).filter((voucher) => inPeriod(voucher.date, period));
  const magnitude = (voucher: AccountingVoucher) => {
    const debit = voucher.ledgerLines.filter((line) => line.entryType === "debit").reduce((sum, line) => sum + Math.abs(line.amount), 0);
    const credit = voucher.ledgerLines.filter((line) => line.entryType === "credit").reduce((sum, line) => sum + Math.abs(line.amount), 0);
    return Math.abs(voucher.amount) || Math.max(debit, credit);
  };
  const receipts = vouchers.filter((voucher) => /receipt/i.test(voucher.voucherType));
  const payments = vouchers.filter((voucher) => /payment/i.test(voucher.voucherType));
  const cashIn = amount(receipts, magnitude);
  const cashOut = amount(payments, magnitude);
  const signedBalance = (re: RegExp) => (data.ledgers ?? []).filter((row) => re.test(row.group)).reduce((sum, row) => sum + row.closing, 0);
  const bank = signedBalance(/bank/i);
  const cash = signedBalance(/cash/i);
  if (!receipts.length && !payments.length && !bank && !cash) return emptySection("cash_movement", "Cash movement and liquidity", "I can’t support a cash movement or liquidity answer from the connected data.", "No receipt/payment vouchers or bank/cash ledgers are available.", { label: "Connect bank and cash evidence", description: "Sync receipts, payments and closing ledgers.", href: "/connections", kind: "connection" });
  return {
    id: "cash_movement",
    intent: "cash_movement",
    title: "Cash movement and liquidity",
    summary: `${inr(cashIn)} of receipt movement and ${inr(cashOut)} of payment movement is supported for ${period.label}. The closing bank-and-cash position is ${inr(bank + cash)} as of ${formatDate(data.asOf)}.`,
    status: period.flowFreshness === "stale" ? "limited" : "answered",
    confidence: 0.82,
    metrics: [
      { label: "Receipt movement", value: cashIn, format: "currency" },
      { label: "Payment movement", value: cashOut, format: "currency" },
      { label: "Net movement", value: cashIn - cashOut, format: "currency" },
      { label: "Bank + cash", value: bank + cash, format: "currency", note: period.balanceLabel },
    ],
    calculation: [
      { label: "Receipt movement", formula: `Sum balanced magnitude of ${receipts.length.toLocaleString("en-IN")} receipt vouchers`, result: inrFull(cashIn) },
      { label: "Payment movement", formula: `Sum balanced magnitude of ${payments.length.toLocaleString("en-IN")} payment vouchers`, result: inrFull(cashOut) },
    ],
    evidence: [
      { id: `vouchers:cash:${period.from ?? "start"}:${period.to}`, source: "vouchers", label: "Receipt and payment vouchers", detail: `${receipts.length + payments.length} vouchers · ${period.label}`, rowCount: receipts.length + payments.length },
      { id: `ledgers:cash:${data.asOf}`, source: "ledgers", label: "Bank and cash closing balances", detail: `Point-in-time closing ledger control · ${formatDate(data.asOf)}`, rowCount: (data.ledgers ?? []).filter((row) => /bank|cash/i.test(row.group)).length },
    ],
    limitations: ["Receipt minus payment movement includes financing, transfers and other non-operating activity; it is not labelled operating cash flow."],
    chart: { type: "bar", title: "Cash movement", categoryKey: "name", valueKey: "value", valueFormat: "currency", data: [{ name: "Receipts", value: cashIn }, { name: "Payments", value: cashOut }] },
    actions: [...baseActions("bankBalance", period), { label: "Open Action Center", description: "Sequence collections, suppliers and cash commitments.", href: "/automations", kind: "action_center" }],
  };
}

function profitabilitySection(period: AnalystPeriod): AnalystSection {
  return emptySection(
    "profitability",
    "Profitability",
    "I can’t support an actual gross profit, net profit, EBITDA or margin claim from this dataset.",
    "Dated sales exist, but realised COGS, credit-note netting and a complete period-classified P&L are not reconciled. Using current item cost would only create an indicative estimate, not actual profit.",
    { label: "Complete margin evidence", description: "Reconcile item cost, credit notes and the period P&L in Data Spine.", href: "/connections", kind: "connection" },
  );
}

function expenseSection(data: BusinessDataset, period: AnalystPeriod): AnalystSection {
  const cost = buildCostCommand(data);
  const rows = cost.categories.slice(0, 8);
  if (!rows.length) return emptySection("expenses", "Operating cost control", "I can’t support an expense analysis from the connected books.", "Expense-ledger classification and dated voucher evidence are missing.", { label: "Repair cost evidence", description: "Sync expense ledgers and vouchers.", href: "/connections", kind: "connection" });
  return {
    id: "expenses", intent: "expenses", title: "Operating cost control",
    summary: `${inr(cost.summaryExpense)} of P&L expense is classified in the synced period. ${inr(cost.addressableExpense)} sits in the management-addressable pool; this is cost opportunity, not a promised saving.`,
    status: cost.isFlowStale || !cost.hasMonthlyCostEvidence ? "limited" : "answered", confidence: cost.hasMonthlyCostEvidence ? 0.9 : 0.72,
    metrics: [{ label: "P&L expense", value: cost.summaryExpense, format: "currency" }, { label: "Addressable pool", value: cost.addressableExpense, format: "currency" }, { label: "People cost", value: cost.peopleCost, format: "currency" }, { label: "Finance cost", value: cost.financeCost, format: "currency" }],
    calculation: [{ label: "Cost universe", formula: "Expense-group ledger closing values, classified into management categories", result: inrFull(cost.summaryExpense) }, { label: "Addressable pool", formula: "Cost universe excluding low-control statutory, depreciation and finance categories", result: inrFull(cost.addressableExpense) }],
    evidence: [{ id: `pnl:expenses:${data.asOf}`, source: "profit_and_loss", label: "Classified expense ledgers", detail: `${cost.categories.length} management categories · accounting position ${formatDate(data.asOf)}`, rowCount: cost.categories.length }, { id: `vouchers:expenses:${cost.latestMonth}`, source: "vouchers", label: "Dated operating expense flow", detail: `Latest comparable month ${cost.latestMonth || "not available"}`, rowCount: data.vouchers?.length ?? 0 }],
    limitations: ["Addressable does not mean removable; continuity, revenue and compliance effects require owner review.", ...(cost.isFlowStale ? [`The dated cost flow ends ${formatDate(cost.flowThrough)}; this is historical, not current-month performance.`] : [])],
    table: { title: "Largest visible cost categories", columns: [{ key: "category", label: "Category" }, { key: "value", label: "Visible value", format: "currency" }, { key: "control", label: "Management control" }], rows: rows.map((row) => ({ category: row.label, value: row.summaryAmount || row.latest, control: row.control })) },
    actions: [...baseActions("expenses", period), { label: "Open Cost Command", description: "Review cost velocity and savings scenarios.", href: "/costs", kind: "review" }],
  };
}

function budgetSection(data: BusinessDataset, period: AnalystPeriod, options: AnalyseOptions): AnalystSection {
  const command = buildPlanningCommand(data, options.budgetPlan ?? emptyBudgetPlan(data.asOf));
  const status = command.planState === "approved" && !command.isFlowStale ? "answered" : "limited";
  return {
    id: "budget", intent: "budget", title: "Plan versus actual",
    summary: `${command.planState === "approved" ? "The approved" : "The unapproved"} monthly operating plan is ${inr(command.plannedOperatingCost)} against ${inr(command.actualOperatingCost)} of visible actual cost in ${command.latestMonth || "the latest comparable month"}. ${command.overBudgetCount} owner triggers are crossed.`,
    status, confidence: command.planState === "approved" ? 0.9 : 0.66,
    metrics: [{ label: "Revenue attainment", value: command.revenueAttainmentPct ?? 0, format: "percent" }, { label: "Operating plan", value: command.plannedOperatingCost, format: "currency" }, { label: "Operating actual", value: command.actualOperatingCost, format: "currency" }, { label: "Triggers crossed", value: command.overBudgetCount, format: "number" }],
    calculation: [{ label: "Operating variance", formula: "Visible actual classified expense − owner-approved monthly category plan", result: inrFull(command.operatingVariance) }, { label: "Revenue attainment", formula: "Latest comparable gross sales ÷ monthly revenue target", result: command.revenueAttainmentPct == null ? "Not available" : `${command.revenueAttainmentPct.toFixed(1)}%` }],
    evidence: [{ id: `plan:${command.plan.fiscalYearStart}`, source: "profit_and_loss", label: "GI owner control plan", detail: `${command.plan.lines.length} category lines · ${command.planState.replace("_", " ")}`, rowCount: command.plan.lines.length }, { id: `vouchers:plan:${command.latestMonth}`, source: "vouchers", label: "Actual cost comparison", detail: `Completed flow month ${command.latestMonth || "not available"}`, rowCount: data.vouchers?.length ?? 0 }],
    limitations: [...(command.planState !== "approved" ? ["The historical baseline is not a management commitment until an owner approves it."] : []), ...(command.isFlowStale ? [`The comparison is historical because transaction flow ends ${formatDate(command.flowThrough)}.`] : [])],
    table: { title: "Owner variance ledger", columns: [{ key: "category", label: "Cost line" }, { key: "plan", label: "Plan", format: "currency" }, { key: "actual", label: "Actual", format: "currency" }, { key: "variance", label: "Variance", format: "currency" }, { key: "owner", label: "Owner" }, { key: "status", label: "Status" }], rows: command.lines.slice(0, 10).map((line) => ({ category: line.label, plan: line.monthlyBudget, actual: line.actual, variance: line.variance, owner: line.owner, status: line.status.replace("_", " ") })) },
    actions: [{ label: "Open Plan & Procurement", description: "Review, approve and assign the management plan.", href: "/planning", kind: "review" }],
  };
}

function procurementSection(data: BusinessDataset, period: AnalystPeriod, options: AnalyseOptions): AnalystSection {
  const command = buildPlanningCommand(data, options.budgetPlan ?? emptyBudgetPlan(data.asOf));
  if (!command.topSuppliers.length) return emptySection("procurement", "Procurement pressure", "I can’t support a supplier or buying-price conclusion for the latest comparable month.", "Purchase vouchers do not contain enough supplier or inventory-line evidence.", { label: "Repair purchase evidence", description: "Sync supplier and item allocations.", href: "/connections", kind: "connection" });
  return {
    id: "procurement", intent: "procurement", title: "Procurement pressure",
    summary: `${inr(command.purchaseActual)} of purchase throughput is visible in ${command.latestMonth}. The top five suppliers represent ${command.supplierConcentrationPct.toFixed(1)}%, while same-item rate increases show ${inr(command.purchasePricePressureImpact)} of price pressure before volume and stock effects.`,
    status: command.isFlowStale ? "limited" : "answered", confidence: command.pricePressures.length ? 0.86 : 0.76,
    metrics: [{ label: "Purchase throughput", value: command.purchaseActual, format: "currency" }, { label: "Purchase variance", value: command.purchaseVariance, format: "currency" }, { label: "Top-5 concentration", value: command.supplierConcentrationPct, format: "percent" }, { label: "Price pressure", value: command.purchasePricePressureImpact, format: "currency" }],
    calculation: [{ label: "Supplier concentration", formula: "Top five supplier purchase throughput ÷ total supplier purchase throughput", result: `${command.supplierConcentrationPct.toFixed(1)}%` }, { label: "Price pressure", formula: "Sum of (latest weighted item rate − prior weighted item rate) × latest quantity for rising items", result: inrFull(command.purchasePricePressureImpact) }],
    evidence: [{ id: `vouchers:purchases:${command.latestMonth}`, source: "vouchers", label: "Purchase vouchers and inventory allocations", detail: `${command.topSuppliers.length} ranked suppliers · ${command.pricePressures.length} supported rising item rates`, rowCount: (data.vouchers ?? []).filter((row) => /purchase/i.test(row.voucherType)).length }],
    limitations: ["Purchase throughput is not cost of goods sold and price pressure is not realised margin loss.", "A supplier concentration flag requires continuity and contract review before negotiation.", ...(command.isFlowStale ? [`The compared purchase month is historical; flow ends ${formatDate(command.flowThrough)}.`] : [])],
    table: { title: "Largest supplier exposures", columns: [{ key: "supplier", label: "Supplier" }, { key: "amount", label: "Purchase throughput", format: "currency" }, { key: "share", label: "Share", format: "percent" }, { key: "vouchers", label: "Vouchers", format: "number" }], rows: command.topSuppliers.map((row) => ({ supplier: row.name, amount: row.amount, share: row.sharePct, vouchers: row.vouchers })) },
    actions: [{ label: "Open Plan & Procurement", description: "Review suppliers, price pressure and owner decisions.", href: "/planning", kind: "review" }],
  };
}

function growthBridgeSection(data: BusinessDataset, period: AnalystPeriod): AnalystSection {
  const command = buildGrowthCommand(data);
  if (!command.flowThrough || !command.bridge.length) return emptySection("growth_bridge", "Revenue growth bridge", "I can’t explain why sales moved from the connected evidence.", "At least two months of dated product, quantity and selling-value lines are required.", { label: "Repair sales evidence", description: "Sync invoice, product, quantity and rate fields.", href: "/connections", kind: "connection" });
  return {
    id: "growth_bridge", intent: "growth_bridge", title: "Revenue growth bridge",
    summary: `${command.comparisonLabel} revenue moved ${command.revenueChange >= 0 ? "up" : "down"} ${inr(Math.abs(command.revenueChange))} (${Math.abs(command.revenueChangePct ?? 0).toFixed(1)}%). GI separated the movement into price/realisation, same-product volume, new assortment and lost assortment.`,
    status: command.isFlowStale ? "limited" : "answered", confidence: 0.91,
    metrics: [{ label: "Previous revenue", value: command.previousRevenue, format: "currency" }, { label: "Current revenue", value: command.currentRevenue, format: "currency" }, { label: "Revenue movement", value: command.revenueChange, format: "currency" }, { label: "Movement", value: command.revenueChangePct ?? 0, format: "percent" }],
    calculation: [{ label: "Price / realisation", formula: "Σ (current weighted product rate − prior weighted product rate) × current product quantity", result: inrFull(command.bridge.find((row) => row.id === "price")?.value ?? 0) }, { label: "Volume", formula: "Σ (current product quantity − prior product quantity) × prior weighted product rate", result: inrFull(command.bridge.find((row) => row.id === "volume")?.value ?? 0) }],
    evidence: [{ id: `sales:growth:${command.previousMonth}:${command.currentMonth}`, source: "sales", label: "Product-level dated sales lines", detail: `${command.comparisonLabel} · ${command.partialComparison ? "equal day coverage" : "complete comparison months"}`, rowCount: data.sales.length, href: evidenceHref("revenue", period) }],
    limitations: ["Selling-rate movement is realisation, not margin; discounts, returns and COGS need separate reconciliation.", "Product-master naming variants can inflate new/lost assortment; map aliases before treating them as commercial assortment decisions.", ...(command.isFlowStale ? [`This explains historical flow through ${formatDate(command.flowThrough)} and is not a current-period growth claim.`] : [])],
    table: { title: "Revenue movement bridge", columns: [{ key: "driver", label: "Driver" }, { key: "effect", label: "Revenue effect", format: "currency" }, { key: "method", label: "Definition" }], rows: command.bridge.map((row) => ({ driver: row.label, effect: row.value, method: row.explanation })) },
    actions: [{ label: "Open Growth Command", description: "Inspect product, customer and region drivers.", href: "/growth", kind: "review" }],
  };
}

function customerMomentumSection(data: BusinessDataset, period: AnalystPeriod): AnalystSection {
  const command = buildGrowthCommand(data);
  if (!command.flowThrough) return emptySection("customer_momentum", "Historical customer momentum", "I can’t identify customer momentum without dated customer sales.", "Customer and invoice fields are missing from the connected sales flow.", { label: "Repair customer evidence", description: "Sync dated customer-level sales.", href: "/connections", kind: "connection" });
  const candidates = command.quietCustomers;
  return {
    id: "customer_momentum", intent: "customer_momentum", title: "Historical customer momentum",
    summary: candidates.length ? `${candidates.length} customers had sales in days 60–179 before ${formatDate(command.flowThrough)} but none in the latest 60 connected days. Their combined historical monthly run rate was ${inr(command.quietCustomerRunRate)}.` : `No customers meet GI’s historical quiet-window rule through ${formatDate(command.flowThrough)}.`,
    status: command.isFlowStale ? "limited" : "answered", confidence: 0.84,
    metrics: [{ label: "Candidates", value: candidates.length, format: "number" }, { label: "Historical run rate", value: command.quietCustomerRunRate, format: "currency" }, { label: "Flow through", value: formatDate(command.flowThrough), format: "text" }],
    calculation: [{ label: "Quiet-window rule", formula: "Positive customer sales in days 60–179 before the latest connected sale date, and zero sales in the latest 60 connected days", result: `${candidates.length} candidates` }],
    evidence: [{ id: `sales:momentum:${command.flowThrough}`, source: "sales", label: "Customer invoice history", detail: `Relative to the latest connected sales date ${formatDate(command.flowThrough)}`, rowCount: data.sales.length, href: evidenceHref("customers", period) }],
    limitations: ["A quiet candidate is not automatically churned or currently inactive; seasonality, open orders and relationship context must be checked.", "Historical monthly run rate is an opportunity hypothesis, not forecast revenue or ROI.", ...(command.isFlowStale ? [`Sales flow is stale versus the ${formatDate(data.asOf)} accounting position; refresh it before contacting customers.`] : [])],
    table: { title: "Historical quiet-customer candidates", columns: [{ key: "customer", label: "Customer" }, { key: "lastSale", label: "Last visible sale", format: "date" }, { key: "invoices", label: "Prior invoices", format: "number" }, { key: "monthlyRunRate", label: "Historical monthly run rate", format: "currency" }], rows: candidates.slice(0, 10).map((row) => ({ customer: row.name, lastSale: row.lastSaleDate, invoices: row.priorInvoices, monthlyRunRate: row.historicalMonthlyRunRate })) },
    actions: [{ label: "Open controlled win-back", description: "Verify context and prepare an owner-approved action.", href: "/growth", kind: "action_center" }],
  };
}
 
function fundingSection(data: BusinessDataset, period: AnalystPeriod, options: AnalyseOptions): AnalystSection {
  const command = buildFundingCommand(data, options.fundingPlan ?? emptyFundingPlan());
  if (!command.totalDebt && !command.trailingFinanceCost && !command.facilities.length) {
    return emptySection("funding", "Funding and finance cost", "I can’t support a borrowing or finance-cost claim from the connected evidence yet.", "Loan/overdraft ledgers, dated interest vouchers or an owner-approved capital register are required.", { label: "Complete capital evidence", description: "Open Funding Command and map the facility register.", href: "/funding", kind: "review" });
  }
  return {
    id: "funding", intent: "funding", title: "Funding and finance cost",
    summary: `${inr(command.totalDebt)} of closing debt is visible as at ${formatDate(command.asOf)}. ${command.weightedRatePct === null ? "A weighted contracted rate is not available until facility terms are approved." : `The configured weighted rate is ${command.weightedRatePct.toFixed(1)}%.`} The connected flow contains ${inr(command.trailingFinanceCost)} of finance cost across the latest available 12-month window.`,
    status: command.plan.approved && !command.isFlowStale ? "answered" : "limited", confidence: command.plan.approved ? 0.91 : 0.7,
    metrics: [{ label: "Closing debt", value: command.totalDebt, format: "currency" }, { label: "Liquid funds", value: command.liquidFunds, format: "currency" }, { label: "Configured headroom", value: command.availableHeadroom, format: "currency" }, { label: "Weighted rate", value: command.weightedRatePct ?? "Not configured", format: command.weightedRatePct === null ? "text" : "percent" }],
    calculation: [{ label: "Net debt", formula: "Detected closing borrowing balances − bank and cash closing balances", result: inrFull(command.netDebt) }, { label: "Repricing scenario", formula: "Σ matched balance × max(contracted rate − target rate, 0)", result: `${inrFull(command.annualRepricingOpportunity)} annual opportunity before fees and eligibility` }],
    evidence: [{ id: `ledgers:funding:${command.asOf}`, source: "ledgers", label: "Borrowing and liquidity closing balances", detail: `${command.debtLedgers.length} detected borrowing ledgers · balance snapshot ${formatDate(command.asOf)}`, rowCount: command.debtLedgers.length, href: "/data?kpi=funding" }, { id: `vouchers:finance-cost:${command.flowThrough ?? "missing"}`, source: "vouchers", label: "Dated finance-cost vouchers", detail: `Flow through ${formatDate(command.flowThrough)}`, rowCount: data.vouchers?.length ?? 0, href: "/data?kpi=expenses" }],
    limitations: ["Sanctioned limits, contracted rates, target rates and maturity dates are management inputs—not inferred from Tally.", "Repricing value is a scenario, not promised saving; fees, collateral, taxes and lender eligibility are excluded.", ...(command.isFlowStale ? [`Finance-cost flow stops on ${formatDate(command.flowThrough)} while balances are dated ${formatDate(command.asOf)}.`] : [])],
    table: { title: "Capital facilities", columns: [{ key: "facility", label: "Facility" }, { key: "drawn", label: "Drawn", format: "currency" }, { key: "utilisation", label: "Utilisation", format: "percent" }, { key: "rate", label: "Rate", format: "percent" }, { key: "headroom", label: "Headroom", format: "currency" }], rows: command.facilities.map((row) => ({ facility: row.facilityName, drawn: row.drawn, utilisation: row.utilisationPct ?? 0, rate: row.annualRatePct, headroom: row.headroom ?? 0 })) },
    actions: [{ label: "Open Funding Command", description: "Inspect utilisation, renewal dates and controlled lender actions.", href: "/funding", kind: "review" }],
  };
}

function scenarioSection(data: BusinessDataset, period: AnalystPeriod, options: AnalyseOptions): AnalystSection {
  const lab = buildScenarioLab(data, options.scenarioPlan ?? emptyScenarioPlan());
  const base = lab.cases.find(row => row.id === "base")!;
  if (!lab.approved) return {
    id:"scenario", intent:"scenario", title:"Approved management scenario",
    summary:"GI has an explicit assumptions model, but the current scenario ledger is still a draft. I will not present its future values as an approved management case.",
    status:"limited", confidence:1,
    metrics:[{label:"Overdue receivables base",value:lab.bases.overdueReceivables,format:"currency"},{label:"Traceable inventory release base",value:lab.bases.releasableInventory,format:"currency"},{label:"Mapped debt base",value:lab.bases.mappedDebt,format:"currency"}],
    calculation:[{label:"Approval gate",formula:"Owner-approved assumptions required before scenario narration",result:"Draft — approval required"}],
    evidence:[{id:`scenario:bases:${data.asOf}`,source:"ledgers",label:"Current evidence bases",detail:`Balance snapshot ${formatDate(data.asOf)}; draft assumptions are not applied`,rowCount:(data.ledgers?.length??0)+(data.bills?.length??0),href:"/scenarios"}],
    limitations:[...lab.caveats,"The current assumption ledger is not owner-approved."],
    actions:[{label:"Open Scenario Lab",description:"Review and approve the assumptions before discussing future cases.",href:"/scenarios",kind:"review"}],
  };
  return {
    id:"scenario", intent:"scenario", title:"Approved management scenario",
    summary:`The approved base case shows ${inr(base.thirteenWeekCash)} of 13-week cash release, ${inr(base.annualCostAvoided)} of annual cost avoided and ${inr(base.annualFinanceSaving)} of annual finance saving. ${inr(base.annualRevenueReactivated)} is a separate gross-revenue reactivation case—not profit.`,
    status:"answered", confidence:.82,
    metrics:[{label:"13-week cash release",value:base.thirteenWeekCash,format:"currency"},{label:"Annual cost avoided",value:base.annualCostAvoided,format:"currency"},{label:"Gross revenue reactivated",value:base.annualRevenueReactivated,format:"currency"},{label:"Annual finance saving",value:base.annualFinanceSaving,format:"currency"}],
    calculation:[{label:"13-week cash",formula:"Overdue receivables × approved recovery % + traceable inventory release pool × approved release %",result:inrFull(base.thirteenWeekCash)},{label:"Annual cost",formula:"Addressable monthly cost × 12 × approved reduction %",result:inrFull(base.annualCostAvoided)},{label:"Finance saving",formula:"Mapped debt × approved basis-point reduction ÷ 10,000",result:inrFull(base.annualFinanceSaving)}],
    evidence:[{id:`scenario:approved:${data.asOf}`,source:"ledgers",label:"Approved scenario bases and assumptions",detail:`Owner-approved assumption ledger · balance snapshot ${formatDate(data.asOf)}`,rowCount:(data.ledgers?.length??0)+(data.bills?.length??0)+(data.inventory?.length??0),href:"/scenarios"}],
    limitations:lab.caveats,
    table:{title:"Scenario range",columns:[{key:"case",label:"Case"},{key:"cash",label:"13-week cash",format:"currency"},{key:"cost",label:"Annual cost avoided",format:"currency"},{key:"finance",label:"Annual finance saving",format:"currency"}],rows:lab.cases.map(row=>({case:row.label,cash:row.thirteenWeekCash,cost:row.annualCostAvoided,finance:row.annualFinanceSaving}))},
    actions:[{label:"Open Scenario Lab",description:"Review the approved assumptions and downside/upside range.",href:"/scenarios",kind:"review"}],
  };
}

function statusOf(sections: AnalystSection[]): AnalystStatus {
  if (!sections.length) return "refused";
  if (sections.every((section) => section.status === "insufficient_data" || section.status === "refused")) return "insufficient_data";
  if (sections.some((section) => section.status !== "answered")) return "limited";
  return "answered";
}

function followUps(intents: AnalystIntent[]) {
  if (intents.includes("scenario")) return ["Open Scenario Lab", "Which assumptions drive 13-week cash?", "What must be verified before acting?"];
  if (intents.includes("funding")) return ["What is our finance-cost burden?", "Which facilities need repricing or renewal?", "Open Funding Command"];
  if (intents.includes("growth_bridge") || intents.includes("customer_momentum")) return ["Which products drove the movement?", "Which customers went quiet in the connected history?", "Open Growth Command"];
  if (intents.includes("budget") || intents.includes("procurement") || intents.includes("expenses")) return ["Which cost lines are over plan?", "Where are supplier prices moving?", "Open the owner control ledger"];
  if (intents.includes("receivables")) return ["Show the top 10 debtors", "How concentrated are overdue bills?", "Take me to the collection queue"];
  if (intents.includes("salary")) return ["How much payroll cost is visible in all available history?", "Show cash movement from receipt and payment vouchers", "Which costs are over plan?"];
  if (intents.includes("revenue")) return ["Compare the latest complete month", "Which products drove this?", "Which customers contributed most?"];
  if (intents.includes("inventory")) return ["Show the largest stock positions", "Why is ageing unavailable?", "What needs reconciling first?"];
  return ["Show my trade receivables", "What is the latest supported sales period?", "Show supplier payables and reconciliation gaps"];
}

export function analyseBusiness(data: BusinessDataset, question: string, options: AnalyseOptions): Omit<AnalystResponse, "id" | "conversationId"> {
  const period = resolvePeriod(data, question, options.period, options.previous?.period);
  const unsupportedRetention = /\b(churned customers?|customer churn rate|currently inactive customers?)\b/i.test(question);
  const externalUnsupported = /\b(benchmark|competitor|industry average|weather|market price|stock price)\b/i.test(question);
  const unsupported = unsupportedRetention || externalUnsupported;
  const intents = unsupported ? [] : detectIntents(question, options.previous?.intents);
  const comparisonMonths = namedMonths(question);
  const sales = data.sales.filter((row) => inPeriod(row.date, period) && (comparisonMonths.length > 1 ? comparisonMonths.includes(row.date.slice(0, 7)) : true));
  const validCustomerRows = sales.filter((row) => clean(row.customerName).toLowerCase() !== clean(data.company).toLowerCase() && !/unspecif|unknown/i.test(row.customerName));
  const regionRows = sales.filter((row) => row.region && !/unspecif|unknown/i.test(row.region));
  const productRows = sales.filter((row) => row.productName && !/unspecif|unknown/i.test(row.productName));
  const guided = !intents.length && !unsupported ? guidedUnsupportedResponse(data, question, period) : null;

  const sections = intents.map((intent): AnalystSection => {
    if (intent === "revenue") return revenueSection(data, period, question);
    if (intent === "products") return rankingSection({ intent, title: "Product contribution", dimension: "products", rows: productRows, key: (row) => row.productName, coverage: sales.length ? productRows.length / sales.length : 0, period, question });
    if (intent === "regions") return rankingSection({ intent, title: "Regional contribution", dimension: "regions", rows: regionRows, key: (row) => row.region, coverage: sales.length ? regionRows.length / sales.length : 0, period, question });
    if (intent === "customers") return rankingSection({ intent, title: "Customer contribution", dimension: "customers", rows: validCustomerRows, key: (row) => row.customerName, coverage: sales.length ? validCustomerRows.length / sales.length : 0, period, question });
    if (intent === "receivables") return receivablesSection(data, period, question);
    if (intent === "payables") return payablesSection(data, period);
    if (intent === "inventory") return inventorySection(data, period);
    if (intent === "salary") return salarySection(data, period);
    if (intent === "cash_movement") return cashMovementSection(data, period);
    if (intent === "expenses") return expenseSection(data, period);
    if (intent === "budget") return budgetSection(data, period, options);
    if (intent === "procurement") return procurementSection(data, period, options);
    if (intent === "growth_bridge") return growthBridgeSection(data, period);
    if (intent === "customer_momentum") return customerMomentumSection(data, period);
    if (intent === "funding") return fundingSection(data, period, options);
    if (intent === "scenario") return scenarioSection(data, period, options);
    return profitabilitySection(period);
  });

  const limitations = [
    ...(period.flowFreshness === "stale" ? [`Transaction flow stops on ${formatDate(period.latestFlowDate)}, while balances are dated ${formatDate(data.asOf)}.`] : []),
    ...sections.flatMap((section) => section.limitations).filter((value, index, all) => all.indexOf(value) === index),
    ...(guided?.limitations ?? []),
  ].filter((value, index, all) => all.indexOf(value) === index);
  const status = guided?.status ?? statusOf(sections);
  const answer = !intents.length
    ? unsupported
      ? unsupportedRetention
        ? "I can’t call a customer churned, lost or currently inactive from this dataset because customer sales flow stops before the balance date. GI can rank historical contribution, but a current retention claim needs complete recent customer-level orders."
        : "I can’t support that forecast, benchmark or external-market claim from the connected accounting evidence. GI can show the historical drivers and current balance position, but it will not turn those into a future number without an explicit assumptions model."
      : "I can’t map that question to a supported calculation yet. Ask about sales, products, regions, customers, trade receivables, supplier dues, inventory, cash movement or payroll. Forecasts, benchmarks and causal claims need additional evidence or explicit assumptions."
    : sections.map((section) => section.summary).join(" ");
  const resolvedAnswer = !intents.length && guided?.answer && !unsupported ? guided.answer : answer;

  return {
    status,
    mode: "deterministic",
    answer: resolvedAnswer,
    company: clean(data.company),
    source: data.source ?? "connected dataset",
    period,
    sections,
    limitations,
    followUps: intents.length ? followUps(intents) : guided?.followUps ?? followUps(intents),
    resolvedIntents: intents,
    dataProfile: {
      salesRows: data.sales.length,
      billRows: data.bills?.length ?? 0,
      voucherRows: data.vouchers?.length ?? 0,
      ledgerRows: data.ledgers?.length ?? 0,
      inventoryRows: data.inventory.length,
    },
    ai: { used: false, role: "none", verified: true },
  };
}
