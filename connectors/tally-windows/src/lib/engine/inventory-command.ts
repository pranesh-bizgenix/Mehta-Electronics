import type { BusinessDataset, InventoryItem } from "./types";
import { latestTransactionDate } from "./period";

export type InventoryBand = "fast" | "watch" | "slow" | "non_moving" | "unknown";
export interface InventoryRow extends InventoryItem {
  value: number; excessUnits: number; excessValue: number; movementDate: string | null;
  movementDays: number | null; band: InventoryBand; grossMarginPct: number | null;
}
export interface InventoryCommand {
  company: string; asOf: string; flowThrough: string | null; isFlowStale: boolean; referenceDate: string;
  rows: InventoryRow[]; stockValue: number; movementCoveredValue: number; movementCoveragePct: number;
  fastValue: number; slowValue: number; nonMovingValue: number; unknownValue: number;
  excessValue: number; stockoutCount: number; marginCoveragePct: number;
  releaseScenarios: Array<{ id: "conservative" | "target" | "stretch"; label: string; releasePct: number; cashRelease: number }>;
  topCashRelease: InventoryRow[]; stockoutItems: InventoryRow[];
  verdict: { tone: "good" | "watch" | "critical" | "setup"; eyebrow: string; headline: string; detail: string; move: string };
}

const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
const days = (later: string, earlier: string) => Math.max(0, Math.floor((+new Date(later) - +new Date(earlier)) / 86400000));
const sum = (rows: InventoryRow[], field: "value" | "excessValue") => rows.reduce((total, row) => total + row[field], 0);
const itemValue = (item: InventoryItem) => Math.abs(item.closingValue ?? Math.max(0, item.currentStock) * Math.max(0, item.unitCost));
const stockLedgerValue = (data: BusinessDataset) =>
  Math.abs((data.ledgers ?? [])
    .filter((ledger) => /stock-in-hand|stock in hand|closing stock/i.test(`${ledger.name} ${ledger.group}`))
    .reduce((total, ledger) => total + ledger.closing, 0));

export function buildInventoryCommand(data: BusinessDataset): InventoryCommand {
  const flowThrough = latestTransactionDate(data);
  const referenceDate = flowThrough ?? data.asOf;
  const lastMovement = new Map<string, string>();
  for (const voucher of data.vouchers ?? []) for (const line of voucher.inventoryLines) {
    if (!line.itemName || (!line.qty && !line.amount)) continue;
    const key = norm(line.itemName); const prior = lastMovement.get(key);
    if (!prior || voucher.date > prior) lastMovement.set(key, voucher.date);
  }
  const rows = data.inventory.filter(item => itemValue(item) > 0 || item.currentStock > 0 || item.reorderLevel > 0).map(item => {
    const movementDate = lastMovement.get(norm(item.itemName)) ?? item.lastSaleDate;
    const movementDays = movementDate ? days(referenceDate, movementDate) : item.agingDays > 0 ? item.agingDays : null;
    const value = itemValue(item);
    const excessUnits = Math.max(0, item.currentStock - Math.max(0, item.reorderLevel));
    const excessValue = excessUnits > 0
      ? excessUnits * Math.max(0, item.unitCost)
      : item.currentStock <= 0 && value > 0
        ? value
        : 0;
    const band: InventoryBand = movementDays == null ? "unknown" : movementDays >= 180 ? "non_moving" : movementDays >= 90 ? "slow" : movementDays >= 61 ? "watch" : "fast";
    const grossMarginPct = item.sellingPrice > 0 && item.unitCost >= 0 && item.unitCost <= item.sellingPrice * 3 ? (item.sellingPrice - item.unitCost) / item.sellingPrice * 100 : null;
    return { ...item, value, excessUnits, excessValue, movementDate, movementDays, band, grossMarginPct };
  }).sort((a, b) => b.value - a.value);
  const visibleStockValue = sum(rows, "value");
  const stockValue = visibleStockValue || stockLedgerValue(data);
  const known = rows.filter(row => row.movementDays != null);
  const movementCoveredValue = sum(known, "value");
  const movementCoveragePct = stockValue ? movementCoveredValue / stockValue * 100 : 0;
  const fastValue = sum(rows.filter(row => row.band === "fast"), "value");
  const slowValue = sum(rows.filter(row => row.band === "slow"), "value");
  const nonMovingValue = sum(rows.filter(row => row.band === "non_moving"), "value");
  const unknownValue = sum(rows.filter(row => row.band === "unknown"), "value");
  const excessValue = sum(rows, "excessValue");
  const releasableBase = rows.filter(row => row.band === "slow" || row.band === "non_moving").reduce((total, row) => total + Math.min(row.value, row.excessValue || row.value), 0);
  const marginCoveredValue = sum(rows.filter(row => row.grossMarginPct != null), "value");
  const stockoutItems = rows.filter(row => row.reorderLevel > 0 && row.currentStock <= row.reorderLevel).sort((a, b) => b.reorderLevel - b.currentStock - (a.reorderLevel - a.currentStock));
  const releaseScenarios = ([
    ["conservative", "Conservative", 0.1], ["target", "Target", 0.2], ["stretch", "Stretch", 0.3],
  ] as const).map(([id, label, releasePct]) => ({ id, label, releasePct, cashRelease: releasableBase * releasePct }));
  const tone = !rows.length ? "setup" : movementCoveragePct < 60 ? "critical" : nonMovingValue > stockValue * .25 ? "critical" : slowValue + nonMovingValue > stockValue * .3 ? "watch" : "good";
  const headline = !rows.length ? "Connect item-level stock to activate inventory productivity." : movementCoveragePct < 60 ? "Movement evidence is too incomplete for a liquidation decision." : nonMovingValue ? "Cash is sitting in stock that has not moved for 180 days." : "Visible stock is moving; protect service without adding avoidable inventory.";
  return {
    company: data.company, asOf: data.asOf, flowThrough, isFlowStale: flowThrough ? days(data.asOf, flowThrough) > 31 : true, referenceDate,
    rows, stockValue, movementCoveredValue, movementCoveragePct, fastValue, slowValue, nonMovingValue, unknownValue,
    excessValue, stockoutCount: stockoutItems.length, marginCoveragePct: stockValue ? marginCoveredValue / stockValue * 100 : 0,
    releaseScenarios, topCashRelease: [...rows].filter(row => row.excessValue > 0).sort((a, b) => b.excessValue - a.excessValue).slice(0, 12), stockoutItems: stockoutItems.slice(0, 12),
    verdict: {
      tone, eyebrow: tone === "good" ? "Inventory discipline" : tone === "setup" ? "Evidence required" : "Working-capital opportunity", headline,
      detail: `${movementCoveragePct.toFixed(0)}% of visible stock value has a movement date. Slow and non-moving classifications use the latest connected flow (${referenceDate}) rather than pretending the accounting snapshot is transaction activity.`,
      move: movementCoveragePct < 60 ? "Repair item movement mapping before acting." : nonMovingValue ? "Ask owners to validate the top excess items, then approve a controlled liquidation or purchasing pause." : "Review stockout candidates and protect only items with demand evidence.",
    },
  };
}
