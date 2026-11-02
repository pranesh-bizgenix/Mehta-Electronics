import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export type ConnectorHistoryFinancialYears = 2 | 4 | 6;

export function historyYearsForPlan(plan: string): ConnectorHistoryFinancialYears {
  if (plan === "plus") return 2;
  if (plan === "growth") return 4;
  if (plan === "command") return 6;
  return 2;
}

export async function historyYearsForOrg(orgId: string): Promise<ConnectorHistoryFinancialYears> {
  if (!db) return historyYearsForPlan("");
  const tenant = orgId.trim();
  if (!tenant) return historyYearsForPlan("");

  try {
    const rows = (await db.execute(sql`
      SELECT plan
      FROM orgs
      WHERE id::text = ${tenant}
      LIMIT 1
    `)) as unknown as Array<{ plan: string | null }>;

    return historyYearsForPlan(rows[0]?.plan || "");
  } catch {
    return historyYearsForPlan("");
  }
}
