import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./client";
import {
  COMPLETED_SESSION_RETENTION_DAYS,
  nextChunkBudget,
  RECEIVING_SESSION_TTL_HOURS,
} from "@/lib/ingest/chunk-budget";

export type TallyChunkField =
  | "vouchersXml"
  | "stockXml"
  | "balanceSheetXml"
  | "profitAndLossXml"
  | "billsReceivableXml"
  | "billsPayableXml"
  | "ledgersXml"
  | "groupsXml"
  | "salesRegisterXml"
  | "purchaseRegisterXml"
  | "dayBookReportXml"
  | "trialBalanceXml"
  | "cashBankBooksXml"
  | "cashBankControlXml"
  | "stockSummaryReportXml";
export type TallySessionMeta = {
  company: string;
  companyGuid?: string;
  companyKey: string;
  expectedDatasetVersion: string | null;
  from: string;
  to: string;
  asOf?: string;
  publicationMode?: "replace" | "merge-window";
  historyCoveredFrom?: string | null;
  connectorId?: string | null;
  syncId?: string | null;
  syncJobId?: string | null;
};

let ensured = false;
async function ensureTables() {
  if (!db || ensured) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS gi_tally_ingest_session (
      id text PRIMARY KEY, org_id text NOT NULL, metadata jsonb NOT NULL,
      status text NOT NULL DEFAULT 'receiving', total_bytes bigint NOT NULL DEFAULT 0,
      chunk_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS gi_tally_ingest_chunk (
      session_id text NOT NULL REFERENCES gi_tally_ingest_session(id) ON DELETE CASCADE,
      org_id text NOT NULL, field_name text NOT NULL, sequence integer NOT NULL, content text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (session_id, field_name, sequence)
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS gi_tally_ingest_chunk_session_idx ON gi_tally_ingest_chunk (session_id, field_name, sequence)`);
  await db.execute(sql`ALTER TABLE gi_tally_ingest_session ADD COLUMN IF NOT EXISTS total_bytes bigint NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE gi_tally_ingest_session ADD COLUMN IF NOT EXISTS chunk_count integer NOT NULL DEFAULT 0`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS gi_tally_ingest_session_cleanup_idx ON gi_tally_ingest_session (status, created_at, completed_at)`);
  ensured = true;
}

export async function cleanupExpiredTallySessions(): Promise<{ expired: number; deleted: number }> {
  if (!db) throw new Error("PostgreSQL is required for Tally upload cleanup.");
  await ensureTables();
  const expiredRows = await db.execute(sql`
    UPDATE gi_tally_ingest_session
    SET status = 'expired', completed_at = now()
    WHERE status = 'receiving'
      AND created_at < now() - (${RECEIVING_SESSION_TTL_HOURS} * interval '1 hour')
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  const deletedRows = await db.execute(sql`
    DELETE FROM gi_tally_ingest_session
    WHERE status <> 'receiving'
      AND COALESCE(completed_at, created_at) < now() - (${COMPLETED_SESSION_RETENTION_DAYS} * interval '1 day')
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  return { expired: expiredRows.length, deleted: deletedRows.length };
}

export async function startTallySession(orgId: string, metadata: TallySessionMeta): Promise<string> {
  if (!db) throw new Error("PostgreSQL is required for resumable Tally uploads.");
  await ensureTables();
  await cleanupExpiredTallySessions();
  const open = await db.execute(sql`SELECT count(*)::int AS count FROM gi_tally_ingest_session WHERE org_id = ${orgId} AND status = 'receiving'`) as unknown as Array<{ count: number }>;
  if ((open[0]?.count ?? 0) >= 5) throw new Error("Five sync sessions are already open. Finalise them or wait for expiry before starting another.");
  const id = randomUUID();
  const json = JSON.stringify(metadata);
  await db.execute(sql`INSERT INTO gi_tally_ingest_session (id, org_id, metadata) VALUES (${id}, ${orgId}, ${json}::jsonb)`);
  return id;
}

export async function appendTallyChunk(orgId: string, sessionId: string, field: TallyChunkField, sequence: number, content: string) {
  if (!db) throw new Error("PostgreSQL is required for resumable Tally uploads.");
  await ensureTables();
  const nextBytes = Buffer.byteLength(content, "utf8");
  await db.transaction(async (tx) => {
    const session = await tx.execute(sql`
      SELECT id, total_bytes, chunk_count
      FROM gi_tally_ingest_session
      WHERE id = ${sessionId} AND org_id = ${orgId} AND status = 'receiving'
      FOR UPDATE
    `) as unknown as Array<{ id: string; total_bytes: string | number; chunk_count: number }>;
    if (!session[0]) throw new Error("Sync session is missing, complete, or belongs to another organisation.");
    const existing = await tx.execute(sql`
      SELECT octet_length(content)::integer AS bytes
      FROM gi_tally_ingest_chunk
      WHERE session_id = ${sessionId} AND org_id = ${orgId}
        AND field_name = ${field} AND sequence = ${sequence}
      LIMIT 1
    `) as unknown as Array<{ bytes: number }>;
    const budget = nextChunkBudget({
      totalBytes: Number(session[0].total_bytes),
      chunkCount: Number(session[0].chunk_count),
      previousBytes: existing[0]?.bytes ?? 0,
      nextBytes,
      replacing: Boolean(existing[0]),
    });
    if (!budget.allowed) {
      throw new Error("Tally upload exceeded the 300 MB or 10,000 chunk session safety budget.");
    }
    await tx.execute(sql`
      INSERT INTO gi_tally_ingest_chunk (session_id, org_id, field_name, sequence, content)
      VALUES (${sessionId}, ${orgId}, ${field}, ${sequence}, ${content})
      ON CONFLICT (session_id, field_name, sequence) DO UPDATE SET content = EXCLUDED.content
    `);
    await tx.execute(sql`
      UPDATE gi_tally_ingest_session
      SET total_bytes = ${budget.totalBytes}, chunk_count = ${budget.chunkCount}
      WHERE id = ${sessionId} AND org_id = ${orgId}
    `);
  });
}

export async function loadTallySession(orgId: string, sessionId: string): Promise<{ metadata: TallySessionMeta; fields: Partial<Record<TallyChunkField, string>> }> {
  if (!db) throw new Error("PostgreSQL is required for resumable Tally uploads.");
  await ensureTables();
  const sessions = await db.execute(sql`SELECT metadata FROM gi_tally_ingest_session WHERE id = ${sessionId} AND org_id = ${orgId} AND status = 'receiving' LIMIT 1`) as unknown as Array<{ metadata: TallySessionMeta }>;
  if (!sessions[0]) throw new Error("Sync session is missing, complete, or belongs to another organisation.");
  const chunks = await db.execute(sql`SELECT field_name, sequence, content FROM gi_tally_ingest_chunk WHERE session_id = ${sessionId} AND org_id = ${orgId} ORDER BY field_name, sequence`) as unknown as Array<{ field_name: TallyChunkField; sequence: number; content: string }>;
  const fields: Partial<Record<TallyChunkField, string>> = {};
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.content.length;
    if (total > 300_000_000) throw new Error("Raw Tally snapshot exceeds the 300 MB pilot safety limit.");
    fields[chunk.field_name] = `${fields[chunk.field_name] || ""}${chunk.content}`;
  }
  return { metadata: sessions[0].metadata, fields };
}

export async function completeTallySession(orgId: string, sessionId: string, status: "stored" | "quarantined" | "rejected") {
  if (!db) return;
  await ensureTables();
  await db.execute(sql`UPDATE gi_tally_ingest_session SET status = ${status}, completed_at = now() WHERE id = ${sessionId} AND org_id = ${orgId}`);
}
