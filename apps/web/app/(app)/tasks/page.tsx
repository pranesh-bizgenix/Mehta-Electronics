'use client';

import { useState, type FormEvent } from 'react';
import { apiData, newIdempotencyKey } from '@/lib/api';
import { useSession } from '@/lib/session';
import {
  Button, EmptyState, ErrorState, LoadingState, Modal, PageHeader, ReasonDialog, Select, StatusBadge, TextArea, TextInput, Timeline,
  fieldErrors, formatDateTime, useAsync, useToast
} from '@/components/ui';

interface Task { id: string; title: string; description: string | null; status: 'OPEN' | 'IN_PROGRESS' | 'FORWARDED' | 'DONE'; owner: string; ownerId: number; backup: string | null; dueAt: string | null; parentTaskId: string | null; version: number; overdue: boolean; reminderCount: number }
interface Board { columns: Record<Task['status'], Task[]> }
interface UserOption { id: number; name: string; status: string }
interface TaskDetail { task: Task; events: { event: string; reason: string | null; created_at: string; actor: string | null }[] }

const COLUMNS: { key: Task['status']; label: string }[] = [
  { key: 'OPEN', label: 'Open' }, { key: 'IN_PROGRESS', label: 'In progress' }, { key: 'FORWARDED', label: 'Forwarded' }, { key: 'DONE', label: 'Done' }
];

/** S-19 Task board. */
export default function TaskBoardPage() {
  const { can } = useSession();
  const toast = useToast();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [board, reload] = useAsync(() => apiData<Board>('/api/v1/tasks', { query: { scope } }), [scope]);
  const [users] = useAsync(() => can('users.read') ? apiData<UserOption[]>('/api/v1/users') : apiData<UserOption[]>('/api/crm/owners'), []);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);
  const [action, setAction] = useState<null | { kind: 'status'; status: Task['status'] } | { kind: 'forward' }>(null);
  const [forwardTo, setForwardTo] = useState('');
  const [detail] = useAsync(() => selected ? apiData<TaskDetail>(`/api/v1/tasks/${selected.id}`) : Promise.resolve(null), [selected?.id, selected?.version]);

  const userOptions = users.status === 'ready' ? users.data.filter((u) => u.status !== 'INACTIVE').map((u) => ({ value: String(u.id), label: u.name })) : [];

  return (
    <>
      <PageHeader title="Task board" description="Open, in progress, forwarded and done tasks. Forwarding creates a linked task for the new owner and keeps who forwarded it."
        actions={<>
          {can('tasks.assign') && <Select label="Show" value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'all')} options={[{ value: 'mine', label: 'My tasks' }, { value: 'all', label: 'Everyone' }]} />}
          {can('tasks.write') && <Button onClick={() => setCreating(true)}>New task</Button>}
        </>} />
      {board.status === 'loading' && <LoadingState />}
      {board.status === 'error' && <ErrorState error={board.error} onRetry={reload} />}
      {board.status === 'ready' && (
        <div className="board">
          {COLUMNS.map((c) => (
            <section key={c.key} className="board-column" aria-labelledby={`col-${c.key}`}>
              <h2 id={`col-${c.key}`}><span>{c.label}</span><span className="muted">{board.data.columns[c.key].length}</span></h2>
              {board.data.columns[c.key].length === 0 && <p className="muted">No tasks.</p>}
              {board.data.columns[c.key].map((t) => (
                <button type="button" key={t.id} className="task-card" onClick={() => setSelected(t)}>
                  <span className="title">{t.title}</span>
                  <span className="muted">{t.owner}{t.parentTaskId ? ' · forwarded' : ''}</span>
                  {t.dueAt && <span className={t.overdue ? 'overdue' : 'muted'}>Due {formatDateTime(t.dueAt)}</span>}
                </button>
              ))}
            </section>
          ))}
        </div>
      )}

      <CreateTask open={creating} onClose={() => setCreating(false)} users={userOptions} canAssign={can('tasks.assign')}
        onCreated={() => { setCreating(false); toast('ok', 'Task created.'); reload(); }} />

      <Modal open={Boolean(selected)} title={selected?.title ?? 'Task'} onClose={() => setSelected(null)} footer={selected && ['OPEN', 'IN_PROGRESS'].includes(selected.status) ? <>
        {selected.status === 'OPEN' && <Button variant="secondary" onClick={() => setAction({ kind: 'status', status: 'IN_PROGRESS' })}>Start</Button>}
        <Button variant="secondary" onClick={() => setAction({ kind: 'forward' })}>Forward</Button>
        <Button onClick={() => setAction({ kind: 'status', status: 'DONE' })}>Mark done</Button>
      </> : selected?.status === 'DONE' ? <Button variant="secondary" onClick={() => setAction({ kind: 'status', status: 'OPEN' })}>Reopen</Button> : undefined}>
        {selected && (
          <div className="stack">
            <div className="row"><StatusBadge status={selected.status} />{selected.overdue && <span className="overdue">Overdue</span>}</div>
            {selected.description && <p className="wrap-anywhere" style={{ whiteSpace: 'pre-wrap' }}>{selected.description}</p>}
            <p className="muted">Owner {selected.owner}{selected.backup ? ` · backup ${selected.backup}` : ''} · due {formatDateTime(selected.dueAt)} · {selected.reminderCount} reminder(s)</p>
            <h3>History</h3>
            {detail.status === 'loading' && <LoadingState />}
            {detail.status === 'error' && <ErrorState error={detail.error} />}
            {detail.status === 'ready' && detail.data && <Timeline items={detail.data.events.map((e, i) => ({ id: i, title: e.event.replace(/_/g, ' ').toLowerCase(), at: e.created_at, by: e.actor, detail: e.reason }))} />}
          </div>
        )}
      </Modal>

      <ReasonDialog open={action?.kind === 'status'} title={action?.kind === 'status' ? `Move to ${action.status.replace('_', ' ').toLowerCase()}` : ''} onClose={() => setAction(null)}
        onConfirm={async (reason) => {
          if (!selected || action?.kind !== 'status') return;
          const updated = await apiData<Task>(`/api/v1/tasks/${selected.id}/status`, { method: 'POST', body: { status: action.status, version: selected.version, reason } });
          setSelected({ ...selected, ...updated }); toast('ok', 'Task updated.'); reload();
        }} />
      <ReasonDialog open={action?.kind === 'forward'} title="Forward task" confirmLabel="Forward" onClose={() => setAction(null)}
        onConfirm={async (reason) => {
          if (!selected || !forwardTo) throw new Error('Choose who to forward to.');
          await apiData(`/api/v1/tasks/${selected.id}/forward`, { method: 'POST', idempotencyKey: newIdempotencyKey(), body: { toUserId: Number(forwardTo), version: selected.version, reason } });
          setSelected(null); setForwardTo(''); toast('ok', 'Task forwarded.'); reload();
        }}>
        <Select label="Forward to" required value={forwardTo} onChange={(e) => setForwardTo(e.target.value)} placeholder="Choose a person" options={userOptions.filter((u) => u.value !== String(selected?.ownerId))} />
      </ReasonDialog>
    </>
  );
}

function CreateTask({ open, onClose, onCreated, users, canAssign }: { open: boolean; onClose: () => void; onCreated: () => void; users: { value: string; label: string }[]; canAssign: boolean }) {
  const [form, setForm] = useState({ title: '', description: '', ownerUserId: '', dueAt: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { setErrors({ title: 'is required' }); return; }
    setBusy(true); setErrors({});
    try {
      await apiData('/api/v1/tasks', { method: 'POST', idempotencyKey: key, body: {
        title: form.title, ...(form.description ? { description: form.description } : {}), ...(form.ownerUserId ? { ownerUserId: Number(form.ownerUserId) } : {}),
        ...(form.dueAt ? { dueAt: new Date(form.dueAt).toISOString() } : {})
      } });
      setForm({ title: '', description: '', ownerUserId: '', dueAt: '' }); setKey(newIdempotencyKey()); onCreated();
    } catch (error) { setErrors({ ...fieldErrors(error), form: error instanceof Error ? error.message : 'Could not create the task.' }); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} title="New task" onClose={() => !busy && onClose()}>
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate>
        <TextInput label="Title" required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={errors.title} />
        <TextArea label="Details" rows={3} maxLength={5000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        {canAssign && <Select label="Owner" value={form.ownerUserId} onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })} placeholder="Me" options={users} error={errors.ownerUserId} />}
        <TextInput label="Due" type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} error={errors.dueAt} />
        {errors.form && <p className="notice notice-bad" role="alert">{errors.form}</p>}
        <div className="row"><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" busy={busy}>Create task</Button></div>
      </form>
    </Modal>
  );
}
