'use client';

import Link from 'next/link';
import {RecordWorkspace} from '@/features/workflows/tally-imports';
import { Suspense, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api/provider';
import { useSession } from '@/lib/session';
import { formatDate, formatMoney, formatRelative, titleCase } from '@/lib/format';
import { Button, CardSkeleton, DataTable, EmptyState, PageHeader, SelectField, StatusBadge, Truncate, useAsync, useDebounced } from '@/components/ds';
import { quotationsApi, type QuoteListRow } from '@/features/quotations/api';
import { CostDrawer, HistoricalDrawer, PolicyDrawer } from '@/features/quotations/owner-tools';

const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'WON', 'LOST', 'EXPIRED', 'CANCELLED'];

function QuotationsList() {
  const client = useApi();
  const api = useMemo(() => quotationsApi(client), [client]);
  const { can } = useSession();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [tool, setTool] = useState<'policy' | 'costs' | 'history' | null>(null);
  const [state, reload] = useAsync((signal) => api.list({ page, search: debounced, status }, signal), [api, page, debounced, status]);
  const data = state.status === 'ready' ? state.data : state.data;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Quotations" crumbs={[{ label: 'Sales' }, { label: 'Quotations' }]}
        description="Draft → approval by a second person → sent → won or lost. Customers never see list price, discount, cost or margin."
        actions={<>
          {can('quotations.policy.manage') && <Button variant="secondary" icon="sliders" onClick={() => setTool('policy')}>Policy & letterhead</Button>}
          {can('quotations.cost.manage') && <Button variant="secondary" icon="rupee" onClick={() => setTool('costs')}>Item costs</Button>}
          {can('quotations.create') && <Link className="ds-button" data-variant="primary" href="/quotations/new"><span>+ New quotation</span></Link>}
        </>} />
      <RecordWorkspace kind="quotations">
      <DataTable<QuoteListRow> id="quotations" caption="Quotations" rows={data?.data} rowKey={(q) => q.id} loading={state.status === 'loading'} error={state.status === 'error' ? state.error : undefined} onRetry={reload}
        pagination={data ? { ...data.pagination } : undefined} onPage={setPage} onRowClick={(q) => router.push(`/quotations/${q.id}`)}
        search={{ value: search, onChange: (v) => { setSearch(v); setPage(1); }, placeholder: 'Search number or customer' }}
        currentQuery={{ search, status }} onApplySaved={(q) => { setSearch(q.search ?? ''); setStatus(q.status ?? ''); setPage(1); }}
        filters={<SelectField label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All statuses" options={STATUSES.map((s) => ({ value: s, label: titleCase(s) }))} />}
        empty={<EmptyState title={search || status ? 'No quotations match' : 'No quotations yet'} illustration={search ? 'search' : 'empty'}
          action={!search && can('quotations.create') ? <Link className="ds-button" data-variant="primary" href="/quotations/new"><span>Create a quotation</span></Link> : undefined}>
          {search || status ? 'Try another number, customer or status.' : 'Start from an enquiry or create one directly.'}</EmptyState>}
        columns={[
          { key: 'number', header: 'Quotation', render: (q) => <><span className="mono ds-cell-primary">{q.quotation_number}</span><br /><span className="ds-cell-secondary">v{q.version} · {formatRelative(q.updated_at)}</span></> },
          { key: 'customer', header: 'Customer', render: (q) => <Truncate text={q.customer_name} /> },
          { key: 'status', header: 'Status', render: (q) => <StatusBadge status={q.status} /> },
          { key: 'valid', header: 'Valid until', render: (q) => <span className={q.validUntil < today && ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT'].includes(q.status) ? 'ds-delta' : undefined} data-tone="down">{formatDate(q.validUntil)}</span> },
          { key: 'total', header: 'Total', numeric: true, render: (q) => <strong>{formatMoney(q.total)}</strong> }
        ]} />
      {data && data.legacyCount > 0 && <p style={{ marginTop: 'var(--space-2)' }}><Button variant="link" onClick={() => setTool('history')}>View {data.legacyCount} older quotation{data.legacyCount === 1 ? '' : 's'} from before the approval workflow</Button></p>}
      </RecordWorkspace>
      <PolicyDrawer open={tool === 'policy'} onClose={() => { setTool(null); reload(); }} />
      <CostDrawer open={tool === 'costs'} onClose={() => setTool(null)} />
      <HistoricalDrawer open={tool === 'history'} onClose={() => setTool(null)} />
    </>
  );
}

export default function QuotationsPage() { return <Suspense fallback={<CardSkeleton />}><QuotationsList /></Suspense>; }
