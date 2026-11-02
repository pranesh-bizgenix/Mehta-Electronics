"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUp,
  BarChart3,
  BookOpenCheck,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Database,
  FileCheck2,
  Loader2,
  MessageSquareText,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Table2,
} from "lucide-react";
import { inr } from "@/lib/engine/kpis";
import type { AnalystColumn, AnalystIntent, AnalystResponse, AnalystSection } from "@/lib/analyst/types";
import type { OperatingPeriod } from "@/lib/engine/period";
import { AnalystChart } from "./AnalystChart";

interface Meta {
  company: string;
  source: string;
  asOf: string;
  latestSalesDate: string | null;
  coverage: { sales: number; bills: number; vouchers: number; ledgers: number; inventory: number };
  starters: string[];
}

type Message = { role: "user"; text: string } | { role: "analyst"; result: AnalystResponse };

const DEFAULT_STARTERS = [
  "How much trade receivable is overdue, and who should I chase first?",
  "Show cash movement from receipt and payment vouchers.",
  "How much payroll cost is visible in all available history?",
  "What is the latest supported sales period, and which products drove it?",
  "What can you support about inventory value, and what needs reconciling?",
  "Which costs are over plan, and where are supplier prices moving?",
  "Why did sales change, and which customers went quiet in the connected history?",
];

const GUIDED_TOPICS = [
  "Sales",
  "Receivables",
  "Payables",
  "Inventory",
  "Payroll",
  "Cash",
  "Expenses",
  "Funding",
];

const EXPLORE_PROMPTS = [
  "What is the latest supported sales period?",
  "Show cash movement from receipt and payment vouchers",
  "How much payroll cost is visible in all available history?",
];

const PERIODS: Array<{ id: OperatingPeriod; label: string }> = [
  { id: "all", label: "All history" },
  { id: "current_fy", label: "Current FY" },
  { id: "previous_fy", label: "Previous FY" },
];

function day(value: string | null | undefined) {
  if (!value) return "Not available";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function valueOf(value: string | number, format: AnalystColumn["format"] | "text") {
  if (typeof value === "string") return value;
  if (format === "currency") return inr(value);
  if (format === "percent") return `${value.toFixed(1)}%`;
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function statusStyle(status: AnalystSection["status"] | AnalystResponse["status"]) {
  if (status === "answered") return "border-good/25 bg-good/10 text-jade-deep";
  if (status === "limited") return "border-warn/30 bg-warn/10 text-warn";
  return "border-bad/25 bg-bad/10 text-bad";
}

function ResultTable({ section }: { section: AnalystSection }) {
  if (!section.table) return null;
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-line bg-white">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-ink"><Table2 size={14} className="text-jade" />{section.table.title}</div>
        <span className="text-[10px] text-muted">{section.table.rows.length} rows</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-[11px]">
          <caption className="sr-only">{section.table.title}</caption>
          <thead className="bg-paper/65 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
            <tr>{section.table.columns.map((column) => <th key={column.key} scope="col" className="whitespace-nowrap px-4 py-2.5">{column.label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {section.table.rows.map((row, index) => (
              <tr key={`${section.id}-${index}`} className="hover:bg-jade-soft/30">
                {section.table!.columns.map((column) => (
                  <td key={column.key} className={`max-w-[280px] px-4 py-2.5 text-ink-soft ${column.format && column.format !== "text" && column.format !== "date" ? "num whitespace-nowrap font-medium text-ink" : ""}`}>
                    {valueOf(row[column.key] ?? "—", column.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Section({ section }: { section: AnalystSection }) {
  const trustLabel = section.status === "answered" ? "Verified evidence" : section.status === "limited" ? "Directional · see limits" : "Insufficient evidence";
  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="absolute inset-y-0 left-0 w-1 bg-jade" />
      <div className="p-5 pl-6 md:p-6 md:pl-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-[17px] font-semibold tracking-[-0.025em] text-ink">{section.title}</h3>
              <span className={`pill text-[9px] ${statusStyle(section.status)}`}>{section.status.replace("_", " ")}</span>
            </div>
            <p className="mt-2 max-w-3xl text-[13px] leading-6 text-ink-soft">{section.summary}</p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted"><ShieldCheck size={13} className="text-jade" />{trustLabel}</div>
        </div>

        {section.metrics.length > 0 && (
          <div className="mt-5 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {section.metrics.map((metric) => (
              <div key={`${section.id}-${metric.label}`} className="bg-white px-4 py-3.5">
                <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-muted">{metric.label}</div>
                <div className={`mt-1.5 text-[18px] font-semibold tracking-[-0.03em] text-ink ${metric.format !== "text" ? "num" : ""}`}>{valueOf(metric.value, metric.format)}</div>
                {metric.note && <div className="mt-1 text-[9px] text-muted">{metric.note}</div>}
              </div>
            ))}
          </div>
        )}

        {section.chart && <AnalystChart chart={section.chart} />}
        <ResultTable section={section} />

        <details className="group mt-4 overflow-hidden rounded-xl bg-sidebar text-sidebar-fg" open>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5">
            <div className="flex items-center gap-2.5"><BookOpenCheck size={15} className="text-jade-bright" /><span className="text-[11px] font-semibold">How GI calculated this</span></div>
            <ChevronDown size={14} className="text-sidebar-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-sidebar-line px-4 py-4">
            {section.calculation.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {section.calculation.map((step) => (
                  <div key={`${section.id}-${step.label}`} className="rounded-lg border border-sidebar-line bg-sidebar-2/55 p-3">
                    <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-jade-bright">{step.label}</div>
                    <div className="mt-2 text-[11px] leading-relaxed text-sidebar-muted">{step.formula}</div>
                    <div className="num mt-2 text-[13px] font-semibold text-sidebar-fg">{step.result}</div>
                  </div>
                ))}
              </div>
            ) : <p className="text-[11px] text-sidebar-muted">No defensible calculation was available, so GI stopped before producing a number.</p>}
          </div>
        </details>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted"><FileCheck2 size={13} />Evidence and limits</div>
            <div className="space-y-2">
              {section.evidence.map((item) => {
                const content = <><Database size={13} className="mt-0.5 shrink-0 text-jade" /><div className="min-w-0 flex-1"><div className="text-[11px] font-semibold text-ink">{item.label}</div><div className="mt-0.5 text-[11px] leading-relaxed text-muted">{item.detail} · source: {item.source.replaceAll("_", " ")}</div></div>{item.href && <ArrowRight size={12} className="mt-1 shrink-0 text-jade" />}</>;
                return item.href
                  ? <Link key={item.id} href={item.href} className="flex items-start gap-2.5 rounded-lg border border-line bg-paper/55 px-3 py-2.5 transition hover:border-jade/35 hover:bg-jade-soft/40">{content}</Link>
                  : <div key={item.id} className="flex items-start gap-2.5 rounded-lg border border-line bg-paper/55 px-3 py-2.5">{content}</div>;
              })}
              {section.limitations.map((limit) => (
                <div key={limit} className="flex items-start gap-2.5 px-1 text-[10px] leading-relaxed text-muted"><CircleAlert size={13} className="mt-0.5 shrink-0 text-warn" />{limit}</div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-[320px] lg:justify-end">
            {section.actions.map((action, index) => (
              <Link key={`${section.id}-${action.href}`} href={action.href} className={index === section.actions.length - 1 && action.kind !== "evidence" ? "btn-primary py-2 text-[11px]" : "btn-ghost py-2 text-[11px]"} title={action.description}>
                {action.label}<ArrowRight size={12} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AnalystAnswer({ result, onFollowUp }: { result: AnalystResponse; onFollowUp: (question: string) => void }) {
  const resultModeLabel = result.mode === "ai_narrated"
    ? "AI phrasing · verified calculations"
    : result.sections.length
      ? "Calculated by GI"
      : "Guided by GI";

  return (
    <div className="animate-fade-up space-y-4">
      <div className="flex items-start gap-3">
        <span className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-jade/20 bg-jade-soft text-jade-deep"><Sparkles size={16} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted">
            <span className={`pill ${statusStyle(result.status)}`}>{result.status.replace("_", " ")}</span>
            <span>{resultModeLabel}</span>
            <span>·</span><span>Transactions: {result.period.label}</span>
            <span>·</span><span>Balances: as of {day(result.period.asOf)}</span>
          </div>
          <p className="mt-2 max-w-4xl text-[15px] leading-7 text-ink">{result.answer}</p>
        </div>
      </div>

      {result.sections.map((section) => <Section key={section.id} section={section} />)}

      {!result.sections.length && (
        <div className="rounded-2xl border border-warn/30 bg-warn/10 p-5 text-[12px] leading-relaxed text-ink-soft">
          <div className="mb-3 rounded-xl border border-line/70 bg-white/75 px-3 py-2.5 text-[11px] text-ink-soft">
            <div className="font-semibold text-ink">Connected evidence in view</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full border border-line bg-white px-3 py-1 text-[10px] font-medium text-ink-soft">{result.dataProfile.salesRows.toLocaleString("en-IN")} sales lines</span>
              <span className="rounded-full border border-line bg-white px-3 py-1 text-[10px] font-medium text-ink-soft">{result.dataProfile.billRows.toLocaleString("en-IN")} bills</span>
              <span className="rounded-full border border-line bg-white px-3 py-1 text-[10px] font-medium text-ink-soft">{result.dataProfile.voucherRows.toLocaleString("en-IN")} vouchers</span>
              <span className="rounded-full border border-line bg-white px-3 py-1 text-[10px] font-medium text-ink-soft">{result.dataProfile.ledgerRows.toLocaleString("en-IN")} ledgers</span>
              <span className="rounded-full border border-line bg-white px-3 py-1 text-[10px] font-medium text-ink-soft">{result.dataProfile.inventoryRows.toLocaleString("en-IN")} stock rows</span>
            </div>
          </div>
          <div className="flex items-center gap-2 font-semibold text-ink"><CircleAlert size={15} className="text-warn" />GI narrowed the question to a safer next step</div>
          <p className="mt-2">Ask about the connected sales, bills, vouchers, ledgers or stock evidence directly, or pick one of the guided follow-ups below.</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pl-12">
        {result.followUps.map((question) => (
          <button key={question} onClick={() => onFollowUp(question)} className="rounded-full border border-line bg-white px-3 py-1.5 text-[10px] font-medium text-ink-soft transition-colors hover:border-jade/40 hover:bg-jade-soft hover:text-jade-deep">{question}</button>
        ))}
      </div>
    </div>
  );
}

export default function AskPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [period, setPeriod] = useState<OperatingPeriod>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const requestGeneration = useRef(0);

  useEffect(() => {
    fetch("/api/ask", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not read the connected data profile.");
        return response.json();
      })
      .then(setMeta)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load the analyst."));
    const params = new URLSearchParams(window.location.search);
    const requestedPeriod = params.get("period");
    if (requestedPeriod === "current_fy" || requestedPeriod === "previous_fy" || requestedPeriod === "all") setPeriod(requestedPeriod);
    setInput(params.get("question") || params.get("signal") || "");
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (busy) endRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "end" });
    else if (messages.at(-1)?.role === "analyst") answerRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }, [messages, busy]);

  const previous = [...messages].reverse().find((message): message is Extract<Message, { role: "analyst" }> => message.role === "analyst")?.result;

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setMessages((current) => [...current, { role: "user", text }]);
    setInput("");
    setBusy(true);
    setError("");
    const generation = ++requestGeneration.current;
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, period, conversationId, context: previous ? { intents: previous.resolvedIntents as AnalystIntent[], period: previous.period } : undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "GI could not analyse that question.");
      if (generation !== requestGeneration.current) return;
      const result = payload as AnalystResponse;
      setConversationId(result.conversationId);
      setMessages((current) => [...current, { role: "analyst", result }]);
    } catch (reason) {
      if (generation !== requestGeneration.current) return;
      setMessages((current) => {
        const last = current.at(-1);
        return last?.role === "user" && last.text === text ? current.slice(0, -1) : current;
      });
      setInput(text);
      setError(reason instanceof Error ? reason.message : "GI could not analyse that question.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    requestGeneration.current += 1;
    setMessages([]);
    setConversationId(undefined);
    setError("");
    setInput("");
  }

  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="relative overflow-hidden rounded-2xl border border-sidebar-line bg-sidebar px-5 py-6 text-sidebar-fg shadow-lift sm:px-7 lg:px-8">
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-jade/20 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-full w-[44%] opacity-20 [background-image:linear-gradient(rgba(201,242,153,.25)_1px,transparent_1px),linear-gradient(90deg,rgba(201,242,153,.25)_1px,transparent_1px)] [background-size:24px_24px]" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.22em] text-jade-bright"><MessageSquareText size={13} />Ask GI about your books</div>
            <h1 className="mt-3 font-display text-[2rem] font-semibold leading-tight tracking-[-0.045em] sm:text-[2.5rem]">Verified answers, guided exploration.</h1>
            <p className="mt-3 max-w-2xl text-[13px] leading-6 text-sidebar-muted">Ask about sales, receivables, payables, inventory, payroll, cash, expenses or funding. If the question is broad, GI will narrow it to the closest supported path instead of inventing a claim.</p>
          </div>
          <div className="grid w-full min-w-0 grid-cols-2 gap-px overflow-hidden rounded-xl border border-sidebar-line bg-sidebar-line text-[10px] sm:min-w-[280px] lg:w-auto">
            <div className="bg-sidebar-2/90 p-3"><div className="uppercase tracking-[0.15em] text-sidebar-muted">Balance date</div><div className="mt-1 font-semibold text-sidebar-fg">{day(meta?.asOf)}</div></div>
            <div className="bg-sidebar-2/90 p-3"><div className="uppercase tracking-[0.15em] text-sidebar-muted">Sales flow to</div><div className="mt-1 font-semibold text-jade-bright">{day(meta?.latestSalesDate)}</div></div>
          </div>
        </div>
      </header>

      <div className="sticky top-[66px] z-20 -mx-1 mt-4 rounded-xl border border-line bg-paper/95 px-3 py-2.5 shadow-card backdrop-blur md:mx-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-jade-soft text-jade"><Database size={13} /></span>
            <span className="truncate"><strong className="font-semibold text-ink">{meta?.company || "Reading connected company…"}</strong> · {meta?.source || "Tally"}</span>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-line bg-white p-1" aria-label="Transaction period">
            <span className="hidden px-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted sm:inline">Transactions</span>
            <CalendarDays size={13} className="mx-1.5 text-muted" />
            {PERIODS.map((option) => (
              <button key={option.id} onClick={() => setPeriod(option.id)} disabled={busy} aria-pressed={period === option.id} className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition-colors disabled:opacity-50 ${period === option.id ? "bg-sidebar text-sidebar-fg" : "text-muted hover:bg-paper hover:text-ink"}`}>{option.label}</button>
            ))}
          </div>
        </div>
      </div>

      {messages.length === 0 ? (
        <section className="mx-auto max-w-4xl py-10 sm:py-14">
          <div className="text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-jade/20 bg-jade-soft text-jade-deep"><BarChart3 size={20} /></div>
            <h2 className="mt-4 font-display text-[20px] font-semibold tracking-[-0.03em] text-ink">Start with a books question.</h2>
            <p className="mx-auto mt-2 max-w-2xl text-[12px] leading-5 text-muted">GI gives verified answers for accounting-backed questions and guides broad asks into the nearest supported path. Active flow period: <strong className="font-semibold text-ink">{PERIODS.find((item) => item.id === period)?.label}</strong>.</p>
          </div>
          <div className="mt-7 grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-white p-5 shadow-card">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-jade"><ShieldCheck size={13} />Verified answer mode</div>
              <p className="mt-2 text-[12px] leading-5 text-ink-soft">Use this for questions about sales, receivables, payables, inventory, payroll, cash movement, expenses or funding. GI calculates first and shows the evidence behind the answer.</p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-5 shadow-card">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-jade"><Database size={13} />Explore the books</div>
              <p className="mt-2 text-[12px] leading-5 text-ink-soft">If you start broad with latest activity, vouchers or payroll evidence, GI will guide you to the closest grounded question instead of replying with fake confidence.</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {GUIDED_TOPICS.map((topic) => (
              <span key={topic} className="rounded-full border border-line bg-white px-3 py-1.5 text-[10px] font-semibold text-ink-soft shadow-card">{topic}</span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {EXPLORE_PROMPTS.map((prompt) => (
              <button key={prompt} onClick={() => ask(prompt)} className="rounded-full border border-jade/25 bg-jade-soft px-3 py-1.5 text-[10px] font-medium text-jade-deep transition hover:border-jade/40 hover:bg-white">
                {prompt}
              </button>
            ))}
          </div>
          <div className="mt-7 grid gap-2 sm:grid-cols-2">
            {(meta?.starters || DEFAULT_STARTERS).map((starter, index) => (
              <button key={starter} onClick={() => ask(starter)} className="group flex min-h-[74px] items-start justify-between gap-4 rounded-xl border border-line bg-white p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-jade/35 hover:shadow-lift">
                <span><span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-jade">{["Cash", "Compare", "Concentration", "Control"][index] || "Analyse"}</span><span className="mt-1.5 block text-[12px] leading-5 text-ink-soft">{starter}</span></span>
                <ArrowRight size={14} className="mt-1 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-jade" />
              </button>
            ))}
          </div>
          {meta && (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[9px] font-medium uppercase tracking-[0.13em] text-muted">
              <span>{meta.coverage.sales.toLocaleString("en-IN")} sales lines</span><span>{meta.coverage.bills.toLocaleString("en-IN")} bills</span><span>{meta.coverage.vouchers.toLocaleString("en-IN")} vouchers</span><span>{meta.coverage.ledgers.toLocaleString("en-IN")} ledgers</span>
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-8 py-7">
          {messages.map((message, index) => message.role === "user" ? (
            <div key={`user-${index}`} className="flex justify-end">
              <div className="max-w-2xl rounded-2xl rounded-br-md bg-sidebar px-4 py-3 text-[13px] leading-5 text-sidebar-fg shadow-card">{message.text}</div>
            </div>
          ) : <div key={message.result.id} ref={index === messages.length - 1 ? answerRef : undefined} className="scroll-mt-28" aria-live="polite"><AnalystAnswer result={message.result} onFollowUp={ask} /></div>)}
          {busy && (
            <div className="flex items-center gap-3 pl-1 text-[11px] text-muted" aria-live="polite">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-jade-soft text-jade"><Loader2 size={15} className="animate-spin" /></span>
              <span><strong className="font-semibold text-ink">Reading the evidence ledger…</strong><br />Resolving period, calculating and checking limits.</span>
            </div>
          )}
          <div ref={endRef} />
        </section>
      )}

      {error && <div className="mx-auto mb-3 flex max-w-4xl items-center justify-between gap-3 rounded-xl border border-bad/25 bg-bad/10 px-4 py-3 text-[11px] text-bad" role="alert"><span className="flex items-center gap-2"><CircleAlert size={14} />{error}</span><button onClick={() => setError("")} className="font-semibold">Dismiss</button></div>}

      <div className="sticky bottom-3 z-30 mx-auto max-w-4xl">
        <form onSubmit={(event) => { event.preventDefault(); ask(input); }} className="rounded-2xl border border-line-strong bg-white p-2 shadow-lift focus-within:border-jade/50 focus-within:ring-4 focus-within:ring-jade/10">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); ask(input); }
            }}
            rows={2}
            maxLength={2000}
            placeholder="Ask about sales, receivables, payables, inventory, payroll, cash, expenses or funding…"
            aria-label="Ask Growth Intelligence"
            className="block max-h-40 min-h-[56px] w-full resize-none bg-transparent px-3 py-2 text-[13px] leading-5 text-ink outline-none placeholder:text-muted"
          />
          <div className="flex items-center justify-between gap-3 border-t border-line px-2 pt-2">
            <div className="flex items-center gap-2 text-[9px] text-muted"><CheckCircle2 size={12} className="text-jade" />Verified answers first · guided follow-ups when the ask is too broad</div>
            <div className="flex items-center gap-2">
              {messages.length > 0 && <button type="button" onClick={reset} disabled={busy} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-muted hover:bg-paper hover:text-ink disabled:opacity-40" aria-label="New analysis"><RotateCcw size={13} /></button>}
              <button type="submit" disabled={busy || !input.trim()} className="btn-primary h-8 px-3 py-0 text-[11px] disabled:cursor-not-allowed disabled:opacity-40">Ask GI<ArrowUp size={13} /></button>
            </div>
          </div>
        </form>
        <div className="mt-1.5 flex items-center justify-center gap-3 text-[8px] font-medium uppercase tracking-[0.14em] text-muted"><span className="flex items-center gap-1"><ShieldCheck size={10} />Tenant isolated</span><span>·</span><span className="flex items-center gap-1"><Bot size={10} />No action is sent without approval</span></div>
      </div>
    </main>
  );
}
