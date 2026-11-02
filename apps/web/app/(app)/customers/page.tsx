'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { formatMoney, formatRelative } from '@/lib/format';
import { Avatar, Badge, Button, CardSkeleton, DataTable, EmptyState, PageHeader, SelectField, StatusBadge, Truncate, useToast } from '@/components/ds';
import { useCustomerList } from '@/features/customers/hooks';
import { RecordWorkspace } from '@/features/workflows/tally-imports';
import { CustomerForm } from '@/features/customers/customer-form';
import type { CustomerRow } from '@/features/customers/api';

function CustomersList() {
  const { can } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { state, data, query, setQuery, setPage, reload } = useCustomerList();
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (params.get('new') && can('customers.create')) setCreating(true); }, [params, can]);

  return (
    <>
      <PageHeader title="Customers" crumbs={[{ label: 'Sales' }, { label: 'Customers' }]}
        description="One record per customer: contacts, credit, Tally link and history. Tally balances stay read-only."
        actions={can('customers.create') && <Button icon="plus" onClick={() => setCreating(true)}>New customer</Button>} />
      <RecordWorkspace kind="customers">
      <DataTable<CustomerRow> id="customers" caption="Customers" rows={data?.data} rowKey={(c) => c.id} loading={state.status === 'loading'} error={state.status === 'error' ? state.error : undefined} onRetry={reload}
        pagination={data?.pagination} onPage={setPage} onRowClick={(c) => router.push(`/customers/${c.id}`)}
        search={{ value: query.search, onChange: (search) => setQuery({ search }), placeholder: 'Search name, GSTIN or code' }}
        currentQuery={{ search: query.search, status: query.status }} onApplySaved={(q) => setQuery({ search: q.search ?? '', status: q.status ?? '' })}
        filters={<SelectField label="Status" value={query.status} onChange={(e) => setQuery({ status: e.target.value })} placeholder="All statuses" options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'ON_HOLD', label: 'On hold' }, { value: 'INACTIVE', label: 'Inactive' }]} />}
        empty={<EmptyState title={query.search || query.status ? 'No customers match' : 'No customers yet'} illustration={query.search ? 'search' : 'empty'}
          action={!query.search && can('customers.create') ? <Button icon="plus" onClick={() => setCreating(true)}>Add your first customer</Button> : undefined}>
          {query.search ? 'Try a shorter name, the GSTIN, or clear the filter.' : 'Create customers here or from Tally reconciliation.'}</EmptyState>}
        columns={[
          { key: 'name', header: 'Customer', render: (c) => <span className="cluster" style={{ flexWrap: 'nowrap', minWidth: 0 }}><Avatar name={c.name} /><span style={{ minWidth: 0 }}><Truncate className="ds-cell-primary" text={c.name} /><span className="ds-cell-secondary">{c.customer_code ?? 'No code'}</span></span></span> },
          { key: 'gstin', header: 'GSTIN', render: (c) => c.gstin ? <span className="mono">{c.gstin}</span> : <span className="subtle">—</span> },
          { key: 'tally', header: 'Tally', render: (c) => c.tally_linked ? <Badge tone="success">Linked</Badge> : <Badge tone="neutral">CRM only</Badge> },
          { key: 'credit', header: 'Credit limit', numeric: true, render: (c) => formatMoney(c.credit_limit, { places: 0 }) },
          { key: 'terms', header: 'Terms', render: (c) => <Truncate text={c.payment_terms ?? `${c.credit_days} days`} /> },
          { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
          { key: 'updated', header: 'Updated', optional: true, render: (c) => <span className="ds-cell-secondary">{formatRelative(c.updated_at)}</span> }
        ]} />
      </RecordWorkspace>
      {can('customers.create') && <CustomerForm open={creating} onClose={() => setCreating(false)} onSaved={(c) => { setCreating(false); toast('success', `${c.name} created.`); router.push(`/customers/${c.id}`); }} />}
    </>
  );
}

export default function CustomersPage() { return <Suspense fallback={<CardSkeleton />}><CustomersList /></Suspense>; }
