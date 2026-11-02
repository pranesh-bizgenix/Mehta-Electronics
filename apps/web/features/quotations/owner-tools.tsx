'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/lib/api/provider';
import type { Paginated } from '@/lib/api/client';
import { formatDate, formatMoney } from '@/lib/format';
import { Button, Combobox, DataTable, Drawer, EmptyState, Notice, SelectField, StatusBadge, TextAreaField, TextField, fieldErrors, useAsync, useToast, type Option } from '@/components/ds';
import { STATE_NAMES, quotationsApi } from './api';

/** Owner: margin floor, seller state and letterhead (versioned, audited). */
export function PolicyDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useApi();
  const api = useMemo(() => quotationsApi(client), [client]);
  const toast = useToast();
  const [f, setF] = useState({ floorPercent: '', marginBasis: 'LINE_AND_TOTAL', sellerState: '', name: '', address: '', gstin: '', email: '', phone: '', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrors({});
    api.policy().then((p) => {
      const l = (p?.letterhead ?? {}) as Record<string, string>;
      setF({ floorPercent: p?.floor_percent ?? '', marginBasis: p?.margin_basis ?? 'LINE_AND_TOTAL', sellerState: p?.seller_state ?? '', name: l.name ?? '', address: l.address ?? '', gstin: l.gstin ?? '', email: l.email ?? '', phone: l.phone ?? '', reason: '' });
    }).catch(() => undefined);
  }, [open, api]);
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      await client.put('/api/crm/quotation-policy', { floorPercent: f.floorPercent, marginBasis: f.marginBasis, sellerState: f.sellerState, letterhead: { name: f.name, address: f.address, gstin: f.gstin, email: f.email, phone: f.phone }, reason: f.reason });
      toast('success', 'Policy saved as a new revision. Open approvals must be reviewed again.'); onClose();
    } catch (e) { setErrors({ ...fieldErrors(e), form: e instanceof Error ? e.message : 'Could not save.' }); } finally { setBusy(false); }
  };
  return (
    <Drawer open={open} title="Policy & letterhead" description="Changing the policy invalidates unsent approvals so they are reviewed again." onClose={() => !busy && onClose()}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={() => void save()}>Save policy</Button></>}>
      <div className="grid-2">
        <TextField label="Margin floor (%)" inputMode="decimal" value={f.floorPercent} onChange={(e) => setF({ ...f, floorPercent: e.target.value.replace(/[^\d.]/g, '') })} hint="Gross margin on discounted sales before GST." />
        <SelectField label="Check margin on" value={f.marginBasis} onChange={(e) => setF({ ...f, marginBasis: e.target.value })} options={[{ value: 'LINE_AND_TOTAL', label: 'Every line and the total' }, { value: 'TOTAL', label: 'Total only' }]} />
      </div>
      <SelectField label="Seller state (GST)" value={f.sellerState} onChange={(e) => setF({ ...f, sellerState: e.target.value })} placeholder="Choose state" options={Object.entries(STATE_NAMES).map(([v, n]) => ({ value: v, label: `${v} · ${n}` }))} />
      <TextField label="Company name on letterhead" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <TextAreaField label="Address" rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
      <div className="grid-2">
        <TextField label="GSTIN" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} maxLength={15} />
        <TextField label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </div>
      <TextField label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <TextAreaField label="Reason for change" required rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} error={errors.reason} />
      {errors.form && <Notice tone="danger">{errors.form}</Notice>}
    </Drawer>
  );
}

/** Owner: CRM cost per item (never taken from Tally). */
export function CostDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useApi();
  const api = useMemo(() => quotationsApi(client), [client]);
  const toast = useToast();
  const [item, setItem] = useState<Option | null>(null);
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { if (!open) { setItem(null); setCurrent(undefined); setUnitCost(''); setReason(''); setError(undefined); } }, [open]);
  useEffect(() => { if (item) api.cost(Number(item.value)).then((c) => setCurrent(c.unit_cost)).catch(() => setCurrent(null)); }, [item, api]);
  const save = async () => {
    if (!item || !/^\d{1,12}(\.\d{1,6})?$/.test(unitCost) || reason.trim().length < 3) { setError('Choose an item, enter the cost in rupees and give a reason.'); return; }
    setBusy(true); setError(undefined);
    try { await client.put(`/api/crm/quotation-costs/${item.value}`, { unitCost, reason }); toast('success', `Cost saved for ${item.label}.`); setCurrent(unitCost); setUnitCost(''); setReason(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); } finally { setBusy(false); }
  };
  return (
    <Drawer open={open} title="Item costs" description="CRM cost before GST, used for margin checks. Visible only to cost-authorised roles." onClose={() => !busy && onClose()}
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button busy={busy} onClick={() => void save()}>Save cost</Button></>}>
      <Combobox label="Item" value={item} onChange={setItem} search={async (t) => (await api.items(t)).data.map((i) => ({ value: String(i.id), label: i.part_code, hint: i.description }))} />
      {item && current !== undefined && <Notice tone={current ? 'info' : 'warning'}>{current ? `Current cost ${formatMoney(current)} per unit.` : 'No cost recorded: quotations with this item cannot be submitted.'}</Notice>}
      <TextField label="New unit cost (₹, before GST)" inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value.replace(/[^\d.]/g, ''))} />
      <TextAreaField label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} hint="e.g. Connectwell price list Oct 2026" />
      {error && <Notice tone="danger">{error}</Notice>}
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
