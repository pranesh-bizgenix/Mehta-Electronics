import { companyKeyForDataset, identityForDataset } from "@/lib/company-workspace";
import { withDatasetVersion } from "@/lib/dataset-version";
import type { AccountingVoucher, BusinessDataset, SalesRecord } from "@/lib/engine/types";

type MergeWindowInput = {
  from: string;
  to: string;
  historyCoveredFrom?: string | null;
};

function inIsoWindow(value: string, from: string, to: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= from && value <= to;
}

function dedupeByKey<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

function saleKey(row: SalesRecord): string {
  return [
    row.invoiceNo,
    row.date,
    row.customerName,
    row.productName,
    row.qty,
    row.amount,
  ].join("|").toLowerCase();
}

function voucherKey(row: AccountingVoucher): string {
  return (row.guid || `${row.voucherType}|${row.voucherNo}|${row.date}`).toLowerCase();
}

export function mergeTallyHistoryWindow(
  existing: BusinessDataset | null,
  incoming: BusinessDataset,
  input: MergeWindowInput,
): BusinessDataset {
  if (!existing) {
    const syncWindow = input.historyCoveredFrom
      ? {
          from: input.historyCoveredFrom,
          to: incoming.asOf,
          receivedAt: new Date().toISOString(),
          channel: "agent" as const,
        }
      : incoming.syncWindow;
    return withDatasetVersion(syncWindow ? { ...incoming, syncWindow } : incoming);
  }

  if (existing.source !== "tally" || incoming.source !== "tally") {
    throw new Error("Window-merge publication is supported only for Tally datasets.");
  }

  const existingKey = companyKeyForDataset(existing);
  const incomingKey = companyKeyForDataset(incoming);
  if (existingKey !== incomingKey) {
    const existingIdentity = identityForDataset(existing).exactName;
    const incomingIdentity = identityForDataset(incoming).exactName;
    throw new Error(`Window-merge company mismatch: existing "${existingIdentity}" vs incoming "${incomingIdentity}".`);
  }

  const salesOutsideWindow = existing.sales.filter((row) => !inIsoWindow(row.date, input.from, input.to));
  const vouchersOutsideWindow = (existing.vouchers ?? []).filter((row) => !inIsoWindow(row.date, input.from, input.to));

  const merged: BusinessDataset = {
    ...existing,
    ...incoming,
    company: incoming.company,
    companyIdentity: incoming.companyIdentity ?? existing.companyIdentity,
    currency: incoming.currency,
    source: incoming.source,
    asOf: incoming.asOf,
    sales: dedupeByKey([...salesOutsideWindow, ...incoming.sales], saleKey),
    inventory: incoming.inventory,
    profitAndLossRevenue: incoming.profitAndLossRevenue ?? existing.profitAndLossRevenue,
    balanceSheetHierarchy: incoming.balanceSheetHierarchy ?? existing.balanceSheetHierarchy,
    ledgers: incoming.ledgers ?? existing.ledgers,
    bills: incoming.bills ?? existing.bills,
    vouchers: dedupeByKey([...vouchersOutsideWindow, ...(incoming.vouchers ?? [])], voucherKey),
    billKindMapping: incoming.billKindMapping ?? existing.billKindMapping,
    billAgeingAsOf: incoming.billAgeingAsOf ?? existing.billAgeingAsOf,
    expenses: incoming.expenses ?? existing.expenses,
    tallyControls: incoming.tallyControls ?? existing.tallyControls,
    syncWindow: input.historyCoveredFrom
      ? {
          from: input.historyCoveredFrom,
          to: incoming.asOf,
          receivedAt: new Date().toISOString(),
          channel: "agent" as const,
        }
      : incoming.syncWindow,
  };

  return withDatasetVersion(merged);
}
