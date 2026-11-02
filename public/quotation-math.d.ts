// Types for the shared browser/server quotation arithmetic (quotation-math.js).
export interface QuoteMathLineInput { itemId?: number | string; quantity: string; unitPrice: string; discountPercent?: string; taxPercent?: string; [key: string]: unknown }
export interface QuoteMathLine extends QuoteMathLineInput {
  net: string; cgst: string; sgst: string; igst: string; total: string;
  unitCost?: string | null; cost?: string; marginPercent?: string | null; belowFloor?: boolean;
}
export interface QuoteMathResult {
  lines: QuoteMathLine[]; subtotal: string; cgst: string; sgst: string; igst: string; total: string; localTaxLabel: 'SGST' | 'UTGST';
  cost?: string; missingCost?: boolean; marginPercent?: string | null; belowFloor?: boolean;
}
export function scaled(value: string | number): bigint;
export function money(n: bigint): string;
export function calculateQuotation(lines: QuoteMathLineInput[], sellerState: string, placeOfSupply: string, costs?: Record<string, string | null> | null, floor?: string, basis?: 'LINE_AND_TOTAL' | 'TOTAL'): QuoteMathResult;
