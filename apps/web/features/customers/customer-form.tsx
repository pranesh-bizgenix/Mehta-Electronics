'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { newIdempotencyKey } from '@/lib/api/client';
import {
  Button, Combobox, Drawer, Icon, IconButton, Notice, SelectField, TextAreaField, TextField, fieldErrors, useDebounced, type Option
} from '@/components/ds';
import type { Customer, CustomerInput, Duplicate } from './api';
import { useCustomersApi } from './hooks';

interface ContactDraft { key: string; id?: number; name: string; designation: string; phone: string; email: string; isPrimary: boolean }
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;

function initialContacts(c?: Customer): ContactDraft[] {
  const list = (c?.contacts ?? []).map((x, i) => ({ key: `c${x.id ?? i}`, id: x.id, name: x.name, designation: x.designation ?? '', phone: x.phone ?? '', email: x.email ?? '', isPrimary: Boolean(x.is_primary) }));
  return list.length ? list : [{ key: 'new0', name: '', designation: '', phone: '', email: '', isPrimary: true }];
}

/** Create or edit a customer. Edits require a reason (audit trail); duplicates are flagged as you type. */
export function CustomerForm({ open, customer, onClose, onSaved }: { open: boolean; customer?: Customer; onClose: () => void; onSaved: (c: Customer) => void }) {
  const api = useCustomersApi();
  const editing = Boolean(customer);
  const [f, setF] = useState(() => toForm(customer));
  const [contacts, setContacts] = useState<ContactDraft[]>(() => initialContacts(customer));
  const [ledger, setLedger] = useState<Option | null>(null);
  const [companies, setCompanies] = useState<Option[]>([]);
  const [owners, setOwners] = useState<Option[]>([]);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);

  useEffect(() => {
    if (!open) return;
    setF(toForm(customer)); setContacts(initialContacts(customer)); setErrors({}); setDuplicates([]); setKey(newIdempotencyKey());
    setLedger(customer?.profile.tally_ledger_name ? { value: customer.profile.tally_ledger_name, label: customer.profile.tally_ledger_name } : null);
    api.companies().then((c) => setCompanies(c.map((x) => ({ value: x.id, label: x.display_name })))).catch(() => setCompanies([]));
    api.owners().then((o) => setOwners(o.map((x) => ({ value: String(x.id), label: x.name })))).catch(() => setOwners([]));
  }, [open, customer, api]);

  const probe = useDebounced(`${f.name}|${f.gstin}`, 400);
  useEffect(() => {
    if (!open || (f.name.trim().length < 3 && !GSTIN.test(f.gstin))) { setDuplicates([]); return; }
    api.duplicates({ name: f.name.trim() || undefined, gstin: GSTIN.test(f.gstin) ? f.gstin : undefined, excludeId: customer?.id })
      .then(setDuplicates).catch(() => setDuplicates([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe, open]);

  const set = (k: keyof ReturnType<typeof toForm>, v: string) => setF((x) => ({ ...x, [k]: v, ...(k === 'gstin' && GSTIN.test(v) && !x.stateCode ? { stateCode: v.slice(0, 2) } : {}) }));
  const setContact = (key: string, patch: Partial<ContactDraft>) => setContacts((cs) => cs.map((c) => c.key === key ? { ...c, ...patch } : patch.isPrimary ? { ...c, isPrimary: false } : c));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = 'Enter the customer’s registered name.';
    if (f.gstin && !GSTIN.test(f.gstin)) e.gstin = 'A GSTIN has 15 characters, e.g. 27ABCDE1234F1Z5.';
    if (f.gstin && GSTIN.test(f.gstin) && f.stateCode && f.gstin.slice(0, 2) !== f.stateCode) e.stateCode = 'State code must match the first two digits of the GSTIN.';
    if (!/^\d{1,14}(\.\d{1,6})?$/.test(f.creditLimit)) e.creditLimit = 'Enter an amount in rupees, e.g. 500000.';
    if (!/^\d{1,4}$/.test(f.creditDays)) e.creditDays = 'Enter whole days (0–3650).';
    if (Boolean(f.companyId) !== Boolean(ledger)) e.tally = 'Choose both a Tally company and the exact ledger, or neither.';
    contacts.forEach((c, i) => { if ((c.email || c.phone || c.designation) && !c.name.trim()) e[`contact${i}`] = 'Add the contact’s name.'; if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) e[`contact${i}`] = 'Check the email address.'; });
    if (editing && f.reason.trim().length < 3) e.reason = 'Say briefly why you are changing this customer.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setBusy(true);
    const body: CustomerInput = {
      name: f.name.trim(), customerCode: f.customerCode || null, gstin: f.gstin || null, stateCode: f.stateCode || null, paymentTerms: f.paymentTerms || null,
      creditLimit: f.creditLimit, creditDays: Number(f.creditDays), billingAddress: f.billingAddress || null, status: f.status as CustomerInput['status'],
      ownerId: f.ownerId ? Number(f.ownerId) : null, companyId: f.companyId || null, tallyName: ledger?.value ?? null,
      contacts: contacts.filter((c) => c.name.trim()).map((c) => ({ ...(c.id ? { id: c.id } : {}), name: c.name.trim(), designation: c.designation || null, phone: c.phone || null, email: c.email || null, isPrimary: c.isPrimary })),
      ...(editing ? { reason: f.reason.trim() } : {})
    };
    try {
      const saved = editing && customer ? await api.update(customer.id, { ...body, reason: f.reason.trim() }) : await api.create(body, key);
      onSaved(saved);
    } catch (error) {
      setErrors({ ...fieldErrors(error), form: error instanceof Error ? error.message : 'Could not save the customer.' });
    } finally { setBusy(false); }
  };

  return (
    <Drawer open={open} title={editing ? `Edit ${customer?.name}` : 'New customer'} description={editing ? 'Changes are versioned in the audit trail.' : 'Billing details, credit terms and contacts.'} onClose={() => !busy && onClose()}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" form="customer-form" busy={busy} icon="check">{editing ? 'Save changes' : 'Create customer'}</Button></>}>
      <form id="customer-form" className="stack-lg" onSubmit={(e) => void submit(e)} noValidate>
        {duplicates.length > 0 && (
          <Notice tone="warning" title="Possible duplicate">
            {duplicates.slice(0, 3).map((d) => <span key={d.id} style={{ display: 'block' }}><Link href={`/customers/${d.id}`}>{d.name}</Link>{d.gstin ? ` · ${d.gstin}` : ''}</span>)}
            Check before creating a second record for the same business.
          </Notice>
        )}
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="ds-menu-label" style={{ padding: 0 }}>Business</legend>
          <TextField label="Registered name" required value={f.name} onChange={(e) => set('name', e.target.value)} error={errors.name} maxLength={300} />
          <div className="grid-2">
            <TextField label="GSTIN" value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase().replace(/\s/g, ''))} error={errors.gstin} maxLength={15} hint="Checked for format and state." />
            <TextField label="State code" value={f.stateCode} onChange={(e) => set('stateCode', e.target.value.replace(/\D/g, '').slice(0, 2))} error={errors.stateCode} inputMode="numeric" maxLength={2} />
          </div>
          <div className="grid-2">
            <TextField label="Customer code" value={f.customerCode} onChange={(e) => set('customerCode', e.target.value)} maxLength={100} />
            <SelectField label="Status" value={f.status} onChange={(e) => set('status', e.target.value)} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'ON_HOLD', label: 'On hold' }, { value: 'INACTIVE', label: 'Inactive' }]} />
          </div>
          <TextAreaField label="Billing address" rows={2} value={f.billingAddress} onChange={(e) => set('billingAddress', e.target.value)} maxLength={4000} />
        </fieldset>

        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="ds-menu-label" style={{ padding: 0 }}>Credit and ownership</legend>
          <div className="grid-2">
            <TextField label="Credit limit (₹)" inputMode="decimal" value={f.creditLimit} onChange={(e) => set('creditLimit', e.target.value.replace(/[^\d.]/g, ''))} error={errors.creditLimit} />
            <TextField label="Credit days" inputMode="numeric" value={f.creditDays} onChange={(e) => set('creditDays', e.target.value.replace(/\D/g, ''))} error={errors.creditDays} />
          </div>
          <TextField label="Payment terms" value={f.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} maxLength={2000} hint="As agreed with the customer, e.g. 30 days from invoice." />
          <SelectField label="Account owner" value={f.ownerId} onChange={(e) => set('ownerId', e.target.value)} placeholder="Unassigned" options={owners} />
        </fieldset>

        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="ds-menu-label" style={{ padding: 0 }}>Tally ledger (read-only link)</legend>
          <SelectField label="Tally company" value={f.companyId} onChange={(e) => { set('companyId', e.target.value); setLedger(null); }} placeholder="Not linked" options={companies} error={errors.tally} />
          {f.companyId && <Combobox label="Exact ledger name" value={ledger} onChange={setLedger} hint="Matching is by exact name; nothing is written to Tally."
            search={async (t) => (await api.tallyLedgers(f.companyId, t)).data.map((l) => ({ value: l.name, label: l.display_name ?? l.name, hint: l.gstin ?? undefined }))} />}
        </fieldset>

        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="ds-menu-label" style={{ padding: 0 }}>Contacts</legend>
          {contacts.map((c, i) => (
            <div key={c.key} className="ds-card ds-card-pad stack-sm" style={{ boxShadow: 'none', background: 'var(--color-surface-sunken)' }}>
              <div className="cluster-between">
                <label className="ds-check-row"><input type="radio" name="primary-contact" checked={c.isPrimary} onChange={() => setContact(c.key, { isPrimary: true })} /> Primary contact</label>
                {contacts.length > 1 && <IconButton icon="x" label={c.id ? 'Archive contact' : 'Remove contact'} onClick={() => setContacts((cs) => cs.filter((x) => x.key !== c.key))} />}
              </div>
              <div className="grid-2">
                <TextField label="Name" value={c.name} onChange={(e) => setContact(c.key, { name: e.target.value })} error={errors[`contact${i}`]} />
                <TextField label="Designation" value={c.designation} onChange={(e) => setContact(c.key, { designation: e.target.value })} />
                <TextField label="Phone" type="tel" inputMode="tel" value={c.phone} onChange={(e) => setContact(c.key, { phone: e.target.value })} />
                <TextField label="Email" type="email" value={c.email} onChange={(e) => setContact(c.key, { email: e.target.value })} />
              </div>
            </div>
          ))}
          <Button variant="secondary" icon="plus" onClick={() => setContacts((cs) => [...cs, { key: `new${Date.now()}`, name: '', designation: '', phone: '', email: '', isPrimary: cs.length === 0 }])}>Add contact</Button>
          {editing && <p className="ds-cell-secondary"><Icon name="info" style={{ display: 'inline', width: 'var(--icon-sm)', height: 'var(--icon-sm)', verticalAlign: 'text-bottom' }} /> Removed contacts are archived, not deleted.</p>}
        </fieldset>

        {editing && <TextAreaField label="Reason for change" required rows={2} value={f.reason} onChange={(e) => set('reason', e.target.value)} error={errors.reason} hint="Saved in the audit trail." />}
        {errors.form && <Notice tone="danger">{errors.form}</Notice>}
      </form>
    </Drawer>
  );
}

/** "500000.000000" → "500000", "100.500000" → "100.5" (string-only, no floats). */
function trimDecimal(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

function toForm(c?: Customer) {
  return {
    name: c?.name ?? '', customerCode: c?.customer_code ?? '', gstin: c?.gstin ?? '', stateCode: c?.profile.state_code ?? '', paymentTerms: c?.profile.payment_terms ?? '',
    creditLimit: c ? trimDecimal(c.credit_limit) : '0', creditDays: String(c?.credit_days ?? 0),
    billingAddress: c?.billing_address ?? '', status: c?.status ?? 'ACTIVE', ownerId: c?.owner_id ? String(c.owner_id) : '', companyId: c?.profile.company_id ?? '', reason: ''
  };
}
