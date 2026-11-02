"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  UploadCloud,
  Loader2,
  CheckCircle2,
  FileSpreadsheet,
  Database,
  Clock,
  Server,
  PlugZap,
  FolderUp,
  Check,
  Cloud,
  RefreshCw,
  ShieldCheck,
  BarChart3,
  ArrowRight,
  AlertTriangle,
  Building2,
} from "lucide-react";
import type { CompanyWorkspaceSummary, SyncReceiptSummary } from "@/lib/company-workspace";
import type { CoherenceModule } from "@/lib/coherence";
import type { OrgEntitlement } from "@/lib/entitlements";
import { CustomIntegrationCard } from "./CustomIntegrationCard";
import { TallyPairingPanel } from "./TallyPairingPanel";

type ConnectionStatus = {
  connected: boolean;
  company: string;
  exactCompany: string;
  companyGuid: string | null;
  activeCompanyKey: string | null;
  workspaces: CompanyWorkspaceSummary[];
  recentReceipts: SyncReceiptSummary[];
  entitlement: OrgEntitlement & { used: number; remaining: number };
  datasetVersion: string | null;
  coherence: CoherenceModule[];
  source: string | null;
  asOf: string;
  lastSyncedAt: string | null;
  storage: "postgres" | "ready" | "memory";
  counts: { salesRows: number; voucherRows: number; billRows: number; ledgerRows: number; inventoryRows: number };
  analysis: { insightCount: number; revenue: number; receivables: number; payables: number };
  history: {
    financialSnapshots: number;
    recentReceipts: number;
    rawTransportRetentionDays: number;
  };
  connector: null | {
    id: string;
    orgId: string;
    installationId: string;
    machineName: string | null;
    agentVersion: string | null;
    status: "active" | "revoked" | "error";
    pairedAt: string;
    lastSeenAt: string | null;
    lastHeartbeatAt: string | null;
    lastSyncAt: string | null;
    historySyncInProgress: boolean;
    nextHistoryFrom: string | null;
    lastTallyAvailable: boolean | null;
    selectedCompany: string | null;
    syncIntervalSeconds: number;
    createdAt: string;
    updatedAt: string;
    revokedAt: string | null;
    online: boolean;
  };
  connectorSyncJobs: Array<{
    id: string;
    orgId: string;
    connectorId: string | null;
    provider: "tally";
    syncId: string | null;
    companyName: string | null;
    companyGuid: string | null;
    status: "running" | "stored" | "quarantined" | "failed";
    recordCount: number;
    message: string | null;
    syncFrom: string | null;
    syncTo: string | null;
    startedAt: string;
    completedAt: string | null;
  }>;
  quality: null | {
    ok: boolean;
    score: number;
    businessProfile: string;
    domainGates: Record<string, "verified" | "review" | "unavailable" | "not_applicable">;
    errors: string[];
    warnings: string[];
    checks: { salesVoucherCount: number; salesInvoiceCount: number; salesReconciliationPct: number; receivableBills: number; payableBills: number; ledgerRows: number; stockCostCoveragePct: number; latestFlowDate: string | null; flowLagDays: number | null; profitAndLossDifferencePct: number | null; tradeReceivablesDifferencePct: number | null; tradePayablesDifferencePct: number | null };
  };
};

function indiaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function currentFinancialYearStart() {
  const [year, month] = indiaToday().split("-").map(Number);
  return `${month >= 4 ? year : year - 1}-04-01`;
}

export default function ConnectionsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [agentCompany, setAgentCompany] = useState("");
  const [statusError, setStatusError] = useState("");

  async function refreshStatus() {
    setChecking(true);
    try {
      const res = await fetch("/api/connections/status", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body?.error === "string" ? body.error : "Could not refresh connection status.");
      }
      setStatus(await res.json());
      setStatusError("");
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : "Could not refresh connection status.");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
    const timer = setInterval(() => {
      void refreshStatus();
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  return (
    <main className="mx-auto max-w-[1320px] px-5 py-7 md:px-7 lg:py-9">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-jade"><span className="h-1.5 w-1.5 rounded-full bg-jade shadow-[0_0_8px_#458652]" /> Connection architecture</div>
          <h1 className="max-w-3xl font-display text-[2.25rem] font-semibold leading-[1.03] tracking-[-0.05em] text-ink md:text-[3rem]">One accounting truth. Every decision downstream.</h1>
          <p className="mt-3 max-w-2xl text-[13px] leading-relaxed text-ink-soft">
            Data Spine shows exactly what arrived from Tally, what is missing, where it is stored, and which decisions are safe to make from it.
          </p>
        </div>
        <button onClick={refreshStatus} disabled={checking} className="btn-ghost mt-1 text-[12px]">
          <RefreshCw size={14} className={checking ? "animate-spin" : ""} /> Check latest stored data
        </button>
      </div>
      {statusError ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-bad/20 bg-bad/5 px-3 py-2 text-[12px] text-bad">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {statusError}
        </div>
      ) : null}

      <ConnectionPipeline status={status} />
      <WeeklyRefreshLifecycle status={status} />
      <AccountAndCoherence status={status} />
      <ClientPortfolio status={status} />
      <RecentSyncReceipts receipts={status?.recentReceipts ?? []} />

      <section id="sync-tally" className="mt-8 scroll-mt-36">
        <div className="mb-4 flex items-center gap-3"><div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-jade">Connection channels</div><h2 className="mt-1 text-[19px] font-semibold tracking-[-0.025em] text-ink">Choose how Tally reaches GI</h2></div><div className="h-px flex-1 bg-line" /></div>
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <TallyPairingPanel company={agentCompany} status={status} onChanged={refreshStatus} />
          <TallyCard onCompanySelected={setAgentCompany} onSynced={async () => { await refreshStatus(); router.refresh(); }} />
        </div>
      </section>

      <ExcelCard onDone={async () => { await refreshStatus(); router.refresh(); }} />

      {/* Credential-gated connectors — accurately labelled, never simulated. */}
      <section className="mt-10">
        <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <Cloud size={16} className="text-jade" /> Provider connection registry
        </div>
        <p className="mb-3 text-[13px] text-ink-soft">
          Tally and spreadsheet imports are available today. Every provider below requires its own authorization, field mapping and reconciliation test before GI can label it connected.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { name: "Zoho Books", flag: "🇮🇳", desc: "OAuth and reviewed mapping required for invoices, contacts, AR and financial reports.", soon: true },
            { name: "QuickBooks", flag: "🌍", desc: "OAuth and report-definition reconciliation required before activation.", soon: true },
            { name: "Xero", flag: "🌍", desc: "OAuth, tenant selection and aged-receivable reconciliation required.", soon: true },
          ].map((c) => (
            <div key={c.name} className="panel flex flex-col p-5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">{c.flag} {c.name}</span>
                <span className="pill border-line bg-surface2 text-muted"><Clock size={11} /> Authorization required</span>
              </div>
              <p className="mt-2 flex-1 text-[13px] leading-relaxed text-ink-soft">{c.desc}</p>
              <button disabled className="mt-4 cursor-not-allowed rounded-xl border border-line bg-surface2 px-3 py-2 text-[13px] font-semibold text-muted">
                Connection-ready · not active
              </button>
            </div>
          ))}
          <CustomIntegrationCard />
        </div>
      </section>
    </main>
  );
}

function AccountAndCoherence({ status }: { status: ConnectionStatus | null }) {
  if (!status) return null;
  const ready = status.coherence.filter((module) => module.readiness === "ready").length;
  const review = status.coherence.filter((module) => module.readiness === "review" || module.readiness === "unavailable").length;
  return (
    <section className="mt-5 grid gap-4 lg:grid-cols-[0.62fr_1.38fr]">
      <div className="rounded-2xl border border-line bg-sidebar p-5 text-sidebar-fg shadow-lift md:p-6">
        <div className="text-[9px] font-semibold uppercase tracking-[0.19em] text-jade-bright">Account access</div>
        <h2 className="mt-2 text-[20px] font-semibold tracking-[-0.03em]">{status.entitlement.label}</h2>
        <p className="mt-2 text-[11px] leading-relaxed text-sidebar-muted">
          {status.entitlement.variant === "channel_partner"
            ? "A CA/channel portfolio: every client is isolated and selected explicitly."
            : status.entitlement.variant === "multi_company"
              ? "One business group with separately governed Tally company workspaces."
              : "One direct business, one included Tally company. Extra books require an approved add-on."}
        </p>
        <div className="mt-5 flex items-end justify-between border-t border-sidebar-line pt-4">
          <div><div className="font-mono text-[26px] font-semibold">{status.entitlement.used}<span className="text-[13px] text-sidebar-muted"> / {status.entitlement.companyLimit}</span></div><div className="text-[9px] uppercase tracking-[.14em] text-sidebar-muted">Company workspaces used</div></div>
          <span className="pill border-jade-bright/25 bg-jade-bright/10 text-jade-bright">Server enforced</span>
        </div>
      </div>
      <div className="rounded-2xl border border-line bg-white p-5 shadow-lift md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><div className="text-[9px] font-semibold uppercase tracking-[0.19em] text-jade">One-sync coherence</div><h2 className="mt-1 text-[18px] font-semibold tracking-[-0.025em] text-ink">13 modules bound to one accounting version</h2><p className="mt-1 text-[10px] text-ink-soft">Company: {status.exactCompany} · Data up to {status.asOf}</p></div>
          <div className="text-right"><div className="font-mono text-[10px] font-semibold text-ink">{status.datasetVersion || "Awaiting first sync"}</div><div className="mt-1 text-[9px] text-muted">{ready} ready · {review} gated</div></div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {status.coherence.map((module) => (
            <Link key={module.id} href={module.path} title={module.reason} className="group flex items-center justify-between gap-3 rounded-lg border border-line bg-surface2/45 px-3 py-2.5 transition hover:border-jade/30 hover:bg-jade-soft/35">
              <span className="truncate text-[10px] font-semibold text-ink">{module.label}</span>
              <span className={`h-2 w-2 shrink-0 rounded-full ${module.readiness === "ready" ? "bg-good shadow-[0_0_7px_rgba(14,159,143,.45)]" : module.readiness === "not_applicable" ? "bg-muted" : "bg-warn"}`} />
            </Link>
          ))}
        </div>
        <p className="mt-3 text-[9px] leading-relaxed text-muted">A sync refreshes all calculated modules together. Company-scoped plans, approvals and action history are retained, then recalculated against the new facts; they are not mixed with another client or silently erased.</p>
      </div>
    </section>
  );
}

function RecentSyncReceipts({ receipts }: { receipts: SyncReceiptSummary[] }) {
  if (!receipts.length) return null;
  return (
    <section className="mt-5 rounded-2xl border border-line bg-white p-5 shadow-lift md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-jade">Import audit trail</div><h2 className="mt-1 text-[18px] font-semibold tracking-[-0.025em] text-ink">Every client sync leaves a receipt</h2></div>
        <div className="text-[9px] text-muted">Rejected books are recorded, never published.</div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-[10px]">
          <thead className="border-b border-line text-[8px] uppercase tracking-[0.14em] text-muted"><tr><th className="pb-2 pr-4">Client</th><th className="pb-2 pr-4">Result</th><th className="pb-2 pr-4">Detected shape</th><th className="pb-2 pr-4">Coverage</th><th className="pb-2 pr-4">Books / attempt</th><th className="pb-2">Why</th></tr></thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt.id} className="border-b border-line/70 align-top last:border-0">
                <td className="py-3 pr-4"><div className="max-w-[220px] truncate font-semibold text-ink" title={receipt.exactName}>{receipt.exactName}</div>{receipt.sourceGuid ? <div className="mt-0.5 font-mono text-[8px] text-muted">…{receipt.sourceGuid.slice(-8)}</div> : null}</td>
                <td className="py-3 pr-4"><span className={`pill ${receipt.status === "stored" ? "border-good/25 bg-good/10 text-good" : "border-bad/25 bg-bad/5 text-bad"}`}>{receipt.status === "stored" ? "Stored" : "Quarantined"}</span></td>
                <td className="py-3 pr-4 capitalize text-ink-soft">{(receipt.quality.businessProfile || "unclassified").replaceAll("_", " ")}</td>
                <td className="py-3 pr-4 font-mono text-[9px] text-ink-soft">{receipt.counts.voucherRows.toLocaleString("en-IN")} vouchers · {receipt.counts.ledgerRows.toLocaleString("en-IN")} ledgers · {receipt.counts.inventoryRows.toLocaleString("en-IN")} stock</td>
                <td className="py-3 pr-4 text-ink-soft"><div>{receipt.syncFrom || "Start"} → {receipt.syncTo || receipt.dataAsOf}</div><div className="mt-0.5 text-[8px] text-muted">{new Date(receipt.createdAt).toLocaleString("en-IN")}</div></td>
                <td className="max-w-[300px] py-3 text-ink-soft">{receipt.status === "stored" ? "Controls passed; snapshot published." : receipt.quality.errors.join(" ") || receipt.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ClientPortfolio({ status }: { status: ConnectionStatus | null }) {
  const workspaces = status?.workspaces ?? [];
  if (!workspaces.length) return null;
  return (
    <section className="mt-5 rounded-2xl border border-line bg-white p-5 shadow-lift md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-jade"><Building2 size={13} /> Client portfolio</div>
          <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.025em] text-ink">{workspaces.length} isolated compan{workspaces.length === 1 ? "y" : "ies"} inside this organisation</h2>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-ink-soft">Each company keeps its own accounting snapshot. The active client in the header controls every dashboard, plan and action ledger.</p>
        </div>
        <span className="pill border-jade/25 bg-jade-soft text-jade-deep">No cross-client overwrite</span>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {workspaces.map((workspace) => {
          const active = workspace.companyKey === status?.activeCompanyKey;
          return (
            <div key={workspace.companyKey} className={`rounded-xl border p-3.5 ${active ? "border-jade/35 bg-jade-soft/45" : "border-line bg-surface2/40"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[9px] font-semibold uppercase tracking-[0.14em] ${active ? "text-jade" : "text-muted"}`}>{active ? "Active client" : "Stored client"}</span>
                <span className="text-[9px] uppercase text-muted">{workspace.source}</span>
              </div>
              <div className="mt-2 truncate text-[12px] font-semibold text-ink" title={workspace.exactName}>{workspace.exactName}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] text-muted">
                <span>Books: {workspace.asOf}</span>
                {workspace.sourceGuid ? <span title={workspace.sourceGuid}>GUID: …{workspace.sourceGuid.slice(-8)}</span> : <span>Name-keyed</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function inrCompact(value: number) {
  // Intl compact notation varies between Node and browsers (₹0.0 vs ₹0),
  // which causes hydration errors. Keep this formatter deterministic.
  const amount = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(amount);
  if (abs >= 1e7) return `₹${(amount / 1e7).toFixed(1)} Cr`;
  if (abs >= 1e5) return `₹${(amount / 1e5).toFixed(1)} L`;
  if (abs >= 1e3) return `₹${(amount / 1e3).toFixed(1)}K`;
  return `₹${Math.round(amount)}`;
}

function ConnectionPipeline({ status }: { status: ConnectionStatus | null }) {
  const ready = status?.storage === "postgres" || status?.storage === "ready";
  const synced = Boolean(status?.connected);
  const trusted = status?.quality == null || status.quality.ok;
  const analysed = Boolean(status?.connected && trusted && status.analysis.insightCount > 0);
  const stages = [
    { label: "Source", done: synced, value: synced ? "Tally live" : "Waiting", detail: synced ? status?.company : "Test connection" },
    { label: "Capture", done: synced, value: synced ? `${status?.counts.voucherRows.toLocaleString("en-IN")} vouchers` : "No snapshot", detail: synced ? `Books as of ${status?.asOf}` : "Run first sync" },
    { label: "Store", done: ready, value: ready ? "PostgreSQL" : "Memory", detail: ready ? "Company isolated" : "Persistence required" },
    { label: "Decide", done: analysed, value: analysed ? `${status?.analysis.insightCount} signals` : "Not scored", detail: analysed ? "Brief refreshed" : "Needs evidence" },
  ];

  return (
    <section className="mt-7 overflow-hidden rounded-2xl border border-line bg-white shadow-lift">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 md:px-6">
        <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-sidebar font-mono text-[10px] font-bold text-jade-bright">DS</span><div><div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-jade">Live Data Spine</div><h2 className="mt-0.5 text-[16px] font-semibold tracking-[-0.02em] text-ink">{synced ? status?.company : "No accounting source connected"}</h2></div></div>
        <div className="flex items-center gap-3"><div className="hidden text-right sm:block"><div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted">Last evidence</div><div className="mt-0.5 text-[10px] font-medium text-ink-soft">{status?.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString("en-IN") : "No snapshot stored"}</div></div><span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] ${synced && trusted ? "border-good/25 bg-good/10 text-good" : synced ? "border-bad/25 bg-bad/10 text-bad" : "border-line bg-surface2 text-muted"}`}><span className={`h-1.5 w-1.5 rounded-full ${synced && trusted ? "bg-good shadow-[0_0_7px_#0E9F8F]" : synced ? "bg-bad" : "bg-muted"}`} />{synced && trusted ? "Data verified" : synced ? "Needs reconciliation" : "Awaiting source"}</span></div>
      </div>

      <div className="grid lg:grid-cols-[1.45fr_0.55fr]">
        <div className="p-5 md:p-6">
          <div className="relative grid gap-3 sm:grid-cols-4">
            <div className="absolute left-[12%] right-[12%] top-5 hidden h-px bg-line sm:block"><div className="h-full bg-gradient-to-r from-jade to-jade-bright transition-all duration-700" style={{width: analysed ? "100%" : synced ? "55%" : ready ? "12%" : "0%"}} /></div>
            {stages.map((stage, index) => (
              <div key={stage.label} className={`relative rounded-xl border p-3.5 transition ${stage.done ? "border-jade/25 bg-jade-soft/45" : "border-line bg-surface2/35"}`}>
                <span className={`relative grid h-8 w-8 place-items-center rounded-lg border font-mono text-[10px] font-bold ${stage.done ? "border-jade/30 bg-jade text-white shadow-[0_0_0_4px_rgba(46,125,70,.10)]" : "border-line bg-white text-muted"}`}>{stage.done ? <Check size={14} /> : `0${index + 1}`}</span>
                <div className="mt-5 text-[9px] font-semibold uppercase tracking-[0.16em] text-muted">{stage.label}</div>
                <div className="mt-1 text-[12px] font-semibold text-ink">{stage.value}</div>
                <div className="mt-1 text-[9px] text-muted">{stage.detail}</div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface2/50 px-4 py-3 text-[10px] text-ink-soft"><span className="flex items-center gap-2"><ShieldCheck size={13} className="text-good" /> Full snapshot is stored atomically; new entries replace the prior snapshot without duplicates.</span><div className="flex gap-3"><Link href="/evidence" className="inline-flex items-center gap-1.5 font-semibold text-jade">Open Evidence Room <ArrowRight size={12} /></Link><Link href="/dashboard" className="inline-flex items-center gap-1.5 font-semibold text-jade">Executive brief <ArrowRight size={12} /></Link></div></div>
          {synced && !trusted && <div className="mt-3 flex items-start gap-2 rounded-lg border border-bad/25 bg-bad/5 px-4 py-3 text-[10px] leading-relaxed text-bad"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span><strong>Advice paused:</strong> {status?.quality?.errors.join(" ")} Run the corrected sync before using the dashboard for decisions.</span></div>}
        </div>

        <div className="border-t border-sidebar-line bg-sidebar p-5 text-sidebar-fg lg:border-l lg:border-t-0 md:p-6">
          <div className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-jade-bright"><BarChart3 size={13} /> Accounting coverage</div>
          <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-5">
            <ReceiptMetric label="Sales lines" value={status?.counts.salesRows ?? 0} />
            <ReceiptMetric label="Vouchers" value={status?.counts.voucherRows ?? 0} />
            <ReceiptMetric label="Open bills" value={status?.counts.billRows ?? 0} />
            <ReceiptMetric label="Ledgers" value={status?.counts.ledgerRows ?? 0} />
            <ReceiptMetric label="Stock items" value={status?.counts.inventoryRows ?? 0} />
            <div><div className="text-[9px] uppercase tracking-[0.14em] text-sidebar-muted">Revenue seen</div><div className="num mt-1 text-[16px] font-semibold text-jade-bright">{inrCompact(status?.analysis.revenue ?? 0)}</div></div>
          </div>
          <div className="mt-5 border-t border-sidebar-line pt-4 text-[9px] leading-relaxed text-sidebar-muted">Coverage—not connection alone—determines which analyses GI can safely produce.</div>
        </div>
      </div>
    </section>
  );
}

function WeeklyRefreshLifecycle({ status }: { status: ConnectionStatus | null }) {
  if (!status) return null;
  const version = status.datasetVersion ? status.datasetVersion.slice(-10) : "pending";
  const storedAt = status.lastSyncedAt
    ? new Date(status.lastSyncedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : "Awaiting first verified sync";
  const steps = [
    {
      number: "01",
      title: "Books change in Tally",
      body: "Your accountant records the new invoice, receipt, payment, stock or journal entry in the selected Tally company.",
    },
    {
      number: "02",
      title: "Engine reads current FY → today",
      body: "The outbound Engine recalculates the dates on every hourly run, so tomorrow's and next week's entries are included automatically.",
    },
    {
      number: "03",
      title: "GI reconciles before publishing",
      body: "The complete company snapshot is checked against accounting controls. A failed book leaves a receipt but cannot replace trusted dashboards.",
    },
    {
      number: "04",
      title: "All 13 modules move together",
      body: "One new dataset version refreshes performance, cash, cost, growth, inventory and planning together; company-scoped actions and outcomes remain.",
    },
  ];
  const storage = [
    ["Current truth", "gi_company_dataset", "One atomic, company-isolated snapshot used by every GI module."],
    ["Sync audit", "gi_sync_receipt", "Every stored or quarantined attempt, with company identity, counts and reasons."],
    ["Trend history", "gi_financial_snapshots", `${status.history.financialSnapshots} dated checkpoint${status.history.financialSnapshots === 1 ? "" : "s"} for this company.`],
    ["Transport only", "gi_tally_ingest_*", `Resumable encrypted transport chunks; completed sessions are cleaned after ${status.history.rawTransportRetentionDays} days.`],
  ];

  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-line bg-white shadow-lift">
      <div className="grid lg:grid-cols-[1.35fr_0.65fr]">
        <div className="p-5 md:p-6">
          <div className="text-[9px] font-semibold uppercase tracking-[0.19em] text-jade">Weekly refresh lifecycle</div>
          <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.03em] text-ink">New Tally entries become one new company truth</h2>
          <p className="mt-2 max-w-3xl text-[11px] leading-relaxed text-ink-soft">
            “Check latest stored data” only reloads GI. A real Tally sync is performed by the read-only Engine every hour, or by the controlled Direct LAN pull below.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {steps.map((step) => (
              <div key={step.number} className="rounded-xl border border-line bg-surface2/40 p-4">
                <div className="font-mono text-[9px] font-semibold text-jade">{step.number}</div>
                <div className="mt-2 text-[12px] font-semibold text-ink">{step.title}</div>
                <p className="mt-1 text-[10px] leading-relaxed text-ink-soft">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
        <aside className="border-t border-sidebar-line bg-sidebar p-5 text-sidebar-fg lg:border-l lg:border-t-0 md:p-6">
          <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-jade-bright">Snapshot now in view</div>
          <div className="mt-2 text-[17px] font-semibold leading-snug">{status.exactCompany}</div>
          <div className="mt-5 space-y-3 border-t border-sidebar-line pt-4 text-[10px]">
            <div className="flex justify-between gap-3"><span className="text-sidebar-muted">Books through</span><strong>{status.asOf}</strong></div>
            <div className="flex justify-between gap-3"><span className="text-sidebar-muted">Stored</span><strong className="text-right">{storedAt}</strong></div>
            <div className="flex justify-between gap-3"><span className="text-sidebar-muted">Version</span><strong className="font-mono">{version}</strong></div>
            <div className="flex justify-between gap-3"><span className="text-sidebar-muted">Recent receipts</span><strong>{status.history.recentReceipts}</strong></div>
          </div>
          <div className="mt-5 rounded-lg border border-jade-bright/20 bg-jade-bright/10 p-3 text-[9px] leading-relaxed text-sidebar-muted">
            The product does not silently append duplicates. It publishes a content-addressed replacement only after the selected company passes its evidence gate.
          </div>
        </aside>
      </div>
      <div className="border-t border-line px-5 py-5 md:px-6">
        <div className="text-[9px] font-semibold uppercase tracking-[0.17em] text-muted">PostgreSQL storage evidence</div>
        <div className="mt-3 grid gap-2 lg:grid-cols-4">
          {storage.map(([label, table, description]) => (
            <div key={table} className="rounded-lg border border-line bg-surface2/35 p-3">
              <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-jade">{label}</div>
              <code className="mt-1.5 block text-[10px] font-semibold text-ink">{table}</code>
              <p className="mt-1 text-[9px] leading-relaxed text-muted">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReceiptMetric({ label, value }: { label: string; value: number }) {
  return <div><div className="text-[9px] uppercase tracking-[0.14em] text-sidebar-muted">{label}</div><div className="mt-1 font-mono text-[17px] font-semibold tabular-nums text-white">{value.toLocaleString("en-IN")}</div></div>;
}

function TallyCard({ onSynced, onCompanySelected }: { onSynced: () => void; onCompanySelected: (company: string) => void }) {
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("9000");
  const [serverCanReachLan, setServerCanReachLan] = useState(true);
  const [from, setFrom] = useState(currentFinancialYearStart());
  const [to, setTo] = useState(indiaToday());
  const [company, setCompany] = useState("");
  const [companies, setCompanies] = useState<Array<{ name: string; displayName: string; guid?: string }>>([]);
  const [busy, setBusy] = useState<"" | "test" | "sync">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [quality, setQuality] = useState<{
    ok: boolean;
    businessProfile?: string;
    domainGates?: Record<string, "verified" | "review" | "unavailable" | "not_applicable">;
    errors: string[];
    warnings: string[];
    checks: {
      salesReconciliationPct: number;
      latestFlowDate: string | null;
      flowLagDays: number | null;
      profitAndLossDifferencePct: number | null;
      tradeReceivablesDifferencePct: number | null;
      tradePayablesDifferencePct: number | null;
      inventoryMovementCoveragePct: number;
    };
  } | null>(null);
  const selectedCompany = companies.find((item) => item.name === company);

  // Remember the host/port so it's never re-typed (per browser).
  useEffect(() => {
    // Query values make a diagnostic run reproducible without changing the
    // saved full-sync range. They are intentionally limited to connection
    // coordinates and dates—never credentials.
    const appHost = window.location.hostname;
    setServerCanReachLan(
      appHost === "localhost" ||
      appHost === "127.0.0.1" ||
      appHost.startsWith("192.168.") ||
      appHost.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(appHost),
    );
    const params = new URLSearchParams(window.location.search);
    const h = params.get("tallyHost") || localStorage.getItem("gi_tally_host");
    const p = params.get("tallyPort") || localStorage.getItem("gi_tally_port");
    // v2 keys intentionally leave the old 2022 default behind once. Older
    // releases auto-saved that value even when the user never chose it.
    const f = params.get("from") || localStorage.getItem("gi_tally_from_v2");
    const t = params.get("to") || localStorage.getItem("gi_tally_to_v2");
    const c = localStorage.getItem("gi_tally_company");
    if (h) setHost(h);
    if (p) setPort(p);
    if (f) setFrom(f);
    if (t) setTo(t);
    if (c) setCompany(c);
  }, []);
  useEffect(() => {
    if (host) localStorage.setItem("gi_tally_host", host);
    if (port) localStorage.setItem("gi_tally_port", port);
    if (from) localStorage.setItem("gi_tally_from_v2", from);
    if (to) localStorage.setItem("gi_tally_to_v2", to);
    if (company) localStorage.setItem("gi_tally_company", company);
  }, [host, port, from, to, company]);
  useEffect(() => {
    onCompanySelected(company);
  }, [company, onCompanySelected]);

  async function call(action: "test" | "sync") {
    if (!serverCanReachLan) {
      setMsg({ ok: false, text: "Direct LAN pull works only when this GI app is running on the same computer or same private network as Tally. For a VPS/public URL, use the Outbound Engine above." });
      return;
    }
    setBusy(action);
    setMsg(null);
    if (action === "sync") setQuality(null);
    try {
      const res = await fetch("/api/connectors/tally", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, host, port, from, to, company: company || undefined }),
      });
      const j = await res.json();
      if (j.quality?.checks) setQuality(j.quality);
      if (Array.isArray(j.companies)) {
        setCompanies(j.companies);
        if (company && !j.companies.some((item: { name: string }) => item.name === company)) setCompany("");
        if (!company && j.companies.length === 1) setCompany(j.companies[0].name);
      }
      setMsg({ ok: !!j.ok, text: j.message || (j.ok ? "Done" : "Failed") });
      if (action === "sync" && j.ok) {
        setBusy("");
        setTimeout(onSynced, 900);
      } else {
        setBusy("");
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Failed" });
      setBusy("");
    }
  }

  return (
    <section className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <span className="pill border-line bg-surface2 text-muted">Local only</span>
        <span className="text-[13px] font-semibold text-ink">Direct LAN pull</span>
        <span className="text-[10px] text-muted">{serverCanReachLan ? "Fastest controlled test" : "Unavailable from public VPS"}</span>
      </div>
      <div className="panel flex-1 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-jade-soft text-jade-deep">
            <Server size={18} />
          </span>
          <div className="flex-1">
            <p className="text-[13px] leading-relaxed text-ink-soft">
              If GI and Tally are on the same computer, keep <span className="font-mono text-ink">127.0.0.1</span>. If Tally is on another computer on the same Wi-Fi, enter that Windows computer&apos;s IPv4 address. Test first, then run the full snapshot.
            </p>
            {!serverCanReachLan && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-warn/25 bg-warn/10 px-3 py-2 text-[12px] leading-relaxed text-warn">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> This site is running from a public host, so it cannot call a private Tally IP like 192.168.x.x. Run the Outbound Engine on the Tally PC; it pushes data securely to this VPS.
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Host</span>
                <input value={host} onChange={(e) => setHost(e.target.value)} className="gi-in w-44" placeholder="TALLY-PC or LAN IP" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Port</span>
                <input value={port} onChange={(e) => setPort(e.target.value)} className="gi-in w-24" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">From</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="gi-in w-40" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">To</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="gi-in w-40" />
              </label>
              {companies.length > 0 && (
                <label className="block min-w-[260px]">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">Tally company</span>
                  <select value={company} onChange={(e) => setCompany(e.target.value)} className="gi-in w-full">
                    <option value="">Select exact company</option>
                    {companies.map((item) => <option key={item.name} value={item.name}>{item.displayName}{item.guid ? ` · ${item.guid.slice(-8)}` : ""}</option>)}
                  </select>
                </label>
              )}
              <button onClick={() => call("test")} disabled={!!busy || !serverCanReachLan} className="btn-ghost py-2 text-[13px]">
                {busy === "test" ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} Test
              </button>
              <button onClick={() => call("sync")} disabled={!!busy || !serverCanReachLan || (companies.length > 1 && !company)} className="btn-primary py-2 text-[13px]">
                {busy === "sync" ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
                {busy === "sync" ? "Importing all books…" : "Run full sync"}
              </button>
            </div>
            {selectedCompany && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-jade/25 bg-jade-soft/55 px-3 py-2.5">
                <div><div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-jade">You are about to sync this exact client</div><div className="mt-0.5 text-[12px] font-semibold text-ink">{selectedCompany.name}</div></div>
                <div className="font-mono text-[9px] text-muted">{selectedCompany.guid ? `Tally GUID ${selectedCompany.guid}` : "No GUID returned · exact-name identity will be used"}</div>
              </div>
            )}
            {msg && (
              <div className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${msg.ok ? "border-jade/25 bg-jade-soft text-jade-deep" : "border-bad/25 bg-bad/5 text-bad"}`}>
                {msg.ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : null}
                <span>{msg.text}</span>
              </div>
            )}
            {quality && (
              <div className="mt-4 rounded-xl border border-line bg-surface2/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-jade">Tally reconciliation receipt</div>
                    <div className="mt-1 text-[12px] font-semibold text-ink">{quality.ok ? "Decision-grade snapshot" : "Snapshot quarantined — source controls need review"}</div>
                    {quality.businessProfile ? <div className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-muted">Detected shape: {quality.businessProfile.replaceAll("_", " ")}</div> : null}
                  </div>
                  <span className={`pill ${quality.ok ? "border-jade/25 bg-jade-soft text-jade" : "border-bad/25 bg-bad/5 text-bad"}`}>{quality.ok ? "Verified" : "Not published"}</span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ["Transaction flow", quality.checks.latestFlowDate ? `through ${quality.checks.latestFlowDate}` : "no valid dates", quality.checks.flowLagDays == null ? `${quality.checks.salesReconciliationPct}% invoice mapping` : `${quality.checks.flowLagDays} day lag`, quality.checks.flowLagDays != null && quality.checks.flowLagDays <= 45],
                    ["Revenue control", quality.checks.profitAndLossDifferencePct == null ? "not available" : `${quality.checks.profitAndLossDifferencePct}% difference`, "net sales vs P&L", quality.checks.profitAndLossDifferencePct != null && quality.checks.profitAndLossDifferencePct <= 2],
                    ["Receivable control", quality.checks.tradeReceivablesDifferencePct == null ? "not available" : `${quality.checks.tradeReceivablesDifferencePct}% difference`, "bills vs debtor ledgers", quality.checks.tradeReceivablesDifferencePct != null && quality.checks.tradeReceivablesDifferencePct <= 5],
                    ["Payable control", quality.checks.tradePayablesDifferencePct == null ? "not available" : `${quality.checks.tradePayablesDifferencePct}% difference`, "bills vs creditor ledgers", quality.checks.tradePayablesDifferencePct != null && quality.checks.tradePayablesDifferencePct <= 5],
                  ].map(([label, value, note, pass]) => (
                    <div key={String(label)} className="rounded-lg border border-line bg-white p-3">
                      <div className="flex items-center justify-between gap-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted"><span>{String(label)}</span><span className={pass ? "text-jade" : "text-bad"}>{pass ? "PASS" : "REVIEW"}</span></div>
                      <div className="num mt-2 text-[13px] font-semibold text-ink">{String(value)}</div>
                      <div className="mt-0.5 text-[9px] text-muted">{String(note)}</div>
                    </div>
                  ))}
                </div>
                {quality.domainGates && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(quality.domainGates).map(([domain, gate]) => (
                      <span key={domain} className={`rounded-md border px-2 py-1 text-[8px] font-semibold uppercase tracking-[0.12em] ${gate === "verified" ? "border-good/25 bg-good/10 text-good" : gate === "not_applicable" ? "border-line bg-white text-muted" : "border-warn/25 bg-warn/10 text-warn"}`}>
                        {domain} · {gate.replace("_", " ")}
                      </span>
                    ))}
                  </div>
                )}
                {quality.errors.length > 0 && <div className="mt-3 text-[10px] leading-relaxed text-bad">{quality.errors.join(" ")}</div>}
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`
        .gi-in{border:1px solid #DCD8CA;background:#fff;border-radius:0.5rem;padding:0.5rem 0.7rem;font-size:0.78rem;color:#141814;font-family:var(--font-geist-mono)}
        .gi-in:focus{outline:none;border-color:#458652;box-shadow:0 0 0 3px rgba(46,125,70,0.12)}
      `}</style>
    </section>
  );
}

const USABLE = /\.(xlsx|xls|csv|xml)$/i;
const TALLY_BINARY = /\.(1800|900|tsf|tcp)$/i;

function ExcelCard({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [done, setDone] = useState<{ company: string; rows: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function send(file: File) {
    setBusy(true);
    setError(null);
    setDone(null);
    setNote(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (j.needsEngine) { setNote(j.message); setBusy(false); return; }
      if (!res.ok || !j.ok) throw new Error(j.error || j.message || "Upload failed");
      setDone({ company: j.company, rows: j.salesRows });
      setBusy(false);
      setTimeout(onDone, 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setBusy(false);
    }
  }

  /** Folder upload: find a usable export inside; if only Tally binaries, guide them. */
  function handleFolder(files: FileList | null) {
    setError(null);
    setNote(null);
    setDone(null);
    const all = files ? Array.from(files) : [];
    const usable = all
      .filter((f) => USABLE.test(f.name))
      .sort((a, b) => {
        const rank = (n: string) => (/\.xml$/i.test(n) ? 0 : /\.(xlsx|xls)$/i.test(n) ? 1 : 2);
        return rank(a.name) - rank(b.name) || b.size - a.size;
      });
    const binaries = all.filter((f) => TALLY_BINARY.test(f.name));

    if (usable.length) {
      setNote(`Found ${usable.length} usable file${usable.length > 1 ? "s" : ""} in the folder — importing “${usable[0].name}”.`);
      send(usable[0]);
    } else if (binaries.length) {
      setNote(
        `That's a Tally company data folder — ${binaries.length} encrypted files (.1800/.TSF). ` +
        `Easiest: zip this folder and drop the .zip above — your GIS Tally Engine auto-loads it and pulls every voucher, no manual export. ` +
        `(Or in Tally: Display → Day Book → Alt+E → XML, and upload that.)`,
      );
    } else if (all.length) {
      setError("No Excel, CSV or Tally XML export found in that folder.");
    }
  }

  return (
    <section className="mt-7">
      <div className="mb-3 flex items-center gap-2">
        <span className="pill border-jade/25 bg-jade-soft text-jade-deep">Live now</span>
        <span className="text-sm font-semibold text-ink">Excel / CSV / Tally XML upload</span>
      </div>
      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.[0]) send(e.dataTransfer.files[0]); }}
        className={`panel flex cursor-pointer flex-col items-center justify-center px-6 py-10 text-center transition-colors ${drag ? "border-jade bg-jade-soft/50" : ""}`}
      >
        {done ? <CheckCircle2 className="text-jade" size={28} /> : busy ? <Loader2 className="animate-spin text-jade" size={28} /> : <UploadCloud className="text-jade" size={28} />}
        <div className="mt-3 text-sm font-semibold text-ink">
          {done ? `Imported ${done.rows} rows — opening insights…` : busy ? "Analysing…" : "Drag & drop, or click to choose a file"}
        </div>
        <div className="mt-1 text-xs text-muted">.xlsx, .xls, .csv, Tally .xml export, or a zipped Tally folder (.zip)</div>
        <input type="file" accept=".xlsx,.xls,.csv,.xml,.zip" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
      </label>

      {/* Folder upload */}
      <div className="mt-2 flex items-center justify-center">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium text-jade hover:bg-jade-soft">
          <FolderUp size={15} /> Or upload a whole folder
          <input
            type="file"
            className="hidden"
            disabled={busy}
            multiple
            // non-standard dir-picker attrs (Chromium/Safari)
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => handleFolder(e.target.files)}
          />
        </label>
      </div>

      {note && <div className="mt-3 rounded-lg border border-jade/25 bg-jade-soft px-3 py-2 text-sm text-jade-deep">{note}</div>}
      {error && <div className="mt-3 rounded-lg border border-bad/25 bg-bad/5 px-3 py-2 text-sm text-bad">{error}</div>}
      <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-line bg-surface2/50 px-3 py-2.5 text-xs text-ink-soft">
        <FileSpreadsheet size={15} className="mt-0.5 shrink-0 text-jade" />
        <span>
          <span className="font-semibold text-ink">From Tally:</span> open <span className="font-medium">Display → Day Book</span> (or Sales Register),
          press <span className="font-mono">Alt+E</span> → Export → choose <span className="font-medium">XML</span> (or Excel), then drop the file here.
          The raw Tally data folder (<span className="font-mono">.1800/.TSF</span> files) can&apos;t be read — it must be exported from inside Tally.
        </span>
      </div>
    </section>
  );
}
