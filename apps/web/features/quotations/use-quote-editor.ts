'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { calculateQuotation, type QuoteMathResult } from '@shared/quotation-math.js';
import { useApi } from '@/lib/api/provider';
import { useSession } from '@/lib/session';
import type { Option } from '@/components/ds';
import { EDITABLE, quotationsApi, type Policy, type Quotation, type QuoteInput } from './api';

export interface LineDraft {
  key: string; item: Option | null; partCode: string; uom: string; hsn: string; description: string;
  quantity: string; unitPrice: string; discountPercent: string; taxPercent: string;
}
export type MarginFlag = 'green' | 'blue' | 'red' | null;

const DECIMAL = /^\d{1,12}(\.\d{1,6})?$/;
const trim = (v: string) => v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
const blankLine = (): LineDraft => ({ key: `n${Date.now()}${Math.random()}`, item: null, partCode: '', uom: '', hsn: '', description: '', quantity: '', unitPrice: '', discountPercent: '0', taxPercent: '18' });
const plusDays = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

/** BR-02 flag from the server-defined margin data: red below the floor or cost, blue exactly at cost, green otherwise. */
export function marginFlag(marginPercent: string | null | undefined, floor: string | undefined): MarginFlag {
  if (marginPercent === null || marginPercent === undefined) return null;
  const m = Number(marginPercent);
  if (m < 0) return 'red';
  if (m === 0) return 'blue';
  return floor !== undefined && m < Number(floor) ? 'red' : 'green';
}

/**
 * View model for the quotation editor. Holds the editable draft, loads policy
 * and (for authorised roles) item costs, and recalculates totals live with the
 * same arithmetic the server uses.
 */
export function useQuoteEditor({ id, enquiryId }: { id?: string; enquiryId?: string | null }) {
  const client = useApi();
  const api = useMemo(() => quotationsApi(client), [client]);
  const { can } = useSession();
  const costAccess = can('quotations.cost.read');
  const [quote, setQuote] = useState<Quotation | null>(null);
  const [policy, setPolicy] = useState<Policy | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [customer, setCustomer] = useState<Option | null>(null);
  const [placeOfSupply, setPlaceOfSupply] = useState('');
  const [validUntil, setValidUntil] = useState(plusDays(15));
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [costs, setCosts] = useState<Record<string, string | null>>({});
  const [linkedEnquiry, setLinkedEnquiry] = useState<number | null>(enquiryId ? Number(enquiryId) : null);
  const [dirty, setDirty] = useState(false);

  const hydrate = useCallback((q: Quotation) => {
    setQuote(q);
    setCustomer({ value: String(q.customerId), label: q.customer_name, hint: q.customerGstin || undefined });
    setPlaceOfSupply(q.placeOfSupply); setValidUntil(q.validUntil); setTerms(q.terms); setNotes(q.notes); setLinkedEnquiry(q.enquiryId);
    setLines(q.lines.map((l, i) => ({ key: `l${i}-${l.itemId}`, item: { value: String(l.itemId), label: l.partCode, hint: l.description }, partCode: l.partCode, uom: l.uom, hsn: l.hsn, description: l.description, quantity: trim(l.quantity), unitPrice: trim(l.unitPrice), discountPercent: trim(l.discountPercent), taxPercent: trim(l.taxPercent) })));
    if (q.pricing) setCosts(Object.fromEntries(q.pricing.lines.map((l) => [String(l.itemId), l.unitCost])));
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setPolicy(await api.policy());
      if (id) { hydrate(await api.get(id)); return; }
      if (enquiryId) {
        const e = await api.enquiry(enquiryId);
        const c = await api.customer(e.customer_id);
        setCustomer({ value: String(c.id), label: c.name, hint: c.gstin ?? undefined });
        setPlaceOfSupply(c.profile.state_code ?? c.gstin?.slice(0, 2) ?? '');
        setNotes(e.notes ?? '');
        setLines(e.lines.filter((l) => l.item_id).map((l) => ({ ...blankLine(), item: { value: String(l.item_id), label: l.part_code ?? l.description, hint: l.description }, partCode: l.part_code ?? '', uom: l.uom ?? '', description: l.description, quantity: trim(l.quantity), unitPrice: l.target_price ? trim(l.target_price) : '' })));
      }
    } catch (error) { setLoadError(error); }
  }, [api, id, enquiryId, hydrate]);
  useEffect(() => { void load(); }, [load]);

  // Costs for margin flags, fetched per item for authorised roles only.
  useEffect(() => {
    if (!costAccess) return;
    const missing = [...new Set(lines.map((l) => l.item?.value).filter((v): v is string => Boolean(v) && !(v! in costs)))];
    if (!missing.length) return;
    let live = true;
    Promise.all(missing.map((itemId) => api.cost(Number(itemId)).then((c) => [itemId, c.unit_cost] as const).catch(() => [itemId, null] as const)))
      .then((pairs) => { if (live) setCosts((c) => ({ ...c, ...Object.fromEntries(pairs) })); });
    return () => { live = false; };
  }, [lines, costAccess, costs, api]);

  const pickCustomer = async (option: Option | null) => {
    setCustomer(option); setDirty(true);
    if (!option) return;
    try { const c = await api.customer(Number(option.value)); setPlaceOfSupply(c.profile.state_code ?? c.gstin?.slice(0, 2) ?? ''); } catch { /* keep manual entry */ }
  };
  const updateLine = (key: string, patch: Partial<LineDraft>) => { setLines((ls) => ls.map((l) => l.key === key ? { ...l, ...patch } : l)); setDirty(true); };
  const addLine = () => { setLines((ls) => [...ls, blankLine()]); setDirty(true); };
  const removeLine = (key: string) => { setLines((ls) => ls.length > 1 ? ls.filter((l) => l.key !== key) : ls); setDirty(true); };

  const lineErrors = lines.map((l) => !l.item ? 'Choose an item' : !DECIMAL.test(l.quantity) || Number(l.quantity) <= 0 ? 'Quantity above zero' : !DECIMAL.test(l.unitPrice) ? 'Unit rate in rupees' : !DECIMAL.test(l.discountPercent) || Number(l.discountPercent) > 100 ? 'Discount 0–100%' : !DECIMAL.test(l.taxPercent) || Number(l.taxPercent) > 100 ? 'GST 0–100%' : null);
  const calc = useMemo<{ result: QuoteMathResult | null; error: string | null }>(() => {
    if (!policy || !/^\d{2}$/.test(placeOfSupply)) return { result: null, error: !policy ? null : 'Confirm the place of supply (2-digit state code).' };
    const valid = lines.filter((_, i) => !lineErrors[i]);
    if (!valid.length) return { result: null, error: null };
    try {
      return { result: calculateQuotation(valid.map((l) => ({ itemId: Number(l.item!.value), quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxPercent: l.taxPercent })), policy.seller_state, placeOfSupply, costAccess ? costs : null, policy.floor_percent ?? '0', policy.margin_basis ?? 'LINE_AND_TOTAL'), error: null };
    } catch (e) { return { result: null, error: e instanceof Error ? e.message : 'Check the line values.' }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, policy, placeOfSupply, costs, costAccess]);

  const lineView = (key: string) => {
    const index = lines.filter((_, i) => !lineErrors[i]).findIndex((l) => l.key === key);
    return index >= 0 ? calc.result?.lines[index] : undefined;
  };
  const editable = !quote || EDITABLE.includes(quote.status);
  const toInput = (reason: string): QuoteInput => ({
    customerId: Number(customer?.value), enquiryId: linkedEnquiry, validUntil, placeOfSupply, supplyType: 'DOMESTIC_STANDARD', terms, notes, reason,
    lines: lines.map((l) => ({ itemId: Number(l.item!.value), description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxPercent: l.taxPercent })),
    ...(quote ? { version: quote.version } : {})
  });
  const problems = [
    ...(!customer ? ['Choose a customer.'] : []),
    ...(!/^\d{2}$/.test(placeOfSupply) ? ['Confirm the place of supply.'] : []),
    ...(!validUntil ? ['Set how long the quotation is valid.'] : []),
    ...(lineErrors.some(Boolean) ? ['Complete every line (item, quantity, rate, discount, GST).'] : [])
  ];

  return {
    api, quote, setQuote: hydrate, policy, loadError, reload: load, costAccess, editable, dirty,
    customer, pickCustomer, placeOfSupply, setPlaceOfSupply: (v: string) => { setPlaceOfSupply(v); setDirty(true); },
    validUntil, setValidUntil: (v: string) => { setValidUntil(v); setDirty(true); }, terms, setTerms: (v: string) => { setTerms(v); setDirty(true); },
    notes, setNotes: (v: string) => { setNotes(v); setDirty(true); }, linkedEnquiry,
    lines, updateLine, addLine, removeLine, lineErrors, lineView, calc, costs, toInput, problems
  };
}
export type QuoteEditor = ReturnType<typeof useQuoteEditor>;
