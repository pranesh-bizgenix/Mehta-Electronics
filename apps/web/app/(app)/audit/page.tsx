'use client';

import { useState } from 'react';
import { useApi } from '@/lib/api/provider';
import type { Paginated } from '@/lib/api/client';
import { formatDateTime, titleCase } from '@/lib/format';
import { Button, DataTable, DateRangeField, Drawer, EmptyState, PageHeader, SelectField, TextField, Truncate, useAsync, type DateRange } from '@/components/ds';

interface AuditRow { id: number; userId: number | null; user: string | null; module: string; recordId: string; action: string; before: unknown; after: unknown; reason: string | null; ip: string | null; at: string }
interface UserOption { id: number; name: string }
const brief = (v: unknown) => v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v);

/** S-25 Audit trail: user, date range, module and record. Entries cannot be edited or deleted. */
export default function AuditPage() {
  const api = useApi();
  const [userId, setUserId] = useState('');
  const [module, setModule] = useState('');
  const [recordId, setRecordId] = useState('');
  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditRow | null>(null);
  const [users] = useAsync(() => api.data<UserOption[]>('GET', '/api/v1/users').catch(() => []), []);
  const [list, reload] = useAsync((signal) => api.get<Paginated<AuditRow> & { modules: string[] }>('/api/v1/audit-logs', { query: { userId, module, recordId, from: range.from, to: range.to, page }, signal }), [userId, module, recordId, range.from, range.to, page]);
  const data = list.status === 'ready' ? list.data : list.data;
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader title="Audit trail" crumbs={[{ label: 'Admin' }, { label: 'Audit trail' }]} description="Every change, approval and sign-in, with who, when, before and after. Entries cannot be edited or deleted." />
      <div className="ds-card ds-card-pad" style={{ marginBottom: 'var(--space-2)' }}><DateRangeField value={range} onChange={(r) => { setRange(r); reset(); }} label="Audit period" /></div>
      <DataTable<AuditRow> id="audit" caption="Audit entries" rows={data?.data} rowKey={(r) => r.id} onRowClick={setOpen} loading={list.status === 'loading'} error={list.status === 'error' ? list.error : undefined} onRetry={reload}
        pagination={data?.pagination} onPage={setPage} currentQuery={{ userId, module, recordId }} onApplySaved={(q) => { setUserId(q.userId ?? ''); setModule(q.module ?? ''); setRecordId(q.recordId ?? ''); reset(); }}
        filters={<>
          <SelectField label="User" value={userId} onChange={(e) => { setUserId(e.target.value); reset(); }} placeholder="Anyone" options={users.status === 'ready' ? users.data.map((u) => ({ value: String(u.id), label: u.name })) : []} />
          <SelectField label="Module" value={module} onChange={(e) => { setModule(e.target.value); reset(); }} placeholder="All" options={(data?.modules ?? []).map((m) => ({ value: m, label: titleCase(m) }))} />
          <TextField label="Record ID" value={recordId} maxLength={80} onChange={(e) => { setRecordId(e.target.value.trim()); reset(); }} />
        </>}
        empty={<EmptyState title="No entries match" illustration="search">Widen the date range or clear a filter.</EmptyState>}
        columns={[
          { key: 'at', header: 'When', render: (r) => <span className="num">{formatDateTime(r.at)}</span> },
          { key: 'user', header: 'User', render: (r) => r.user ?? <span className="subtle">System</span> },
          { key: 'module', header: 'Module', render: (r) => titleCase(r.module) },
          { key: 'action', header: 'Action', render: (r) => <span className="ds-cell-primary">{titleCase(r.action)}</span> },
          { key: 'record', header: 'Record', render: (r) => <Truncate className="mono" text={r.recordId} /> },
          { key: 'reason', header: 'Reason', render: (r) => <Truncate text={r.reason ?? '—'} /> },
          { key: 'ip', header: 'IP', optional: true, render: (r) => <span className="mono">{r.ip ?? '—'}</span> }
        ]} />
      <Drawer open={Boolean(open)} title={open ? `${titleCase(open.action)} · ${titleCase(open.module)}` : ''} description={open ? `${formatDateTime(open.at)} · ${open.user ?? 'System'}` : undefined} onClose={() => setOpen(null)}
        footer={<Button variant="secondary" onClick={() => setOpen(null)}>Close</Button>}>
        {open && <div className="stack">
          <dl className="ds-facts"><div><dt>Record</dt><dd className="mono">{open.recordId}</dd></div><div><dt>IP address</dt><dd className="mono">{open.ip ?? '—'}</dd></div><div><dt>Reason</dt><dd>{open.reason ?? '—'}</dd></div></dl>
          <h3>Before</h3><pre className="ds-secret" style={{ textAlign: 'start', whiteSpace: 'pre-wrap' }}>{JSON.stringify(open.before, null, 2) ?? '—'}</pre>
          <h3>After</h3><pre className="ds-secret" style={{ textAlign: 'start', whiteSpace: 'pre-wrap' }}>{brief(open.after) === '—' ? '—' : JSON.stringify(open.after, null, 2)}</pre>
        </div>}
      </Drawer>
    </>
  );
}
