import { sql } from "drizzle-orm";
import { db, getTenantConfig } from "./client";

export interface TenantDatabaseResolution {
  orgId: string;
  mode: "shared" | "dedicated";
  dbUrl: string | null;
  dbProvider: string;
  source: "tenant_database_connections" | "organizations" | "default";
}

/**
 * Central resolver for future per-tenant databases. Today's pilot still writes
 * into the shared application database, but connector auth and ingest now go
 * through this resolver so the selection logic is server-owned.
 */
export async function resolveTenantDatabase(orgId: string): Promise<TenantDatabaseResolution> {
  const tenant = orgId.trim() || "default";
  if (db) {
    const routed = await db.execute(sql`
      SELECT db_url, db_provider
      FROM tenant_database_connections
      WHERE tenant_id = ${tenant}
        AND is_active = true
      LIMIT 1
    `).catch(() => []) as unknown as Array<{ db_url: string; db_provider: string }>;
    if (routed[0]) {
      const dbUrl = routed[0].db_url?.trim() || process.env.DATABASE_URL?.trim() || null;
      return {
        orgId: tenant,
        mode: routed[0].db_url?.trim() ? "dedicated" : "shared",
        dbUrl,
        dbProvider: routed[0].db_provider || "shared-postgres",
        source: "tenant_database_connections",
      };
    }
  }
  const config = await getTenantConfig(tenant).catch(() => null);
  if (!config) {
    return {
      orgId: tenant,
      mode: "shared",
      dbUrl: process.env.DATABASE_URL?.trim() || null,
      dbProvider: "shared-postgres",
      source: "default",
    };
  }
  const dbUrl = config.dbUrl?.trim() || process.env.DATABASE_URL?.trim() || null;
  return {
    orgId: tenant,
    mode: config.dbUrl?.trim() ? "dedicated" : "shared",
    dbUrl,
    dbProvider: config.dbProvider || "shared-postgres",
    source: "organizations",
  };
}
