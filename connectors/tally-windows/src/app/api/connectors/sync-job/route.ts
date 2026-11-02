import { NextResponse } from "next/server";
import { z } from "zod";
import {
  completeConnectorSyncJob,
  startConnectorSyncJob,
  type ConnectorSyncJobStatus,
} from "@/lib/connectors/tally/connector-repo";
import { authenticateAgent } from "@/lib/ingest/agent-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const RequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    syncId: z.string().max(200).nullish(),
    companyName: z.string().min(1).max(300),
    companyGuid: z.string().max(300).nullish(),
    syncFrom: date,
    syncTo: date,
  }),
  z.object({
    action: z.literal("complete"),
    jobId: z.string().uuid(),
    status: z.enum(["stored", "quarantined", "failed"]),
    recordCount: z.number().int().min(0).optional(),
    message: z.string().max(4000).nullish(),
    lastSyncAt: z.string().datetime({ offset: true }).nullish(),
  }),
]);

export async function POST(request: Request) {
  const auth = await authenticateAgent(request);
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status });
  if (!auth.connectorId) {
    return NextResponse.json({ error: "Sync job tracking requires a paired connector token." }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sync job payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.action === "start") {
    const syncJobId = await startConnectorSyncJob({
      orgId: auth.orgId,
      connectorId: auth.connectorId,
      syncId: parsed.data.syncId || null,
      companyName: parsed.data.companyName.trim(),
      companyGuid: parsed.data.companyGuid?.trim() || undefined,
      syncFrom: parsed.data.syncFrom,
      syncTo: parsed.data.syncTo,
    });

    return NextResponse.json({ ok: true, syncJobId });
  }

  await completeConnectorSyncJob({
    jobId: parsed.data.jobId,
    orgId: auth.orgId,
    connectorId: auth.connectorId,
    status: parsed.data.status as ConnectorSyncJobStatus,
    recordCount: parsed.data.recordCount,
    message: parsed.data.message || null,
    lastSyncAt: parsed.data.lastSyncAt || null,
  });

  return NextResponse.json({ ok: true });
}
