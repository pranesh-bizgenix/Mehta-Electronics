'use client';

import { useState } from 'react';
import { api, apiData, newIdempotencyKey, ApiError, type Paginated } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, DataTable, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination, ReasonDialog, Select, StatusBadge, formatDateTime, useAsync, useToast } from '@/components/ui';

interface Draft { id: string; status: string; workflowKey: string | null; category: string; customerId: number; customerName?: string; recipients: string[]; subject: string; body: string; approved: boolean; createdAt: string }
interface Gate { gate: string; passed: boolean; message: string }
interface GateStatus { draft: Draft; passed: boolean; results: Gate[] }

const GATE_LABEL: Record<string, string> = {
  VERIFIED_RECORD: 'Verified CRM record', REGISTERED_EMAIL: 'Registered customer email', MANUAL_RESPONSE_LIST: 'Not on the manual-response list',
  WORKFLOW_SWITCH: 'Workflow switch ON', CUSTOMER_CHECKLIST: 'Customer ticked for this category', DRAFT_APPROVED: 'Approved by an employee', NOT_BANK: 'Not a bank address'
};

/** Draft-first outbound messages: nothing is sent until every gate passes. */
export default function MessagesPage() {
  const { can } = useSession();
  const toast = useToast();
  const [status, setStatus] = useState('DRAFT');
  const [page, setPage] = useState(1);
  const [list, reload] = useAsync(() => api<Paginated<Draft>>('/api/v1/messages/drafts', { query: { status, page } }), [status, page]);
  const [open, setOpen] = useState<Draft | null>(null);
  const [gates, reloadGates] = useAsync(() => open ? apiData<GateStatus>(`/api/v1/messages/drafts/${open.id}`) : Promise.resolve(null), [open?.id]);
  const [act, setAct] = useState<'approve' | 'reject' | null>(null);
  const [sendKey, setSendKey] = useState(newIdempotencyKey);
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!open) return;
    setSending(true);
    try {
      await apiData('/api/v1/messages/send', { method: 'POST', idempotencyKey: sendKey, body: { draftId: open.id } });
      toast('ok', 'Message sent.'); setOpen(null); setSendKey(newIdempotencyKey()); reload();
    } catch (e) {
      toast('bad', e instanceof ApiError ? e.message : 'Not sent.');
      if (e instanceof ApiError && e.code === 'GATE_BLOCKED') setSendKey(newIdempotencyKey());
      reloadGates();
    } finally { setSending(false); }
  };

  return (
    <>
      <PageHeader title="Outbound drafts" description="Every automated message waits here. It is sent only when the workflow switch is ON, the customer is ticked for the category, the CRM record and email are verified, and an employee approves the exact text." />
      <div className="filters">
        <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All"
          options={['DRAFT', 'APPROVED', 'SENDING', 'SENT', 'REJECTED'].map((v) => ({ value: v, label: v.toLowerCase() }))} />
      </div>
      {list.status === 'loading' && <LoadingState />}
      {list.status === 'error' && <ErrorState error={list.error} onRetry={reload} />}
      {list.status === 'ready' && (
        <>
          <DataTable caption="Drafts" rows={list.data.data} rowKey={(d) => d.id} onRowClick={setOpen} empty={<EmptyState title="No drafts">Drafts appear when an approved workflow prepares a message.</EmptyState>} columns={[
            { key: 'subject', header: 'Subject', render: (d) => <span className="wrap-anywhere"><strong>{d.subject}</strong><br /><span className="muted">{d.category.replace(/_/g, ' ')}</span></span> },
            { key: 'customer', header: 'Customer', render: (d) => d.customerName ?? `#${d.customerId}` },
            { key: 'to', header: 'To', render: (d) => <span className="wrap-anywhere">{d.recipients.join(', ')}</span> },
            { key: 'status', header: 'Status', render: (d) => <StatusBadge status={d.status} /> },
            { key: 'created', header: 'Created', render: (d) => formatDateTime(d.createdAt) }
          ]} />
          <Pagination {...list.data.pagination} onPage={setPage} />
        </>
      )}
      <Modal open={Boolean(open)} title={open?.subject ?? ''} onClose={() => setOpen(null)} footer={open && can('outbound.approve') && !['SENT', 'REJECTED', 'SENDING'].includes(open.status) ? <>
        <Button variant="secondary" onClick={() => setAct('reject')}>Reject</Button>
        {!open.approved && <Button variant="secondary" onClick={() => setAct('approve')}>Approve text</Button>}
        <Button busy={sending} disabled={gates.status !== 'ready' || !gates.data?.passed} onClick={() => void send()}>Send</Button>
      </> : undefined}>
        {open && <>
          <p className="muted">To {open.recipients.join(', ')}</p>
          <pre className="secret" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font)' }}>{open.body}</pre>
          <h3>Send checks</h3>
          {gates.status === 'loading' && <LoadingState />}
          {gates.status === 'error' && <ErrorState error={gates.error} onRetry={reloadGates} />}
          {gates.status === 'ready' && gates.data && (
            <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
              {gates.data.results.map((g) => <li key={g.gate} className="row"><StatusBadge status={g.passed ? 'APPROVED' : 'BLOCKED'} label={g.passed ? 'pass' : 'blocked'} /><span><strong>{GATE_LABEL[g.gate] ?? g.gate}</strong> — {g.message}</span></li>)}
            </ul>
          )}
        </>}
      </Modal>
      <ReasonDialog open={act !== null} title={act === 'approve' ? 'Approve this text' : 'Reject draft'} danger={act === 'reject'} confirmLabel={act === 'approve' ? 'Approve' : 'Reject'}
        onClose={() => setAct(null)}
        onConfirm={async (reason) => {
          if (!open) return;
          const updated = await apiData<Draft>(`/api/v1/messages/drafts/${open.id}/${act}`, { method: 'POST', body: { reason } });
          setOpen(act === 'reject' ? null : { ...open, ...updated }); toast('ok', act === 'approve' ? 'Draft approved.' : 'Draft rejected.'); reload(); reloadGates();
        }} />
    </>
  );
}
