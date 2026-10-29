'use client';

import { useState } from 'react';
import { useApi } from '@/lib/api/provider';
import type { Paginated } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import { formatDateTime, formatRelative, titleCase } from '@/lib/format';
import { Button, DataTable, EmptyState, PageHeader, ReasonDialog, SelectField, StatusBadge, Truncate, useAsync, useToast } from '@/components/ds';

interface ExceptionRow {
  id: string; type: string; typeLabel: string; entityType: string; entityId: string; summary: string; status: string;
  department: string | null; backdateTo: string | null; raisedBy: string; raisedById: number; createdAt: string; decidedBy: string | null; decisionReason: string | null;
}

/** Exception queue: anything that stops a process until a different person decides. */
export default function ExceptionsPage() {
  const api = useApi();
  const { can, state: session } = useSession();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('OPEN');
  const [department, setDepartment] = useState('');
  const [list, reload] = useAsync((signal) => api.get<Paginated<ExceptionRow>>('/api/v1/exceptions', { query: { page, status, department }, signal }), [page, status, department]);
  const [deciding, setDeciding] = useState<{ row: ExceptionRow; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const me = session.kind === 'ready' ? session.user.id : 0;
  const data = list.status === 'ready' ? list.data : list.data;

  return (
    <>
      <PageHeader title="Exceptions" crumbs={[{ label: 'Work' }, { label: 'Exceptions' }]}
        description="Unknown codes, low margin, credit limits, failed checks, Do Not Quote and backdating. The person who raised an exception cannot decide it." />
      <DataTable<ExceptionRow> id="exceptions" caption="Exceptions" rows={data?.data} rowKey={(r) => r.id} loading={list.status === 'loading'} error={list.status === 'error' ? list.error : undefined} onRetry={reload}
        pagination={data?.pagination} onPage={setPage} currentQuery={{ status, department }} onApplySaved={(q) => { setStatus(q.status ?? ''); setDepartment(q.department ?? ''); setPage(1); }}
        filters={<>
          <SelectField label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All" options={['OPEN', 'APPROVED', 'REJECTED'].map((v) => ({ value: v, label: titleCase(v) }))} />
          <SelectField label="Department" value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1); }} placeholder="All" options={['SALES', 'OPERATIONS', 'ACCOUNTS', 'CUSTOMER_SUPPORT'].map((v) => ({ value: v, label: titleCase(v) }))} />
        </>}
        empty={<EmptyState title={status === 'OPEN' ? 'No open exceptions' : 'No exceptions match'} illustration={status === 'OPEN' ? 'done' : 'search'}>{status === 'OPEN' ? 'Processes stopped for review will appear here.' : 'Try another status or department.'}</EmptyState>}
        columns={[
          { key: 'type', header: 'Type', render: (r) => <span className="ds-cell-primary">{r.typeLabel}</span> },
          { key: 'summary', header: 'Summary', render: (r) => <div style={{ minWidth: 0 }}><Truncate text={r.summary} />{r.backdateTo && <span className="ds-cell-secondary">Backdate to {formatDateTime(r.backdateTo)}</span>}</div> },
          { key: 'record', header: 'Record', optional: true, render: (r) => <span className="mono">{titleCase(r.entityType)} {r.entityId.slice(0, 10)}</span> },
          { key: 'raised', header: 'Raised', render: (r) => <><span>{r.raisedBy}</span><br /><span className="ds-cell-secondary" title={formatDateTime(r.createdAt)}>{formatRelative(r.createdAt)}</span></> },
          { key: 'status', header: 'Status', render: (r) => <><StatusBadge status={r.status} />{r.decidedBy && <><br /><span className="ds-cell-secondary">{r.decidedBy}: {r.decisionReason}</span></>}</> }
        ]}
        rowActions={(r) => r.status === 'OPEN' && can('exceptions.decide') ? (r.raisedById === me ? <span className="subtle">Raised by you</span> : <>
          <Button size="sm" variant="secondary" onClick={() => setDeciding({ row: r, decision: 'REJECT' })}>Reject</Button>
          <Button size="sm" onClick={() => setDeciding({ row: r, decision: 'APPROVE' })}>Approve</Button>
        </>) : null} />
      <ReasonDialog open={Boolean(deciding)} title={deciding?.decision === 'APPROVE' ? 'Approve exception' : 'Reject exception'} confirmLabel={deciding?.decision === 'APPROVE' ? 'Approve' : 'Reject'}
        danger={deciding?.decision === 'REJECT'} description={deciding?.row.summary} onClose={() => setDeciding(null)}
        onConfirm={async (reason) => {
          if (!deciding) return;
          await api.data('POST', `/api/v1/approvals/${deciding.row.id}/decide`, { decision: deciding.decision, reason });
          toast('success', deciding.decision === 'APPROVE' ? 'Exception approved.' : 'Exception rejected.'); reload();
        }} />
    </>
  );
}
