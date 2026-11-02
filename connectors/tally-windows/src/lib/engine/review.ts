import type { AccountingVoucher, BusinessDataset } from "./types";
import {
  balanceSheetBankTotal,
  balanceSheetPayablesTotal,
  balanceSheetReceivablesTotal,
  collectionReceivablesTotal,
  groupBalance,
  hasCollectionReceivables,
  hasFinancials as hasFinancialData,
  payablesTotal,
  signedGroupBalance,
} from "./financials";

// Month-on-month review — "am I improving?" across every dimension.
// FLOW metrics (revenue, orders, credit raised, payables raised, overdue) are
// real, computed from dated transactions. BALANCE position (receivables, cash,
// bank, stock today) is point-in-time; true monthly balance history accrues as
// the connector keeps syncing.

export interface MonthRow {
  month: string; // yyyy-mm
  revenue: number;
  orders: number;
  aov: number;
  newReceivables: number; // receivable bills dated in the month (credit given)
  newPayables: number; // payable bills dated in the month (credit taken)
  overdueRaised: number; // of new receivables, how much is now overdue
  netFlow: number; // revenue − new payables (rough working-capital movement)
  cashIn: number; // receipt vouchers
  cashOut: number; // payment vouchers
  operatingCashFlow: number; // receipts − payments
  financeCost: number; // interest and finance-charge voucher lines
  stockIn: number; // purchase inventory allocations
  stockOut: number; // sales inventory allocations
}

export interface Delta {
  current: number;
  previous: number;
  changePct: number;
  direction: "up" | "down" | "flat";
}

export interface Position {
  collectionReceivables: number;
  balanceSheetReceivables: number;
  payables: number;
  bank: number;
  cash: number;
  stock: number;
  hasFinancials: boolean;
}

export interface MonthlyReview {
  months: MonthRow[];
  hasData: boolean;
  revenue: Delta;
  orders: Delta;
  aov: Delta;
  newReceivables: Delta;
  newPayables: Delta;
  overdueRaised: Delta;
  netFlow: Delta;
  cashIn: Delta;
  cashOut: Delta;
  operatingCashFlow: Delta;
  financeCost: Delta;
  stockIn: Delta;
  stockOut: Delta;
  position: Position;
  latestMonth: string;
  prevMonth: string;
  revenueUpStreak: { up: number; of: number };
  goodTrend: boolean | null;
}

function delta(current: number, previous: number): Delta {
  const changePct = previous === 0 ? (current > 0 ? 100 : 0) : ((current - previous) / Math.abs(previous)) * 100;
  return {
    current,
    previous,
    changePct,
    direction: Math.abs(changePct) < 0.5 ? "flat" : changePct > 0 ? "up" : "down",
  };
}

function positionOf(d: BusinessDataset): Position {
  const ledgers = d.ledgers ?? [];
  const collectionReceivables = hasCollectionReceivables(d) ? collectionReceivablesTotal(d) : 0;
  return {
    collectionReceivables,
    balanceSheetReceivables: balanceSheetReceivablesTotal(d) || collectionReceivables,
    // Same owner-facing payable figure as Today: Tally Sundry Creditors B/S close.
    payables: balanceSheetPayablesTotal(d) || payablesTotal(d),
    // Same Bank Balance as the dashboard: Bank Accounts only; Cash Credit and loans are excluded.
    bank: balanceSheetBankTotal(d),
    // Restrict cash to Tally Cash-in-Hand. A ledger named "Cash Credit" is a
    // Bank OD / loan liability and must never inflate cash or cash conversion.
    cash: Math.abs(signedGroupBalance(ledgers, /(^|>)\s*cash[- ]?in[- ]?hand(\s*>|$)/i)),
    stock: groupBalance(ledgers, /stock|inventor/i) || d.inventory.reduce((s, i) => s + (i.closingValue ?? i.currentStock * i.unitCost), 0),
    hasFinancials: hasFinancialData(d),
  };
}

/** Match Tally's Receipt Register: when one receipt has multiple debtor lines,
 * it reports the primary PARTYLEDGERNAME amount, not a secondary allocation. */
function receiptRegisterAmount(voucher: AccountingVoucher): number {
  const debit = voucher.ledgerLines.filter((line) => line.entryType === "debit").reduce((sum, line) => sum + Math.abs(line.amount), 0);
  const credit = voucher.ledgerLines.filter((line) => line.entryType === "credit").reduce((sum, line) => sum + Math.abs(line.amount), 0);
  const voucherAmount = Math.abs(voucher.amount) || Math.max(debit, credit);
  const party = voucher.party.trim().toLowerCase();
  const debtorLines = voucher.ledgerLines.filter((line) => /debtor/i.test(line.ledgerName));
  const primary = debtorLines.find((line) => line.ledgerName.trim().toLowerCase() === party);
  return debtorLines.length > 1 && primary ? Math.abs(primary.amount) : voucherAmount;
}
export function monthlyReview(d: BusinessDataset): MonthlyReview {
  const m = new Map<string, { revenue: number; invoices: Set<string>; newRecv: number; newPay: number; overdue: number; cashIn: number; cashOut: number; financeCost: number; stockIn: number; stockOut: number }>();
  const get = (k: string) => {
    let e = m.get(k);
    if (!e) m.set(k, (e = { revenue: 0, invoices: new Set(), newRecv: 0, newPay: 0, overdue: 0, cashIn: 0, cashOut: 0, financeCost: 0, stockIn: 0, stockOut: 0 }));
    return e;
  };

  for (const r of d.sales) {
    const k = r.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(k)) continue;
    const e = get(k);
    e.revenue += r.amount;
    e.invoices.add(r.invoiceNo);
  }
  for (const b of d.bills ?? []) {
    const k = b.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(k)) continue;
    const e = get(k);
    if (b.kind === "receivable") {
      e.newRecv += b.amount;
      if (b.overdueDays > 0) e.overdue += b.amount;
    } else {
      e.newPay += b.amount;
    }
  }
  for (const voucher of d.vouchers ?? []) {
    const k = voucher.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(k)) continue;
    const e = get(k);
    const debit = voucher.ledgerLines.filter((line) => line.entryType === "debit").reduce((sum, line) => sum + Math.abs(line.amount), 0);
    const credit = voucher.ledgerLines.filter((line) => line.entryType === "credit").reduce((sum, line) => sum + Math.abs(line.amount), 0);
    const magnitude = Math.abs(voucher.amount) || Math.max(debit, credit);
    // Use the Receipt Register amount; secondary debtor allocations are not a second receipt.
    if (/receipt/i.test(voucher.voucherType)) e.cashIn += receiptRegisterAmount(voucher);
    if (/payment/i.test(voucher.voucherType)) e.cashOut += magnitude;
    for (const line of voucher.ledgerLines) {
      if (/interest|finance (?:cost|charge)|bank charge|loan charge|discounting charge|od interest|cc interest/i.test(line.ledgerName)) e.financeCost += Math.abs(line.amount);
    }
    const stockValue = voucher.inventoryLines.reduce((sum, line) => sum + Math.abs(line.amount), 0);
    if (/purchase/i.test(voucher.voucherType)) e.stockIn += stockValue;
    if (/sales?/i.test(voucher.voucherType)) e.stockOut += stockValue;
  }

  const months: MonthRow[] = [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, e]) => ({
      month,
      revenue: e.revenue,
      orders: e.invoices.size,
      aov: e.invoices.size ? e.revenue / e.invoices.size : 0,
      newReceivables: e.newRecv,
      newPayables: e.newPay,
      overdueRaised: e.overdue,
      netFlow: e.revenue - e.newPay,
      cashIn: e.cashIn,
      cashOut: e.cashOut,
      operatingCashFlow: e.cashIn - e.cashOut,
      financeCost: e.financeCost,
      stockIn: e.stockIn,
      stockOut: e.stockOut,
    }));

  const empty: MonthRow = { month: "", revenue: 0, orders: 0, aov: 0, newReceivables: 0, newPayables: 0, overdueRaised: 0, netFlow: 0, cashIn: 0, cashOut: 0, operatingCashFlow: 0, financeCost: 0, stockIn: 0, stockOut: 0 };
  // The current month is usually partial (data ends mid-month) — comparing it to
  // a full prior month manufactures a false decline. Compare COMPLETE months for
  // the deltas; keep all months in the chart/table.
  // const asOfDate = new Date(d.asOf);
  // const partial = months.length > 0 && months[months.length - 1].month === d.asOf.slice(0, 7) && asOfDate.getDate() < 28;
  // const complete = partial ? months.slice(0, -1) : months;
  const complete = months;
  const cn = complete.length;
  const c = complete[cn - 1] ?? empty;
  const p = complete[cn - 2] ?? empty;

  const recent = complete.slice(-7);
  let up = 0,
    of = 0;
  for (let i = 1; i < recent.length; i++) {
    of++;
    if (recent[i].revenue >= recent[i - 1].revenue) up++;
  }

  const revD = delta(c.revenue, p.revenue);
  return {
    months,
    hasData: cn >= 2,
    revenue: revD,
    orders: delta(c.orders, p.orders),
    aov: delta(c.aov, p.aov),
    newReceivables: delta(c.newReceivables, p.newReceivables),
    newPayables: delta(c.newPayables, p.newPayables),
    overdueRaised: delta(c.overdueRaised, p.overdueRaised),
    netFlow: delta(c.netFlow, p.netFlow),
    cashIn: delta(c.cashIn, p.cashIn),
    cashOut: delta(c.cashOut, p.cashOut),
    operatingCashFlow: delta(c.operatingCashFlow, p.operatingCashFlow),
    financeCost: delta(c.financeCost, p.financeCost),
    stockIn: delta(c.stockIn, p.stockIn),
    stockOut: delta(c.stockOut, p.stockOut),
    position: positionOf(d),
    latestMonth: c.month,
    prevMonth: p.month,
    revenueUpStreak: { up, of },
    goodTrend: cn >= 3 ? up >= of / 2 && revD.direction !== "down" : null,
  };
}
