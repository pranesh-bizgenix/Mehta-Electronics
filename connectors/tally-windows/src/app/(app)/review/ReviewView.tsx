"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  Legend,
  ComposedChart,
  Line,
  ReferenceLine,
} from "recharts";
import { ArrowUpRight, ArrowDownRight, Minus, TrendingUp, Circle, Wallet, Banknote, Boxes, Landmark, Sparkles } from "lucide-react";
import { inr } from "@/lib/engine/kpis";
import type { MonthlyReview, Delta, MonthRow } from "@/lib/engine/review";
import type { FinancialSnapshot } from "@/lib/performance/snapshots";

const JADE = "#458652";
const JADE_BRIGHT = "#4CAF50";
const BAD = "#B23B2E";
const GOLD = "#B5832F";
const INK_SOFT = "#57514A";
const MUTED = "#8A837A";
const LINE = "#DCE8DF";

const monthLabel = (m: string) => {
  if (!m) return "—";
  const [y, mo] = m.split("-");
  return new Date(+y, +mo - 1, 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
};

function DeltaCard({
  label,
  delta,
  fmt,
  goodWhenUp = true,
  sub,
}: {
  label: string;
  delta: Delta;
  fmt: (n: number) => string;
  goodWhenUp?: boolean;
  sub: string;
}) {
  const good = delta.direction === "flat" ? null : (delta.direction === "up") === goodWhenUp;
  const Icon = delta.direction === "up" ? ArrowUpRight : delta.direction === "down" ? ArrowDownRight : Minus;
  const color = good === null ? "text-muted" : good ? "text-jade" : "text-bad";
  return (
    <div className="panel p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="num mt-1.5 text-[1.55rem] font-semibold leading-none text-ink">{fmt(delta.current)}</div>
      <div className={`mt-2 flex items-center gap-1 text-[12.5px] font-semibold ${color}`}>
        <Icon size={14} />
        {delta.changePct >= 0 ? "+" : ""}
        {delta.changePct.toFixed(0)}%
        <span className="font-normal text-muted">{sub}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="panel p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`num mt-1.5 text-[1.45rem] font-semibold leading-none ${accent ? "text-bad" : "text-ink"}`}>{value}</div>
      <div className="mt-1.5 text-[11px] text-muted">{sub}</div>
    </div>
  );
}

const moTip = (title: string, rows: { k: string; v: string }[]) => (
  <div className="rounded-lg border border-line bg-surface px-3 py-2 shadow-sm">
    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</div>
    {rows.map((r) => (
      <div key={r.k} className="num text-[12.5px] text-ink">
        <span className="text-muted">{r.k}: </span>
        {r.v}
      </div>
    ))}
  </div>
);

export function ReviewView({ review, snapshots }: { review: MonthlyReview; snapshots: FinancialSnapshot[] }) {
  if (!review.hasData) {
    return (
      <div className="panel mt-6 p-8 text-center">
        <TrendingUp className="mx-auto text-muted" size={28} />
        <p className="mt-3 text-sm text-ink-soft">
          Need at least two months of data for a month-on-month review. Connect more history from Tally.
        </p>
      </div>
    );
  }

  const chart = review.months.slice(-12);
  const pos = review.position;
  const balanceChart = snapshots.map((snapshot) => ({
    date: snapshot.asOf,
    receivables: snapshot.metrics.receivables,
    payables: snapshot.metrics.payables,
    liquidity: snapshot.metrics.bank + snapshot.metrics.cash,
    stock: snapshot.metrics.stock,
  }));
  const momentumAlerts = [
    { label: "Sales", value: review.revenue.current, delta: review.revenue, goodWhenUp: true, move: review.revenue.direction === "down" ? "Find the customer and product losses before the next cycle." : "Protect the buyers and products creating the lift." },
    { label: "Cash movement", value: review.operatingCashFlow.current, delta: review.operatingCashFlow, goodWhenUp: true, move: review.operatingCashFlow.current < 0 ? "Sequence collections and payments against a 13-week cash plan." : "Ring-fence the positive movement for priority commitments." },
    { label: "New credit given", value: review.newReceivables.current, delta: review.newReceivables, goodWhenUp: false, move: review.newReceivables.direction === "up" ? "Tighten terms where credit is growing faster than receipts." : "Keep payment discipline while protecting healthy sales." },
    { label: "Stock sales movement", value: review.stockOut.current, delta: review.stockOut, goodWhenUp: true, move: review.stockOut.direction === "down" ? "Separate demand decline from stale item-level voucher history." : "Replenish only the items sustaining measured movement." },
  ];

  return (
    <>
      {/* Verdict */}
      <div
        className={`mt-6 flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${
          review.goodTrend ? "border-jade/25 bg-jade-soft" : "border-line bg-surface2/50"
        }`}
      >
        <span className={`grid h-9 w-9 place-items-center rounded-xl ${review.goodTrend ? "bg-jade text-white" : "bg-surface text-muted"}`}>
          <TrendingUp size={17} />
        </span>
        <div>
          <div className="font-serif text-[1.2rem] font-medium text-ink">
            {review.goodTrend ? "You're trending up." : review.goodTrend === false ? "Momentum is slipping — worth a look." : "Early days — keep the data flowing."}
          </div>
          <div className="text-[13px] text-ink-soft">
            Revenue grew in {review.revenueUpStreak.up} of the last {review.revenueUpStreak.of} months · {monthLabel(review.latestMonth)} vs{" "}
            {monthLabel(review.prevMonth)}:{" "}
            <span className={review.revenue.direction === "up" ? "font-semibold text-jade" : review.revenue.direction === "down" ? "font-semibold text-bad" : ""}>
              {review.revenue.changePct >= 0 ? "+" : ""}
              {review.revenue.changePct.toFixed(0)}% revenue
            </span>
          </div>
        </div>
      </div>

      {/* Management movement tape — the page's signature decision device. */}
      <section className="mt-7 overflow-hidden rounded-2xl border border-sidebar-line bg-sidebar text-white shadow-lift">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-sidebar-line px-5 py-4">
          <div><div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-jade-bright"><Sparkles size={12} /> GI movement tape</div><h2 className="mt-1 text-[18px] font-semibold tracking-[-0.025em]">Four shifts management should read together</h2></div>
          <div className="font-mono text-[9px] text-sidebar-muted">{monthLabel(review.latestMonth)} vs {monthLabel(review.prevMonth)} · latest available months</div>
        </div>
        <div className="grid md:grid-cols-2 xl:grid-cols-4">
          {momentumAlerts.map((item) => {
            const favourable = item.delta.direction === "flat" ? null : (item.delta.direction === "up") === item.goodWhenUp;
            return <div key={item.label} className="border-t border-sidebar-line p-5 first:border-t-0 md:border-l md:first:border-l-0 xl:border-t-0"><div className="flex items-start justify-between gap-3"><div><div className="text-[9px] font-semibold uppercase tracking-[0.15em] text-sidebar-muted">{item.label}</div><div className="num mt-2 text-[18px] font-semibold text-white">{inr(item.value)}</div></div><span className={`rounded-full border px-2 py-1 font-mono text-[9px] ${favourable === null ? "border-sidebar-line text-sidebar-muted" : favourable ? "border-jade/40 bg-jade/15 text-jade-bright" : "border-bad/40 bg-bad/10 text-[#FF9B8D]"}`}>{item.delta.changePct >= 0 ? "+" : ""}{item.delta.changePct.toFixed(0)}%</span></div><p className="mt-4 text-[10px] leading-relaxed text-sidebar-muted">{item.move}</p></div>;
          })}
        </div>
      </section>

      <h2 className="mt-7 font-serif text-lg font-medium italic text-ink">This month vs last</h2>
      <section className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <DeltaCard label="Revenue" delta={review.revenue} fmt={inr} sub={`vs ${monthLabel(review.prevMonth)}`} />
        <DeltaCard label="Orders" delta={review.orders} fmt={(n) => String(Math.round(n))} sub="invoices" />
        <DeltaCard label="Cash received" delta={review.cashIn} fmt={inr} sub="receipt vouchers" />
        <DeltaCard label="Cash paid" delta={review.cashOut} fmt={inr} goodWhenUp={false} sub="payment vouchers" />
        <DeltaCard label="Net cash movement" delta={review.operatingCashFlow} fmt={inr} sub="receipts − payments" />
        <DeltaCard label="New credit given" delta={review.newReceivables} fmt={inr} goodWhenUp={false} sub="receivables raised" />
        <DeltaCard label="Finance cost" delta={review.financeCost} fmt={inr} goodWhenUp={false} sub="interest & charges" />
        <DeltaCard label="Stock moved out" delta={review.stockOut} fmt={inr} sub="sales item allocations" />
      </section>

      {/* Current financial position (snapshot) */}
      {pos.hasFinancials && (
        <>
          <h2 className="mt-7 flex items-center gap-2 font-serif text-lg font-medium italic text-ink">
            <Wallet size={16} className="text-jade" /> Where you stand today
          </h2>
          <section className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Stat label="Receivables" value={inr(pos.balanceSheetReceivables)} sub="ledger closing" />
            <Stat label="Payables" value={inr(pos.payables)} sub="you owe" accent />
            <Stat label="Bank" value={inr(pos.bank)} sub="across accounts" />
            <Stat label="Cash" value={inr(pos.cash)} sub="in hand" />
            <Stat label="Closing stock" value={inr(pos.stock)} sub="capital in stock" />
          </section>
        </>
      )}

      {/* Revenue MoM */}
      <section className="panel mt-7 p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="font-serif text-[1.15rem] font-medium text-ink">Revenue, month on month</h3>
          <span className="text-[11px] text-muted">last {chart.length} months</span>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
            <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fill: INK_SOFT, fontSize: 11 }} axisLine={{ stroke: LINE }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tickFormatter={(v) => inr(v).replace("₹", "")} tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
            <Tooltip cursor={{ fill: "rgba(19,122,86,0.06)" }} content={({ active, payload }) => (active && payload?.length ? moTip(monthLabel(payload[0].payload.month), [{ k: "Revenue", v: inr(payload[0].payload.revenue) }, { k: "Orders", v: String(payload[0].payload.orders) }]) : null)} />
            <Bar dataKey="revenue" radius={[5, 5, 0, 0]} maxBarSize={46}>
              {chart.map((_, i) => (
                <Cell key={i} fill={i === chart.length - 1 ? JADE : JADE_BRIGHT} fillOpacity={i === chart.length - 1 ? 1 : 0.7} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Receipt/payment movement is a cash-flow operating view, not a statutory cash-flow statement. */}
      <section className="mt-3 grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="panel p-5">
          <div className="mb-3 flex items-baseline justify-between"><div><div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-jade"><Banknote size={13} /> Cash conversion</div><h3 className="mt-1 font-serif text-[1.15rem] font-medium text-ink">Receipts, payments and net movement</h3></div><span className="text-[10px] text-muted">voucher evidence</span></div>
          <ResponsiveContainer width="100%" height={270}>
            <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fill: INK_SOFT, fontSize: 10 }} axisLine={{ stroke: LINE }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={(v) => inr(v).replace("₹", "")} tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} width={52} />
              <Tooltip cursor={{ fill: "rgba(19,122,86,0.05)" }} content={({ active, payload }) => (active && payload?.length ? moTip(monthLabel(payload[0].payload.month), [{ k: "Received", v: inr(payload[0].payload.cashIn) }, { k: "Paid", v: inr(payload[0].payload.cashOut) }, { k: "Net", v: inr(payload[0].payload.operatingCashFlow) }]) : null)} />
              <Legend iconType="circle" formatter={(v) => <span style={{ color: INK_SOFT, fontSize: 11 }}>{v}</span>} />
              <ReferenceLine y={0} stroke={LINE} />
              <Bar dataKey="cashIn" name="Cash received" fill={JADE_BRIGHT} radius={[4, 4, 0, 0]} maxBarSize={19} />
              <Bar dataKey="cashOut" name="Cash paid" fill={GOLD} radius={[4, 4, 0, 0]} maxBarSize={19} />
              <Line dataKey="operatingCashFlow" name="Net movement" stroke={BAD} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="panel p-5">
          <div className="mb-3 flex items-baseline justify-between"><div><div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-jade"><Boxes size={13} /> Inventory velocity</div><h3 className="mt-1 font-serif text-[1.15rem] font-medium text-ink">Stock entering vs moving out</h3></div><span className="text-[10px] text-muted">item allocations</span></div>
          <ResponsiveContainer width="100%" height={270}>
            <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fill: INK_SOFT, fontSize: 10 }} axisLine={{ stroke: LINE }} tickLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={(v) => inr(v).replace("₹", "")} tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} width={52} />
              <Tooltip cursor={{ fill: "rgba(19,122,86,0.05)" }} content={({ active, payload }) => (active && payload?.length ? moTip(monthLabel(payload[0].payload.month), [{ k: "Stock in", v: inr(payload[0].payload.stockIn) }, { k: "Stock out", v: inr(payload[0].payload.stockOut) }]) : null)} />
              <Legend iconType="circle" formatter={(v) => <span style={{ color: INK_SOFT, fontSize: 11 }}>{v}</span>} />
              <Bar dataKey="stockIn" name="Stock in" fill="#9A86FF" radius={[4, 4, 0, 0]} maxBarSize={20} />
              <Bar dataKey="stockOut" name="Stock out" fill={JADE} radius={[4, 4, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Credit given vs went overdue */}
      <section className="panel mt-3 p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="font-serif text-[1.15rem] font-medium text-ink">Credit given vs gone overdue</h3>
          <span className="text-[11px] text-muted">are you collecting?</span>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
            <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fill: INK_SOFT, fontSize: 11 }} axisLine={{ stroke: LINE }} tickLine={false} interval="preserveStartEnd" />
            <YAxis tickFormatter={(v) => inr(v).replace("₹", "")} tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
            <Tooltip cursor={{ fill: "rgba(19,122,86,0.06)" }} content={({ active, payload }) => (active && payload?.length ? moTip(monthLabel(payload[0].payload.month), [{ k: "Credit given", v: inr(payload[0].payload.newReceivables) }, { k: "Overdue", v: inr(payload[0].payload.overdueRaised) }]) : null)} />
            <Legend iconType="circle" formatter={(v) => <span style={{ color: INK_SOFT, fontSize: 12 }}>{v}</span>} />
            <Bar dataKey="newReceivables" name="Credit given" fill={JADE} radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Bar dataKey="overdueRaised" name="Gone overdue" fill={BAD} radius={[4, 4, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className="panel mt-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-jade"><Landmark size={13} /> Balance movement</div><h3 className="mt-1 font-serif text-[1.15rem] font-medium text-ink">Cash, receivables, payables and stock over time</h3></div><span className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-[9px] text-muted">{snapshots.length} sync snapshot{snapshots.length === 1 ? "" : "s"}</span></div>
        {balanceChart.length >= 2 ? <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={balanceChart} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
            <XAxis dataKey="date" tickFormatter={(value) => new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} tick={{ fill: INK_SOFT, fontSize: 10 }} axisLine={{ stroke: LINE }} tickLine={false} />
            <YAxis tickFormatter={(v) => inr(v).replace("₹", "")} tick={{ fill: MUTED, fontSize: 10 }} axisLine={false} tickLine={false} width={52} />
            <Tooltip content={({ active, payload }) => (active && payload?.length ? moTip(new Date(`${payload[0].payload.date}T00:00:00`).toLocaleDateString("en-IN"), [{ k: "Receivables", v: inr(payload[0].payload.receivables) }, { k: "Payables", v: inr(payload[0].payload.payables) }, { k: "Stock", v: inr(payload[0].payload.stock) }, { k: "Liquidity", v: inr(payload[0].payload.liquidity) }]) : null)} />
            <Legend iconType="circle" formatter={(v) => <span style={{ color: INK_SOFT, fontSize: 11 }}>{v}</span>} />
            <Line dataKey="receivables" name="Receivables" stroke={JADE} strokeWidth={2.3} dot={{ r: 3 }} />
            <Line dataKey="payables" name="Payables" stroke={GOLD} strokeWidth={2.3} dot={{ r: 3 }} />
            <Line dataKey="stock" name="Stock" stroke="#7C5CFC" strokeWidth={2} dot={{ r: 3 }} />
            <Line dataKey="liquidity" name="Bank + cash" stroke={JADE_BRIGHT} strokeWidth={2} dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer> : <div className="mt-4 grid gap-4 rounded-xl border border-dashed border-line bg-surface2/35 p-5 md:grid-cols-[1fr_auto] md:items-center"><div><div className="text-[12px] font-semibold text-ink">GI started the balance-history ledger with this sync.</div><p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-muted">Tally gives today&apos;s closing balances, not trustworthy past daily balances. GI now freezes receivables, payables, bank, cash and stock after every sync. A real trend appears after the next dated snapshot; no historical balance is fabricated.</p></div><div className="rounded-xl border border-line bg-white px-4 py-3 text-right"><div className="text-[9px] uppercase tracking-[0.12em] text-muted">First snapshot</div><div className="mt-1 text-[11px] font-semibold text-jade">{snapshots[0]?.asOf ? new Date(`${snapshots[0].asOf}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Next sync"}</div></div></div>}
      </section>

      {/* Table */}
      <section className="panel mt-3 overflow-x-auto p-5">
        <h3 className="mb-3 font-serif text-[1.15rem] font-medium text-ink">The last 6 months</h3>
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted">
              <th className="pb-2 font-semibold">Month</th>
              <th className="pb-2 text-right font-semibold">Revenue</th>
              <th className="pb-2 text-right font-semibold">MoM</th>
              <th className="pb-2 text-right font-semibold">Received</th>
              <th className="pb-2 text-right font-semibold">Paid</th>
              <th className="pb-2 text-right font-semibold">Net cash</th>
              <th className="pb-2 text-right font-semibold">Credit</th>
              <th className="pb-2 text-right font-semibold">Stock out</th>
              <th className="pb-2 text-right font-semibold">Finance cost</th>
            </tr>
          </thead>
          <tbody>
            {review.months.slice(-6).map((m: MonthRow, i, arr) => {
              const prev = arr[i - 1];
              const mom = prev && prev.revenue ? ((m.revenue - prev.revenue) / prev.revenue) * 100 : null;
              return (
                <tr key={m.month} className="border-t border-line">
                  <td className="py-2 font-medium text-ink">{monthLabel(m.month)}</td>
                  <td className="num py-2 text-right text-ink">{inr(m.revenue)}</td>
                  <td className={`py-2 text-right font-semibold ${mom == null ? "text-muted" : mom >= 0 ? "text-jade" : "text-bad"}`}>{mom == null ? "—" : `${mom >= 0 ? "+" : ""}${mom.toFixed(0)}%`}</td>
                  <td className="num py-2 text-right text-ink-soft">{m.cashIn ? inr(m.cashIn) : "—"}</td>
                  <td className="num py-2 text-right text-ink-soft">{m.cashOut ? inr(m.cashOut) : "—"}</td>
                  <td className={`num py-2 text-right ${m.operatingCashFlow >= 0 ? "text-jade" : "text-bad"}`}>{m.operatingCashFlow ? inr(m.operatingCashFlow) : "—"}</td>
                  <td className="num py-2 text-right text-ink-soft">{m.newReceivables ? inr(m.newReceivables) : "—"}</td>
                  <td className="num py-2 text-right text-ink-soft">{m.stockOut ? inr(m.stockOut) : "—"}</td>
                  <td className={`num py-2 text-right ${m.financeCost ? "text-bad" : "text-muted"}`}>{m.financeCost ? inr(m.financeCost) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted">
          <Circle size={6} className="mt-1 fill-jade text-jade" /> Sales, receipts, payments, credit, stock movement and finance cost are computed from dated vouchers. This is internal management analysis, not an audited or statutory cash-flow statement. Balance history builds from verified sync snapshots.
        </p>
      </section>
    </>
  );
}
