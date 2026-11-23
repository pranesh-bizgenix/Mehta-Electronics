'use client';

import Link from 'next/link';
import { use, useMemo, useState } from 'react';
import { useApi } from '@/lib/api/provider';
import { useSession } from '@/lib/session';
import { formatDate, formatDateTime, formatMoney, initials, titleCase } from '@/lib/format';
import {
  Badge, Button, Card, CardSkeleton, Combobox, DataTable, EmptyState, ErrorState, Facts, Icon, Modal, Notice, ReasonDialog, StatCard, StatusBadge, TabPanel, Tabs, TextField,
  Timeline, Truncate, useAsync, useToast, type Option
} from '@/components/ds';
import { customerEnquiryHref,commercialRecordHref } from '../../../../../../public/crm-navigation.js';
import { useCustomer } from '@/features/customers/hooks';
import { CustomerForm } from '@/features/customers/customer-form';
import { CustomerOperations } from '@/features/workflows/customer-operations';
import {CustomerManagement} from '@/features/customers/management';
import type { Customer, HistoryRow, PartMapping } from '@/features/customers/api';

type Tab = 'overview' | 'contacts' | 'parts' | 'enquiries' | 'quotes' | 'orders' | 'invoices' | 'dues' | 'activity' | 'operations' | 'addresses' | 'sales-activity' | 'opportunities' | 'history' | 'commercial' | 'merges';

export default function Customer360({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const api = useApi();
  const { can } = useSession();
  const toast = useToast();
  const { state, customer, reload } = useCustomer(id);
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT' | null>(null);

  if (state.status === 'error' && !customer) return <ErrorState error={state.error} onRetry={reload} />;
  if (!customer) return <div className="stack"><CardSkeleton lines={2} /><div className="grid-kpis"><CardSkeleton /><CardSkeleton /><CardSkeleton /></div></div>;
  const primary = customer.contacts.find((c) => c.is_primary) ?? customer.contacts[0];

  const tabs = [
    { id: 'overview', label: 'Overview', icon: 'dashboard' as const },
    { id: 'contacts', label: 'Contacts', count: customer.contacts.length },
    { id: 'addresses', label: 'Address book' },
    { id: 'sales-activity', label: 'Calls & visits' },
    ...(can('enquiries.read')?[{id:'opportunities',label:'Opportunities'}]:[]),
    {id:'history',label:'Business history'},
    {id:'commercial',label:'Pricing & classification'},
    ...(can('customers.merge.request')||can('customers.merge.approve')?[{id:'merges',label:'Duplicate review'}]:[]),
    { id: 'parts', label: 'Part numbers', count: customer.partMappings.filter((m) => m.status !== 'ARCHIVED').length },
    ...(can('enquiries.read') ? [{ id: 'enquiries', label: 'Enquiries' }] : []),
    ...(can('quotations.read') ? [{ id: 'quotes', label: 'Quotations' }] : []),
    ...(can('orders.read') ? [{ id: 'orders', label: 'Orders' }] : []),
    { id: 'invoices', label: 'Invoices' },
    ...(can('operations.read') ? [{ id: 'operations', label: 'Support & collections' }] : []),
    ...(customer.dues.financialAccess ? [{ id: 'dues', label: 'Dues' }] : []),
    ...(can('audit.read') ? [{ id: 'activity', label: 'Activity' }] : [])
  ];

  return (
    <>
      <nav className="ds-breadcrumbs" aria-label="Breadcrumb"><ol><li><Link href="/customers">Customers</Link></li><li><span aria-current="page">{customer.name}</span></li></ol></nav>
      <header className="ds-record page-enter">
        <span className="ds-record-avatar" aria-hidden="true">{initials(customer.name)}</span>
        <div style={{ minWidth: 0 }}>
          <div className="cluster"><h1 className="truncate" title={customer.name}>{customer.name}</h1><StatusBadge status={customer.status} />{customer.tally.linked ? <Badge tone="success">Tally linked</Badge> : <Badge tone="neutral">CRM only</Badge>}{customer.onboarding ? <StatusBadge status={customer.onboarding.status} /> : <Badge tone="neutral">Established record</Badge>}</div>
          <div className="ds-record-meta">
            {customer.gstin && <span className="mono"><Icon name="shield" />{customer.gstin}</span>}
            {customer.customer_code && <span><Icon name="audit" />{customer.customer_code}</span>}
            {customer.owner_name && <span><Icon name="user" />Owner: {customer.owner_name}</span>}
            {primary && <span><Icon name="user" />{primary.name}{primary.phone ? ` · ${primary.phone}` : ''}</span>}
            {primary?.email && <a href={`mailto:${primary.email}`} style={{ display: 'inline-flex', gap: 'var(--space-0-5)', alignItems: 'center' }}><Icon name="mail" />{primary.email}</a>}
          </div>
        </div>
        <div className="ds-record-actions">
          {!customer.identity?.merged&&can('enquiries.create') && <Link className="ds-button" data-variant="secondary" href={customerEnquiryHref(customer.id)}><Icon name="inbox" /><span>New enquiry</span></Link>}
          {!customer.identity?.merged&&can('customers.update') && <Button icon="settings" onClick={() => setEditing(true)}>Edit</Button>}
        </div>
      </header>

      {customer.identity?.merged&&<Notice tone="warning" title="Merged customer"><Link href={`/customers/${customer.identity.canonicalId}`}>Open the surviving customer #{customer.identity.canonicalId}</Link>. This original profile and its business records are retained for history.</Notice>}
      <section aria-label="Commercial terms" className="grid-kpis" style={{ marginBottom: 'var(--space-3)' }}>
        <StatCard label="Credit limit" value={formatMoney(customer.credit_limit, { places: 0 })} footnote={`${customer.credit_days} credit days`} />
        <StatCard label="Payment terms" value={<span style={{ fontSize: 'var(--text-lg)' }}>{customer.profile.payment_terms ?? 'Not set'}</span>} footnote={customer.profile.state_code ? `Place of supply state ${customer.profile.state_code}` : undefined} />
        {customer.dues.financialAccess && <StatCard label="Tally balance" value={customer.dues.available ? balanceText(customer, 0) : 'Unavailable'} footnote={customer.dues.available ? `Fetched ${formatDateTime(customer.dues.fetchedAt)}` : 'Link the exact Tally ledger to see it'} />}
      </section>

      {customer.onboarding && <Notice tone={customer.onboarding.status === 'APPROVED' ? 'success' : customer.onboarding.status === 'REJECTED' ? 'danger' : 'warning'} title={customer.onboarding.status === 'PENDING_APPROVAL' ? 'Customer awaiting independent billing review' : `Customer onboarding ${customer.onboarding.status.toLowerCase()}`}>
        Version {customer.onboarding.version} was submitted by {customer.onboarding.submitted_by_name}. {customer.onboarding.decision_reason ? `Last decision: ${customer.onboarding.decision_reason}` : 'A different eligible reviewer must decide it.'}
        {customer.onboarding.status === 'PENDING_APPROVAL' && can('customers.approve') && <span className="cluster" style={{ marginTop: 'var(--space-2)' }}><Button size="sm" onClick={() => setDecision('APPROVE')}>Approve for billing</Button><Button size="sm" variant="secondary" onClick={() => setDecision('REJECT')}>Reject</Button></span>}
      </Notice>}

      <Tabs label="Customer sections" value={tab} onChange={(t) => setTab(t as Tab)} items={tabs} />
      <TabPanel id={tab}>
        {['addresses','sales-activity','opportunities','history','commercial','merges'].includes(tab)&&<CustomerManagement customerId={customer.id} section={tab as 'addresses'|'sales-activity'|'opportunities'|'history'|'commercial'|'merges'} financial={customer.dues.financialAccess} onIdentityChanged={reload}/>}
        {tab === 'operations' && <CustomerOperations customerId={id} financial={customer.dues.financialAccess} />}
        {tab === 'overview' && <OverviewTab customer={customer} />}
        {tab === 'contacts' && <ContactsTab customer={customer} />}
        {tab === 'parts' && <PartsTab customer={customer} onChanged={reload} />}
        {(tab === 'enquiries' || tab === 'quotes' || tab === 'orders') && <HistoryTab customerId={customer.id} tab={tab} />}
        {tab === 'invoices' && (customer.dues.financialAccess?<CustomerManagement customerId={customer.id} section="history" financial initialKind="INVOICE_DOCUMENT"/>:<Notice tone="info">Invoice history is available to authorised Accounts and Owner users.</Notice>)}
        {tab === 'dues' && <Card title="Dues"><Notice tone="info" title={customer.dues.available ? balanceText(customer, 2) : 'Balance unavailable'}>{customer.dues.note}</Notice></Card>}
        {tab === 'activity' && <ActivityTab customerId={customer.id} />}
      </TabPanel>

      <CustomerForm open={editing} customer={customer} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); toast('success', 'Customer updated.'); reload(); }} />
      <ReasonDialog open={decision !== null} title={decision === 'APPROVE' ? 'Approve customer for billing' : 'Reject customer onboarding'} danger={decision === 'REJECT'} confirmLabel={decision === 'APPROVE' ? 'Approve' : 'Reject'} description="Your reason and identity will be retained in the audit trail. The original creator and the person who last submitted this customer cannot decide it." onClose={() => setDecision(null)} onConfirm={async reason => { if (!decision || !customer.onboarding) return; await api.data('POST', `/api/crm/customers/${customer.id}/onboarding-decision`, { decision, version: customer.onboarding.version, reason }); setDecision(null); toast('success', decision === 'APPROVE' ? 'Customer approved for billing.' : 'Customer onboarding rejected.'); reload(); }} />
    </>
  );
}

/** Tally signed closing balance; shown with Dr/Cr when Tally supplies it, otherwise with its sign. */
function balanceText(c: Customer, places: number): string {
  const value = c.dues.closingBalance ?? '0';
  return c.dues.drCr ? `${formatMoney(value.replace(/^-/, ''), { places })} ${c.dues.drCr}` : formatMoney(value, { places });
}

function OverviewTab({ customer }: { customer: Customer }) {
  return (
    <div className="grid-main-aside">
      <Card title="Details">
        <Facts items={[
          { label: 'Registered name', value: customer.name }, { label: 'GSTIN', value: customer.gstin ? <span className="mono">{customer.gstin}</span> : '—' },
          { label: 'PAN', value: customer.pan ? <span className="mono">{customer.pan}</span> : '—' }, { label: 'State code', value: customer.profile.state_code ?? '—' },
          { label: 'Customer code', value: customer.customer_code ?? '—' }, { label: 'Account owner', value: customer.owner_name ?? 'Not assigned' },
          { label: 'Backup owner', value: customer.profile.backup_owner_name ?? 'Not assigned' }, { label: 'Territory', value: customer.profile.territory ?? '—' },
          { label: 'Billing address', value: customer.billing_address ?? '—' }, { label: 'Shipping / site address', value: customer.shipping_address ?? '—' },
          { label: 'Location', value: [customer.city, customer.state, customer.pincode].filter(Boolean).join(', ') || '—' },
          { label: 'Dealership / relationship', value: customer.profile.dealership ?? '—' },
          { label: 'Brand relationships', value: customer.profile.brand_relationships?.join(', ') || '—' },
          { label: 'Customer since', value: formatDate(customer.created_at) }, { label: 'Internal notes', value: customer.notes ?? '—' }
        ]} />
      </Card>
      <Card title="Tally link">
        {customer.tally.linked ? <div className="stack-sm"><Badge tone="success">Linked to one ledger</Badge><p className="wrap-anywhere">{customer.tally.name}</p><p className="ds-cell-secondary">Read-only. Matching is by exact ledger name.</p></div>
          : customer.tally.name ? <Notice tone="warning" title="Ledger not found">“{customer.tally.name}” matched {customer.tally.matchCount} ledgers in the latest import.</Notice>
            : <p className="muted">Not linked. Edit the customer to choose the exact Tally ledger.</p>}
      </Card>
    </div>
  );
}

function ContactsTab({ customer }: { customer: Customer }) {
  if (!customer.contacts.length) return <Card title="Contacts"><EmptyState title="No contacts yet">Edit the customer to add buyers, accounts or site contacts.</EmptyState></Card>;
  return (
    <div className="grid-auto">
      {customer.contacts.map((c) => (
        <div key={c.id} className="ds-card ds-card-pad stack-sm">
          <div className="cluster-between"><strong>{c.name}</strong>{c.is_primary ? <Badge tone="info">Primary</Badge> : null}</div>
          {c.designation && <span className="muted">{c.designation}</span>}
          {c.phone && <a href={`tel:${c.phone}`} className="cluster"><Icon name="user" />{c.phone}</a>}
          {c.email && <a href={`mailto:${c.email}`} className="truncate">{c.email}</a>}
        </div>
      ))}
    </div>
  );
}

function PartsTab({ customer, onChanged }: { customer: Customer; onChanged: () => void }) {
  const api = useApi();
  const { can } = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState<PartMapping | 'new' | null>(null);
  const [item, setItem] = useState<Option | null>(null);
  const [part, setPart] = useState('');
  const [archive, setArchive] = useState<PartMapping | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const rows = customer.partMappings.filter((m) => m.status !== 'ARCHIVED');
  const open = (m: PartMapping | 'new') => { setEditing(m); setError(undefined); setPart(m === 'new' ? '' : m.customer_part_number); setItem(m === 'new' ? null : { value: String(m.item_id), label: m.part_code }); };
  const save = async () => {
    if (!item || !part.trim()) { setError('Choose our item and enter the customer’s part number.'); return; }
    setBusy(true);
    try {
      const body = { itemId: Number(item.value), customerPartNumber: part.trim(), status: 'ACTIVE' as const, ...(editing !== 'new' ? { reason: 'Part mapping updated' } : {}) };
      if (editing === 'new') await api.data('POST', `/api/crm/customers/${customer.id}/part-mappings`, body); else if (editing) await api.data('PATCH', `/api/crm/customers/${customer.id}/part-mappings/${editing.id}`, body);
      setEditing(null); toast('success', 'Part number saved.'); onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); } finally { setBusy(false); }
  };
  return (
    <>
      <DataTable<PartMapping> id="customer-parts" caption="Customer part numbers" rows={rows} rowKey={(m) => m.id}
        filters={can('customers.update') ? <Button icon="plus" variant="secondary" onClick={() => open('new')}>Map a part number</Button> : undefined}
        empty={<EmptyState title="No part numbers mapped">Map the customer’s material codes to our items, e.g. Johnson Lifts 215632 → JX2.5/2.</EmptyState>}
        columns={[
          { key: 'theirs', header: 'Customer part number', render: (m) => <span className="mono ds-cell-primary">{m.customer_part_number}</span> },
          { key: 'ours', header: 'Our item', render: (m) => <span className="mono">{m.part_code}</span> },
          { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status} /> }
        ]}
        rowActions={can('customers.update') ? (m) => <><Button size="sm" variant="ghost" onClick={() => open(m)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => setArchive(m)}>Archive</Button></> : undefined} />
      <Modal open={editing !== null} title={editing === 'new' ? 'Map a part number' : 'Edit part number'} onClose={() => setEditing(null)} footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button busy={busy} onClick={() => void save()}>Save</Button></>}>
        <TextField label="Customer’s part number" required value={part} onChange={(e) => setPart(e.target.value)} maxLength={200} />
        <Combobox label="Our item" required value={item} onChange={setItem} search={async (t) => (await api.get<{ data: { id: number; part_code: string; description: string }[] }>('/api/crm/items', { query: { search: t, status: 'ACTIVE', pageSize: 20 } })).data.map((i) => ({ value: String(i.id), label: i.part_code, hint: i.description }))} />
        {error && <Notice tone="danger">{error}</Notice>}
      </Modal>
      <ReasonDialog open={Boolean(archive)} title="Archive part number" danger confirmLabel="Archive" description={archive ? `${archive.customer_part_number} → ${archive.part_code}` : undefined} onClose={() => setArchive(null)}
        onConfirm={async (reason) => { if (!archive) return; await api.data('PATCH', `/api/crm/customers/${customer.id}/part-mappings/${archive.id}`, { itemId: archive.item_id, customerPartNumber: archive.customer_part_number, status: 'ARCHIVED', reason }); toast('success', 'Archived.'); onChanged(); }} />
    </>
  );
}

function HistoryTab({ customerId, tab }: { customerId: number; tab: 'enquiries' | 'quotes' | 'orders' }) {
  const api = useApi();
  const [state, reload] = useAsync((signal) => api.get<{ data: HistoryRow[] }>(`/api/crm/customers/${customerId}/history/${tab}`, { signal }), [customerId, tab]);
  const rows = useMemo(() => state.status === 'ready' ? state.data.data : state.data?.data, [state]);
  const label = { enquiries: 'enquiries', quotes: 'quotations', orders: 'sales orders' }[tab];
  return (
    <DataTable<HistoryRow> id={`customer-${tab}`} caption={`Customer ${label}`} rows={rows} rowKey={(r) => r.id} loading={state.status === 'loading'} error={state.status === 'error' ? state.error : undefined} onRetry={reload}
      empty={<EmptyState title={`No ${label} yet`} />}
      columns={[
        { key: 'number', header: 'Number', render: (r) => <Link className="mono ds-cell-primary" href={r.href??commercialRecordHref(tab,r.id,r.managed)}>{r.number}</Link> },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'created', header: 'Created', render: (r) => <span className="num">{formatDate(r.created_at)}</span> },
        { key: 'updated', header: 'Last updated', render: (r) => <span className="ds-cell-secondary">{formatDateTime(r.updated_at)}</span> }
      ]} />
  );
}

function ActivityTab({ customerId }: { customerId: number }) {
  const api = useApi();
  const [state, reload] = useAsync((signal) => api.get<{ data: { id: number; action: string; reason: string | null; at: string; user: string | null; module: string }[] }>('/api/v1/audit-logs', { query: { module: 'CUSTOMER', recordId: String(customerId), pageSize: 50 }, signal }), [customerId]);
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={reload} />;
  if (state.status === 'loading' && !state.data) return <CardSkeleton />;
  const rows = state.data?.data ?? [];
  return <Card title="Activity"><Timeline items={rows.map((a) => ({ id: a.id, title: titleCase(a.action), at: a.at, by: a.user ?? 'System', body: a.reason ? <Truncate text={a.reason} /> : undefined, icon: a.action === 'CREATE' ? 'plus' : 'settings' }))} empty="No changes recorded yet." /></Card>;
}

