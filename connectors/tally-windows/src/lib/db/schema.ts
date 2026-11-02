// ─────────────────────────────────────────────────────────────────────────
// Growth Intelligence — V1 multi-tenant accounting schema (Postgres / Drizzle).
//
// Design notes:
//  - Tenancy: org → companies. An org (a business, or a CA firm) owns one or
//    many companies (multi-unit / client books). EVERYTHING is scoped by
//    companyId, and indexed on it, so a single query never crosses tenants.
//  - Modelled on real Tally/Zoho entities (ledgers, vouchers, bills, GST,
//    stock movements) — not just sales + inventory — so insights can drill
//    down to the exact invoice / ledger / bill.
//  - `source` + `externalId` + `alterId` on every imported row → idempotent,
//    incremental sync (Tally AlterID / Zoho ids), no duplicates on re-sync.
// ─────────────────────────────────────────────────────────────────────────
import {
  pgTable,
  uuid,
  text,
  numeric,
  integer,
  bigint,
  date,
  timestamp,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

const money = (n: string) => numeric(n, { precision: 16, scale: 2 });
const ts = (name?: string) => name ? timestamp(name, { withTimezone: true }) : timestamp({ withTimezone: true });
export const organizations = pgTable("organizations", {
  id: text().primaryKey(),
  name: text().notNull(),
  dbUrl: text("db_url").notNull().default(""),
  dbProvider: text("db_provider").notNull().default("shared-postgres"),
  createdAt: ts().defaultNow(),
});

// ── Tenancy & identity ───────────────────────────────────────────────────
export const orgs = pgTable("orgs", {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  plan: text().default("plus"), // plus | growth | command
  createdAt: ts().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid().defaultRandom().primaryKey(),
  email: text().notNull().unique(),
  name: text().notNull(),
  passwordHash: text(), // null when using OAuth/magic-link
  createdAt: ts().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid().notNull().references(() => orgs.id, { onDelete: "cascade" }),
    role: text().notNull().default("owner"), // owner | admin | analyst | viewer
    createdAt: ts().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] })],
);

// A business/company whose books we analyse (Tally company, Zoho org, etc.)
export const companies = pgTable(
  "companies",
  {
    id: uuid().defaultRandom().primaryKey(),
    orgId: uuid().notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text().notNull(),
    gstin: text(),
    industry: text(),
    state: text(),
    currency: text().default("INR"),
    source: text().default("manual"), // tally | zoho | quickbooks | excel | manual
    tallyGuid: text(), // Tally company GUID for stable identity across syncs
    createdAt: ts().defaultNow(),
  },
  (t) => [index("companies_org_idx").on(t.orgId)],
);

export const connections = pgTable(
  "connections",
  {
    id: uuid().defaultRandom().primaryKey(),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    provider: text().notNull(), // tally | zoho | quickbooks | excel
    status: text().default("disconnected"), // connected | disconnected | error
    config: jsonb().$type<Record<string, unknown>>().default({}),
    lastSyncedAt: ts(),
    lastAlterId: bigint({ mode: "number" }).default(0), // Tally incremental cursor
    createdAt: ts().defaultNow(),
  },
  (t) => [index("connections_company_idx").on(t.companyId)],
);

export const syncRuns = pgTable("sync_runs", {
  id: uuid().defaultRandom().primaryKey(),
  connectionId: uuid().notNull().references(() => connections.id, { onDelete: "cascade" }),
  startedAt: ts().defaultNow(),
  finishedAt: ts(),
  status: text().default("running"), // running | ok | error
  recordsPulled: integer().default(0),
  error: text(),
});

export const tenantDatabaseConnections = pgTable("tenant_database_connections", {
  tenantId: text("tenant_id").primaryKey(),
  dbUrl: text("db_url").notNull().default(""),
  dbProvider: text("db_provider").notNull().default("shared-postgres"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: ts().defaultNow(),
  updatedAt: ts().defaultNow(),
});

export const connectorPairingCodes = pgTable(
  "connector_pairing_codes",
  {
    id: text().primaryKey(),
    orgId: text("org_id").notNull(),
    provider: text().notNull().default("tally"),
    createdByEmail: text("created_by_email").notNull(),
    createdByName: text("created_by_name"),
    codeHash: text("code_hash").notNull(),
    status: text().notNull().default("active"),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: ts().defaultNow(),
  },
  (t) => [
    uniqueIndex("connector_pairing_codes_hash_uidx").on(t.codeHash),
    index("connector_pairing_codes_org_idx").on(t.orgId, t.provider, t.createdAt),
  ],
);

export const tenantConnectors = pgTable(
  "tenant_connectors",
  {
    id: text().primaryKey(),
    orgId: text("org_id").notNull(),
    provider: text().notNull().default("tally"),
    installationId: text("installation_id").notNull(),
    machineName: text("machine_name"),
    agentVersion: text("agent_version"),
    status: text().notNull().default("active"),
    syncIntervalSeconds: integer("sync_interval_seconds").notNull().default(3600),
    pairedAt: ts("paired_at").defaultNow(),
    lastSeenAt: ts("last_seen_at"),
    lastHeartbeatAt: ts("last_heartbeat_at"),
    lastSyncAt: ts("last_sync_at"),
    historySyncInProgress: boolean("history_sync_in_progress").notNull().default(false),
    nextHistoryFrom: date("next_history_from"),
    lastTallyAvailable: boolean("last_tally_available"),
    selectedCompany: text("selected_company"),
    revokedAt: ts("revoked_at"),
    createdAt: ts().defaultNow(),
    updatedAt: ts().defaultNow(),
  },
  (t) => [
    uniqueIndex("tenant_connectors_installation_uidx").on(t.provider, t.installationId),
    index("tenant_connectors_org_idx").on(t.orgId, t.provider, t.updatedAt),
  ],
);

export const connectorRefreshTokens = pgTable(
  "connector_refresh_tokens",
  {
    id: text().primaryKey(),
    orgId: text("org_id").notNull(),
    connectorId: text("connector_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: ts().defaultNow(),
  },
  (t) => [
    uniqueIndex("connector_refresh_tokens_hash_uidx").on(t.tokenHash),
    index("connector_refresh_tokens_connector_idx").on(t.connectorId, t.createdAt),
  ],
);

export const connectorSyncJobs = pgTable(
  "connector_sync_jobs",
  {
    id: text().primaryKey(),
    orgId: text("org_id").notNull(),
    connectorId: text("connector_id"),
    provider: text().notNull().default("tally"),
    syncId: text("sync_id"),
    companyName: text("company_name"),
    companyGuid: text("company_guid"),
    status: text().notNull().default("running"),
    recordCount: integer("record_count").notNull().default(0),
    message: text(),
    syncFrom: date("sync_from"),
    syncTo: date("sync_to"),
    startedAt: ts("started_at").defaultNow(),
    completedAt: ts("completed_at"),
  },
  (t) => [
    index("connector_sync_jobs_org_idx").on(t.orgId, t.startedAt),
    index("connector_sync_jobs_connector_idx").on(t.connectorId, t.startedAt),
  ],
);

export const connectorHeartbeats = pgTable(
  "connector_heartbeats",
  {
    id: text().primaryKey(),
    orgId: text("org_id").notNull(),
    connectorId: text("connector_id").notNull(),
    machineName: text("machine_name"),
    agentVersion: text("agent_version"),
    tallyAvailable: boolean("tally_available").notNull(),
    selectedCompany: text("selected_company"),
    lastSyncAt: ts("last_sync_at"),
    historySyncInProgress: boolean("history_sync_in_progress").notNull().default(false),
    nextHistoryFrom: date("next_history_from"),
    createdAt: ts().defaultNow(),
  },
  (t) => [
    index("connector_heartbeats_org_idx").on(t.orgId, t.createdAt),
    index("connector_heartbeats_connector_idx").on(t.connectorId, t.createdAt),
  ],
);

export const connectorRevocations = pgTable(
  "connector_revocations",
  {
    id: text().primaryKey(),
    orgId: text("org_id").notNull(),
    connectorId: text("connector_id").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    reason: text(),
    revokedAt: ts("revoked_at").notNull(),
    createdAt: ts().defaultNow(),
  },
  (t) => [
    index("connector_revocations_org_idx").on(t.orgId, t.createdAt),
    index("connector_revocations_connector_idx").on(t.connectorId, t.createdAt),
  ],
);

export const connectorAuditLogs = pgTable(
  "connector_audit_logs",
  {
    id: text().primaryKey(),
    orgId: text("org_id").notNull(),
    connectorId: text("connector_id"),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text().notNull(),
    detail: jsonb().$type<Record<string, unknown>>().default({}),
    createdAt: ts().defaultNow(),
  },
  (t) => [index("connector_audit_logs_org_idx").on(t.orgId, t.createdAt)],
);

// ── Master data ────────────────────────────────────────────────────────────
export const customers = pgTable(
  "customers",
  {
    id: uuid().defaultRandom().primaryKey(),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text().notNull(),
    gstin: text(),
    state: text(),
    creditDays: integer().default(0),
    externalId: text(), // ledger name / provider id
    createdAt: ts().defaultNow(),
  },
  (t) => [
    index("customers_company_idx").on(t.companyId),
    uniqueIndex("customers_company_ext_idx").on(t.companyId, t.externalId),
  ],
);

export const vendors = pgTable(
  "vendors",
  {
    id: uuid().defaultRandom().primaryKey(),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text().notNull(),
    gstin: text(),
    externalId: text(),
    createdAt: ts().defaultNow(),
  },
  (t) => [index("vendors_company_idx").on(t.companyId)],
);

export const products = pgTable(
  "products",
  {
    id: uuid().defaultRandom().primaryKey(),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text().notNull(),
    sku: text(),
    category: text(),
    unitCost: money("unit_cost").default("0"),
    sellingPrice: money("selling_price").default("0"),
    currentStock: numeric({ precision: 14, scale: 2 }).default("0"),
    reorderLevel: numeric({ precision: 14, scale: 2 }).default("0"),
    lastSaleDate: date(),
    externalId: text(),
    createdAt: ts().defaultNow(),
  },
  (t) => [index("products_company_idx").on(t.companyId)],
);

// ── Transactions ───────────────────────────────────────────────────────────
export const sales = pgTable(
  "sales",
  {
    id: uuid().defaultRandom().primaryKey(),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    invoiceNo: text().notNull(),
    date: date().notNull(),
    dueDate: date(),
    region: text(),
    amount: money("amount").notNull(),
    taxAmount: money("tax_amount").default("0"),
    igst: money("igst").default("0"),
    cgst: money("cgst").default("0"),
    sgst: money("sgst").default("0"),
    status: text().default("paid"), // paid | pending | overdue
    source: text().default("manual"),
    externalId: text(),
    alterId: bigint({ mode: "number" }),
    createdAt: ts().defaultNow(),
  },
  (t) => [
    index("sales_company_date_idx").on(t.companyId, t.date),
    index("sales_company_status_idx").on(t.companyId, t.status),
    uniqueIndex("sales_company_ext_idx").on(t.companyId, t.externalId),
  ],
);

export const saleLines = pgTable(
  "sale_lines",
  {
    id: uuid().defaultRandom().primaryKey(),
    saleId: uuid().notNull().references(() => sales.id, { onDelete: "cascade" }),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    productId: uuid().references(() => products.id, { onDelete: "set null" }),
    productName: text().notNull(),
    qty: numeric({ precision: 14, scale: 2 }).notNull(),
    rate: money("rate").default("0"),
    amount: money("amount").notNull(),
  },
  (t) => [index("sale_lines_sale_idx").on(t.saleId), index("sale_lines_company_idx").on(t.companyId)],
);

export const purchases = pgTable(
  "purchases",
  {
    id: uuid().defaultRandom().primaryKey(),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    vendorId: uuid().references(() => vendors.id, { onDelete: "set null" }),
    voucherNo: text().notNull(),
    date: date().notNull(),
    amount: money("amount").notNull(),
    taxAmount: money("tax_amount").default("0"),
    itcClaimed: money("itc_claimed").default("0"),
    source: text().default("manual"),
    externalId: text(),
    alterId: bigint({ mode: "number" }),
    createdAt: ts().defaultNow(),
  },
  (t) => [index("purchases_company_date_idx").on(t.companyId, t.date)],
);

// General ledger — the accounting truth, for cashflow & margin analyses.
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid().defaultRandom().primaryKey(),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    ledgerName: text().notNull(),
    ledgerGroup: text(), // Sundry Debtors / Creditors / Sales / Bank / etc.
    voucherType: text(),
    voucherNo: text(),
    date: date().notNull(),
    debit: money("debit").default("0"),
    credit: money("credit").default("0"),
    externalId: text(),
    alterId: bigint({ mode: "number" }),
  },
  (t) => [
    index("ledger_company_date_idx").on(t.companyId, t.date),
    index("ledger_company_group_idx").on(t.companyId, t.ledgerGroup),
  ],
);

export const vouchers = pgTable(
  "vouchers",
  {
    id: uuid().defaultRandom().primaryKey(),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    voucherType: text("voucher_type").notNull(),
    voucherNo: text("voucher_no").notNull(),
    date: date().notNull(),
    party: text(),
    narration: text(),
    amount: money("amount").notNull(),
    ledgerLines: jsonb("ledger_lines").$type<Array<Record<string, unknown>>>().default([]),
    inventoryLines: jsonb("inventory_lines").$type<Array<Record<string, unknown>>>().default([]),
    source: text().default("tally"),
    externalId: text(),
    alterId: bigint({ mode: "number" }),
    createdAt: ts().defaultNow(),
  },
  (t) => [
    index("vouchers_company_date_idx").on(t.companyId, t.date),
    index("vouchers_company_type_idx").on(t.companyId, t.voucherType),
    uniqueIndex("vouchers_company_ext_idx").on(t.companyId, t.externalId),
  ],
);

// Receipts / payments against bills.
export const payments = pgTable(
  "payments",
  {
    id: uuid().defaultRandom().primaryKey(),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    direction: text().notNull(), // received | paid
    party: text().notNull(),
    date: date().notNull(),
    amount: money("amount").notNull(),
    againstInvoice: text(),
    externalId: text(),
  },
  (t) => [index("payments_company_date_idx").on(t.companyId, t.date)],
);

// Open bills — receivables & payables with ageing.
export const bills = pgTable(
  "bills",
  {
    id: uuid().defaultRandom().primaryKey(),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    kind: text().notNull(), // receivable | payable
    party: text().notNull(),
    billNo: text(),
    billDate: date(),
    dueDate: date(),
    amount: money("amount").notNull(),
    outstanding: money("outstanding").notNull(),
    daysOverdue: integer().default(0),
    externalId: text(),
  },
  (t) => [index("bills_company_kind_idx").on(t.companyId, t.kind)],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid().defaultRandom().primaryKey(),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    productId: uuid().references(() => products.id, { onDelete: "set null" }),
    productName: text().notNull(),
    date: date().notNull(),
    direction: text().notNull(), // in | out
    qty: numeric({ precision: 14, scale: 2 }).notNull(),
    value: money("value").default("0"),
  },
  (t) => [index("stock_mov_company_idx").on(t.companyId, t.date)],
);

export const gstReturns = pgTable(
  "gst_returns",
  {
    id: uuid().defaultRandom().primaryKey(),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    returnType: text().notNull(), // GSTR1 | GSTR3B
    period: text().notNull(), // MM-YYYY
    dueDate: date(),
    status: text().default("pending"), // pending | filed | overdue
    taxLiability: money("tax_liability").default("0"),
    itcAvailable: money("itc_available").default("0"),
    netPayable: money("net_payable").default("0"),
  },
  (t) => [index("gst_company_idx").on(t.companyId)],
);

// ── Output: insights & delivery ──────────────────────────────────────────
export const insights = pgTable(
  "insights",
  {
    id: uuid().defaultRandom().primaryKey(),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    pack: text().notNull(),
    title: text().notNull(),
    soWhat: text().notNull(),
    impactInr: money("impact_inr").default("0"),
    severity: text().default("medium"),
    confidence: numeric({ precision: 3, scale: 2 }).default("0"),
    actionItems: jsonb().$type<string[]>().default([]),
    detail: jsonb().$type<Record<string, unknown>>().default({}),
    periodStart: date(),
    periodEnd: date(),
    delivered: boolean().default(false),
    createdAt: ts().defaultNow(),
  },
  (t) => [index("insights_company_idx").on(t.companyId, t.pack)],
);

export const digestConfigs = pgTable(
  "digest_configs",
  {
    id: uuid().defaultRandom().primaryKey(),
    companyId: uuid().notNull().references(() => companies.id, { onDelete: "cascade" }),
    channel: text().notNull(), // whatsapp | email
    provider: text().notNull(), // periskope | cloud | custom | resend
    endpoint: text(),
    apiKeyRef: text(), // reference to a secret, not the raw key
    destination: text(),
    schedule: text().default("0 9 * * 1"), // cron — Mondays 9am
    enabled: boolean().default(false),
    lastSentAt: ts(),
  },
  (t) => [index("digest_company_idx").on(t.companyId)],
);


