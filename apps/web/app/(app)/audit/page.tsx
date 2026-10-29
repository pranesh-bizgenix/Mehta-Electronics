'use client';

import { useState } from 'react';
import { api, apiData, type Paginated } from '@/lib/api';
import { Button, DataTable, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, Select, TextInput, formatDateTime, useAsync } from '@/components/ui';

interface AuditRow { id: number; userId: number | null; user: string | null; module: string; recordId: string; action: string; before: unknown; after: unknown; reason: string | null; ip: string | null; at: string }
interface UserOption { id: number; name: string }

const brief = (v: unknown) => v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v);

/** S-25 Audit trail: search by user, date, module and record (owner only by default). */
export default function AuditPage() {
  const [filters, setFilters] = useState({ userId: '', from: '', to: '', module: '', recordId: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [users] = useAsync(() => apiData<UserOption[]>('/api/v1/users').catch(() => []), []);
  const [list, reload] = useAsync(() => api<Paginated<AuditRow> & { modules: string[] }>('/api/v1/audit-logs', { query: { ...applied, page } }), [applied, page]);

  return (
    <>
      <PageHeader title="Audit trail" description="Every change, approval and sign-in. Records cannot be edited or deleted." />
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(filters); }}>
        <Select label="User" value={filters.userId} onChange={(e) => setFilters({ ...filters, userId: e.target.value })} placeholder="Anyone"
          options={users.status === 'ready' ? users.data.map((u) => ({ value: String(u.id), label: u.name })) : []} />
        <TextInput label="From" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <TextInput label="To" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        <Select label="Module" value={filters.module} onChange={(e) => setFilters({ ...filters, module: e.target.value })} placeholder="All"
          options={list.status === 'ready' ? list.data.modules.map((m) => ({ value: m, label: m.replace(/_/g, ' ').toLowerCase() })) : []} />
        <TextInput label="Record" value={filters.recordId} maxLength={80} onChange={(e) => setFilters({ ...filters, recordId: e.target.value.trim() })} />
        <Button type="submit">Search</Button>
      </form>
      {list.status === 'loading' && <LoadingState />}
      {list.status === 'error' && <ErrorState error={list.error} onRetry={reload} />}
      {list.status === 'ready' && (
        <>
          <DataTable caption="Audit entries" rows={list.data.data} rowKey={(r) => r.id} empty={<EmptyState title="No audit entries match" />} columns={[
            { key: 'at', header: 'When', render: (r) => formatDateTime(r.at) },
            { key: 'user', header: 'User', render: (r) => r.user ?? 'System' },
            { key: 'module', header: 'Module', render: (r) => r.module.replace(/_/g, ' ').toLowerCase() },
            { key: 'record', header: 'Record', render: (r) => <span className="mono wrap-anywhere">{r.recordId}</span> },
            { key: 'action', header: 'Action', render: (r) => r.action.replace(/_/g, ' ').toLowerCase() },
            { key: 'change', header: 'Before → after', render: (r) => <span className="mono wrap-anywhere" title={`${brief(r.before)} → ${brief(r.after)}`}>{brief(r.before).slice(0, 120)} → {brief(r.after).slice(0, 160)}</span> },
            { key: 'reason', header: 'Reason', render: (r) => <span className="wrap-anywhere">{r.reason ?? '—'}</span> }
          ]} />
          <Pagination {...list.data.pagination} onPage={setPage} />
        </>
      )}
    </>
  );
}
