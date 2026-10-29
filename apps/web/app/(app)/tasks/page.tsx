'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/api/provider';
import { newIdempotencyKey } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import { formatDateTime, titleCase } from '@/lib/format';
import {
  Button, CardSkeleton, Drawer, ErrorState, Icon, Modal, PageHeader, ReasonDialog, SelectField, SlaChip, StatusBadge, TextAreaField, TextField, Timeline,
  fieldErrors, useAsync, useToast
} from '@/components/ds';

interface Task { id: string; title: string; description: string | null; status: 'OPEN' | 'IN_PROGRESS' | 'FORWARDED' | 'DONE'; owner: string; ownerId: number; backup: string | null; dueAt: string | null; parentTaskId: string | null; version: number; overdue: boolean; reminderCount: number }
interface Board { columns: Record<Task['status'], Task[]> }
interface UserOption { id: number; name: string; status?: string }
interface TaskDetail { task: Task; events: { event: string; reason: string | null; created_at: string; actor: string | null }[] }

const COLUMNS: { key: Task['status']; label: string }[] = [{ key: 'OPEN', label: 'Open' }, { key: 'IN_PROGRESS', label: 'In progress' }, { key: 'FORWARDED', label: 'Forwarded' }, { key: 'DONE', label: 'Done' }];

/** S-19 Task board. */
function TaskBoard() {
  const api = useApi();
  const { can } = useSession();
  const toast = useToast();
  const params = useSearchParams();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [board, reload] = useAsync((signal) => api.data<Board>('GET', '/api/v1/tasks', undefined, { query: { scope }, signal }), [scope]);
  const [users] = useAsync(() => can('users.read') ? api.data<UserOption[]>('GET', '/api/v1/users') : api.data<UserOption[]>('GET', '/api/crm/owners'), []);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);
  const [action, setAction] = useState<null | { kind: 'status'; status: Task['status'] } | { kind: 'forward' }>(null);
  const [forwardTo, setForwardTo] = useState('');
  const [detail] = useAsync(() => selected ? api.data<TaskDetail>('GET', `/api/v1/tasks/${selected.id}`) : Promise.resolve(null), [selected?.id, selected?.version]);
  useEffect(() => { if (params.get('new')) setCreating(true); }, [params]);
  const userOptions = users.status === 'ready' ? users.data.filter((u) => u.status !== 'INACTIVE').map((u) => ({ value: String(u.id), label: u.name })) : [];

  return (
    <>
      <PageHeader title="Tasks" crumbs={[{ label: 'Work' }, { label: 'Tasks' }]} description="Forwarding creates a linked task for the new owner and records who forwarded it."
        actions={<>
          {can('tasks.assign') && <SelectField label="Show" value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'all')} options={[{ value: 'mine', label: 'My tasks' }, { value: 'all', label: 'Everyone' }]} />}
          {can('tasks.write') && <Button icon="plus" onClick={() => setCreating(true)}>New task</Button>}
        </>} />
      {board.status === 'error' && <ErrorState error={board.error} onRetry={reload} />}
      {board.status !== 'error' && (
        <div className="board" style={{ display: 'grid', gap: 'var(--space-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, var(--layout-card-min)), 1fr))', alignItems: 'start' }}>
          {COLUMNS.map((c) => {
            const tasks = board.data?.columns[c.key];
            return (
              <section key={c.key} className="ds-card" aria-labelledby={`col-${c.key}`}>
                <header className="ds-card-header"><h2 id={`col-${c.key}`}>{c.label}</h2><span className="ds-nav-badge" data-tone="neutral">{tasks?.length ?? '…'}</span></header>
                <div className="ds-card-body stack-sm">
                  {!tasks ? <CardSkeleton lines={2} /> : tasks.length === 0 ? <p className="subtle">No tasks</p> : tasks.map((t) => (
                    <button type="button" key={t.id} className="ds-card ds-list-item" style={{ borderRadius: 'var(--radius-md)', boxShadow: 'none' }} onClick={() => setSelected(t)}>
                      <span className="ds-cell-primary wrap-anywhere">{t.title}</span>
                      <span className="cluster"><span className="ds-cell-secondary">{t.owner}</span>{t.parentTaskId && <StatusBadge status="FORWARDED" label="Forwarded" />}</span>
                      {t.dueAt && ['OPEN', 'IN_PROGRESS'].includes(t.status) && <SlaChip dueAt={t.dueAt} />}
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <CreateTask open={creating} onClose={() => setCreating(false)} users={userOptions} canAssign={can('tasks.assign')} onCreated={() => { setCreating(false); toast('success', 'Task created.'); reload(); }} />

      <Drawer open={Boolean(selected)} title={selected?.title ?? 'Task'} onClose={() => setSelected(null)} footer={selected && ['OPEN', 'IN_PROGRESS'].includes(selected.status) ? <>
        {selected.status === 'OPEN' && <Button variant="secondary" onClick={() => setAction({ kind: 'status', status: 'IN_PROGRESS' })}>Start</Button>}
        <Button variant="secondary" icon="arrowRight" onClick={() => setAction({ kind: 'forward' })}>Forward</Button>
        <Button icon="check" onClick={() => setAction({ kind: 'status', status: 'DONE' })}>Mark done</Button>
      </> : selected?.status === 'DONE' ? <Button variant="secondary" onClick={() => setAction({ kind: 'status', status: 'OPEN' })}>Reopen</Button> : undefined}>
        {selected && (
          <div className="stack-lg">
            <div className="cluster"><StatusBadge status={selected.status} />{selected.dueAt && <SlaChip dueAt={selected.dueAt} />}</div>
            {selected.description && <p className="wrap-anywhere" style={{ whiteSpace: 'pre-wrap' }}>{selected.description}</p>}
            <dl className="ds-facts"><div><dt>Owner</dt><dd>{selected.owner}</dd></div><div><dt>Backup</dt><dd>{selected.backup ?? '—'}</dd></div><div><dt>Due</dt><dd>{formatDateTime(selected.dueAt)}</dd></div><div><dt>Reminders sent</dt><dd>{selected.reminderCount}</dd></div></dl>
            <div className="stack-sm"><h3>History</h3>
              {detail.status === 'loading' && <CardSkeleton />}
              {detail.status === 'error' && <ErrorState error={detail.error} />}
              {detail.status === 'ready' && detail.data && <Timeline items={detail.data.events.map((e, i) => ({ id: i, title: titleCase(e.event), at: e.created_at, by: e.actor, body: e.reason ?? undefined, icon: e.event === 'FORWARDED' ? 'arrowRight' : e.event === 'STATUS' ? 'check' : 'clock' }))} />}
            </div>
          </div>
        )}
      </Drawer>

      <ReasonDialog open={action?.kind === 'status'} title={action?.kind === 'status' ? `Move to ${titleCase(action.status).toLowerCase()}` : ''} onClose={() => setAction(null)}
        onConfirm={async (reason) => {
          if (!selected || action?.kind !== 'status') return;
          const updated = await api.data<Task>('POST', `/api/v1/tasks/${selected.id}/status`, { status: action.status, version: selected.version, reason });
          setSelected({ ...selected, ...updated }); toast('success', 'Task updated.'); reload();
        }} />
      <ReasonDialog open={action?.kind === 'forward'} title="Forward task" confirmLabel="Forward" onClose={() => setAction(null)}
        onConfirm={async (reason) => {
          if (!selected || !forwardTo) throw new Error('Choose who to forward the task to.');
          await api.data('POST', `/api/v1/tasks/${selected.id}/forward`, { toUserId: Number(forwardTo), version: selected.version, reason }, { idempotencyKey: newIdempotencyKey() });
          setSelected(null); setForwardTo(''); toast('success', 'Task forwarded.'); reload();
        }}>
        <SelectField label="Forward to" required value={forwardTo} onChange={(e) => setForwardTo(e.target.value)} placeholder="Choose a person" options={userOptions.filter((u) => u.value !== String(selected?.ownerId))} />
      </ReasonDialog>
    </>
  );
}

function CreateTask({ open, onClose, onCreated, users, canAssign }: { open: boolean; onClose: () => void; onCreated: () => void; users: { value: string; label: string }[]; canAssign: boolean }) {
  const api = useApi();
  const [form, setForm] = useState({ title: '', description: '', ownerUserId: '', dueAt: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setErrors({ title: 'Give the task a title.' }); return; }
    setBusy(true); setErrors({});
    try {
      await api.data('POST', '/api/v1/tasks', {
        title: form.title, ...(form.description ? { description: form.description } : {}), ...(form.ownerUserId ? { ownerUserId: Number(form.ownerUserId) } : {}),
        ...(form.dueAt ? { dueAt: new Date(form.dueAt).toISOString() } : {})
      }, { idempotencyKey: key });
      setForm({ title: '', description: '', ownerUserId: '', dueAt: '' }); setKey(newIdempotencyKey()); onCreated();
    } catch (error) { setErrors({ ...fieldErrors(error), form: error instanceof Error ? error.message : 'Could not create the task.' }); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} title="New task" onClose={() => !busy && onClose()} footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" form="new-task" busy={busy}>Create task</Button></>}>
      <form id="new-task" className="stack" onSubmit={(e) => void submit(e)} noValidate>
        <TextField label="Title" required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={errors.title} />
        <TextAreaField label="Details" rows={3} maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        {canAssign && <SelectField label="Owner" value={form.ownerUserId} onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })} placeholder="Me" options={users} error={errors.ownerUserId} />}
        <TextField label="Due" type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} error={errors.dueAt} />
        {errors.form && <p className="ds-field-error" role="alert"><Icon name="alert" />{errors.form}</p>}
      </form>
    </Modal>
  );
}

export default function TasksPage() { return <Suspense fallback={<CardSkeleton />}><TaskBoard /></Suspense>; }
