import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(filename) {
  const file = path.resolve(filename);
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');

const integer = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function testMfaAccounts(value){
 if(!value)return [];
 let entries;try{entries=JSON.parse(value);}catch{throw new Error('MFA_TEST_EXEMPT_ACCOUNTS must be a JSON array.');}
 if(!Array.isArray(entries)||entries.length>20||entries.some(e=>!e||!Number.isSafeInteger(e.userId)||e.userId<1||typeof e.email!=='string'||!/^[^@\s]+@test\.local$/.test(e.email)||typeof e.expiresAt!=='string'||!Number.isFinite(Date.parse(e.expiresAt))))throw new Error('Test MFA exceptions require at most 20 exact fictional account IDs, emails and expiry timestamps.');
 if(new Set(entries.map(e=>e.userId)).size!==entries.length||new Set(entries.map(e=>e.email)).size!==entries.length)throw new Error('Test MFA exception entries must be unique.');
 return entries;
}

export function getConfig(overrides = {}) {
  const databaseUrl = String(process.env.DATABASE_URL || '').trim().replace(/^DATABASE_URL\s*=/i, '').trim();
  const config = {
    host: process.env.HOST || '127.0.0.1',
    port: integer(process.env.PORT, 3000),
    localReviewAccess: process.env.LOCAL_REVIEW_ACCESS === 'true',
    emailAutomationEnabled: process.env.EMAIL_AUTOMATION_ENABLED === 'true',
    emailAutomationDataMode: process.env.EMAIL_AUTOMATION_DATA_MODE === 'stored' ? 'stored' : 'mock',
    tallyOrderComparisonEnabled: process.env.TALLY_ORDER_COMPARISON_ENABLED === 'true',
    databaseUrl,
    tallyConnectorOrgId: process.env.TALLY_CONNECTOR_ORG_ID || 'mehta-electronics',
    tallyStalledRunMinutes: Math.max(1, integer(process.env.TALLY_STALLED_RUN_MINUTES, 30)),
    tallyFinancialRoles: (process.env.TALLY_FINANCIAL_ROLES || 'OWNER,ACCOUNTS').split(',').map(role=>role.trim().toUpperCase()),
    sessionTtlMinutes: integer(process.env.SESSION_TTL_MINUTES, 480),
    tallyUrl: process.env.TALLY_URL || 'http://127.0.0.1:9000',
    tallyCompany: process.env.TALLY_COMPANY || 'Mehta Electronics',
    tallyTimeoutMs: integer(process.env.TALLY_TIMEOUT_MS, 10_000),
    tallyMaxRetries: integer(process.env.TALLY_MAX_RETRIES, 3),
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
    appEncryptionKey: process.env.APP_ENCRYPTION_KEY || '',
    mfaEnabled: String(process.env.MFA_ENABLED ?? 'false').toLowerCase() === 'true',
    mfaTestExemptUserId: integer(process.env.MFA_TEST_EXEMPT_USER_ID, 0),
    mfaTestExemptEmail: String(process.env.MFA_TEST_EXEMPT_EMAIL || '').trim().toLowerCase(),
    mfaTestExemptAccounts: testMfaAccounts(process.env.MFA_TEST_EXEMPT_ACCOUNTS),
    schedulerEnabled: String(process.env.SCHEDULER_ENABLED ?? 'true').toLowerCase() !== 'false',
    isProduction: process.env.NODE_ENV === 'production',
    ...overrides,
    tallyFinancialRoles: (overrides.tallyFinancialRoles || (process.env.TALLY_FINANCIAL_ROLES || 'OWNER,ACCOUNTS').split(',').map(role=>role.trim().toUpperCase()))
      .filter(role=>['OWNER','ACCOUNTS'].includes(role))
  };
  if ((config.isProduction || process.env.NODE_ENV === 'production') && config.localReviewAccess) {
    throw Object.assign(new Error('ControlDesk cannot start in production with LOCAL_REVIEW_ACCESS=true. Set LOCAL_REVIEW_ACCESS=false and use normal staff authentication.'), { code: 'LOCAL_REVIEW_PRODUCTION_FORBIDDEN' });
  }
  if ((config.isProduction || process.env.NODE_ENV === 'production') && !config.mfaEnabled) {
    throw Object.assign(new Error('ControlDesk production requires MFA_ENABLED=true. Enroll required staff through the normal two-factor setup before business access.'), {code:'MFA_PRODUCTION_REQUIRED'});
  }
  if ((config.isProduction || process.env.NODE_ENV === 'production') && Buffer.from(String(config.appEncryptionKey),'base64').length !== 32) {
    throw Object.assign(new Error('ControlDesk production requires APP_ENCRYPTION_KEY to be a base64-encoded 32-byte key for two-factor secrets.'),{code:'MFA_ENCRYPTION_KEY_REQUIRED'});
  }
  return config;
}
