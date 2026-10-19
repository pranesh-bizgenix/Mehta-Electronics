import crypto from 'node:crypto';
import { markStalledRuns } from './tally-import.js';
import { connectPostgres } from './postgres.js';

const requiredFields = ['vouchersXml', 'stockXml', 'balanceSheetXml', 'profitAndLossXml', 'billsReceivableXml', 'billsPayableXml', 'ledgersXml', 'groupsXml'];
const supportedFields = new Set([...requiredFields, 'salesRegisterXml', 'purchaseRegisterXml', 'dayBookReportXml', 'trialBalanceXml', 'cashBankControlXml', 'stockSummaryReportXml']);

export function connectorConnectionState(connector, now = Date.now()) {
  if (connector.status === 'revoked' || connector.revoked_at) return 'revoked';
  if (connector.status === 'error') return 'error';
  if (connector.pairing_expires_at) return new Date(connector.pairing_expires_at).getTime() > now ? 'awaiting_pairing' : 'pairing_expired';
  if (!connector.last_seen_at) return 'awaiting_connection';
  const seen = connector.heartbeat_at || connector.last_seen_at;
  if (now - new Date(seen).getTime() > 3 * 60_000) return 'offline';
  if (connector.tally_available === false) return 'tally_unavailable';
  if (connector.tally_available === true && !connector.selected_company) return 'awaiting_company';
  return connector.last_sync_at ? 'connected' : 'awaiting_first_sync';
}
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const clean = (value, max = 300) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const sameCompany = (left, right) => clean(left).toLowerCase() === clean(right).toLowerCase();
const tokenPair = () => ({
  accessToken: crypto.randomBytes(32).toString('base64url'),
  refreshToken: crypto.randomBytes(48).toString('base64url')
});
const tokenTimes = () => ({
  accessExpiresAt: new Date(Date.now() + 15 * 60_000),
  refreshExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60_000)
});
const invalidRefreshToken = () => {
  const error = new Error('Refresh token is invalid or has expired.');
  error.status = 401;
  return error;
};

export function assembleChunkFields(rows, fieldsToRequire = requiredFields) {
  const byField = new Map();
  for (const row of rows) {
    if (!byField.has(row.field_name)) byField.set(row.field_name, []);
    byField.get(row.field_name).push(row);
  }
  const missing = fieldsToRequire.filter((field) => !byField.has(field));
  if (missing.length) {
    const error = new Error(`Snapshot is incomplete: ${missing.join(', ')}.`);
    error.status = 422;
    throw error;
  }
  const fields = {};
  for (const [field, chunks] of byField) {
    chunks.sort((left, right) => left.sequence - right.sequence);
    if (chunks.some((chunk, index) => chunk.sequence !== index)) {
      const error = new Error(`Snapshot has missing or duplicate chunks for ${field}.`);
      error.status = 422;
      throw error;
    }
    fields[field] = chunks.map((chunk) => chunk.content).join('');
  }
  return fields;
}

export function createConnectorStore(config) {
  const sql = config.databaseUrl ? connectPostgres(config.databaseUrl, { schema: config.databaseSchema, postgresOptions: { max: 3 } }) : null;
  const requireDb = () => { if (!sql) { const error = new Error('PostgreSQL is not configured. Set DATABASE_URL before using the Tally Connector.'); error.status = 503; throw error; } return sql; };

  return {
    async close() { if (sql) await sql.end({ timeout: 2 }); },
    async health() { await requireDb()`SELECT 1`; return { status: 'ok' }; },
    async setup({ profileName, companyName }) {
      const database = requireDb(); const profile = clean(profileName, 120); const company = clean(companyName);
      if (!profile || !company) { const error = new Error('Connector profile name and exact Tally company name are required.'); error.status = 422; throw error; }
      const id = crypto.randomUUID(); const token = crypto.randomBytes(32).toString('base64url');
      await database`INSERT INTO tally_connectors (id, profile_name, expected_company_name, token_hash)
        VALUES (${id}, ${profile}, ${company}, ${hash(token)})`;
      return { id, profileName: profile, companyName: company, token, orgId: config.tallyConnectorOrgId };
    },
    async createPairingCode({ profileName, companyName, apiBaseUrl }) {
      const database = requireDb(); const profile = clean(profileName, 120); const company = clean(companyName);
      if (!profile || !company) { const error = new Error('Connector profile name and exact Tally company name are required.'); error.status = 422; throw error; }
      let apiUrl;
      try {
        apiUrl = new URL(apiBaseUrl);
        if (!['https:', 'http:'].includes(apiUrl.protocol) || (apiUrl.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(apiUrl.hostname))) throw new Error();
      } catch {
        const error = new Error('A valid HTTPS CRM URL is required for pairing.');
        error.status = 422;
        throw error;
      }
      const id = crypto.randomUUID();
      const pairingCode = `BGX-${String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')}`;
      const expiresAt = new Date(Date.now() + 10 * 60_000);
      const unusedLegacyTokenHash = hash(crypto.randomBytes(32).toString('base64url'));
      const cleanApiUrl = apiUrl.origin;
      await database`INSERT INTO tally_connectors (id, profile_name, expected_company_name, token_hash, pairing_code_hash, pairing_expires_at, api_base_url)
        VALUES (${id}, ${profile}, ${company}, ${unusedLegacyTokenHash}, ${hash(pairingCode)}, ${expiresAt}, ${cleanApiUrl})`;
      return { id, profileName: profile, companyName: company, pairingCode, apiBaseUrl: cleanApiUrl, expiresAt: expiresAt.toISOString() };
    },
    async pair(body) {
      const database = requireDb();
      const code = clean(body.pairingCode, 20).toUpperCase();
      const installationId = clean(body.installationId, 200);
      const machineName = clean(body.machineName, 255) || null;
      const agentVersion = clean(body.agentVersion, 100);
      if (!/^BGX-\d{6}$/.test(code) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installationId) || !machineName || !agentVersion) {
        const error = new Error('Invalid or expired pairing code.');
        error.status = 401;
        throw error;
      }
      const found = await database`SELECT id,profile_name,api_base_url FROM tally_connectors
        WHERE pairing_code_hash=${hash(code)} AND pairing_expires_at > now() AND status='active' AND revoked_at IS NULL`;
      if (!found.length) {
        const error = new Error('Invalid or expired pairing code.');
        error.status = 401;
        throw error;
      }
      const { accessToken, refreshToken } = tokenPair();
      const { accessExpiresAt, refreshExpiresAt } = tokenTimes();
      const profileName = clean(body.profileName, 120) || found[0].profile_name;
      const paired = await database.begin(async (tx) => {
        const result = await tx`UPDATE tally_connectors SET
            profile_name=${profileName}, installation_id=${installationId}, machine_name=${machineName}, agent_version=${agentVersion},
            pairing_code_hash=NULL, pairing_expires_at=NULL, access_token_hash=${hash(accessToken)},
            refresh_token_hash=${hash(refreshToken)}, access_token_expires_at=${accessExpiresAt},
            refresh_token_expires_at=${refreshExpiresAt}, last_seen_at=now()
          WHERE id=${found[0].id} AND pairing_code_hash=${hash(code)} AND pairing_expires_at > now()
            AND status='active' AND revoked_at IS NULL
          RETURNING id`;
        if (result.length) {
          await tx`UPDATE tally_connectors SET status='revoked',revoked_at=now()
            WHERE installation_id=${installationId} AND id<>${result[0].id} AND status='active' AND revoked_at IS NULL`;
        }
        return result;
      });
      if (!paired.length) {
        const error = new Error('Invalid or expired pairing code.');
        error.status = 401;
        throw error;
      }
      return {
        ok: true,
        connectorId: paired[0].id,
        accessToken,
        accessTokenExpiresAt: accessExpiresAt.toISOString(),
        refreshToken,
        apiBaseUrl: found[0].api_base_url,
        syncIntervalSeconds: 3600,
        heartbeatIntervalSeconds: 60,
        historyFinancialYears: 6
      };
    },
    async refresh(refreshToken) {
      const database = requireDb(); const token = clean(refreshToken, 512);
      if (!token) throw invalidRefreshToken();
      const rows = await database`SELECT id FROM tally_connectors
        WHERE refresh_token_hash=${hash(token)} AND refresh_token_expires_at > now()
          AND status='active' AND revoked_at IS NULL`;
      if (!rows.length) throw invalidRefreshToken();
      const { accessToken, refreshToken: nextRefreshToken } = tokenPair();
      const { accessExpiresAt, refreshExpiresAt } = tokenTimes();
      const rotated = await database`UPDATE tally_connectors SET access_token_hash=${hash(accessToken)},
          refresh_token_hash=${hash(nextRefreshToken)}, access_token_expires_at=${accessExpiresAt},
          refresh_token_expires_at=${refreshExpiresAt}, last_seen_at=now()
        WHERE id=${rows[0].id} AND refresh_token_hash=${hash(token)}
          AND refresh_token_expires_at > now() AND status='active' AND revoked_at IS NULL
        RETURNING id`;
      if (!rotated.length) throw invalidRefreshToken();
      return {
        ok: true,
        connectorId: rotated[0].id,
        accessToken,
        accessTokenExpiresAt: accessExpiresAt.toISOString(),
        refreshToken: nextRefreshToken,
        syncIntervalSeconds: 3600,
        heartbeatIntervalSeconds: 60,
        historyFinancialYears: 6
      };
    },
    async status() {
      const database = requireDb();
      await markStalledRuns(database,config.tallyStalledRunMinutes || 30);
      const connectors = await database`SELECT c.id,c.profile_name,c.expected_company_name,c.machine_name,c.agent_version,c.status,c.created_at,c.last_seen_at,c.last_sync_at,c.revoked_at,c.pairing_expires_at,
        h.tally_available,h.selected_company,h.open_companies,h.updated_at AS heartbeat_at
        FROM tally_connectors c LEFT JOIN tally_connector_heartbeats h ON h.connector_id=c.id ORDER BY c.created_at DESC`;
      const jobs = await database`SELECT id,connector_id,company_name,company_guid,status,message,record_count,started_at,completed_at FROM tally_sync_jobs ORDER BY started_at DESC LIMIT 20`;
      return { connectors: connectors.map(connector => ({ ...connector, connection_state: connectorConnectionState(connector) })), jobs };
    },
    async revoke(id) { const database = requireDb(); const result = await database`UPDATE tally_connectors SET status='revoked',revoked_at=now() WHERE id=${id} AND status='active' RETURNING id`; if (!result.length) { const error = new Error('Active connector not found.'); error.status = 404; throw error; } },
    async authenticate(headers) {
      const database = requireDb();
      const authorization = clean(headers.authorization, 600);
      const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
      if (authorization && !bearer) { const error = new Error('Invalid connector credentials.'); error.status = 401; throw error; }
      if (bearer) {
        const rows = await database`SELECT * FROM tally_connectors WHERE access_token_hash=${hash(bearer)}
          AND access_token_expires_at > now() AND status='active' AND revoked_at IS NULL LIMIT 1`;
        if (!rows.length) { const error = new Error('Invalid or expired connector access token.'); error.status = 401; throw error; }
        return rows[0];
      }
      const token = clean(headers['x-gi-token'], 512); const orgId = clean(headers['x-gi-org'], 120);
      if (!token || orgId !== config.tallyConnectorOrgId) { const error = new Error('Invalid connector credentials.'); error.status = 401; throw error; }
      const rows = await database`SELECT * FROM tally_connectors WHERE token_hash=${hash(token)} AND status='active' AND revoked_at IS NULL LIMIT 1`;
      if (!rows.length) { const error = new Error('Invalid connector credentials.'); error.status = 401; throw error; }
      return rows[0];
    },
    async heartbeat(connector, body) {
      const database = requireDb(); const machine = clean(body.machineName, 255) || null; const selected = clean(body.selectedCompany) || null;
      const agentVersion = clean(body.agentVersion, 100) || null;
      const open = Array.isArray(body.openCompanies) ? body.openCompanies.map((item) => clean(item)).filter(Boolean).slice(0, 100) : [];
      if (selected && !sameCompany(selected, connector.expected_company_name)) { const error = new Error('Connector is bound to a different Tally company.'); error.status = 403; throw error; }
      const lastSyncAt = body.lastSyncAt && !Number.isNaN(Date.parse(body.lastSyncAt)) ? new Date(body.lastSyncAt) : null;
      await database.begin(async (tx) => {
        await tx`UPDATE tally_connectors SET machine_name=${machine},agent_version=COALESCE(${agentVersion},agent_version),
          last_seen_at=now(),last_sync_at=COALESCE(${lastSyncAt},last_sync_at) WHERE id=${connector.id}`;
        await tx`INSERT INTO tally_connector_heartbeats (connector_id,tally_available,selected_company,open_companies,last_sync_at,updated_at)
          VALUES (${connector.id},${body.tallyAvailable === true},${selected},${JSON.stringify(open)}::jsonb,${lastSyncAt},now())
          ON CONFLICT (connector_id) DO UPDATE SET tally_available=EXCLUDED.tally_available,selected_company=EXCLUDED.selected_company,open_companies=EXCLUDED.open_companies,last_sync_at=EXCLUDED.last_sync_at,updated_at=now()`;
      });
      return {
        ok: true,
        connectorId: connector.id,
        syncIntervalSeconds: 3600,
        heartbeatIntervalSeconds: 60,
        historyFinancialYears: 6,
        lastSeenAt: new Date().toISOString(),
        lastSyncAt: lastSyncAt?.toISOString() ?? null
      };
    },
    async start(connector, body) {
      const database = requireDb(); const company = clean(body.companyName || body.company); const from = clean(body.syncFrom || body.from, 10); const to = clean(body.syncTo || body.to, 10);
      const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
      if (!sameCompany(company, connector.expected_company_name) || !validDate(from) || !validDate(to) || from > to) { const error = new Error('Invalid company or sync window.'); error.status = 422; throw error; }
      const sessionId = crypto.randomUUID();
      let jobId = clean(body.syncJobId, 80);
      if (jobId) {
        const existing = await database`SELECT id,status FROM tally_sync_jobs
          WHERE id=${jobId} AND connector_id=${connector.id} AND company_name=${company}`;
        if (!existing.length) { const error = new Error('Sync job is unavailable.'); error.status = 404; throw error; }
        const stored=await database`SELECT id FROM tally_upload_sessions WHERE sync_job_id=${jobId} AND connector_id=${connector.id}
          AND company_name=${company} AND sync_from=${from} AND sync_to=${to} AND status='stored' ORDER BY completed_at DESC LIMIT 1`;
        if(stored.length)return {sessionId:stored[0].id,syncJobId:jobId};
        await database`UPDATE tally_sync_jobs SET status='running',last_progress_at=now(),completed_at=NULL WHERE id=${jobId}`;
      } else {
        jobId = crypto.randomUUID();
      }
      await database.begin(async (tx) => {
        if (!body.syncJobId) await tx`INSERT INTO tally_sync_jobs(id,connector_id,company_name,company_guid,status) VALUES(${jobId},${connector.id},${company},${clean(body.companyGuid)||null},'running')`;
        await tx`INSERT INTO tally_upload_sessions(id,connector_id,sync_job_id,sync_id,company_name,company_guid,sync_from,sync_to,status)
          VALUES(${sessionId},${connector.id},${jobId},${clean(body.syncId, 200)||null},${company},${clean(body.companyGuid)||null},${from},${to},'receiving')`;
      });
      return { sessionId, syncJobId: jobId };
    },
    async startJob(connector, body) {
      const database = requireDb(); const company = clean(body.companyName); const from = clean(body.syncFrom, 10); const to = clean(body.syncTo, 10);
      const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
      if (!sameCompany(company, connector.expected_company_name) || !validDate(from) || !validDate(to) || from > to) { const error = new Error('Invalid company or sync window.'); error.status = 422; throw error; }
      const jobId = crypto.randomUUID();
      await database`INSERT INTO tally_sync_jobs(id,connector_id,company_name,company_guid,status)
        VALUES(${jobId},${connector.id},${company},${clean(body.companyGuid)||null},'running')`;
      return { syncJobId: jobId };
    },
    async progress(connector, body) {
      const database = requireDb(); const percent = Number(body.progressPct); const count = Number(body.recordCount);
      const rows = await database`UPDATE tally_sync_jobs SET last_progress_at=now(),record_count=CASE WHEN ${Number.isInteger(count) && count >= 0} THEN ${count} ELSE record_count END,
        message=${clean(body.progressStep || body.message, 500) || null} WHERE id=${body.jobId} AND connector_id=${connector.id} AND status='running' RETURNING id`;
      if (!rows.length) { const error = new Error('Sync job is unavailable.'); error.status = 404; throw error; }
      return { progressPct: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null };
    },
    async completeJob(connector, body) {
      const database = requireDb(); const jobId = clean(body.jobId, 80); const status = clean(body.status, 30).toLowerCase();
      const finalStatus = status === 'succeeded' || status === 'success' ? 'stored' : status;
      if (!['stored', 'failed', 'quarantined'].includes(finalStatus)) { const error = new Error('Invalid sync job completion status.'); error.status = 422; throw error; }
      const count = Number(body.recordCount);
      const recordCount = Number.isInteger(count) && count >= 0 ? count : null;
      const message = clean(body.message, 500) || null;
      const lastSyncAt = body.lastSyncAt && !Number.isNaN(Date.parse(body.lastSyncAt)) ? new Date(body.lastSyncAt) : null;
      const rows = await database`UPDATE tally_sync_jobs SET status=${finalStatus},
          record_count=COALESCE(${recordCount},record_count),message=${message},completed_at=now()
        WHERE id=${jobId} AND connector_id=${connector.id} AND status='running' RETURNING id`;
      if (!rows.length) { const error = new Error('Sync job is unavailable.'); error.status = 404; throw error; }
      if (finalStatus === 'stored') await database`UPDATE tally_connectors SET last_seen_at=now(),last_sync_at=COALESCE(${lastSyncAt},now()) WHERE id=${connector.id}`;
      return { ok: true };
    },
    async append(connector, body) {
      const database = requireDb(); const field = clean(body.field, 80); const sequence = Number(body.sequence); const content = String(body.content || '');
      if (!supportedFields.has(field) || !Number.isInteger(sequence) || sequence < 0 || sequence > 100_000 || content.length > 6_000_000) { const error = new Error('Invalid upload chunk.'); error.status = 422; throw error; }
      const stored=await database`SELECT id FROM tally_upload_sessions WHERE id=${body.sessionId} AND connector_id=${connector.id} AND status='stored'`;
      if(stored.length){
        const prior=await database`SELECT content FROM tally_upload_chunks WHERE session_id=${body.sessionId} AND field_name=${field} AND sequence=${sequence}`;
        if(prior[0]?.content===content)return;
        const error=new Error('Stored upload differs from retried chunk; create a new sync session.');error.status=409;throw error;
      }
      const session = await database`SELECT id FROM tally_upload_sessions WHERE id=${body.sessionId} AND connector_id=${connector.id} AND status='receiving'`;
      if (!session.length) { const error = new Error('Upload session is unavailable.'); error.status = 404; throw error; }
      await database`INSERT INTO tally_upload_chunks(session_id,field_name,sequence,content) VALUES(${body.sessionId},${field},${sequence},${content}) ON CONFLICT(session_id,field_name,sequence) DO UPDATE SET content=EXCLUDED.content`;
      await database`UPDATE tally_sync_jobs SET last_progress_at=now() WHERE id=(SELECT sync_job_id FROM tally_upload_sessions WHERE id=${body.sessionId}) AND status='running'`;
    },
  };
}
