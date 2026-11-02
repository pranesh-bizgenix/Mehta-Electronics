"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Loader2,
  PlugZap,
  ShieldCheck,
} from "lucide-react";

type ConnectorStatus = {
  id: string;
  machineName: string | null;
  agentVersion: string | null;
  status: "active" | "revoked" | "error";
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  lastTallyAvailable: boolean | null;
  selectedCompany: string | null;
  revokedAt: string | null;
};

type ConnectorSyncJob = {
  id: string;
  companyName: string | null;
  status: "running" | "stored" | "quarantined" | "failed";
  recordCount: number;
  syncFrom: string | null;
  syncTo: string | null;
  startedAt: string;
  completedAt: string | null;
};

function formatDateTime(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : "Not yet";
}

function formatLastSync(value: string | null | undefined, syncing: boolean) {
  if (value) {
    return new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  }
  return syncing ? "Syncing..." : "Not yet";
}

export function TallyPairingCard(props: {
  company: string;
  connector: ConnectorStatus | null;
  syncJobs: ConnectorSyncJob[];
  busy: "" | "pairing" | "revoke";
  pairing: { pairingCode: string; expiresAt: string } | null;
  copied: boolean;
  actionMessage: { ok: boolean; text: string } | null;
  connectorState: string;
  syncing: boolean;
  onGeneratePairingCode: () => void | Promise<void>;
  onRevokeConnector: () => void | Promise<void>;
  onCopyPairingCode: () => void;
}) {
  const {
    company,
    connector,
    syncJobs,
    busy,
    pairing,
    copied,
    actionMessage,
    connectorState,
    syncing,
    onGeneratePairingCode,
    onRevokeConnector,
    onCopyPairingCode,
  } = props;

  return (
    <section className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <span className="pill border-jade/25 bg-jade-soft text-jade-deep">Recommended</span>
        <span className="text-[13px] font-semibold text-ink">One-time pairing connector</span>
        <span className="text-[10px] text-muted">Website on VPS, service on the customer&apos;s Windows PC</span>
      </div>
      <div className="panel flex-1 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-jade-soft text-jade-deep">
            <Cpu size={18} />
          </span>
          <div className="flex-1">
            <p className="text-[13px] leading-relaxed text-ink-soft">
              Use this when Tally is running on the customer&apos;s Windows PC. Generate a short pairing code here, install the connector there, enter the code once, and the Windows service will keep sending read-only Tally snapshots to GI every 60 minutes.
            </p>
            <ol className="mt-3 space-y-1.5 text-[13px] text-ink">
              <li><span className="font-semibold text-jade-deep">1.</span> Click <span className="font-medium">Generate pairing code</span> while signed into this workspace.</li>
              <li><span className="font-semibold text-jade-deep">2.</span> Install the Bizgenix Tally Connector on the Tally PC and enter the code once.</li>
              <li><span className="font-semibold text-jade-deep">3.</span> The connector stores its device credentials locally, starts with Windows, sends heartbeats, and syncs automatically every hour.</li>
            </ol>
            <div className="mt-4 rounded-xl border border-line bg-surface2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Pairing and machine status</div>
                  <div className="mt-0.5 text-[11px] text-ink-soft">The browser no longer reveals an org ID or reusable workspace token.</div>
                  <div className="mt-1 text-[10px] font-medium text-jade-deep">Connector state: {connectorState}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={onGeneratePairingCode} disabled={!!busy} className="btn-primary py-1.5 text-[12px]">
                    {busy === "pairing" ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />} {pairing ? "Generate new code" : "Generate pairing code"}
                  </button>
                  {connector && connector.status !== "revoked" && (
                    <button onClick={onRevokeConnector} disabled={!!busy} className="btn-ghost py-1.5 text-[12px]">
                      {busy === "revoke" ? <Loader2 size={13} className="animate-spin" /> : <AlertTriangle size={13} />} Revoke connector
                    </button>
                  )}
                </div>
              </div>
              {pairing && (
                <div className="mt-3 rounded-xl border border-jade/25 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-jade">One-time pairing code</div>
                      <div className="mt-2 font-mono text-[28px] font-semibold tracking-[0.18em] text-ink">{pairing.pairingCode}</div>
                      <div className="mt-1 text-[11px] text-ink-soft">Expires: {formatDateTime(pairing.expiresAt)}</div>
                    </div>
                    <button onClick={onCopyPairingCode} className="btn-ghost py-1.5 text-[12px]">
                      {copied ? <Check size={13} className="text-jade" /> : <Copy size={13} />} {copied ? "Copied code" : "Copy code"}
                    </button>
                  </div>
                  <div className="mt-3 rounded-lg border border-line bg-surface2/60 px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
                    Enter this code once inside the connector setup on the Tally PC. After successful pairing, the device keeps a revocable refresh token locally and no daily website login is required.
                  </div>
                </div>
              )}
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-lg bg-white px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted">Machine</div><div className="mt-0.5 truncate text-[11px] font-semibold text-ink">{connector?.machineName || "Awaiting first pairing"}</div></div>
                <div className="rounded-lg bg-white px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted">Last seen</div><div className="mt-0.5 text-[11px] font-semibold text-ink">{formatDateTime(connector?.lastSeenAt)}</div></div>
                <div className="rounded-lg bg-white px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted">Last sync</div><div className="mt-0.5 text-[11px] font-semibold text-ink">{formatLastSync(connector?.lastSyncAt, syncing)}</div></div>
                <div className="rounded-lg bg-white px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted">Tally status</div><div className="mt-0.5 text-[11px] font-semibold text-ink">{connector?.lastTallyAvailable == null ? "Unknown" : connector.lastTallyAvailable ? "Available" : "Offline"}</div></div>
                <div className="rounded-lg bg-white px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted">Connector version</div><div className="mt-0.5 text-[11px] font-semibold text-ink">{connector?.agentVersion || "Not reported yet"}</div></div>
                <div className="rounded-lg bg-white px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted">Selected company</div><div className="mt-0.5 truncate text-[11px] font-semibold text-ink">{connector?.selectedCompany || company || "Connector will report this after first heartbeat"}</div></div>
              </div>
              {syncJobs.length > 0 && (
                <div className="mt-3 rounded-xl border border-line bg-white p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-jade">Recent connector sync jobs</div>
                  <div className="mt-3 space-y-2">
                    {syncJobs.slice(0, 4).map((job) => (
                      <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface2/45 px-3 py-2">
                        <div>
                          <div className="text-[11px] font-semibold text-ink">{job.companyName || "Tally snapshot"}</div>
                          <div className="mt-0.5 text-[10px] text-muted">{formatDateTime(job.completedAt || job.startedAt)}{job.syncFrom && job.syncTo ? ` · ${job.syncFrom} → ${job.syncTo}` : ""}</div>
                        </div>
                        <div className="text-right">
                          <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${job.status === "stored" ? "text-jade" : job.status === "running" ? "text-ink" : "text-bad"}`}>{job.status}</div>
                          <div className="mt-0.5 text-[10px] text-muted">{job.recordCount.toLocaleString("en-IN")} records</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {actionMessage && (
                <div className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px] leading-relaxed ${actionMessage.ok ? "border-jade/25 bg-jade-soft/60 text-jade-deep" : "border-bad/25 bg-bad/5 text-bad"}`}>
                  {actionMessage.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
                  {actionMessage.text}
                </div>
              )}
              {connector?.revokedAt && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-bad/25 bg-bad/5 px-3 py-2 text-[12px] leading-relaxed text-bad">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> This connector was revoked on {formatDateTime(connector.revokedAt)}. Generate a new pairing code to connect this PC again.
                </div>
              )}
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-jade/20 bg-jade-soft/60 px-3 py-2 text-[12px] leading-relaxed text-jade-deep">
              <ShieldCheck size={15} className="mt-0.5 shrink-0" /> Port 9000 stays inside the Tally computer. The connector authenticates with a device-specific token, sends heartbeat and sync requests outward to GI, and GI never writes back into Tally.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
