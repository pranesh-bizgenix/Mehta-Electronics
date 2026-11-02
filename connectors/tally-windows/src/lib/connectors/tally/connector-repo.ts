import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db, ensureMasterTables } from "@/lib/db/client";
import { hashSecret, generatePairingCode } from "./connector-crypto";

export type ConnectorProvider = "tally";
export type ConnectorStatus = "active" | "revoked" | "error";
export type PairingCodeStatus = "active" | "used" | "expired" | "superseded" | "revoked";
export type ConnectorActorType = "user" | "connector" | "system";
export type ConnectorSyncJobStatus = "running" | "stored" | "quarantined" | "failed";

const DEFAULT_PROVIDER: ConnectorProvider = "tally";
const DEFAULT_SYNC_INTERVAL_SECONDS = 60 * 60;
const PAIRING_CODE_TTL_MINUTES = 10;

export interface PairingCodeResult {
  pairingCode: string;
  expiresAt: string;
}

export interface ConnectorActor {
  type: ConnectorActorType;
  id: string;
  display?: string;
}

export interface TenantConnectorRecord {
  id: string;
  orgId: string;
  provider: ConnectorProvider;
  installationId: string;
  machineName: string | null;
  agentVersion: string | null;
  status: ConnectorStatus;
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
}

export interface ConnectorSyncJobRecord {
  id: string;
  orgId: string;
  connectorId: string | null;
  provider: ConnectorProvider;
  syncId: string | null;
  companyName: string | null;
  companyGuid: string | null;
  status: ConnectorSyncJobStatus;
  recordCount: number;
  message: string | null;
  syncFrom: string | null;
  syncTo: string | null;
  startedAt: string;
  completedAt: string | null;
}

type Row = Record<string, unknown>;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function ymd(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function toConnector(row: Row): TenantConnectorRecord {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    provider: "tally",
    installationId: String(row.installation_id),
    machineName: row.machine_name == null ? null : String(row.machine_name),
    agentVersion: row.agent_version == null ? null : String(row.agent_version),
    status: (row.status === "revoked" || row.status === "error" ? row.status : "active"),
    pairedAt: iso(row.paired_at as Date | string | null | undefined) || new Date(0).toISOString(),
    lastSeenAt: iso(row.last_seen_at as Date | string | null | undefined),
    lastHeartbeatAt: iso(row.last_heartbeat_at as Date | string | null | undefined),
    lastSyncAt: iso(row.last_sync_at as Date | string | null | undefined),
    historySyncInProgress: row.history_sync_in_progress === true,
    nextHistoryFrom: ymd(row.next_history_from as Date | string | null | undefined),
    lastTallyAvailable: boolOrNull(row.last_tally_available),
    selectedCompany: row.selected_company == null ? null : String(row.selected_company),
    syncIntervalSeconds: Number(row.sync_interval_seconds || DEFAULT_SYNC_INTERVAL_SECONDS),
    createdAt: iso(row.created_at as Date | string | null | undefined) || new Date(0).toISOString(),
    updatedAt: iso(row.updated_at as Date | string | null | undefined) || new Date(0).toISOString(),
    revokedAt: iso(row.revoked_at as Date | string | null | undefined),
  };
}

function toSyncJob(row: Row): ConnectorSyncJobRecord {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    connectorId: row.connector_id == null ? null : String(row.connector_id),
    provider: "tally",
    syncId: row.sync_id == null ? null : String(row.sync_id),
    companyName: row.company_name == null ? null : String(row.company_name),
    companyGuid: row.company_guid == null ? null : String(row.company_guid),
    status: row.status === "stored" || row.status === "quarantined" || row.status === "failed" ? row.status : "running",
    recordCount: Number(row.record_count || 0),
    message: row.message == null ? null : String(row.message),
    syncFrom: row.sync_from == null ? null : String(row.sync_from).slice(0, 10),
    syncTo: row.sync_to == null ? null : String(row.sync_to).slice(0, 10),
    startedAt: iso(row.started_at as Date | string | null | undefined) || new Date(0).toISOString(),
    completedAt: iso(row.completed_at as Date | string | null | undefined),
  };
}

function isConcurrentCreateError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return code === "42P07" || code === "42710" || code === "23505";
}

async function ddl(step: () => Promise<unknown>): Promise<void> {
  try {
    await step();
  } catch (error) {
    if (!isConcurrentCreateError(error)) throw error;
  }
}

let ensured = false;
let ensurePromise: Promise<void> | null = null;

export async function ensureConnectorTables(): Promise<void> {
  if (!db || ensured) return;
  if (ensurePromise) return ensurePromise;
  const database = db;
  ensurePromise = (async () => {
    await ensureMasterTables();
    await ddl(() => database.execute(sql`
      CREATE TABLE IF NOT EXISTS tenant_database_connections (
        tenant_id text PRIMARY KEY,
        db_url text NOT NULL DEFAULT '',
        db_provider text NOT NULL DEFAULT 'shared-postgres',
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `));
    await ddl(() => database.execute(sql`
      CREATE TABLE IF NOT EXISTS connector_pairing_codes (
        id text PRIMARY KEY,
        org_id text NOT NULL,
        provider text NOT NULL DEFAULT 'tally',
        created_by_email text NOT NULL,
        created_by_name text,
        code_hash text NOT NULL UNIQUE,
        status text NOT NULL DEFAULT 'active',
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `));
    await ddl(() => database.execute(sql`CREATE INDEX IF NOT EXISTS connector_pairing_codes_org_idx ON connector_pairing_codes (org_id, provider, created_at DESC)`));
    await ddl(() => database.execute(sql`
      CREATE TABLE IF NOT EXISTS tenant_connectors (
        id text PRIMARY KEY,
        org_id text NOT NULL,
        provider text NOT NULL DEFAULT 'tally',
        installation_id text NOT NULL,
        machine_name text,
        agent_version text,
        status text NOT NULL DEFAULT 'active',
        sync_interval_seconds integer NOT NULL DEFAULT 3600,
        paired_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz,
        last_heartbeat_at timestamptz,
        last_sync_at timestamptz,
        history_sync_in_progress boolean NOT NULL DEFAULT false,
        next_history_from date,
        last_tally_available boolean,
        selected_company text,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (provider, installation_id)
      )
    `));
    await ddl(() => database.execute(sql`ALTER TABLE tenant_connectors ADD COLUMN IF NOT EXISTS history_sync_in_progress boolean NOT NULL DEFAULT false`));
    await ddl(() => database.execute(sql`ALTER TABLE tenant_connectors ADD COLUMN IF NOT EXISTS next_history_from date`));
    await ddl(() => database.execute(sql`CREATE INDEX IF NOT EXISTS tenant_connectors_org_idx ON tenant_connectors (org_id, provider, updated_at DESC)`));
    await ddl(() => database.execute(sql`
      CREATE TABLE IF NOT EXISTS connector_refresh_tokens (
        id text PRIMARY KEY,
        org_id text NOT NULL,
        connector_id text NOT NULL REFERENCES tenant_connectors(id) ON DELETE CASCADE,
        token_hash text NOT NULL UNIQUE,
        expires_at timestamptz NOT NULL,
        last_used_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `));
    await ddl(() => database.execute(sql`CREATE INDEX IF NOT EXISTS connector_refresh_tokens_connector_idx ON connector_refresh_tokens (connector_id, created_at DESC)`));
    await ddl(() => database.execute(sql`
      CREATE TABLE IF NOT EXISTS connector_sync_jobs (
        id text PRIMARY KEY,
        org_id text NOT NULL,
        connector_id text REFERENCES tenant_connectors(id) ON DELETE SET NULL,
        provider text NOT NULL DEFAULT 'tally',
        sync_id text,
        company_name text,
        company_guid text,
        status text NOT NULL DEFAULT 'running',
        record_count integer NOT NULL DEFAULT 0,
        message text,
        sync_from date,
        sync_to date,
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      )
    `));
    await ddl(() => database.execute(sql`CREATE INDEX IF NOT EXISTS connector_sync_jobs_org_idx ON connector_sync_jobs (org_id, started_at DESC)`));
    await ddl(() => database.execute(sql`CREATE INDEX IF NOT EXISTS connector_sync_jobs_connector_idx ON connector_sync_jobs (connector_id, started_at DESC)`));
    await ddl(() => database.execute(sql`
      CREATE TABLE IF NOT EXISTS connector_heartbeats (
        id text PRIMARY KEY,
        org_id text NOT NULL,
        connector_id text NOT NULL REFERENCES tenant_connectors(id) ON DELETE CASCADE,
        machine_name text,
        agent_version text,
        tally_available boolean NOT NULL,
        selected_company text,
        last_sync_at timestamptz,
        history_sync_in_progress boolean NOT NULL DEFAULT false,
        next_history_from date,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `));
    await ddl(() => database.execute(sql`ALTER TABLE connector_heartbeats ADD COLUMN IF NOT EXISTS history_sync_in_progress boolean NOT NULL DEFAULT false`));
    await ddl(() => database.execute(sql`ALTER TABLE connector_heartbeats ADD COLUMN IF NOT EXISTS next_history_from date`));
    await ddl(() => database.execute(sql`CREATE INDEX IF NOT EXISTS connector_heartbeats_org_idx ON connector_heartbeats (org_id, created_at DESC)`));
    await ddl(() => database.execute(sql`CREATE INDEX IF NOT EXISTS connector_heartbeats_connector_idx ON connector_heartbeats (connector_id, created_at DESC)`));
    await ddl(() => database.execute(sql`
      CREATE TABLE IF NOT EXISTS connector_revocations (
        id text PRIMARY KEY,
        org_id text NOT NULL,
        connector_id text NOT NULL REFERENCES tenant_connectors(id) ON DELETE CASCADE,
        actor_type text NOT NULL,
        actor_id text NOT NULL,
        reason text,
        revoked_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `));
    await ddl(() => database.execute(sql`CREATE INDEX IF NOT EXISTS connector_revocations_org_idx ON connector_revocations (org_id, created_at DESC)`));
    await ddl(() => database.execute(sql`CREATE INDEX IF NOT EXISTS connector_revocations_connector_idx ON connector_revocations (connector_id, created_at DESC)`));
    await ddl(() => database.execute(sql`
      CREATE TABLE IF NOT EXISTS connector_audit_logs (
        id text PRIMARY KEY,
        org_id text NOT NULL,
        connector_id text REFERENCES tenant_connectors(id) ON DELETE SET NULL,
        actor_type text NOT NULL,
        actor_id text NOT NULL,
        action text NOT NULL,
        detail jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `));
    await ddl(() => database.execute(sql`CREATE INDEX IF NOT EXISTS connector_audit_logs_org_idx ON connector_audit_logs (org_id, created_at DESC)`));

    // Keep the resolver table aligned with the org metadata table until
    // dedicated databases are rolled out tenant-by-tenant.
    await ddl(() => database.execute(sql`
      INSERT INTO tenant_database_connections (tenant_id, db_url, db_provider, is_active, created_at, updated_at)
      SELECT id, db_url, db_provider, true, now(), now()
      FROM organizations
      ON CONFLICT (tenant_id) DO UPDATE SET
        db_url = EXCLUDED.db_url,
        db_provider = EXCLUDED.db_provider,
        is_active = true,
        updated_at = now()
    `));

    ensured = true;
  })().finally(() => {
    ensurePromise = null;
  });
  return ensurePromise;
}

async function insertAudit(
  orgId: string,
  connectorId: string | null,
  actor: ConnectorActor,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  if (!db) return;
  await ensureConnectorTables();
  const id = randomUUID();
  await db.execute(sql`
    INSERT INTO connector_audit_logs (id, org_id, connector_id, actor_type, actor_id, action, detail, created_at)
    VALUES (
      ${id}, ${orgId}, ${connectorId}, ${actor.type}, ${actor.id}, ${action},
      ${JSON.stringify(detail)}::jsonb, now()
    )
  `);
}

export async function createPairingCodeForOrg(input: {
  orgId: string;
  createdByEmail: string;
  createdByName?: string;
  provider?: ConnectorProvider;
}): Promise<PairingCodeResult> {
  if (!db) throw new Error("PostgreSQL is required for pairing codes.");
  await ensureConnectorTables();
  const orgId = input.orgId.trim() || "default";
  const provider = input.provider ?? DEFAULT_PROVIDER;
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MINUTES * 60_000);
  const pairingCode = generatePairingCode();
  const id = randomUUID();
  const codeHash = hashSecret(pairingCode);

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE connector_pairing_codes
      SET status = 'superseded'
      WHERE org_id = ${orgId}
        AND provider = ${provider}
        AND status = 'active'
        AND used_at IS NULL
    `);
    await tx.execute(sql`
      INSERT INTO connector_pairing_codes (
        id, org_id, provider, created_by_email, created_by_name,
        code_hash, status, expires_at, created_at
      )
      VALUES (
        ${id}, ${orgId}, ${provider}, ${input.createdByEmail.trim().toLowerCase()},
        ${input.createdByName?.trim() || null}, ${codeHash}, 'active', ${expiresAt.toISOString()}, now()
      )
    `);
  });

  await insertAudit(orgId, null, {
    type: "user",
    id: input.createdByEmail.trim().toLowerCase(),
    ...(input.createdByName?.trim() ? { display: input.createdByName.trim() } : {}),
  }, "pairing_code_generated", { provider, expiresAt: expiresAt.toISOString() });

  return { pairingCode, expiresAt: expiresAt.toISOString() };
}

export async function pairConnectorWithCode(input: {
  pairingCode: string;
  installationId: string;
  machineName: string;
  agentVersion: string;
  provider?: ConnectorProvider;
  refreshTokenHash: string;
  refreshTokenExpiresAt: string;
}): Promise<TenantConnectorRecord> {
  if (!db) throw new Error("PostgreSQL is required for connector pairing.");
  await ensureConnectorTables();
  const provider = input.provider ?? DEFAULT_PROVIDER;
  const codeHash = hashSecret(input.pairingCode.trim().toUpperCase());
  const connectorId = randomUUID();

  const row = await db.transaction(async (tx) => {
    const codes = (await tx.execute(sql`
      SELECT id, org_id, status, expires_at, used_at
      FROM connector_pairing_codes
      WHERE code_hash = ${codeHash}
        AND provider = ${provider}
      FOR UPDATE
    `)) as unknown as Array<{
      id: string;
      org_id: string;
      status: PairingCodeStatus;
      expires_at: Date | string;
      used_at: Date | string | null;
    }>;
    const code = codes[0];
    if (!code) throw new Error("Pairing code is invalid.");
    if (code.status !== "active" || code.used_at) throw new Error("Pairing code has already been used.");
    if (new Date(code.expires_at).getTime() <= Date.now()) {
      await tx.execute(sql`UPDATE connector_pairing_codes SET status = 'expired' WHERE id = ${code.id}`);
      throw new Error("Pairing code has expired.");
    }

    const existing = (await tx.execute(sql`
      SELECT *
      FROM tenant_connectors
      WHERE provider = ${provider}
        AND installation_id = ${input.installationId}
      LIMIT 1
    `)) as unknown as Row[];

    const connector = existing[0];
    const resolvedConnectorId = connector?.id ? String(connector.id) : connectorId;
    const movedBetweenOrgs = connector
      ? String(connector.org_id) !== String(code.org_id)
      : false;

    if (connector) {
      await tx.execute(sql`
        UPDATE tenant_connectors
        SET org_id = ${code.org_id},
            machine_name = ${input.machineName},
            agent_version = ${input.agentVersion},
            status = 'active',
            sync_interval_seconds = ${DEFAULT_SYNC_INTERVAL_SECONDS},
            last_seen_at = ${movedBetweenOrgs ? null : (connector.last_seen_at as Date | string | null | undefined) || null},
            last_heartbeat_at = ${movedBetweenOrgs ? null : (connector.last_heartbeat_at as Date | string | null | undefined) || null},
            last_sync_at = ${movedBetweenOrgs ? null : (connector.last_sync_at as Date | string | null | undefined) || null},
            history_sync_in_progress = false,
            next_history_from = null,
            last_tally_available = ${movedBetweenOrgs ? null : boolOrNull(connector.last_tally_available)},
            selected_company = ${movedBetweenOrgs ? null : (connector.selected_company == null ? null : String(connector.selected_company))},
            paired_at = now(),
            revoked_at = null,
            updated_at = now()
        WHERE id = ${resolvedConnectorId}
      `);
    } else {
      await tx.execute(sql`
        INSERT INTO tenant_connectors (
          id, org_id, provider, installation_id, machine_name, agent_version,
          status, sync_interval_seconds, history_sync_in_progress, next_history_from,
          paired_at, created_at, updated_at
        )
        VALUES (
          ${resolvedConnectorId}, ${code.org_id}, ${provider}, ${input.installationId},
          ${input.machineName}, ${input.agentVersion}, 'active',
          ${DEFAULT_SYNC_INTERVAL_SECONDS}, false, null,
          now(), now(), now()
        )
      `);
    }

    await tx.execute(sql`
      UPDATE connector_refresh_tokens
      SET revoked_at = now()
      WHERE connector_id = ${resolvedConnectorId}
        AND revoked_at IS NULL
    `);
    await tx.execute(sql`
      INSERT INTO connector_refresh_tokens (
        id, org_id, connector_id, token_hash, expires_at, created_at
      )
      VALUES (
        ${randomUUID()}, ${code.org_id}, ${resolvedConnectorId},
        ${input.refreshTokenHash}, ${input.refreshTokenExpiresAt}, now()
      )
    `);
    await tx.execute(sql`
      UPDATE connector_pairing_codes
      SET status = 'used', used_at = now()
      WHERE id = ${code.id}
    `);

    const connectors = (await tx.execute(sql`
      SELECT *
      FROM tenant_connectors
      WHERE id = ${resolvedConnectorId}
      LIMIT 1
    `)) as unknown as Row[];
    return connectors[0];
  });

  const record = toConnector(row);
  await insertAudit(record.orgId, record.id, {
    type: "connector",
    id: record.installationId,
    ...(record.machineName ? { display: record.machineName } : {}),
  }, "connector_paired", {
    provider,
    machineName: record.machineName,
    agentVersion: record.agentVersion,
  });
  return record;
}

export async function findConnectorById(connectorId: string): Promise<TenantConnectorRecord | null> {
  if (!db) return null;
  await ensureConnectorTables();
  const rows = (await db.execute(sql`
    SELECT *
    FROM tenant_connectors
    WHERE id = ${connectorId}
    LIMIT 1
  `)) as unknown as Row[];
  return rows[0] ? toConnector(rows[0]) : null;
}

export async function findActiveRefreshToken(token: string): Promise<{
  tokenId: string;
  connector: TenantConnectorRecord;
}> {
  if (!db) throw new Error("PostgreSQL is required for connector refresh.");
  await ensureConnectorTables();
  const tokenHash = hashSecret(token);
  const rows = (await db.execute(sql`
    SELECT
      rt.id AS token_id,
      rt.expires_at,
      rt.revoked_at,
      c.*
    FROM connector_refresh_tokens rt
    JOIN tenant_connectors c ON c.id = rt.connector_id
    WHERE rt.token_hash = ${tokenHash}
    LIMIT 1
  `)) as unknown as Array<Row & { token_id: string; expires_at: Date | string; revoked_at: Date | string | null }>;
  const row = rows[0];
  if (!row) throw new Error("Refresh token is invalid.");
  if (row.revoked_at) throw new Error("Refresh token has been revoked.");
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new Error("Refresh token has expired.");
  const connector = toConnector(row);
  if (connector.status !== "active" || connector.revokedAt) throw new Error("Connector is no longer active.");
  return { tokenId: String(row.token_id), connector };
}

export async function rotateRefreshToken(input: {
  tokenId: string;
  connectorId: string;
  orgId: string;
  refreshTokenHash: string;
  refreshTokenExpiresAt: string;
}): Promise<void> {
  if (!db) throw new Error("PostgreSQL is required for connector refresh rotation.");
  await ensureConnectorTables();
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE connector_refresh_tokens
      SET revoked_at = now(), last_used_at = now()
      WHERE id = ${input.tokenId}
    `);
    await tx.execute(sql`
      INSERT INTO connector_refresh_tokens (
        id, org_id, connector_id, token_hash, expires_at, created_at
      )
      VALUES (
        ${randomUUID()}, ${input.orgId}, ${input.connectorId},
        ${input.refreshTokenHash}, ${input.refreshTokenExpiresAt}, now()
      )
    `);
  });
}

export async function recordConnectorHeartbeat(input: {
  connectorId: string;
  orgId: string;
  machineName?: string;
  agentVersion?: string;
  tallyAvailable: boolean;
  selectedCompany?: string;
  lastSyncAt?: string | null;
  historySyncInProgress?: boolean;
  nextHistoryFrom?: string | null;
}): Promise<TenantConnectorRecord> {
  if (!db) throw new Error("PostgreSQL is required for connector heartbeat.");
  await ensureConnectorTables();
  const rows = await db.transaction(async (tx) => {
    const updated = (await tx.execute(sql`
      UPDATE tenant_connectors
      SET machine_name = COALESCE(${input.machineName || null}, machine_name),
          agent_version = COALESCE(${input.agentVersion || null}, agent_version),
          last_seen_at = now(),
          last_heartbeat_at = now(),
          last_tally_available = ${input.tallyAvailable},
          selected_company = COALESCE(${input.selectedCompany || null}, selected_company),
          last_sync_at = COALESCE(${input.lastSyncAt || null}::timestamptz, last_sync_at),
          history_sync_in_progress = ${input.historySyncInProgress === true},
          next_history_from = ${input.nextHistoryFrom || null}::date,
          updated_at = now()
      WHERE id = ${input.connectorId}
        AND org_id = ${input.orgId}
        AND status = 'active'
        AND revoked_at IS NULL
      RETURNING *
    `)) as unknown as Row[];
    if (!updated[0]) return updated;

    await tx.execute(sql`
      INSERT INTO connector_heartbeats (
        id, org_id, connector_id, machine_name, agent_version,
        tally_available, selected_company, last_sync_at, history_sync_in_progress,
        next_history_from, created_at
      )
      VALUES (
        ${randomUUID()}, ${input.orgId}, ${input.connectorId}, ${input.machineName || null},
        ${input.agentVersion || null}, ${input.tallyAvailable}, ${input.selectedCompany || null},
        ${input.lastSyncAt || null}::timestamptz, ${input.historySyncInProgress === true},
        ${input.nextHistoryFrom || null}::date, now()
      )
    `);
    return updated;
  });
  if (!rows[0]) throw new Error("Connector is not active.");
  return toConnector(rows[0]);
}

export async function listConnectorsForOrg(orgId: string, provider: ConnectorProvider = DEFAULT_PROVIDER): Promise<TenantConnectorRecord[]> {
  if (!db) return [];
  await ensureConnectorTables();
  const rows = (await db.execute(sql`
    SELECT *
    FROM tenant_connectors
    WHERE org_id = ${orgId}
      AND provider = ${provider}
    ORDER BY updated_at DESC
  `)) as unknown as Row[];
  return rows.map(toConnector);
}

export async function getLatestConnectorForOrg(orgId: string, provider: ConnectorProvider = DEFAULT_PROVIDER): Promise<TenantConnectorRecord | null> {
  const rows = await listConnectorsForOrg(orgId, provider);
  return rows[0] ?? null;
}

export async function revokeConnector(input: {
  connectorId: string;
  orgId: string;
  actor: ConnectorActor;
  reason?: string;
}): Promise<TenantConnectorRecord> {
  if (!db) throw new Error("PostgreSQL is required to revoke a connector.");
  await ensureConnectorTables();
  const rows = await db.transaction(async (tx) => {
    const updated = (await tx.execute(sql`
      UPDATE tenant_connectors
      SET status = 'revoked',
          revoked_at = now(),
          updated_at = now()
      WHERE id = ${input.connectorId}
        AND org_id = ${input.orgId}
      RETURNING *
    `)) as unknown as Row[];
    if (!updated[0]) return updated;

    await tx.execute(sql`
      UPDATE connector_refresh_tokens
      SET revoked_at = now()
      WHERE connector_id = ${input.connectorId}
        AND revoked_at IS NULL
    `);
    await tx.execute(sql`
      INSERT INTO connector_revocations (
        id, org_id, connector_id, actor_type, actor_id, reason, revoked_at, created_at
      )
      VALUES (
        ${randomUUID()}, ${input.orgId}, ${input.connectorId}, ${input.actor.type},
        ${input.actor.id}, ${input.reason || null}, now(), now()
      )
    `);

    return updated;
  });
  if (!rows[0]) throw new Error("Connector was not found.");
  await insertAudit(input.orgId, input.connectorId, input.actor, "connector_revoked", {
    ...(input.reason ? { reason: input.reason } : {}),
  });
  return toConnector(rows[0]);
}

export async function startConnectorSyncJob(input: {
  orgId: string;
  connectorId?: string | null;
  provider?: ConnectorProvider;
  syncId?: string | null;
  companyName?: string;
  companyGuid?: string;
  syncFrom?: string;
  syncTo?: string;
}): Promise<string | null> {
  if (!db) return null;
  await ensureConnectorTables();
  const id = randomUUID();
  await db.execute(sql`
    INSERT INTO connector_sync_jobs (
      id, org_id, connector_id, provider, sync_id, company_name, company_guid,
      status, record_count, message, sync_from, sync_to, started_at
    )
    VALUES (
      ${id}, ${input.orgId}, ${input.connectorId || null}, ${input.provider ?? DEFAULT_PROVIDER},
      ${input.syncId || null}, ${input.companyName || null}, ${input.companyGuid || null},
      'running', 0, null, ${input.syncFrom || null}, ${input.syncTo || null}, now()
    )
  `);
  return id;
}

export async function completeConnectorSyncJob(input: {
  jobId?: string | null;
  orgId: string;
  connectorId?: string | null;
  status: ConnectorSyncJobStatus;
  recordCount?: number;
  message?: string | null;
  completedAt?: string;
  lastSyncAt?: string | null;
}): Promise<void> {
  if (!db || !input.jobId) return;
  await ensureConnectorTables();
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE connector_sync_jobs
      SET status = ${input.status},
          record_count = ${Math.max(0, input.recordCount ?? 0)},
          message = ${input.message || null},
          completed_at = ${input.completedAt || new Date().toISOString()}
      WHERE id = ${input.jobId}
        AND org_id = ${input.orgId}
    `);
    if (input.connectorId && input.lastSyncAt && input.status === "stored") {
      await tx.execute(sql`
        UPDATE tenant_connectors
        SET last_sync_at = ${input.lastSyncAt}::timestamptz,
            last_seen_at = now(),
            updated_at = now()
        WHERE id = ${input.connectorId}
      `);
    }
  });
}

export async function listConnectorSyncJobs(orgId: string, limit = 10): Promise<ConnectorSyncJobRecord[]> {
  if (!db) return [];
  await ensureConnectorTables();
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const rows = (await db.execute(sql`
    SELECT *
    FROM connector_sync_jobs
    WHERE org_id = ${orgId}
    ORDER BY started_at DESC
    LIMIT ${safeLimit}
  `)) as unknown as Row[];
  return rows.map(toSyncJob);
}
