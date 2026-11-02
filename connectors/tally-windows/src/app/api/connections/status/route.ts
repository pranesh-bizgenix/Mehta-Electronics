import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { dbReady, listSyncReceipts, loadCompanyDatasetMeta } from "@/lib/db/repo";
import { getActiveCompanyKey, getActiveDataset, getActiveWorkspaceScope, getCompanyWorkspaces, getOrgEntitlement } from "@/lib/store";
import { computeKPIs } from "@/lib/engine/kpis";
import { generateInsights } from "@/lib/engine/insights";
import { assessTallyDataQuality } from "@/lib/connectors/tally/parse";
import { buildCoherenceMatrix } from "@/lib/coherence";
import { listFinancialSnapshots } from "@/lib/performance/snapshots";
import { COMPLETED_SESSION_RETENTION_DAYS } from "@/lib/ingest/chunk-budget";
import { getLatestConnectorForOrg, listConnectorSyncJobs } from "@/lib/connectors/tally/connector-repo";
import { filterDatasetForOrgPlan } from "@/lib/connectors/tally/plan-window";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [rawData, activeCompanyKey, activeScope, workspaces, recentReceipts, entitlement] = await Promise.all([
    getActiveDataset(),
    getActiveCompanyKey(),
    getActiveWorkspaceScope(),
    getCompanyWorkspaces(),
    dbReady() ? listSyncReceipts(user.orgId || "default", 12).catch(() => []) : Promise.resolve([]),
    getOrgEntitlement(),
  ]);
  const data = await filterDatasetForOrgPlan(rawData, user.orgId || "default");
  const counts = {
    salesRows: data.sales.length,
    voucherRows: data.vouchers?.length ?? 0,
    billRows: data.bills?.length ?? 0,
    ledgerRows: data.ledgers?.length ?? 0,
    inventoryRows: data.inventory.length,
  };
  const connected = Object.values(counts).some((count) => count > 0);
  const meta = dbReady() && activeCompanyKey
    ? await loadCompanyDatasetMeta(user.orgId || "default", activeCompanyKey).catch(() => null)
    : null;
  const insights = connected ? generateInsights(data) : [];
  const kpis = computeKPIs(data);
  const quality = data.source === "tally" && connected ? assessTallyDataQuality(data) : null;
  const financialSnapshots = connected
    ? await listFinancialSnapshots(activeScope, data.company).catch(() => [])
    : [];
  const [connector, connectorSyncJobs] = await Promise.all([
    getLatestConnectorForOrg(user.orgId || "default").catch(() => null),
    listConnectorSyncJobs(user.orgId || "default", 8).catch(() => []),
  ]);
  const syncInProgress = Boolean(
    connector?.historySyncInProgress
    || connectorSyncJobs.some((job) => job.status === "running"),
  );
  const onlineGraceMs = syncInProgress ? 30 * 60_000 : 5 * 60_000;
  const connectorOnline = Boolean(
    connector?.lastSeenAt
    && Date.now() - new Date(connector.lastSeenAt).getTime() <= onlineGraceMs,
  );

  return NextResponse.json(
    {
      ok: true,
      connected,
      company: data.company,
      exactCompany: data.companyIdentity?.exactName || data.company,
      companyGuid: data.companyIdentity?.guid ?? null,
      activeCompanyKey,
      workspaces,
      entitlement: { ...entitlement, used: workspaces.length, remaining: Math.max(0, entitlement.companyLimit - workspaces.length) },
      recentReceipts,
      source: data.source ?? null,
      asOf: data.asOf,
      lastSyncedAt: meta?.updatedAt ?? null,
      storage: dbReady() ? (meta ? "postgres" : "ready") : "memory",
      counts,
      analysis: {
        insightCount: insights.length,
        revenue: kpis.totalRevenue,
        receivables: kpis.receivables,
        payables: kpis.payables,
      },
      history: {
        financialSnapshots: financialSnapshots.length,
        recentReceipts: recentReceipts.length,
        rawTransportRetentionDays: COMPLETED_SESSION_RETENTION_DAYS,
      },
      connector: connector ? {
        ...connector,
        online: connectorOnline,
      } : null,
      connectorSyncJobs,
      quality,
      datasetVersion: data.datasetVersion ?? null,
      coherence: buildCoherenceMatrix(data),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
