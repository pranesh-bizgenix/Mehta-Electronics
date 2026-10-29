'use client';

import { useState } from 'react';
import { apiData } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, DataTable, ErrorState, LoadingState, PageHeader, ReasonDialog, StatusBadge, formatDateTime, useAsync, useToast } from '@/components/ui';

interface Switch { key: string; name: string; description: string; enabled: boolean; rolloutStage: 'DRAFT_AND_APPROVAL' | 'SELECTIVE'; updatedAt: string; updatedBy: string | null }
interface Change { field: string; oldValue: string; newValue: string; reason: string; at: string; by: string }

/** One switch per automation. All start OFF; only the owner turns one ON. */
export default function AutomationPage() {
  const { can } = useSession();
  const toast = useToast();
  const [state, reload] = useAsync(() => apiData<{ switches: Switch[]; history: Change[] }>('/api/v1/automation'), []);
  const [pending, setPending] = useState<{ sw: Switch; body: { enabled?: boolean; rolloutStage?: Switch['rolloutStage'] } } | null>(null);
  const owner = can('automation.enable');

  return (
    <>
      <PageHeader title="Automation switches" description="Every automation has its own switch. They stay OFF until the owner approves activation. Every change records who, when, the old and new value, and why." />
      {state.status === 'loading' && <LoadingState />}
      {state.status === 'error' && <ErrorState error={state.error} onRetry={reload} />}
      {state.status === 'ready' && (
        <>
          <DataTable caption="Automation switches" rows={state.data.switches} rowKey={(r) => r.key} columns={[
            { key: 'name', header: 'Workflow', render: (r) => <><strong>{r.name}</strong><br /><span className="muted">{r.description}</span></> },
            { key: 'state', header: 'State', render: (r) => <StatusBadge status={r.enabled ? 'ON' : 'OFF'} label={r.enabled ? 'on' : 'off'} /> },
            { key: 'stage', header: 'Rollout stage', render: (r) => r.rolloutStage === 'SELECTIVE' ? 'Selective automation' : 'Draft and approval' },
            { key: 'changed', header: 'Last change', render: (r) => <>{formatDateTime(r.updatedAt)}<br /><span className="muted">{r.updatedBy ?? 'Never changed'}</span></> },
            { key: 'actions', header: 'Actions', render: (r) => (
              <div className="row">
                {r.enabled
                  ? (can('automation.disable') || owner) && <Button variant="secondary" onClick={() => setPending({ sw: r, body: { enabled: false } })}>Turn off</Button>
                  : owner && <Button onClick={() => setPending({ sw: r, body: { enabled: true } })}>Turn on</Button>}
                {owner && <Button variant="ghost" onClick={() => setPending({ sw: r, body: { rolloutStage: r.rolloutStage === 'SELECTIVE' ? 'DRAFT_AND_APPROVAL' : 'SELECTIVE' } })}>
                  {r.rolloutStage === 'SELECTIVE' ? 'Back to draft and approval' : 'Move to selective'}</Button>}
                {!owner && !r.enabled && <span className="muted">Owner only</span>}
              </div>
            ) }
          ]} />
          <section className="card" style={{ marginTop: 16 }} aria-labelledby="changes">
            <h2 id="changes" className="card-title">Change log</h2>
            {state.data.history.length === 0 ? <p className="muted">No switch has been changed yet.</p> : (
              <DataTable caption="Switch change log" rows={state.data.history} rowKey={(h) => `${h.at}-${h.field}-${h.newValue}`} columns={[
                { key: 'at', header: 'When', render: (h) => formatDateTime(h.at) },
                { key: 'by', header: 'Who', render: (h) => h.by },
                { key: 'change', header: 'Change', render: (h) => `${h.field}: ${h.oldValue} → ${h.newValue}` },
                { key: 'reason', header: 'Reason', render: (h) => <span className="wrap-anywhere">{h.reason}</span> }
              ]} />
            )}
          </section>
        </>
      )}
      <ReasonDialog open={Boolean(pending)} title={pending ? `${pending.sw.name}: ${pending.body.enabled === true ? 'turn ON' : pending.body.enabled === false ? 'turn OFF' : 'change rollout stage'}` : ''}
        danger={pending?.body.enabled === true} confirmLabel="Apply" onClose={() => setPending(null)}
        onConfirm={async (reason) => {
          if (!pending) return;
          await apiData(`/api/v1/automation/${pending.sw.key}`, { method: 'PATCH', body: { ...pending.body, reason } });
          toast('ok', 'Switch updated.'); reload();
        }}>
        {pending?.body.enabled === true && <p className="notice">Turning this ON lets the workflow act on its own within its rollout stage. Outgoing messages still need an employee to approve each draft.</p>}
      </ReasonDialog>
    </>
  );
}
