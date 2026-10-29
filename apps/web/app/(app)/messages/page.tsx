'use client';

import { useState } from 'react';
import { useApi } from '@/lib/api/provider';
import { ApiError, newIdempotencyKey, type Paginated } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import { formatRelative, titleCase } from '@/lib/format';
import { Button, CardSkeleton, DataTable, Drawer, EmptyState, ErrorState, Icon, PageHeader, ReasonDialog, SelectField, StatusBadge, Stepper, Truncate, useAsync, useToast, type Step } from '@/components/ds';

interface Draft { id: string; status: string; workflowKey: string | null; category: string; customerId: number; customerName?: string; recipients: string[]; subject: string; body: string; approved: boolean; createdAt: string }
interface Gate { gate: string; passed: boolean; message: string }
interface GateStatus { draft: Draft; passed: boolean; results: Gate[] }

const GATE_LABEL: Record<string, string> = {
  VERIFIED_RECORD: 'Verified CRM record', REGISTERED_EMAIL: 'Registered customer email', MANUAL_RESPONSE_LIST: 'Not on the manual-reply list',
  WORKFLOW_SWITCH: 'Workflow switch ON', CUSTOMER_CHECKLIST: 'Customer ticked for this message type', DRAFT_APPROVED: 'Text approved by an employee', NOT_BANK: 'Not a bank address'
};

/** Draft-first outbound email: sent only when every gate passes. */
export default function MessagesPage() {
  const api = useApi();
  const { can } = useSession();
  const toast = useToast();
  const [status, setStatus] = useState('DRAFT');
  const [page, setPage] = useState(1);
  const [list, reload] = useAsync((signal) => api.get<Paginated<Draft>>('/api/v1/messages/drafts', { query: { status, page }, signal }), [status, page]);
  const [open, setOpen] = useState<Draft | null>(null);
  const [gates, reloadGates] = useAsync(() => open ? api.data<GateStatus>('GET', `/api/v1/messages/drafts/${open.id}`) : Promise.resolve(null), [open?.id]);
  const [act, setAct] = useState<'approve' | 'reject' | null>(null);
  const [sendKey, setSendKey] = useState(newIdempotencyKey);
  const [sending, setSending] = useState(false);
  const data = list.status === 'ready' ? list.data : list.data;

  const send = async () => {
    if (!open) return;
    setSending(true);
    try {
      await api.data('POST', '/api/v1/messages/send', { draftId: open.id }, { idempotencyKey: sendKey });
      toast('success', 'Email sent.'); setOpen(null); setSendKey(newIdempotencyKey()); reload();
    } catch (e) {
      toast('danger', e instanceof Error ? e.message : 'Not sent.');
      if (e instanceof ApiError && e.code === 'GATE_BLOCKED') setSendKey(newIdempotencyKey());
      reloadGates();
    } finally { setSending(false); }
  };
  const results = gates.status === 'ready' ? gates.data?.results ?? [] : [];
  const steps: Step[] = results.map((g, i) => ({ label: GATE_LABEL[g.gate] ?? titleCase(g.gate), detail: g.message, state: g.passed ? 'done' : results.findIndex((x) => !x.passed) === i ? 'current' : 'todo' }));

  return (
    <>
      <PageHeader title="Outbound drafts" crumbs={[{ label: 'Sales' }, { label: 'Outbound drafts' }]}
        description="Every automated email waits here. It sends only when its switch is ON, the customer is ticked for the message type, the record and email are verified, and someone approves the exact text." />
      <DataTable<Draft> id="drafts" caption="Outbound drafts" rows={data?.data} rowKey={(d) => d.id} onRowClick={setOpen} loading={list.status === 'loading'} error={list.status === 'error' ? list.error : undefined} onRetry={reload}
        pagination={data?.pagination} onPage={setPage}
        filters={<SelectField label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All" options={['DRAFT', 'APPROVED', 'SENDING', 'SENT', 'REJECTED'].map((v) => ({ value: v, label: titleCase(v) }))} />}
        empty={<EmptyState title={status === 'DRAFT' ? 'No drafts waiting' : 'No drafts match'} illustration="done">Drafts appear when an approved workflow prepares a message.</EmptyState>}
        columns={[
          { key: 'subject', header: 'Subject', render: (d) => <div style={{ minWidth: 0 }}><Truncate className="ds-cell-primary" text={d.subject} /><span className="ds-cell-secondary">{titleCase(d.category)}</span></div> },
          { key: 'customer', header: 'Customer', render: (d) => <Truncate text={d.customerName ?? `#${d.customerId}`} /> },
          { key: 'to', header: 'To', render: (d) => <Truncate text={d.recipients.join(', ')} /> },
          { key: 'status', header: 'Status', render: (d) => <StatusBadge status={d.status} /> },
          { key: 'created', header: 'Created', render: (d) => <span className="ds-cell-secondary">{formatRelative(d.createdAt)}</span> }
        ]} />
      <Drawer open={Boolean(open)} title={open?.subject ?? ''} description={open ? `To ${open.recipients.join(', ')}` : undefined} onClose={() => setOpen(null)}
        footer={open && can('outbound.approve') && !['SENT', 'REJECTED', 'SENDING'].includes(open.status) ? <>
          <Button variant="secondary" onClick={() => setAct('reject')}>Reject</Button>
          {!open.approved && <Button variant="secondary" icon="check" onClick={() => setAct('approve')}>Approve text</Button>}
          <Button icon="mail" busy={sending} disabled={gates.status !== 'ready' || !gates.data?.passed} onClick={() => void send()}>Send</Button>
        </> : undefined}>
        {open && <div className="stack-lg">
          <div className="ds-card ds-card-pad" style={{ whiteSpace: 'pre-wrap', background: 'var(--color-surface-sunken)' }}>{open.body}</div>
          <div className="stack-sm"><h3>Send checks</h3>
            {gates.status === 'loading' && <CardSkeleton />}
            {gates.status === 'error' && <ErrorState error={gates.error} onRetry={reloadGates} />}
            {gates.status === 'ready' && <>
              <Stepper label="Send checks" steps={steps} />
              <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {results.map((g) => <li key={g.gate} className="cluster" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><StatusBadge status={g.passed ? 'APPROVED' : 'BLOCKED'} label={g.passed ? 'Pass' : 'Blocked'} /><span><strong>{GATE_LABEL[g.gate] ?? titleCase(g.gate)}</strong><br /><span className="ds-cell-secondary">{g.message}</span></span></li>)}
              </ul>
              {!gates.data?.passed && <p className="ds-cell-secondary"><Icon name="info" style={{ display: 'inline', width: 'var(--icon-sm)', height: 'var(--icon-sm)', verticalAlign: 'text-bottom' }} /> Send stays disabled until every check passes.</p>}
            </>}
          </div>
        </div>}
      </Drawer>
      <ReasonDialog open={act !== null} title={act === 'approve' ? 'Approve this text' : 'Reject draft'} danger={act === 'reject'} confirmLabel={act === 'approve' ? 'Approve' : 'Reject'} onClose={() => setAct(null)}
        onConfirm={async (reason) => {
          if (!open) return;
          const updated = await api.data<Draft>('POST', `/api/v1/messages/drafts/${open.id}/${act}`, { reason });
          setOpen(act === 'reject' ? null : { ...open, ...updated }); toast('success', act === 'approve' ? 'Draft approved.' : 'Draft rejected.'); reload(); reloadGates();
        }} />
    </>
  );
}
