import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile() {
  const file = path.resolve('.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

loadEnvFile();

const integer = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function getConfig(overrides = {}) {
  return {
    host: process.env.HOST || '127.0.0.1',
    port: integer(process.env.PORT, 3000),
    databasePath: process.env.DATABASE_PATH || path.resolve('data/crm.db'),
    sessionTtlMinutes: integer(process.env.SESSION_TTL_MINUTES, 480),
    tallyUrl: process.env.TALLY_URL || 'http://127.0.0.1:9000',
    tallyCompany: process.env.TALLY_COMPANY || 'Mehta Electronics',
    tallyTimeoutMs: integer(process.env.TALLY_TIMEOUT_MS, 10_000),
    tallyMaxRetries: integer(process.env.TALLY_MAX_RETRIES, 3),
    seedOwnerEmail: process.env.SEED_OWNER_EMAIL || 'owner@mehtaelectronics.local',
    seedOwnerPassword: process.env.SEED_OWNER_PASSWORD || 'ChangeMe123!',
    companyName: process.env.COMPANY_NAME || 'Mehta Electronics',
    companyAddress: process.env.COMPANY_ADDRESS || 'Authorised industrial automation and electrical solutions',
    companyGstin: process.env.COMPANY_GSTIN || '',
    companyEmail: process.env.COMPANY_EMAIL || 'sales@mehtaelectronics.local',
    companyPhone: process.env.COMPANY_PHONE || '',
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: integer(process.env.SMTP_PORT, 587),
    smtpSecure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    smtpUser: process.env.SMTP_USER || '',
    smtpPassword: process.env.SMTP_PASSWORD || '',
    smtpFrom: process.env.SMTP_FROM || '',
    isProduction: process.env.NODE_ENV === 'production',
    ...overrides
  };
}
