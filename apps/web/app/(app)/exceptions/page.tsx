'use client';

import { useState } from 'react';
import { api, apiData, type Paginated } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, DataTable, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, ReasonDialog, Select, StatusBadge, formatDateTime, useAsync, useToast } from '@/components/ui';

interface ExceptionRow {
  id: string; type: string; typeLabel: string; entityType: string; entityId: string; summary: string; details: Record<string, unknown>; status: string;
  department: string | null; backdateTo: string | null; raisedBy: string; raisedById: number; createdAt: string; decidedBy: string | null; decidedAt: string | null; decisionReason: string | null;
}

/** Exception queue: anything that stops a process until a different person approves or rejects it. */
export default function ExceptionsPage() {
  const { can, state: session } = useSession();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('OPEN');
  const [department, setDepartment] = useState('');
  const [list, reload] = useAsync(() => api<Paginated<ExceptionRow>>('/api/v1/exceptions', { query: { page, status, department } }), [page, status, department]);
  const [deciding, setDeciding] = useState<{ row: ExceptionRow; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const me = session.kind === 'ready' ? session.user.id : 0;

  return (
    <>
      <PageHeader title="Exception queue" description="Unknown codes, low margin, credit exceeded, failed checks, Do Not Quote and backdating requests. The person who raised an exception cannot decide it." />
      <div className="filters">
        <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All"
          options={['OPEN', 'APPROVED', 'REJECTED'].map((v) => ({ value: v, label: v.toLowerCase() }))} />
        <Select label="Department" value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1); }} placeholder="All"
          options={['SALES', 'OPERATIONS', 'ACCOUNTS', 'CUSTOMER_SUPPORT'].map((v) => ({ value: v, label: v.replace('_', ' ').toLowerCase() }))} />
      </div>
      {list.status === 'loading' && <LoadingState />}
      {list.status === 'error' && <ErrorState error={list.error} onRetry={reload} />}
      {list.status === 'ready' && (
        <>
          <DataTable caption="Exceptions" rows={list.data.data} rowKey={(r) => r.id}
            empty={<EmptyState title={status === 'OPEN' ? 'No open exceptions' : 'No exceptions match these filters'} />}
            columns={[
              { key: 'type', header: 'Type', render: (r) => <strong>{r.typeLabel}</strong> },
              { key: 'summary', header: 'Summary', render: (r) => <span className="wrap-anywhere">{r.summary}{r.backdateTo && <><br /><span className="muted">Backdate to {formatDateTime(r.backdateTo)}</span></>}</span> },
              { key: 'record', header: 'Record', render: (r) => <span className="mono">{r.entityType} {r.entityId.slice(0, 12)}</span> },
              { key: 'raised', header: 'Raised', render: (r) => <>{r.raisedBy}<br /><span className="muted">{formatDateTime(r.createdAt)}</span></> },
              { key: 'status', header: 'Status', render: (r) => <><StatusBadge status={r.status} />{r.decidedBy && <><br /><span className="muted">{r.decidedBy}: {r.decisionReason}</span></>}</> },
              { key: 'actions', header: 'Decision', render: (r) => r.status === 'OPEN' && can('exceptions.decide') ? (
                r.raisedById === me ? <span className="muted">Raised by you</span> : <div className="row">
                  <Button variant="secondary" onClick={() => setDeciding({ row: r, decision: 'REJECT' })}>Reject</Button>
                  <Button onClick={() => setDeciding({ row: r, decision: 'APPROVE' })}>Approve</Button>
                </div>) : '—' }
            ]} />
          <Pagination {...list.data.pagination} onPage={setPage} />
        </>
      )}
      <ReasonDialog open={Boolean(deciding)} title={deciding?.decision === 'APPROVE' ? 'Approve exception' : 'Reject exception'} confirmLabel={deciding?.decision === 'APPROVE' ? 'Approve' : 'Reject'}
        danger={deciding?.decision === 'REJECT'} onClose={() => setDeciding(null)}
        onConfirm={async (reason) => {
          if (!deciding) return;
          await apiData(`/api/v1/approvals/${deciding.row.id}/decide`, { method: 'POST', body: { decision: deciding.decision, reason } });
          toast('ok', deciding.decision === 'APPROVE' ? 'Exception approved.' : 'Exception rejected.'); reload();
        }}>
        {deciding && <p className="wrap-anywhere">{deciding.row.summary}</p>}
      </ReasonDialog>
    </>
  );
}
