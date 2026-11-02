import Link from "next/link";
import { getActiveDataset } from "@/lib/store";
import { computeKPIs, inr } from "@/lib/engine/kpis";
import type { BusinessDataset, Insight } from "@/lib/engine/types";
import { generateInsights } from "@/lib/engine/insights";
import { coachBrief } from "@/lib/engine/coach";
import {
  datasetForOperatingPeriod,
  latestTransactionDate,
  operatingPeriod,
  type OperatingPeriod,
  type PeriodWindow,
} from "@/lib/engine/period";
import { assessTallyDataQuality, normalizeCompanyName, type TallyDataQuality } from "@/lib/connectors/tally/parse";
import { filterDatasetForOrgPlan } from "@/lib/connectors/tally/plan-window";
import {
  receivablesAging,
  topDebtors,
  revenueTrend,
  topProductsChart,
  topRegionsChart,
} from "@/lib/engine/charts";
import {
  ReceivablesAgingChart,
  TopDebtorsChart,
  RevenueTrendChart,
  TopProductsChart,
  TopRegionsChart,
} from "./_components/DashboardCharts";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Cable,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Database,
  Gauge,
  MoveRight,
  ShieldCheck,
  Sparkles,
  AlertTriangle,
  LockKeyhole,
  Send,
  Target,
  TrendingUp,
} from "lucide-react";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => new Date().toISOString().slice(0, 10);

function validIsoDate(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && ISO_DATE_RE.test(value) ? value : null;
}

function validPeriod(raw: unknown): OperatingPeriod {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === "previous_fy" || value === "all" ? value : "current_fy";
}

function overdueDaysAsOf(dueDate: string, asOf: string): number {
  const due = +new Date(dueDate);
  const ref = +new Date(asOf);
  return !Number.isNaN(due) && !Number.isNaN(ref) && due < ref ? Math.floor((ref - due) / 86400000) : 0;
}

function filterDatasetAsOf(data: BusinessDataset, asOf: string): BusinessDataset {
  const sales = data.sales.filter((row) => !ISO_DATE_RE.test(row.date) || row.date <= asOf);
  const bills = (data.bills ?? [])
    .filter((bill) => !ISO_DATE_RE.test(bill.date) || bill.date <= asOf)
    .map((bill) => ({ ...bill, overdueDays: overdueDaysAsOf(bill.dueDate, asOf) }));
  return {
    ...data,
    asOf,
    sales,
    ...(data.profitAndLossRevenue != null && asOf >= data.asOf ? { profitAndLossRevenue: data.profitAndLossRevenue } : { profitAndLossRevenue: undefined }),
    ...(data.bills ? { bills, billAgeingAsOf: asOf } : {}),
  };
}

function hasBusinessData(data: BusinessDataset) {
  return data.sales.length > 0 || data.inventory.length > 0 || (data.bills?.length ?? 0) > 0 || (data.vouchers?.length ?? 0) > 0 || (data.ledgers?.length ?? 0) > 0;
}

function formatDay(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
}

function formatCompactDate(iso: string | null) {
  if (!iso) return "No dated transactions found";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

const severityTone: Record<string, string> = {
  critical: "border-bad/25 bg-bad/10 text-bad",
  high: "border-warn/25 bg-warn/10 text-warn",
  medium: "border-gold/25 bg-gold/10 text-gold",
  low: "border-good/25 bg-good/10 text-good",
};

function EvidenceMetric({ label, value, context, href }: { label: string; value: string; context: string; href: string }) {
  return (
    <Link href={href} className="group min-w-0 border-l border-line px-4 first:border-l-0 first:pl-0 lg:px-6">
      <div className="flex items-center justify-between gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-muted">
        {label}<ArrowUpRight size={11} className="opacity-0 transition group-hover:opacity-100" />
      </div>
      <div className="num mt-2 truncate text-[1.45rem] font-semibold text-ink">{value}</div>
      <div className="mt-1 truncate text-[10px] text-muted">{context}</div>
    </Link>
  );
}

function Metric({
  label,
  value,
  sub,
  detail,
  accent,
  href,
}: {
  label: string;
  value: string;
  sub: string;
  detail?: string;
  accent?: boolean;
  href?: string;
}) {
  const content = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`num mt-1.5 text-[1.7rem] font-semibold leading-none ${accent ? "text-bad" : "text-ink"}`}>{value}</div>
      <div className="mt-1.5 text-[11px] text-muted">{sub}</div>
      {detail && <div className="mt-1 text-[10.5px] leading-snug text-muted">{detail}</div>}
    </>
  );

  return href ? (
    <Link href={href} className="panel block p-4 transition hover:-translate-y-0.5 hover:border-jade/40 hover:shadow-lg">
      {content}
    </Link>
  ) : (
    <div className="panel p-4">{content}</div>
  );
}

function PeriodTabs({ selected, asOf }: { selected: OperatingPeriod; asOf: string }) {
  const options: Array<{ id: OperatingPeriod; label: string }> = [
    { id: "current_fy", label: "Current FY" },
    { id: "previous_fy", label: "Previous FY" },
    { id: "all", label: "All history" },
  ];
  return (
    <div className="inline-flex rounded-lg border border-line bg-white p-1 shadow-card" aria-label="Revenue period">
      {options.map((option) => (
        <Link
          key={option.id}
          href={`/dashboard?period=${option.id}&asOf=${asOf}`}
          className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition ${selected === option.id ? "bg-sidebar text-white" : "text-muted hover:bg-surface2 hover:text-ink"}`}
          aria-current={selected === option.id ? "page" : undefined}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}

function LayerStatus({ voucherCount, decisionCount }: { voucherCount: number; decisionCount: number }) {
  const layers = [
    { icon: Database, step: "Layer 1 · Truth", label: "Tally data spine", value: `${voucherCount.toLocaleString("en-IN")} vouchers verified`, tone: "text-jade-bright" },
    { icon: Send, step: "Layer 2 · Action", label: "Approval control", value: "Draft first · nothing sent", tone: "text-gold" },
    { icon: Sparkles, step: "Layer 3 · Intelligence", label: "GI guidance", value: `${decisionCount} grounded decisions`, tone: "text-jade-bright" },
  ];
  return (
    <section className="mt-5 grid overflow-hidden rounded-xl border border-sidebar-line bg-sidebar shadow-lift md:grid-cols-3">
      {layers.map(({ icon: Icon, step, label, value, tone }) => (
        <div key={step} className="flex items-center gap-3 border-t border-sidebar-line px-4 py-4 first:border-t-0 md:border-l md:border-t-0 md:first:border-l-0">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-sidebar-line bg-sidebar-2 ${tone}`}><Icon size={16} /></span>
          <div className="min-w-0"><div className="font-mono text-[9px] uppercase tracking-[0.14em] text-sidebar-muted">{step}</div><div className="mt-0.5 text-[12px] font-semibold text-white">{label}</div><div className="mt-0.5 truncate text-[10px] text-sidebar-muted">{value}</div></div>
        </div>
      ))}
    </section>
  );
}

function DecisionLoop({ period, company, priority, voucherCount }: { period: PeriodWindow; company: string; priority: ReturnType<typeof coachBrief>["priorities"][number] | undefined; voucherCount: number }) {
  const stages = [
    { no: "01", icon: ShieldCheck, label: "Evidence", status: "Verified", title: `${voucherCount.toLocaleString("en-IN")} vouchers from Tally`, body: `${company} · ${period.label} operating view`, tone: "text-jade-bright" },
    { no: "02", icon: Sparkles, label: "Judgment", status: "Grounded", title: priority?.label ?? "No decision signal yet", body: priority?.soWhat ?? "GI will not manufacture advice without evidence.", tone: "text-jade-bright" },
    { no: "03", icon: Send, label: "Action", status: "Human approval", title: priority?.action ?? "No action drafted", body: "Review first. No WhatsApp, email or task is sent automatically.", tone: "text-gold" },
    { no: "04", icon: TrendingUp, label: "Result", status: "Baseline", title: "Outcome tracking starts here", body: "Recovery, DSO, margin and owner decisions will be measured after action.", tone: "text-sidebar-muted" },
  ];
  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-sidebar-line bg-sidebar shadow-lift">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-sidebar-line px-5 py-5 md:px-6">
        <div><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-jade-bright">The GI operating loop</div><h2 className="mt-1 text-[18px] font-semibold tracking-[-0.025em] text-white">Truth → decision → controlled action → measured result</h2></div>
        <span className="flex items-center gap-1.5 rounded-full border border-sidebar-line bg-sidebar-2 px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-sidebar-muted"><LockKeyhole size={11} /> Human stays in control</span>
      </div>
      <div className="grid lg:grid-cols-4">
        {stages.map(({ no, icon: Icon, label, status, title, body, tone }, index) => (
          <div key={label} className="relative border-t border-sidebar-line p-5 first:border-t-0 lg:border-l lg:border-t-0 lg:first:border-l-0">
            {index < stages.length - 1 && <ArrowRight size={15} className="absolute -right-2 top-7 z-10 hidden rounded-full bg-sidebar text-sidebar-muted lg:block" />}
            <div className="flex items-center justify-between"><span className="font-mono text-[10px] text-sidebar-muted">{no}</span><Icon size={15} className={tone} /></div>
            <div className="mt-5 text-[9px] font-semibold uppercase tracking-[0.16em] text-sidebar-muted">{label} · {status}</div>
            <h3 className="mt-2 text-[13px] font-semibold leading-snug text-white">{title}</h3>
            <p className="mt-2 line-clamp-3 text-[10px] leading-relaxed text-sidebar-muted">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function DecisionRow({ priority, index }: { priority: ReturnType<typeof coachBrief>["priorities"][number]; index: number }) {
  return (
    <div className="group grid gap-4 border-t border-sidebar-line px-5 py-5 first:border-t-0 md:grid-cols-[54px_1fr_auto] md:items-center md:px-6">
      <div className="font-mono text-[11px] font-semibold text-jade-bright">0{index + 1}</div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${severityTone[priority.severity]}`}>{priority.severity}</span>
          <span className="font-mono text-[11px] text-sidebar-muted">{inr(priority.impactInr)} at stake</span>
        </div>
        <h3 className="mt-2 text-[16px] font-semibold leading-snug tracking-[-0.02em] text-white">{priority.label}</h3>
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-sidebar-muted">{priority.soWhat}</p>
        <div className="mt-3 flex items-start gap-2 text-[12px] text-sidebar-fg"><MoveRight size={14} className="mt-0.5 shrink-0 text-jade-bright" />{priority.action}</div>
      </div>
      <Link href={{ pathname: "/ask", query: { question: `Explain ${priority.label}. Show the calculation, evidence and next controlled action.` } }} className="grid h-10 w-10 place-items-center rounded-lg border border-sidebar-line bg-sidebar-2 text-jade-bright transition group-hover:border-jade-bright/50 group-hover:bg-jade/15" aria-label={`Discuss ${priority.label}`}><ArrowUpRight size={16} /></Link>
    </div>
  );
}

function SignalTable({ insights }: { insights: Insight[] }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-jade">Decision register</div><h2 className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-ink">Signals behind today&apos;s brief</h2></div>
        <Link href="/ask" className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-jade">Interrogate the data <ArrowRight size={13} /></Link>
      </div>
      <div className="divide-y divide-line">
        {insights.slice(0, 6).map((insight) => (
          <div key={insight.id} className="grid gap-3 px-5 py-4 transition hover:bg-surface2/50 md:grid-cols-[1fr_150px_110px_36px] md:items-center">
            <div><div className="text-[13px] font-semibold text-ink">{insight.title}</div><div className="mt-1 line-clamp-1 text-[11px] text-muted">{insight.soWhat}</div></div>
            <div><div className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted">Money involved</div><div className="num mt-1 text-[13px] font-semibold text-ink">{inr(insight.impactInr)}</div></div>
            <div><div className="text-[9px] font-semibold uppercase tracking-[0.15em] text-muted">Confidence</div><div className="mt-1 flex items-center gap-2 text-[11px] font-medium text-ink-soft"><span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface2"><span className="block h-full rounded-full bg-jade" style={{ width: `${insight.confidence * 100}%` }} /></span>{Math.round(insight.confidence * 100)}%</div></div>
            <Link href={{ pathname: "/ask", query: { question: `${insight.title}. Show the evidence and what I should do next.` } }} className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-ink-soft hover:border-jade/40 hover:text-jade"><ArrowUpRight size={14} /></Link>
          </div>
        ))}
      </div>
    </section>
  );
}

function EmptyOperatingState({ company }: { company: string }) {
  const steps = [
    { icon: Cable, label: "Source", value: "Tally", state: "waiting" },
    { icon: Database, label: "Accounting coverage", value: "0 records", state: "waiting" },
    { icon: Gauge, label: "Decision readiness", value: "Not scored", state: "waiting" },
    { icon: Sparkles, label: "Owner brief", value: "Waiting", state: "waiting" },
  ];
  return (
    <section className="mt-7 overflow-hidden rounded-2xl border border-sidebar-line bg-sidebar text-sidebar-fg shadow-lift">
      <div className="grid lg:grid-cols-[0.85fr_1.15fr]">
        <div className="relative overflow-hidden border-b border-sidebar-line p-7 lg:border-b-0 lg:border-r md:p-9">
          <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-jade/20 blur-3xl" />
          <div className="relative text-[10px] font-semibold uppercase tracking-[0.2em] text-jade-bright">First clean signal</div>
          <h2 className="relative mt-3 max-w-md font-display text-[2rem] font-semibold leading-[1.08] tracking-[-0.04em] text-white">Connect the books before GI gives advice.</h2>
          <p className="relative mt-4 max-w-md text-[13px] leading-relaxed text-sidebar-muted">{company} has no accounting evidence yet. GI will not invent a “steady business” story from zeros. Connect Tally and the operating brief will rebuild from verified vouchers, bills, ledgers and stock.</p>
          <div className="relative mt-6 flex flex-wrap gap-2">
            <Link href="/connections" className="btn-primary"><Cable size={15} /> Open Data Spine</Link>
            <Link href="/data" className="inline-flex items-center gap-2 rounded-lg border border-sidebar-line bg-sidebar-2 px-4 py-2.5 text-[13px] font-semibold text-sidebar-fg"><Database size={14} /> Inspect data tables</Link>
          </div>
          <div className="relative mt-6 flex items-center gap-2 text-[10px] text-sidebar-muted"><ShieldCheck size={13} className="text-good" /> Read-only connection · company-isolated storage · no write-back to Tally</div>
        </div>

        <div className="p-7 md:p-9">
          <div className="flex items-center justify-between"><div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-muted">Live Data Spine</div><div className="mt-1 text-[13px] text-white">The path from books to boardroom</div></div><span className="rounded-md border border-sidebar-line bg-sidebar-2 px-2 py-1 font-mono text-[9px] text-sidebar-muted">AWAITING SOURCE</span></div>
          <div className="relative mt-8 grid gap-3 sm:grid-cols-4">
            <div className="absolute left-[12%] right-[12%] top-6 hidden h-px bg-sidebar-line sm:block"><div className="h-full w-0 bg-jade-bright" /></div>
            {steps.map(({ icon: Icon, label, value }, index) => (
              <div key={label} className="relative rounded-xl border border-sidebar-line bg-sidebar-2/70 p-4">
                <span className="relative grid h-8 w-8 place-items-center rounded-lg border border-sidebar-line bg-sidebar text-sidebar-muted"><Icon size={15} /></span>
                <div className="mt-5 font-mono text-[9px] text-sidebar-muted">0{index + 1}</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-muted">{label}</div>
                <div className="mt-1 text-[12px] font-semibold text-sidebar-fg">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-xl border border-sidebar-line bg-[#09182A] p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-sidebar-fg"><CircleDot size={13} className="text-jade-bright" /> What lights up after the first sync</div>
            <div className="mt-3 grid gap-2 text-[10px] text-sidebar-muted sm:grid-cols-2"><span>• Top products and real revenue mix</span><span>• Debtors and ageing by bill</span><span>• Cash, bank and payable position</span><span>• Priority actions with ₹ impact</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ReconciliationState({ company, quality }: { company: string; quality: TallyDataQuality }) {
  return (
    <section className="mt-7 overflow-hidden rounded-2xl border border-bad/25 bg-sidebar p-7 text-sidebar-fg shadow-lift md:p-9">
      <div className="flex max-w-3xl items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-bad/30 bg-bad/10 text-bad"><AlertTriangle size={20} /></span>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-bad">Data received · advice paused</div>
          <h2 className="mt-3 font-display text-[2rem] font-semibold leading-[1.08] tracking-[-0.04em] text-white">GI found a reconciliation gap before publishing advice.</h2>
          <p className="mt-4 text-[13px] leading-relaxed text-sidebar-muted">{company} is connected, but the accounting evidence did not pass the sales-voucher check. The dashboard is intentionally blocked until a clean snapshot replaces it.</p>
          <div className="mt-5 rounded-xl border border-sidebar-line bg-sidebar-2 p-4 text-[12px] text-sidebar-fg">{quality.errors.join(" ")}</div>
          <div className="mt-5 flex flex-wrap gap-2"><Link href="/connections" className="btn-primary"><Cable size={15} /> Return to Data Spine</Link></div>
        </div>
      </div>
    </section>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getSessionUser();
  const rawData = await filterDatasetForOrgPlan(await getActiveDataset(), user?.orgId || "default");
  const params = searchParams ? await searchParams : {};
  const selectedAsOf = validIsoDate(params.asOf) ?? todayIso();
  const selectedPeriod = validPeriod(params.period);
  const period = operatingPeriod(selectedAsOf, selectedPeriod);
  const asOfData = filterDatasetAsOf(rawData, selectedAsOf);
  const data = datasetForOperatingPeriod(asOfData, period);
  const previousPeriod = operatingPeriod(selectedAsOf, "previous_fy");
  const previousData = datasetForOperatingPeriod(asOfData, previousPeriod);
  const companyName = normalizeCompanyName(data.company) || data.company;
  const hasData = hasBusinessData(asOfData);
  const quality = rawData.source === "tally" && hasData ? assessTallyDataQuality(rawData) : null;
  const connected = hasData && (quality?.ok ?? true);
  const k = computeKPIs(data);
  const previousK = computeKPIs(previousData);
  const allHistoryK = computeKPIs(asOfData);
  const insights = generateInsights(data);
  const brief = coachBrief(data, insights);
  const trend = revenueTrend(data);
  const products = topProductsChart(data);
  const regions = topRegionsChart(data);
  const aging = receivablesAging(data);
  const debtors = topDebtors(data);
  const latestActivity = latestTransactionDate(asOfData);
  const noPeriodSales = selectedPeriod !== "all" && k.invoiceCount === 0;
  const revenueSub = k.revenueSource === "profit-and-loss" ? "Sales Accounts + Direct Incomes" : `${k.invoiceCount.toLocaleString("en-IN")} invoices`;
  const kpiLink = (kpi: string) => `/data?kpi=${kpi}&asOf=${selectedAsOf}&period=${selectedPeriod}${period.from ? `&from=${period.from}` : ""}`;
  const dashboardHeadline = connected
    ? noPeriodSales
      ? `No sales are posted in ${period.label} yet.`
      : `${brief.priorities.length} decisions deserve your attention.`
    : quality && !quality.ok
      ? "Evidence first. Advice only after reconciliation."
      : "Your operating picture starts with one clean sync.";

  return (
    <main className="mx-auto max-w-[1320px] px-5 py-7 md:px-7 lg:py-9">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-jade"><span className="h-1.5 w-1.5 rounded-full bg-jade shadow-[0_0_8px_#458652]" /> Owner brief · {period.label} · as of {formatDay(selectedAsOf)}</div>
          <h1 className="mt-3 max-w-3xl font-display text-[2.25rem] font-semibold leading-[1.02] tracking-[-0.05em] text-ink md:text-[3rem]">{dashboardHeadline}</h1>
          <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-ink-soft">{connected ? noPeriodSales ? `${companyName} is connected. The latest dated transaction is ${formatCompactDate(latestActivity)}, so GI is showing current balances but will not present lifetime revenue as current-year performance.` : `${companyName} · GI ranked every signal by urgency, confidence and money involved for ${period.label}.` : quality && !quality.ok ? "The books arrived, but GI detected incomplete sales parsing and paused the executive brief." : "No generic dashboard theatre. Connect accounting evidence first; advice comes second."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action="/dashboard" className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 shadow-card"><input type="hidden" name="period" value={selectedPeriod} /><CalendarDays size={14} className="text-jade" /><input name="asOf" type="date" defaultValue={selectedAsOf} className="w-[9rem] bg-transparent font-mono text-[11px] text-ink outline-none" /><button className="text-[11px] font-semibold text-jade" type="submit">Refresh</button></form>
          <Link href={{ pathname: "/ask", query: { period: selectedPeriod } }} className="btn-primary"><Sparkles size={15} /> Ask GI</Link>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <PeriodTabs selected={selectedPeriod} asOf={selectedAsOf} />
        {connected && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted"><span><strong className="font-semibold text-ink">Revenue view:</strong> {period.label}</span><span><strong className="font-semibold text-ink">Balance view:</strong> as of {formatCompactDate(selectedAsOf)}</span><span><strong className="font-semibold text-ink">Latest transaction:</strong> {formatCompactDate(latestActivity)}</span></div>}
      </div>

      {quality && !quality.ok ? <ReconciliationState company={companyName} quality={quality} /> : !connected ? <EmptyOperatingState company={companyName} /> : (
        <>
          <LayerStatus voucherCount={asOfData.vouchers?.length ?? 0} decisionCount={brief.priorities.length} />

          <section className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Metric label="Revenue" value={inr(k.totalRevenue)} sub="Total income" detail={revenueSub} href={kpiLink("revenue")} />
            <Metric label="Receivables" value={inr(k.billReceivables)} sub="Sundry Debtors" detail="Balance Sheet closing balance only" href={kpiLink("receivables")} />
            <Metric label="Overdue Receivables" value={inr(k.overdueReceivables)} sub="Needs chasing" detail="Bill-wise outstanding due date" accent href={kpiLink("overdueReceivables")} />
            <Metric label="Payables (B/S)" value={inr(k.billPayables)} sub="Sundry Creditors" detail="Balance Sheet closing balance only" href={kpiLink("payables")} />
            <Metric label="Overdue Payables" value={inr(k.overduePayables)} sub="Needs paying" detail="Bill-wise outstanding due date" accent href={kpiLink("overduePayables")} />
            <Metric label="Bank Balance" value={inr(k.bankBalance)} sub="Closing balance" detail="Balance Sheet Bank Accounts only" href={kpiLink("bankBalance")} />
            <Metric label="Cash in Hand" value={inr(k.cashBalance)} sub="Closing balance" detail="Sum Cash-in-Hand closing balance" href={kpiLink("cashInHand")} />
            <Metric label="Closing Stock" value={inr(k.closingStockValue)} sub="Stock value" detail="Balance Sheet Closing Stock group" href={kpiLink("closingStock")} />
            <Metric label="Customers" value={String(k.customerCount)} sub="Unique customers" detail="Distinct Sundry Debtors ledgers" href={kpiLink("customers")} />
            <Metric label="Products" value={String(k.productCount)} sub="Unique products" detail="Distinct stock item masters" href={kpiLink("products")} />
          </section>

          <section className="mt-4 grid overflow-hidden rounded-xl border border-line bg-white shadow-card md:grid-cols-[1.05fr_0.95fr]">
            <div className="border-b border-line p-5 md:border-b-0 md:border-r md:p-6">
              <div className="flex items-start justify-between gap-4"><div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-jade">Performance period</div><div className="num mt-2 text-[2rem] font-semibold text-ink">{inr(k.totalRevenue)}</div><div className="mt-1 text-[11px] text-muted">Revenue · {period.label} · {k.invoiceCount.toLocaleString("en-IN")} invoices</div></div><Target size={19} className="text-jade" /></div>
              <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4"><div><div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">Previous FY</div><div className="num mt-1 text-[14px] font-semibold text-ink">{inr(previousK.totalRevenue)}</div></div><div><div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">All history</div><div className="num mt-1 text-[14px] font-semibold text-ink">{inr(allHistoryK.totalRevenue)}</div><div className="mt-1 text-[9px] text-muted">Context only · not today&apos;s headline</div></div></div>
            </div>
            <div className="p-5 md:p-6">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-jade">Data freshness verdict</div>
              <h2 className="mt-2 text-[17px] font-semibold tracking-[-0.02em] text-ink">{noPeriodSales ? "Connected books, but no current-FY sales activity." : "The selected period contains dated sales evidence."}</h2>
              <p className="mt-2 text-[11px] leading-relaxed text-muted">{noPeriodSales ? `The current balance sheet can still support collections and liquidity decisions. Sales-growth advice stays paused until current-FY sales vouchers are available; the latest accounting activity is ${formatCompactDate(latestActivity)}.` : `GI is using ${k.invoiceCount.toLocaleString("en-IN")} invoices inside ${period.label}; lifetime P&L is retained only as historical context.`}</p>
              <Link href="/connections" className="mt-4 inline-flex items-center gap-2 text-[11px] font-semibold text-jade">Review sync coverage <ArrowRight size={13} /></Link>
            </div>
          </section>

          <section className="mt-7 grid gap-4 xl:grid-cols-[1.5fr_0.7fr]">
            <div className="overflow-hidden rounded-2xl border border-sidebar-line bg-sidebar shadow-lift">
              <div className="flex items-end justify-between border-b border-sidebar-line px-5 py-5 md:px-6"><div><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-jade-bright">Decision stack</div><h2 className="mt-1 text-[18px] font-semibold tracking-[-0.025em] text-white">What should move before Friday</h2></div><div className="text-right"><div className="font-mono text-[9px] uppercase tracking-[0.12em] text-sidebar-muted">Largest exposure</div><div className="num mt-1 text-[18px] font-semibold text-white">{inr(brief.focusInr)}</div></div></div>
              {brief.priorities.map((priority, index) => <DecisionRow key={`${priority.label}-${index}`} priority={priority} index={index} />)}
            </div>
            <div className="panel p-5 md:p-6">
              <div className="flex items-center justify-between"><div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-jade">Money map</div><h2 className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-ink">Where capital sits today</h2></div><BarChart3 size={18} className="text-jade" /></div>
              <div className="mt-6 space-y-5">
                {[{label:"Bank + cash",value:k.bankBalance+k.cashBalance,color:"bg-good"},{label:"All receivable balances",value:k.billReceivables,color:"bg-jade"},{label:"All payable balances",value:k.billPayables,color:"bg-warn"},{label:"Stock",value:k.closingStockValue,color:"bg-[#7C5CFC]"}].map((row) => { const max = Math.max(k.bankBalance+k.cashBalance,k.receivables,k.payables,k.closingStockValue,1); return <div key={row.label}><div className="flex items-end justify-between"><span className="text-[11px] font-medium text-ink-soft">{row.label}</span><span className="num text-[12px] font-semibold text-ink">{inr(row.value)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface2"><div className={`h-full rounded-full ${row.color}`} style={{width:`${Math.max(3,(row.value/max)*100)}%`}} /></div></div>; })}
              </div>
              <Link href="/review" className="mt-6 flex items-center justify-between rounded-lg border border-line bg-surface2/60 px-3 py-3 text-[11px] font-semibold text-ink-soft">Review working capital <ArrowUpRight size={14} className="text-jade" /></Link>
            </div>
          </section>

          <DecisionLoop period={period} company={companyName} priority={brief.priorities[0]} voucherCount={asOfData.vouchers?.length ?? 0} />

          <section className="mt-4 grid grid-cols-2 rounded-xl border border-line bg-white px-5 py-5 shadow-card md:grid-cols-4">
            <EvidenceMetric label={`Revenue · ${period.shortLabel}`} value={inr(k.totalRevenue)} context={`${k.invoiceCount} invoices in period`} href={kpiLink("revenue")} />
            <EvidenceMetric label="Debtors (B/S) · as of" value={inr(k.billReceivables)} context={`${inr(k.overdueReceivables)} overdue`} href={kpiLink("receivables")} />
            <EvidenceMetric label="Payables · as of" value={inr(k.billPayables)} context={`${inr(k.overduePayables)} overdue`} href={kpiLink("payables")} />
            <EvidenceMetric label="Inventory · as of" value={inr(k.closingStockValue)} context={`${k.productCount} products`} href={kpiLink("closingStock")} />
          </section>

          <section className="mt-6 space-y-4">
            <div className="flex items-center gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-jade">Evidence room</div><h2 className="mt-1 text-[19px] font-semibold tracking-[-0.025em] text-ink">Patterns supporting the brief</h2></div><div className="h-px flex-1 bg-line" /></div>
            {trend.length >= 2 ? <RevenueTrendChart data={trend} /> : <div className="panel flex min-h-44 items-center justify-center p-6 text-center"><div><TrendingUp size={20} className="mx-auto text-muted" /><div className="mt-3 text-[13px] font-semibold text-ink">No revenue trend for {period.label}</div><div className="mt-1 text-[11px] text-muted">Sync dated sales for this period; GI will not stretch older transactions into the current year.</div></div></div>}
            <div className="grid gap-4 lg:grid-cols-2">{products.length > 0 && <TopProductsChart data={products} />}{regions.length > 0 && <TopRegionsChart data={regions} />}{aging.length > 0 && <ReceivablesAgingChart data={aging} />}{debtors.length > 0 && <TopDebtorsChart data={debtors} />}</div>
          </section>
          <div className="mt-6"><SignalTable insights={insights} /></div>
        </>
      )}

      <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-[10px] text-muted"><span>Growth Intelligence · Executive OS</span><span className="flex items-center gap-1.5"><CheckCircle2 size={12} className="text-good" /> Advice is generated only from connected evidence</span></footer>
    </main>
  );
}
