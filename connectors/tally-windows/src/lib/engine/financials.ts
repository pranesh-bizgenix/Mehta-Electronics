import type { Bill, BusinessDataset, LedgerBalance } from "./types";

const norm = (s: string) => s.trim().toLowerCase();

export function hasFinancials(d: BusinessDataset): boolean {
  return (d.ledgers?.length ?? 0) > 0 || (d.bills?.length ?? 0) > 0;
}

export function groupBalance(ledgers: LedgerBalance[], re: RegExp): number {
  return Math.abs(ledgers.filter((l) => re.test(l.group)).reduce((s, l) => s + l.closing, 0));
}

/** Signed closing balance for liquidity groups. Debit bank/cash stays positive;
 * credit overdraft/cash-credit balances reduce available liquidity. */
export function signedGroupBalance(ledgers: LedgerBalance[], re: RegExp): number {
  return ledgers.filter((l) => re.test(l.group)).reduce((sum, ledger) => sum + ledger.closing, 0);
}

/** Balance Sheet bank position from Bank Accounts only. Bank OD, Cash Credit
 * and loan liabilities belong to the borrowings/funding view and are excluded. */
export function balanceSheetBankTotal(d: BusinessDataset): number {
  return groupBalance(d.ledgers ?? [], /(^|>)\s*bank accounts?(\s*>|$)/i);
}

function partiesInGroup(ledgers: LedgerBalance[], re: RegExp): Set<string> {
  return new Set(ledgers.filter((l) => re.test(l.group)).map((l) => norm(l.name)));
}

function billsForLedgerGroup(d: BusinessDataset, re: RegExp): Bill[] {
  const partyNames = partiesInGroup(d.ledgers ?? [], re);
  if (!partyNames.size) return [];
  return (d.bills ?? []).filter((b) => partyNames.has(norm(b.party)));
}

export function sumBillAmounts(bills: Bill[]): number {
  return bills.reduce((s, b) => s + b.amount, 0);
}

/** Collection view receivables: pending receivable bills (invoice-wise). */
export function receivableBills(d: BusinessDataset): Bill[] {
  const bills = d.bills ?? [];
  const debtorNames = partiesInGroup(d.ledgers ?? [], /debtor|receivable/i);
  // The built-in reports split by balance sign, so use the ledger group as the
  // authoritative business classification whenever masters are available.
  return debtorNames.size
    ? bills.filter((b) => b.kind === "receivable" && debtorNames.has(norm(b.party)))
    : bills.filter((b) => b.kind === "receivable");
}

export function payableBills(d: BusinessDataset): Bill[] {
  const bills = d.bills ?? [];
  const creditorNames = partiesInGroup(d.ledgers ?? [], /sundry creditors?|creditor/i);
  return creditorNames.size
    ? bills.filter((b) => b.kind === "payable" && creditorNames.has(norm(b.party)))
    : bills.filter((b) => b.kind === "payable");
}

/** Consulting/action view: only parties classified as Sundry Debtors. Tally's
 * accounting receivables report may also contain advances, deposits and tax
 * balances, which belong in the balance view but not a customer chase list. */
export function customerReceivableBills(d: BusinessDataset): Bill[] {
  const bills = receivableBills(d);
  const debtorNames = partiesInGroup(d.ledgers ?? [], /debtor|receivable/i);
  if (!debtorNames.size) return bills;
  return bills.filter((b) => debtorNames.has(norm(b.party)));
}

/** Consulting/action view: only parties classified as Sundry Creditors. */
export function supplierPayableBills(d: BusinessDataset): Bill[] {
  const bills = payableBills(d);
  const creditorNames = partiesInGroup(d.ledgers ?? [], /creditor|payable/i);
  if (!creditorNames.size) return bills;
  return bills.filter((b) => creditorNames.has(norm(b.party)));
}

export function sundryDebtorBills(d: BusinessDataset): Bill[] {
  return billsForLedgerGroup(d, /sundry debtors?|debtor/i);
}

export function sundryCreditorBills(d: BusinessDataset): Bill[] {
  return billsForLedgerGroup(d, /sundry creditors?|creditor/i);
}

/** A Tally bill is overdue only after its due date; a bill due today remains
 * current. Use the active accounting balance date instead of a stale exported
 * overdueDays value so dashboard date filtering stays mathematically correct. */
export function isTallyBillOverdue(bill: Bill, asOf: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(bill.dueDate) && bill.dueDate < asOf;
}

export function isTallyBillAgeingOverdue(bill: Bill): boolean {
  return bill.overdueDays > 2;
}

export function overdueSundryDebtorReceivableBills(d: BusinessDataset): Bill[] {
  return (d.bills ?? []).filter((b) => b.kind === "receivable" && b.amount > 0 && isTallyBillAgeingOverdue(b));
}

export function overdueSundryCreditorPayableBills(d: BusinessDataset): Bill[] {
  return (d.bills ?? []).filter((b) => b.kind === "payable" && b.amount > 0 && isTallyBillAgeingOverdue(b));
}

export function hasCollectionReceivables(d: BusinessDataset): boolean {
  return receivableBills(d).length > 0;
}

/** Accounting view receivables: closing balance of Sundry Debtor ledgers. */
export function balanceSheetReceivablesTotal(d: BusinessDataset): number {
  return groupBalance(d.ledgers ?? [], /sundry debtors?|debtor/i);
}

/** Accounting view payables: Tally Balance Sheet closing balance of Sundry
 * Creditor ledgers. This is the owner-facing payable amount. */
export function balanceSheetPayablesTotal(d: BusinessDataset): number {
  return groupBalance(d.ledgers ?? [], /sundry creditors?|creditor/i);
}

/** Net customer receivables: pending debtor debit bills less debtor credit
 * balances (advances, credit notes and other opposite-side outstandings).
 * The invoice-only collection queue remains separate in receivableBills(). */
export function collectionReceivablesTotal(d: BusinessDataset): number {
  const debtorBills = billsForLedgerGroup(d, /sundry debtors?|debtor|receivable/i);
  if (!debtorBills.length) return sumBillAmounts(receivableBills(d));
  const pendingDebits = debtorBills
    .filter((bill) => bill.kind === "receivable")
    .reduce((sum, bill) => sum + bill.amount, 0);
  const creditBalances = debtorBills
    .filter((bill) => bill.kind === "payable")
    .reduce((sum, bill) => sum + bill.amount, 0);
  return Math.max(0, pendingDebits - creditBalances);
}

/** Legacy alias kept for collection-oriented paths. */
export function receivablesTotal(d: BusinessDataset): number {
  return collectionReceivablesTotal(d);
}

/** Closing Payable = Opening Payable + Credits - Debits.
 * Uses only voucher lines posted to Sundry Creditor ledgers. When detailed
 * creditor movements are unavailable, the Balance Sheet closing balance is
 * the authoritative fallback. */
export function payablesTotal(d: BusinessDataset): number {
  const creditorLedgers = (d.ledgers ?? []).filter((ledger) => /sundry creditors?|creditor/i.test(ledger.group));
  const creditorNames = new Set(creditorLedgers.map((ledger) => norm(ledger.name)));
  const creditorLines = (d.vouchers ?? [])
    .flatMap((voucher) => voucher.ledgerLines)
    .filter((line) => creditorNames.has(norm(line.ledgerName)));

  if (creditorLines.length) {
    const openingSigned = creditorLedgers.reduce((sum, ledger) => sum + ledger.opening, 0);
    const closingSigned = creditorLedgers.reduce((sum, ledger) => sum + ledger.closing, 0);
    // Tally exports can encode creditor balances as either positive or negative
    // depending on the XML report family. A movement with the same sign as the
    // creditor control increases payables (credit); the opposite sign reduces
    // payables (debit).
    const creditorSign = Math.sign(closingSigned || openingSigned) || 1;
    const openingPayable = Math.abs(openingSigned);
    const credits = creditorLines
      .filter((line) => Math.sign(line.amount) === creditorSign)
      .reduce((sum, line) => sum + Math.abs(line.amount), 0);
    const debits = creditorLines
      .filter((line) => Math.sign(line.amount) === -creditorSign)
      .reduce((sum, line) => sum + Math.abs(line.amount), 0);
    return Math.max(0, openingPayable + credits - debits);
  }

  const ledgerPayables = groupBalance(creditorLedgers, /sundry creditors?|creditor/i);
  if (ledgerPayables) return ledgerPayables;
  return sumBillAmounts(payableBills(d));
}
