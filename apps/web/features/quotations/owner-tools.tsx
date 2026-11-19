'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/lib/api/provider';
import type { Paginated } from '@/lib/api/client';
import { formatDate, formatMoney } from '@/lib/format';
import { Button, Combobox, DataTable, Drawer, EmptyState, Notice, SelectField, StatusBadge, TextAreaField, TextField, fieldErrors, useAsync, useToast, type Option } from '@/components/ds';
import { STATE_NAMES, quotationsApi } from './api';
import {policyErrors,costErrors} from '../../../../public/quotation-setup-validation.js';
import {SetupHistory} from './setup-history';
import {CostImport} from './cost-import';

/** Owner: margin floor, seller state and letterhead (versioned, audited). */
export function PolicyDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useApi();
  const api = useMemo(() => quotationsApi(client), [client]);
  const toast = useToast();
  const [f, setF] = useState({ floorPercent: '', marginBasis: '', sellerState: '', name: '', address: '', gstin: '', email: '', phone: '', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading,setLoading]=useState(true);
  const [configured,setConfigured]=useState(false);
  const [revision,setRevision]=useState<number|null>(null);
  useEffect(() => {
    if (!open) return;
    let live=true;setLoading(true);
    setErrors({});
    api.policy().then((p) => {
      if(!live)return;setConfigured(!!p);setRevision(p?.revision??null);
      const l = (p?.letterhead ?? {}) as Record<string, string>;
      setF({ floorPercent: p?.floor_percent ?? '', marginBasis: p?.margin_basis ?? '', sellerState: p?.seller_state ?? '', name: l.name ?? '', address: l.address ?? '', gstin: l.gstin ?? '', email: l.email ?? '', phone: l.phone ?? '', reason: '' });
    }).catch(e=>{if(live)setErrors({load:'Policy could not be loaded. Close and reopen to retry.',form:e instanceof Error?e.message:'Could not load policy.'});}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  }, [open, api]);
  const save = async () => {
    const issues=policyErrors({...f,letterhead:{name:f.name,address:f.address,gstin:f.gstin,email:f.email,phone:f.phone}});
    if(Object.keys(issues).length){setErrors(issues);return;}
    setBusy(true); setErrors({});
    try {
      await client.put('/api/crm/quotation-policy', { floorPercent: f.floorPercent, marginBasis: f.marginBasis, sellerState: f.sellerState, expectedRevision:revision, letterhead: { name: f.name, address: f.address, gstin: f.gstin, email: f.email, phone: f.phone }, reason: f.reason });
      toast('success', 'Policy saved as a new revision. Open approvals must be reviewed again.'); onClose();
    } catch (e) { setErrors({ ...fieldErrors(e), form: e instanceof Error ? e.message : 'Could not save.' }); } finally { setBusy(false); }
  };
  return (
    <Drawer open={open} title="Policy & letterhead" description="Changing the policy invalidates unsent approvals so they are reviewed again." onClose={() => !busy && onClose()}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={loading||!!errors.load} busy={busy} onClick={() => void save()}>Save policy</Button></>}>
      {loading?<p>Loading policy...</p>:!errors.load&&!configured&&<Notice tone="warning">Quotation creation is blocked until the owner saves a margin floor, margin basis, seller GST state and company name. No business values are filled in automatically.</Notice>}
      <div className="grid-2">
        <TextField label="Margin floor (%)" required error={errors.floorPercent} inputMode="decimal" value={f.floorPercent} onChange={(e) => setF({ ...f, floorPercent: e.target.value })} hint="Gross margin on discounted sales before GST." />
        <SelectField label="Check margin on" required error={errors.marginBasis} placeholder="Choose margin basis" value={f.marginBasis} onChange={(e) => setF({ ...f, marginBasis: e.target.value })} options={[{ value: 'LINE_AND_TOTAL', label: 'Every line and the total' }, { value: 'TOTAL', label: 'Total only' }]} />
      </div>
      <SelectField label="Seller state (GST)" required error={errors.sellerState} value={f.sellerState} onChange={(e) => setF({ ...f, sellerState: e.target.value })} placeholder="Choose state" options={Object.entries(STATE_NAMES).map(([v, n]) => ({ value: v, label: `${v} · ${n}` }))} />
      <TextField label="Company name on letterhead" error={errors['letterhead.name']} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <TextAreaField label="Address" error={errors['letterhead.address']} rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
      <div className="grid-2">
        <TextField label="GSTIN" error={errors['letterhead.gstin']} value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} />
        <TextField label="Phone" error={errors['letterhead.phone']} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </div>
      <TextField label="Email" error={errors['letterhead.email']} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <TextAreaField label="Reason for change" required rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} error={errors.reason} />
      {errors.form && <Notice tone="danger">{errors.form}</Notice>}
      <SetupHistory revision={0} />
    </Drawer>
  );
}

/** Owner: CRM cost per item (never taken from Tally). */
export function CostDrawer({ open, onClose,initialItem }: { open: boolean; onClose: () => void;initialItem?:Option|null }) {
  const client = useApi();
  const api = useMemo(() => quotationsApi(client), [client]);
  const toast = useToast();
  const [item, setItem] = useState<Option | null>(null);
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [errors,setErrors]=useState<Record<string,string>>({});
  const [revision,setRevision]=useState(0);
  const [loading,setLoading]=useState(false);
  useEffect(() => { if (!open) { setItem(null); setCurrent(undefined); setUnitCost(''); setReason(''); setError(undefined); } }, [open]);
  useEffect(()=>{if(open&&initialItem)setItem(initialItem);},[open,initialItem?.value,initialItem?.label]);
  useEffect(() => {let live=true;setCurrent(undefined);setUnitCost('');setError(undefined);setErrors({});if(item){setLoading(true);api.cost(Number(item.value)).then(c=>{if(live)setCurrent(c.unit_cost);}).catch(e=>{if(live)setError(e instanceof Error?e.message:'Could not load cost.');}).finally(()=>{if(live)setLoading(false);});}return()=>{live=false;};}, [item, api,revision]);
  const save = async () => {
    const issues={...costErrors({unitCost,reason}),...(!item?{item:'Choose an active CRM item.'}:{})};
    setErrors(issues);if(Object.keys(issues).length||!item)return;
    setBusy(true); setError(undefined);
    try { await client.put(`/api/crm/quotation-costs/${item.value}`, { unitCost, reason }); toast('success', `Cost saved for ${item.label}.`); setCurrent(unitCost); setUnitCost(''); setReason('');setRevision(r=>r+1); }
    catch (e) { setErrors(fieldErrors(e));setError(e instanceof Error ? e.message : 'Could not save.'); } finally { setBusy(false); }
  };
  return (
    <Drawer open={open} title="Item costs" description="CRM cost before GST, used for margin checks. Visible only to cost-authorised roles." onClose={() => !busy && onClose()}
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button disabled={!item||loading||current===undefined} busy={busy} onClick={() => void save()}>Save cost</Button></>}>
      <p className="muted">Enter one item cost manually below. File import is optional.</p>
      <Combobox label="Item" error={errors.item} value={item} onChange={value=>{if(!busy)setItem(value);}} search={async (t,signal) => (await api.items(t,signal)).data.map((i) => ({ value: String(i.id), label: i.part_code, hint: i.description }))} />
      {item && current !== undefined && <Notice tone={current!==null ? 'info' : 'warning'}>{current!==null ? `Current cost ${formatMoney(current,{places:6})} per unit.` : 'No cost recorded: quotations with this item cannot be submitted.'}</Notice>}
      <TextField required error={errors.unitCost} label="New unit cost (₹, before GST)" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
      <TextAreaField required error={errors.reason} label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} hint="e.g. Connectwell price list Oct 2026" />
      {loading&&<p>Loading current cost...</p>}
      {error && <Notice tone="danger">{error}</Notice>}
      {item&&<SetupHistory itemId={item.value} revision={revision} />}
      <details><summary>Optional: import costs from a file</summary><CostImport onSaved={()=>setRevision(r=>r+1)} /></details>
    </Drawer>
  );
}

interface LegacyRow { id: number; quotation_number: string; customer_name: string; status: string; valid_until: string; total: number | string }
/** Quotations created before the approval workflow (read-only, PDF available). */
export function HistoricalDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useApi();
  const [page, setPage] = useState(1);
  const [state, reload] = useAsync((signal) => open ? client.get<Paginated<LegacyRow>>('/api/quotations', { query: { page, pageSize: 25 }, signal }) : Promise.resolve(null), [open, page]);
  const data = state.status === 'ready' ? state.data : state.data;
  return (
    <Drawer open={open} title="All quotations, including older ones" description="Records from before the approval workflow are read-only." onClose={onClose}>
      <DataTable<LegacyRow> bare id="legacy-quotes" caption="All quotations" rows={data?.data} rowKey={(r) => r.id} loading={state.status === 'loading'} error={state.status === 'error' ? state.error : undefined} onRetry={reload}
        pagination={data?.pagination} onPage={setPage} empty={<EmptyState title="No quotations" />}
        columns={[
          { key: 'n', header: 'Number', render: (r) => <a className="mono" href={`/api/quotations/${r.id}/pdf`} target="_blank" rel="noopener">{r.quotation_number}</a> },
          { key: 'c', header: 'Customer', render: (r) => r.customer_name },
          { key: 's', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'v', header: 'Valid until', render: (r) => formatDate(r.valid_until) },
          { key: 't', header: 'Total', numeric: true, render: (r) => formatMoney(String(r.total)) }
        ]} />
    </Drawer>
  );
}
