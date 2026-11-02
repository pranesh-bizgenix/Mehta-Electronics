import { NextResponse } from "next/server";
import { gunzipSync } from "zlib";
import { authenticateAgent } from "@/lib/ingest/agent-auth";
import { ingestTallyPayload, TallyIngestPayloadSchema } from "@/lib/ingest/tally-service";
import { CompanyLimitError } from "@/lib/entitlements";

export const runtime = "nodejs";
const MAX_COMPRESSED = 25 * 1024 * 1024;
const MAX_DECOMPRESSED = 250 * 1024 * 1024;

/** Legacy single-request endpoint retained for installed v1 agents. Agent v2 uses /chunks. */
export async function POST(req: Request) {
  const auth = await authenticateAgent(req);
  if (auth.error) return NextResponse.json({ ok: false, error: auth.error.message }, { status: auth.error.status });
  try {
    const declared = Number(req.headers.get("content-length") || "0");
    if (declared > MAX_COMPRESSED) return NextResponse.json({ ok: false, error: "Ingest payload is too large. Upgrade the connector to resumable uploads." }, { status: 413 });
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.byteLength > MAX_COMPRESSED) return NextResponse.json({ ok: false, error: "Ingest payload is too large. Upgrade the connector to resumable uploads." }, { status: 413 });
    const raw = req.headers.get("content-encoding") === "gzip" ? gunzipSync(buf, { maxOutputLength: MAX_DECOMPRESSED }) : buf;
    const parsed = TallyIngestPayloadSchema.safeParse(JSON.parse(raw.toString("utf8")));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Malformed ingest payload", issues: parsed.error.flatten() }, { status: 400 });
    const result = await ingestTallyPayload(auth.orgId, parsed.data);
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    if (e instanceof CompanyLimitError) return NextResponse.json({ ok: false, error: e.message, code: e.code, entitlement: e.entitlement, used: e.currentCount }, { status: 409 });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed to ingest" }, { status: 500 });
  }
}
