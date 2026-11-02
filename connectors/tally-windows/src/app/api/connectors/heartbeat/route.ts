import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAgent } from "@/lib/ingest/agent-auth";
import { historyYearsForOrg } from "@/lib/connectors/tally/connector-plan";
import { recordConnectorHeartbeat } from "@/lib/connectors/tally/connector-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HeartbeatRequest = z.object({
  agentVersion: z.string().min(1).max(100),
  machineName: z.string().min(1).max(255),
  tallyAvailable: z.boolean(),
  selectedCompany: z.string().max(300).nullish(),
  lastSyncAt: z.string().datetime({ offset: true }).nullish(),
  historySyncInProgress: z.boolean().optional(),
  nextHistoryFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

export async function POST(request: Request) {
  const auth = await authenticateAgent(request);
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status });
  if (!auth.connectorId) {
    return NextResponse.json({ error: "Heartbeat requires a paired connector token." }, { status: 400 });
  }
  const parsed = HeartbeatRequest.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid heartbeat payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const connector = await recordConnectorHeartbeat({
    connectorId: auth.connectorId,
    orgId: auth.orgId,
    machineName: parsed.data.machineName.trim(),
    agentVersion: parsed.data.agentVersion.trim(),
    tallyAvailable: parsed.data.tallyAvailable,
    selectedCompany: parsed.data.selectedCompany?.trim() || undefined,
    lastSyncAt: parsed.data.lastSyncAt || null,
    historySyncInProgress: parsed.data.historySyncInProgress === true,
    nextHistoryFrom: parsed.data.nextHistoryFrom || null,
  });
  const historyFinancialYears = await historyYearsForOrg(connector.orgId);

  return NextResponse.json({
    ok: true,
    connectorId: connector.id,
    syncIntervalSeconds: connector.syncIntervalSeconds,
    historyFinancialYears,
    lastSeenAt: connector.lastSeenAt,
    lastSyncAt: connector.lastSyncAt,
  });
}
