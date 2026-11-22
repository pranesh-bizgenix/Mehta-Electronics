'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calculateQuotation, type QuoteMathResult } from '@shared/quotation-math.js';
import {decimal as exactDecimal,compare as exactCompare} from '@shared/money.js';
export {marginFlag,type MarginFlag} from '@shared/quotation-margin.js';
import { useApi } from '@/lib/api/provider';
import { useSession } from '@/lib/session';
import {useScope} from '@/lib/scope';
import type { Option } from '@/components/ds';
import { EDITABLE, quotationsApi, type Policy, type Quotation, type QuoteInput } from './api';
import {quotationRequest,quotationLineRequest,quotationRequestBlock,quotationPricingDate,type QuotationLineRequest,type QuotationRequest} from '../../../../public/quotation-request.js';

export interface LineDraft {
  sourceLineId?: string;
  pricingSelection?: {level:number;fingerprint:string};
  requestDetails:QuotationLineRequest;
  key: string; item: Option | null; partCode: string; uom: string; hsn: string; description: string;
  quantity: string; unitPrice: string; discountPercent: string; taxPercent: string;
}

const DECIMAL = /^\d{1,12}(\.\d{1,6})?$/;
const trim = (v: string) => v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
const blankLine = (): LineDraft => ({ key: `n${Date.now()}${Math.random()}`, item: null, partCode: '', uom: '', hsn: '', description: '', quantity: '', unitPrice: '', discountPercent: '', taxPercent: '',requestDetails:quotationLineRequest(undefined,'') });
const indiaToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

/**
 * View model for the quotation editor. Holds the editable draft, loads policy
 * and (for authorised roles) item costs, and recalculates totals live with the
 * same arithmetic the server uses.
 */
export function useQuoteEditor({ id, enquiryId, customerId }: { id?: string; enquiryId?: string | null; customerId?: string | null }) {
  const client = useApi();
  const {companyId}=useScope();
  const api = useMemo(() => quotationsApi(client), [client]);
  const { can } = useSession();
  const costAccess = can('quotations.cost.read');
  const permitted = can(id ? 'quotations.read' : 'quotations.create');
  const customerRequest = useRef(0);
  const [quote, setQuote] = useState<Quotation | null>(null);
  const [policy, setPolicy] = useState<Policy | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [customer, setCustomer] = useState<Option | null>(null);
  const [placeOfSupply, setPlaceOfSupply] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [request,setRequest]=useState<QuotationRequest>(quotationRequest());
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [costs, setCosts] = useState<Record<string, string | null>>({});
  const [linkedEnquiry, setLinkedEnquiry] = useState<number | null>(enquiryId ? Number(enquiryId) : null);
  const [dirty, setDirty] = useState(false);
  const [sourceWarning, setSourceWarning] = useState<string>();
  const [customerError, setCustomerError] = useState<string>();
  const [customerLoading, setCustomerLoading] = useState(false);
  const refreshPolicy = async () => { try { setPolicy(await api.policy()); } catch(error) { setLoadError(error); } };

  const hydrate = useCallback((q: Quotation) => {
    setQuote(q);
    setCustomer({ value: String(q.customerId), label: q.customer_name, hint: q.customerGstin || undefined });
    setPlaceOfSupply(q.placeOfSupply); setValidUntil(q.validUntil); setTerms(q.terms); setNotes(q.notes); setLinkedEnquiry(q.enquiryId);
    setRequest(quotationRequest(q.request));
    setLines(q.lines.map((l, i) => ({ key: `l${i}-${l.itemId}`, item: { value: String(l.itemId), label: l.partCode, hint: l.description }, sourceLineId:l.sourceLineId, partCode: l.partCode, uom: l.uom, hsn: l.hsn, description: l.description, quantity: trim(l.quantity), unitPrice: trim(l.unitPrice), discountPercent: trim(l.discountPercent), taxPercent: trim(l.taxPercent),pricingSelection:l.pricingSelection,requestDetails:{...quotationLineRequest(undefined,''),...l.requestDetails} })));
    setCosts({}); // Load current costs separately from the retained approval snapshot.
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    if (!permitted) return;
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
        const linked=e.lines.filter((l) => l.item_id);
        setLines(linked.length ? linked.map((l) => ({ ...blankLine(), item: { value: String(l.item_id), label: l.part_code ?? l.description, hint: l.description }, partCode: l.part_code ?? '', uom: l.uom ?? '', description: l.description, quantity: trim(l.quantity), unitPrice: l.target_price ? trim(l.target_price) : '' })) : [blankLine()]);
        if(linked.length !== e.lines.length) setSourceWarning(`${e.lines.length-linked.length} enquiry line(s) need a CRM item. Add those items before saving the quotation.`);
      } else if(customerId) {
        if(!/^[1-9]\d*$/.test(customerId)) throw new Error('The customer link is invalid. Open New quotation again from the customer record.');
        const c=await api.customer(Number(customerId));
        setCustomer({value:String(c.id),label:c.name,hint:c.gstin??undefined});
        setPlaceOfSupply(c.profile.state_code??c.gstin?.slice(0,2)??'');
      }
    } catch (error) { setLoadError(error); }
  }, [api, id, enquiryId, customerId, hydrate, permitted]);
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
    const request=++customerRequest.current;
    setCustomer(option); setDirty(true); setPlaceOfSupply(''); setCustomerError(undefined); setCustomerLoading(false);
    if (!option) return;
    setCustomerLoading(true);
    try { const c = await api.customer(Number(option.value)); if(request===customerRequest.current)setPlaceOfSupply(current=>current||c.profile.state_code||c.gstin?.slice(0,2)||''); }
    catch { if(request===customerRequest.current)setCustomerError('Customer details could not be loaded. Select the customer again to retry.'); }
    finally { if(request===customerRequest.current)setCustomerLoading(false); }
  };
  const updateLine = (key: string, patch: Partial<LineDraft>) => { setLines((ls) => ls.map((l) => l.key === key ? { ...l, ...patch } : l)); if(Object.hasOwn(patch,'quantity')||Object.hasOwn(patch,'item')||Object.hasOwn(patch,'requestDetails'))setRequest(r=>({...r,quantityConfirmed:false}));setDirty(true); };
  const addLine = () => { setLines((ls) => [...ls, blankLine()]); setRequest(r=>({...r,quantityConfirmed:false}));setDirty(true); };
  const removeLine = (key: string) => { setLines((ls) => ls.length > 1 ? ls.filter((l) => l.key !== key) : ls); setRequest(r=>({...r,quantityConfirmed:false}));setDirty(true); };

  const lineErrors = lines.map((l) => !l.item ? 'Choose an item' : !DECIMAL.test(l.quantity) || exactCompare(exactDecimal(l.quantity),exactDecimal('0')) <= 0 ? 'Quantity above zero' : !DECIMAL.test(l.unitPrice) ? 'Unit rate in rupees' : !DECIMAL.test(l.discountPercent) || exactCompare(exactDecimal(l.discountPercent),exactDecimal('100')) > 0 ? 'Discount 0–100%' : !DECIMAL.test(l.taxPercent) || exactCompare(exactDecimal(l.taxPercent),exactDecimal('100')) > 0 ? 'GST 0–100%' : null);
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
  const editable = quote ? EDITABLE.includes(quote.status) && can('quotations.update') : can('quotations.create');
  const costSnapshotChanged=Boolean(costAccess&&quote?.pricing&&quote.pricing.lines.some(saved=>{
    const current=costs[String(saved.itemId)];
    if(current===undefined)return false;
    if(current===null||saved.unitCost===null)return current!==saved.unitCost;
    return exactCompare(exactDecimal(current),exactDecimal(saved.unitCost))!==0;
  }));
  const toInput = (reason: string): QuoteInput => ({
    companyId:quote?.companyId??companyId??undefined,
    request,
    customerId: Number(customer?.value), enquiryId: linkedEnquiry, validUntil, placeOfSupply, supplyType: 'DOMESTIC_STANDARD', terms, notes, reason,
    lines: lines.map((l) => ({ sourceLineId:l.sourceLineId, itemId: Number(l.item!.value), description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxPercent: l.taxPercent,pricingSelection:l.pricingSelection,requestDetails:l.requestDetails })),
    ...(quote ? { version: quote.version } : {})
  });
  const problems = [
    ...(!policy ? ['Owner must configure quotation policy and letterhead.'] : []),
    ...(policy?.confirmed===false?['Owner must confirm the retained quotation policy in Decisions or save Policy and letterhead.']:[]),
    ...(!customer ? ['Choose a customer.'] : []),
    ...(customerLoading ? ['Loading customer details.'] : []),
    ...(customerError ? [customerError] : []),
    ...(sourceWarning ? [sourceWarning] : []),
    ...(!/^\d{2}$/.test(placeOfSupply) ? ['Confirm the place of supply.'] : []),
    ...(!validUntil ? ['Set how long the quotation is valid.'] : []),
    ...(!lines.length || lineErrors.some(Boolean) ? ['Complete every line (item, quantity, rate, discount, GST).'] : []),
    ...(calc.error ? [calc.error] : [])
  ];
  try{quotationPricingDate(request,indiaToday());}catch(error){problems.push(error instanceof Error?error.message:String(error));}
  lines.forEach((line,index)=>{try{quotationLineRequest(line.requestDetails,indiaToday());}catch(error){problems.push(`Line ${index+1}: ${error instanceof Error?error.message:'Check request details.'}`);}});

  return {
    api, quote, setQuote: hydrate, policy, refreshPolicy, refreshCosts:()=>setCosts({}), loadError, reload: load, costAccess, costSnapshotChanged, editable, dirty, sourceWarning, setSourceWarning, customerError, customerLoading,
    customer, pickCustomer, placeOfSupply, setPlaceOfSupply: (v: string) => { setPlaceOfSupply(v); setDirty(true); },
    validUntil, setValidUntil: (v: string) => { setValidUntil(v); setDirty(true); }, terms, setTerms: (v: string) => { setTerms(v); setRequest(r=>({...r,termsConfirmed:false})); setDirty(true); },
    notes, setNotes: (v: string) => { setNotes(v); setDirty(true); }, linkedEnquiry,
    request,requestBlock:quotationRequestBlock(request,terms),updateRequest:(patch:Partial<QuotationRequest>)=>{setRequest(value=>({...value,...patch,...(Object.hasOwn(patch,'quantityInstructions')?{quantityConfirmed:false}:{})}));setDirty(true);},
    lines, updateLine, addLine, removeLine, lineErrors, lineView, calc, costs, toInput, problems
  };
}
export type QuoteEditor = ReturnType<typeof useQuoteEditor>;
