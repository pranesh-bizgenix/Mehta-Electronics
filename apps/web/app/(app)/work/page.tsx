'use client';

import { useState } from 'react';
import { useApi } from '@/lib/api/provider';
import type { Paginated } from '@/lib/api/client';
import { formatDateTime, titleCase } from '@/lib/format';
import { DataTable, EmptyState, PageHeader, SelectField, SlaChip, StatusBadge, Truncate, useAsync } from '@/components/ds';

interface WorkRow {
  id: string; entityType: string; entityId: string; title: string; department: string | null; status: string; owner: string | null; backup: string | null;
  dueAt: string | null; slaState: string; escalationLevel: number; escalatedToMe: boolean; overdue: boolean;
}

/** My work: everything I own or that escalated to me, earliest due first. */
export default function MyWorkPage() {
  const api = useApi();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [state, reload] = useAsync((signal) => api.get<Paginated<WorkRow>>('/api/v1/me/work', { query: { page, pageSize: 25, status }, signal }), [page, status]);
  const data = state.status === 'ready' ? state.data : state.data;

  return (
    <>
      <PageHeader title="My work" crumbs={[{ label: 'Overview', href: '/dashboard' }, { label: 'My work' }]}
        description="Records you own or that were escalated to you. The SLA clock follows the owner’s business-hours policy." />
      <DataTable<WorkRow> id="my-work" caption="My work" rows={data?.data} loading={state.status === 'loading'} error={state.status === 'error' ? state.error : undefined} onRetry={reload}
        rowKey={(r) => r.id} pagination={data?.pagination} onPage={setPage}
        filters={<SelectField label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All open" options={['OPEN', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELLED'].map((v) => ({ value: v, label: titleCase(v) }))} />}
        empty={<EmptyState title="Nothing assigned to you" illustration="done">New enquiries, quotations, orders and tasks appear here when you own them.</EmptyState>}
        columns={[
          { key: 'title', header: 'Record', render: (r) => <div style={{ minWidth: 0 }}><Truncate className="ds-cell-primary" text={r.title} /><span className="ds-cell-secondary">{titleCase(r.entityType)}{r.department ? ` · ${titleCase(r.department)}` : ''}</span></div> },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'sla', header: 'SLA', render: (r) => <SlaChip dueAt={r.dueAt} state={r.slaState} /> },
          { key: 'due', header: 'Due', render: (r) => <span className="num">{formatDateTime(r.dueAt)}</span>, optional: true },
          { key: 'owner', header: 'Owner / backup', render: (r) => <><span>{r.owner ?? '—'}</span><br /><span className="ds-cell-secondary">{r.backup ?? 'No backup'}</span></> },
          { key: 'esc', header: 'Escalation', render: (r) => r.escalatedToMe ? <StatusBadge status="WAITING" label={r.escalationLevel === 2 ? 'Escalated to you · manager' : 'Escalated to you · backup'} /> : r.escalationLevel ? `Level ${r.escalationLevel}` : <span className="subtle">—</span> }
        ]} />
    </>
  );
}
