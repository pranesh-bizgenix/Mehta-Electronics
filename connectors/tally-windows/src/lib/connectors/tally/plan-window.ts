import { historyYearsForOrg, type ConnectorHistoryFinancialYears } from "@/lib/connectors/tally/connector-plan";
import type { BusinessDataset } from "@/lib/engine/types";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function startOfFinancialYear(value: string): string {
  const [year, month] = value.split("-").map(Number);
  const fyYear = month >= 4 ? year : year - 1;
  return `${fyYear}-04-01`;
}

function addYears(value: string, years: number): string {
  const [year, month, day] = value.split("-").map(Number);
  return `${year + years}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateInPlanWindow(value: unknown, allowedStart: string): boolean {
  return typeof value !== "string" || !ISO_DATE_RE.test(value) || value >= allowedStart;
}

export function historyStartForFinancialYears(asOf: string, years: ConnectorHistoryFinancialYears): string {
  const anchor = ISO_DATE_RE.test(asOf) ? asOf : new Date().toISOString().slice(0, 10);
  return addYears(startOfFinancialYear(anchor), -(years - 1));
}

export function filterDatasetByHistoryStart(data: BusinessDataset, allowedStart: string): BusinessDataset {
  return {
    ...data,
    sales: data.sales.filter((row) => dateInPlanWindow(row.date, allowedStart)),
    profitAndLossRevenue: undefined,
    ...(data.vouchers ? { vouchers: data.vouchers.filter((row) => dateInPlanWindow(row.date, allowedStart)) } : {}),
    ...(data.bills ? { bills: data.bills.filter((row) => dateInPlanWindow(row.date, allowedStart)) } : {}),
    ...(data.expenses ? { expenses: data.expenses.filter((row) => dateInPlanWindow((row as { date?: unknown }).date, allowedStart)) } : {}),
    syncWindow: data.syncWindow
      ? {
          ...data.syncWindow,
          from: data.syncWindow.from && data.syncWindow.from > allowedStart ? data.syncWindow.from : allowedStart,
        }
      : {
          from: allowedStart,
          to: data.asOf,
          receivedAt: new Date().toISOString(),
          channel: "agent" as const,
        },
  };
}

export async function filterDatasetForOrgPlan(data: BusinessDataset, orgId: string): Promise<BusinessDataset> {
  const years = await historyYearsForOrg(orgId);
  return filterDatasetByHistoryStart(data, historyStartForFinancialYears(data.asOf, years));
}
