import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { gunzipSync } from "zlib";
import { z } from "zod";
import { authenticateAgent } from "@/lib/ingest/agent-auth";
import { appendTallyChunk, completeTallySession, loadTallySession, startTallySession } from "@/lib/db/tally-chunks";
import { ingestTallyPayload } from "@/lib/ingest/tally-service";
import { CompanyLimitError } from "@/lib/entitlements";
import { companyKeyForIdentity } from "@/lib/company-workspace";
import { loadCompanyDataset, DatasetVersionConflictError } from "@/lib/db/repo";
import { completeConnectorSyncJob, startConnectorSyncJob } from "@/lib/connectors/tally/connector-repo";
import { resolveTenantDatabase } from "@/lib/db/tenant-resolver";

export const runtime = "nodejs";
const MAX_COMPRESSED = 8 * 1024 * 1024;
const MAX_DECOMPRESSED = 12 * 1024 * 1024;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const RequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    company: z.string().min(1).max(300),
    companyGuid: z.string().max(300).nullish(),
    from: date,
    to: date,
    asOf: date.optional(),
    publicationMode: z.enum(["replace", "merge-window"]).optional(),
    historyCoveredFrom: date.nullish(),
    syncId: z.string().max(200).optional(),
    syncJobId: z.string().uuid().optional(),
  }),
  z.object({ action: z.literal("append"), sessionId: z.string().uuid(), field: z.enum(["vouchersXml", "stockXml", "balanceSheetXml", "profitAndLossXml", "billsReceivableXml", "billsPayableXml", "ledgersXml", "groupsXml", "salesRegisterXml", "purchaseRegisterXml", "dayBookReportXml", "trialBalanceXml", "cashBankBooksXml", "cashBankControlXml", "stockSummaryReportXml"]), sequence: z.number().int().min(0).max(100000), content: z.string().max(6_000_000) }),
  z.object({ action: z.literal("finalize"), sessionId: z.string().uuid() }),
]);
const REQUIRED_FIELDS = ["vouchersXml", "stockXml", "balanceSheetXml", "profitAndLossXml", "billsReceivableXml", "billsPayableXml", "ledgersXml", "groupsXml"] as const;

export async function POST(req: Request) {
  const auth = await authenticateAgent(req);
  if (auth.error) return NextResponse.json({ ok: false, error: auth.error.message }, { status: auth.error.status });
  let finalizingSession: string | null = null;
  let finalizingJob: { jobId?: string | null; connectorId?: string | null } | null = null;
  try {
    await resolveTenantDatabase(auth.orgId);
    const declared = Number(req.headers.get("content-length") || "0");
    if (declared > MAX_COMPRESSED) return NextResponse.json({ ok: false, error: "Chunk is too large." }, { status: 413 });
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.byteLength > MAX_COMPRESSED) return NextResponse.json({ ok: false, error: "Chunk is too large." }, { status: 413 });
    const raw = req.headers.get("content-encoding") === "gzip" ? gunzipSync(buf, { maxOutputLength: MAX_DECOMPRESSED }) : buf;
    const parsed = RequestSchema.safeParse(JSON.parse(raw.toString("utf8")));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Malformed chunk request", issues: parsed.error.flatten() }, { status: 400 });
    const input = parsed.data;
    if (input.action === "start") {
      const externalId = input.companyGuid?.trim()
        ? `guid:${input.companyGuid.trim()}`
        : `name:${input.company.trim().toLowerCase()}`;
      const companyKey = companyKeyForIdentity("tally", externalId);
      const current = await loadCompanyDataset(auth.orgId, companyKey);
      const syncJobId = input.syncJobId || (
        auth.connectorId
          ? await startConnectorSyncJob({
              orgId: auth.orgId,
              connectorId: auth.connectorId,
              syncId: input.syncId || null,
              companyName: input.company,
              companyGuid: input.companyGuid ?? undefined,
              syncFrom: input.from,
              syncTo: input.to,
            })
          : null
      );
      const sessionId = await startTallySession(auth.orgId, {
        company: input.company,
        companyGuid: input.companyGuid ?? undefined,
        companyKey,
        expectedDatasetVersion: current?.datasetVersion ?? null,
        from: input.from,
        to: input.to,
        asOf: input.asOf,
        publicationMode: input.publicationMode ?? "replace",
        historyCoveredFrom: input.historyCoveredFrom ?? null,
        connectorId: auth.connectorId,
        syncId: input.syncId || null,
        syncJobId,
      });
      return NextResponse.json({ ok: true, sessionId, ...(syncJobId ? { syncJobId } : {}) });
    }
    const session = await loadTallySession(auth.orgId, input.sessionId);
    if (session.metadata.connectorId && auth.connectorId && session.metadata.connectorId !== auth.connectorId) {
      return NextResponse.json({ ok: false, error: "This sync session belongs to a different connector." }, { status: 403 });
    }
    if (input.action === "append") {
      await appendTallyChunk(auth.orgId, input.sessionId, input.field, input.sequence, input.content);
      return NextResponse.json({ ok: true, sequence: input.sequence });
    }
    finalizingSession = input.sessionId;
    finalizingJob = { jobId: session.metadata.syncJobId, connectorId: session.metadata.connectorId || auth.connectorId };
    const missing = REQUIRED_FIELDS.filter((field) => !session.fields[field]);
    if (missing.length) {
      await completeTallySession(auth.orgId, input.sessionId, "rejected");
      if (session.metadata.syncJobId) {
        await completeConnectorSyncJob({
          jobId: session.metadata.syncJobId,
          orgId: auth.orgId,
          connectorId: session.metadata.connectorId || auth.connectorId,
          status: "failed",
          message: `Snapshot is incomplete; missing ${missing.join(", ")}.`,
        });
      }
      return NextResponse.json({ ok: false, error: `Snapshot is incomplete; missing ${missing.join(", ")}. Nothing was published.` }, { status: 422 });
    }
    const result = await ingestTallyPayload(auth.orgId, { ...session.metadata, ...session.fields });
    await completeTallySession(auth.orgId, input.sessionId, result.status === 200 ? "stored" : "quarantined");
    if (session.metadata.syncJobId) {
      await completeConnectorSyncJob({
        jobId: session.metadata.syncJobId,
        orgId: auth.orgId,
        connectorId: session.metadata.connectorId || auth.connectorId,
        status: result.status === 200 ? "stored" : "quarantined",
        recordCount: Number((result.body as { voucherRows?: number }).voucherRows || 0),
        message: "message" in result.body && typeof result.body.message === "string" ? result.body.message : null,
        lastSyncAt: result.status === 200 ? new Date().toISOString() : null,
      });
    }
    if (result.status === 200) revalidatePath("/", "layout");
    return NextResponse.json({ ...result.body, sessionId: input.sessionId, uploadMode: "resumable" }, { status: result.status });
  } catch (e) {
    if (e instanceof CompanyLimitError) {
      if (finalizingSession) await completeTallySession(auth.orgId, finalizingSession, "rejected").catch(() => {});
      if (finalizingJob?.jobId) {
        await completeConnectorSyncJob({
          jobId: finalizingJob.jobId,
          orgId: auth.orgId,
          connectorId: finalizingJob.connectorId,
          status: "failed",
          message: e.message,
        }).catch(() => {});
      }
      return NextResponse.json({ ok: false, error: e.message, code: e.code, entitlement: e.entitlement, used: e.currentCount }, { status: 409 });
    }
    if (e instanceof DatasetVersionConflictError) {
      if (finalizingSession) await completeTallySession(auth.orgId, finalizingSession, "rejected").catch(() => {});
      if (finalizingJob?.jobId) {
        await completeConnectorSyncJob({
          jobId: finalizingJob.jobId,
          orgId: auth.orgId,
          connectorId: finalizingJob.connectorId,
          status: "failed",
          message: e.message,
        }).catch(() => {});
      }
      return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: 409 });
    }
    if (finalizingJob?.jobId) {
      await completeConnectorSyncJob({
        jobId: finalizingJob.jobId,
        orgId: auth.orgId,
        connectorId: finalizingJob.connectorId,
        status: "failed",
        message: e instanceof Error ? e.message : "Chunk ingest failed",
      }).catch(() => {});
    }
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Chunk ingest failed" }, { status: 500 });
  }
}
