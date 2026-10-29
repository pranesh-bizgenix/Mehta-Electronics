'use client';

import { useState } from 'react';
import { api, type Paginated } from '@/lib/api';
import { DataTable, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, Select, StatusBadge, formatDateTime, useAsync } from '@/components/ui';

interface WorkRow {
  id: string; entityType: string; entityId: string; title: string; department: string | null; status: string; owner: string | null; backup: string | null;
  dueAt: string | null; slaState: string; escalationLevel: number; escalatedToMe: boolean; overdue: boolean; minutesRemaining: number | null;
}

function slaText(row: WorkRow): string {
  if (row.slaState === 'NOT_CONFIGURED') return 'SLA not configured';
  if (row.minutesRemaining === null) return '—';
  const m = Math.abs(row.minutesRemaining);
  const text = m >= 1440 ? `${Math.round(m / 1440)}d` : m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`;
  return row.minutesRemaining < 0 ? `${text} overdue` : `${text} left`;
}

/** My Work: everything I own or that escalated to me, ordered by due time. */
export default function MyWorkPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [state, reload] = useAsync(() => api<Paginated<WorkRow>>('/api/v1/me/work', { query: { page, pageSize: 25, status } }), [page, status]);

  return (
    <>
      <PageHeader title="My work" description="Records you own or that were escalated to you. The SLA clock follows the owner's business-hours policy." />
      <div className="filters">
        <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All open"
          options={['OPEN', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELLED'].map((v) => ({ value: v, label: v.replace('_', ' ').toLowerCase() }))} />
      </div>
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}
      {state.status === 'ready' && (
        <>
          <DataTable caption="My work" rows={state.data.data} rowKey={(r) => r.id}
            empty={<EmptyState title="Nothing assigned to you">New enquiries, quotations, orders and tasks appear here when you own them.</EmptyState>}
            columns={[
              { key: 'title', header: 'Record', render: (r) => <span className="wrap-anywhere"><strong>{r.title}</strong><br /><span className="muted">{r.entityType.replace('_', ' ').toLowerCase()}</span></span> },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'due', header: 'Due', render: (r) => <>{formatDateTime(r.dueAt)}<br /><span className={r.overdue ? 'overdue' : 'muted'}>{slaText(r)}</span></> },
              { key: 'sla', header: 'SLA', render: (r) => <StatusBadge status={r.slaState} /> },
              { key: 'owner', header: 'Owner / backup', render: (r) => <>{r.owner ?? '—'}<br /><span className="muted">{r.backup ?? 'No backup'}</span></> },
              { key: 'esc', header: 'Escalation', render: (r) => r.escalatedToMe ? <StatusBadge status="WAITING" label={r.escalationLevel === 2 ? 'escalated to you (manager)' : 'escalated to you (backup)'} /> : r.escalationLevel ? `Level ${r.escalationLevel}` : '—' }
            ]} />
          <Pagination {...state.data.pagination} onPage={setPage} />
        </>
      )}
    </>
  );
}
