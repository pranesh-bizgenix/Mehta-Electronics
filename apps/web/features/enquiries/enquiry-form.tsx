'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { newIdempotencyKey } from '@/lib/api/client';
import { useApi } from '@/lib/api/provider';
import { useSession } from '@/lib/session';
import { Button, Combobox, Drawer, IconButton, Notice, SelectField, TextAreaField, TextField, fieldErrors, type Option } from '@/components/ds';
import { SOURCES, enquiriesApi, type Enquiry } from './api';

interface LineDraft { key: string; item: Option | null; quantity: string }

/** New enquiry or revision of an open one. Revisions need a reason and keep the old lines archived. */
export function EnquiryForm({ open, enquiry, onClose, onSaved }: { open: boolean; enquiry?: Enquiry; onClose: () => void; onSaved: (e: Enquiry) => void }) {
  const client = useApi();
  const api = useMemo(() => enquiriesApi(client), [client]);
  const { state } = useSession();
  const editing = Boolean(enquiry);
  const [customer, setCustomer] = useState<Option | null>(null);
  const [f, setF] = useState({ subject: '', source: '', expectedBy: '', ownerId: '', notes: '', reason: '' });
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [owners, setOwners] = useState<Option[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);

  useEffect(() => {
    if (!open) return;
    setErrors({}); setKey(newIdempotencyKey());
    setCustomer(enquiry ? { value: String(enquiry.customer_id), label: enquiry.customer_name } : null);
    setF({ subject: enquiry?.subject ?? '', source: enquiry?.source ?? '', expectedBy: enquiry?.expected_by ?? '', ownerId: String(enquiry?.assigned_to ?? (state.kind === 'ready' ? state.user.id : '')), notes: enquiry?.notes ?? '', reason: '' });
    setLines(enquiry?.lines.length ? enquiry.lines.map((l) => ({ key: `l${l.id}`, item: l.item_id ? { value: String(l.item_id), label: l.part_code ?? l.description, hint: l.description } : null, quantity: l.quantity.includes('.') ? l.quantity.replace(/0+$/, '').replace(/\.$/, '') : l.quantity })) : [{ key: 'n0', item: null, quantity: '' }]);
    api.owners().then((o) => setOwners(o.map((x) => ({ value: String(x.id), label: x.name })))).catch(() => setOwners([]));
  }, [open, enquiry, api, state]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!customer) e.customer = 'Choose the customer.';
    if (!f.subject.trim()) e.subject = 'Describe the requirement in a few words.';
    const filled = lines.filter((l) => l.item || l.quantity);
    if (!filled.length) e.lines = 'Add at least one item.';
    filled.forEach((l, i) => { if (!l.item) e[`line${i}`] = 'Choose the item.'; else if (!/^\d{1,14}(\.\d{1,6})?$/.test(l.quantity) || Number(l.quantity) <= 0) e[`line${i}`] = 'Enter a quantity above zero.'; });
    if (editing && f.reason.trim().length < 3) e.reason = 'Say briefly why this enquiry is being revised.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const body = { customerId: Number(customer!.value), subject: f.subject.trim(), source: f.source || null, expectedBy: f.expectedBy || null, ...(f.ownerId ? { ownerId: Number(f.ownerId) } : {}), notes: f.notes || null, lines: filled.map((l) => ({ itemId: Number(l.item!.value), quantity: l.quantity })) };
    try { onSaved(editing && enquiry ? await api.revise(enquiry.id, { ...body, reason: f.reason.trim() }) : await api.create(body, key)); }
    catch (error) { setErrors({ ...fieldErrors(error), form: error instanceof Error ? error.message : 'Could not save the enquiry.' }); }
    finally { setBusy(false); }
  };

  return (
    <Drawer open={open} title={editing ? `Revise ${enquiry?.enquiry_number}` : 'New enquiry'} description={editing ? 'A new numbered revision is kept; earlier lines are archived.' : 'Capture what the customer asked for. The SLA clock starts now.'}
      onClose={() => !busy && onClose()} footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" form="enquiry-form" busy={busy} icon="check">{editing ? 'Save revision' : 'Create enquiry'}</Button></>}>
      <form id="enquiry-form" className="stack-lg" onSubmit={(e) => void submit(e)} noValidate>
        <Combobox label="Customer" required value={customer} onChange={setCustomer} error={errors.customer}
          search={async (t) => (await api.customers(t)).data.map((c) => ({ value: String(c.id), label: c.name, hint: c.gstin ?? undefined }))} />
        <TextField label="Subject" required value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} error={errors.subject} maxLength={300} hint="e.g. MCC panel components for packaging line" />
        <div className="grid-2">
          <SelectField label="Source" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="Not recorded" options={[...new Set([...SOURCES, ...(f.source ? [f.source] : [])])].map((s) => ({ value: s, label: s }))} />
          <TextField label="Expected by" type="date" value={f.expectedBy} onChange={(e) => setF({ ...f, expectedBy: e.target.value })} />
        </div>
        <SelectField label="Owner" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })} options={owners} hint="Responsible for the response and the SLA." />

        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="ds-menu-label" style={{ padding: 0 }}>Items requested</legend>
          {errors.lines && <Notice tone="danger">{errors.lines}</Notice>}
          {lines.map((l, i) => (
            <div key={l.key} className="cluster" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                <Combobox label={`Item ${i + 1}`} value={l.item} onChange={(item) => setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, item } : x))} error={errors[`line${i}`]}
                  search={async (t) => (await api.items(t)).data.map((it) => ({ value: String(it.id), label: it.part_code, hint: `${it.description} · ${it.uom}` }))} />
              </div>
              <div style={{ flex: '0 0 30%' }}><TextField label="Qty" inputMode="decimal" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, quantity: e.target.value.replace(/[^\d.]/g, '') } : x))} /></div>
              {lines.length > 1 && <IconButton icon="x" label={`Remove item ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />}
            </div>
          ))}
          <Button variant="secondary" icon="plus" onClick={() => setLines((ls) => [...ls, { key: `n${Date.now()}`, item: null, quantity: '' }])}>Add item</Button>
        </fieldset>

        <TextAreaField label="Notes" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={10000} />
        {editing && <TextAreaField label="Reason for revision" required rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} error={errors.reason} />}
        {errors.form && <Notice tone="danger">{errors.form}</Notice>}
      </form>
    </Drawer>
  );
}
