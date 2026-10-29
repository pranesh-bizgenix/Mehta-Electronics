'use client';

import { useState } from 'react';
import { apiData, newIdempotencyKey } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, DataTable, ErrorState, LoadingState, Modal, PageHeader, ReasonDialog, Select, StatusBadge, TextInput, useAsync, useToast } from '@/components/ui';

interface UserRow { id: number; name: string; email: string; role: string; status: string; department: string | null; onLeave: boolean; backupUserId: number | null; backup: string | null; managerUserId: number | null; manager: string | null; mfaEnabled: boolean; mfaRequired: boolean }
interface Role { key: string; name: string; requiresMfa: boolean; allPermissions: boolean; isSystem: boolean; status: string }
interface Permission { key: string; resource: string; action: 'R' | 'W' | 'A' | 'F'; description: string; ownerOnly: boolean; grantedTo: string[] }
interface Matrix { roles: Role[]; permissions: Permission[] }

const ACTION_LABEL = { R: 'Read', W: 'Write', A: 'Approve', F: 'Field privacy' } as const;
const DEPARTMENTS = ['SALES', 'OPERATIONS', 'ACCOUNTS', 'CUSTOMER_SUPPORT'];

/** S-24 Users and roles. Departments are routing labels, not roles. */
export default function UsersPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  return (
    <>
      <PageHeader title="Users & roles" description="Roles decide which screens, actions and fields a person can use; the server enforces every rule. Departments (Sales, Operations, Accounts, Customer Support) only route work." />
      <div className="row" role="tablist" aria-label="Users and roles" style={{ marginBottom: 16 }}>
        <Button role="tab" aria-selected={tab === 'users'} variant={tab === 'users' ? 'primary' : 'secondary'} onClick={() => setTab('users')}>Users</Button>
        {can('access.read') && <Button role="tab" aria-selected={tab === 'roles'} variant={tab === 'roles' ? 'primary' : 'secondary'} onClick={() => setTab('roles')}>Role permissions</Button>}
      </div>
      {tab === 'users' ? <UsersTab /> : <RolesTab />}
    </>
  );
}

function UsersTab() {
  const { can } = useSession();
  const toast = useToast();
  const [users, reload] = useAsync(() => apiData<UserRow[]>('/api/v1/users'), []);
  const [roles] = useAsync(() => can('access.read') ? apiData<Matrix>('/api/v1/roles').then((m) => m.roles) : Promise.resolve<Role[]>([]), []);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [confirm, setConfirm] = useState<'save' | 'reassign' | 'mfa' | null>(null);
  const others = users.status === 'ready' ? users.data.filter((u) => u.id !== editing?.id && u.status === 'ACTIVE').map((u) => ({ value: String(u.id), label: u.name })) : [];

  const edit = (u: UserRow) => { setEditing(u); setForm({ role: u.role, status: u.status, department: u.department ?? '', backupUserId: u.backupUserId ? String(u.backupUserId) : '', managerUserId: u.managerUserId ? String(u.managerUserId) : '', onLeave: u.onLeave }); };

  if (users.status === 'loading') return <LoadingState />;
  if (users.status === 'error') return <ErrorState error={users.error} onRetry={reload} />;
  return (
    <>
      <DataTable caption="Users" rows={users.data} rowKey={(u) => u.id} onRowClick={can('users.update') ? edit : undefined} columns={[
        { key: 'name', header: 'Name', render: (u) => <><strong>{u.name}</strong><br /><span className="muted wrap-anywhere">{u.email}</span></> },
        { key: 'role', header: 'Role', render: (u) => u.role.toLowerCase() },
        { key: 'dept', header: 'Department', render: (u) => u.department?.replace('_', ' ').toLowerCase() ?? '—' },
        { key: 'cover', header: 'Backup / manager', render: (u) => <>{u.backup ?? 'No backup'}<br /><span className="muted">{u.manager ?? 'No manager'}</span></> },
        { key: 'mfa', header: 'Two-factor', render: (u) => u.mfaEnabled ? <StatusBadge status="ACTIVE" label="on" /> : u.mfaRequired ? <StatusBadge status="WAITING" label="required, not set up" /> : <span className="muted">off</span> },
        { key: 'status', header: 'Status', render: (u) => <>{<StatusBadge status={u.status} />}{u.onLeave && <> <StatusBadge status="WAITING" label="on leave" /></>}</> }
      ]} />
      <Modal open={Boolean(editing)} title={editing ? `Edit ${editing.name}` : ''} onClose={() => setEditing(null)} footer={editing && <>
        {can('work.reassign') && <Button variant="secondary" onClick={() => setConfirm('reassign')}>Move all open work to backup</Button>}
        {editing.mfaEnabled && <Button variant="secondary" onClick={() => setConfirm('mfa')}>Reset two-factor</Button>}
        <Button onClick={() => setConfirm('save')}>Save</Button>
      </>}>
        {editing && <div className="grid grid-2">
          <Select label="Role" value={String(form.role)} onChange={(e) => setForm({ ...form, role: e.target.value })}
            options={(roles.status === 'ready' && roles.data.length ? roles.data.filter((r) => r.status === 'ACTIVE') : [{ key: editing.role, name: editing.role }]).map((r) => ({ value: r.key, label: r.name }))} />
          <Select label="Status" value={String(form.status)} onChange={(e) => setForm({ ...form, status: e.target.value })} options={['ACTIVE', 'INACTIVE', 'LOCKED'].map((v) => ({ value: v, label: v.toLowerCase() }))} />
          <Select label="Department (routing label)" value={String(form.department)} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="None" options={DEPARTMENTS.map((d) => ({ value: d, label: d.replace('_', ' ').toLowerCase() }))} />
          <Select label="Backup owner" value={String(form.backupUserId)} onChange={(e) => setForm({ ...form, backupUserId: e.target.value })} placeholder="None" options={others} />
          <Select label="Escalation manager" value={String(form.managerUserId)} onChange={(e) => setForm({ ...form, managerUserId: e.target.value })} placeholder="None" options={others} />
          <label className="checkbox"><input type="checkbox" checked={Boolean(form.onLeave)} onChange={(e) => setForm({ ...form, onLeave: e.target.checked })} /> On leave</label>
        </div>}
      </Modal>
      <ReasonDialog open={confirm !== null} onClose={() => setConfirm(null)}
        title={confirm === 'reassign' ? 'Move all open work to backup' : confirm === 'mfa' ? 'Reset two-factor' : 'Save user'}
        danger={confirm === 'mfa'}
        onConfirm={async (reason) => {
          if (!editing) return;
          if (confirm === 'reassign') {
            const r = await apiData<{ workItems: { moved: number; unassignedCount: number }; tasks: { moved: number } }>(`/api/v1/users/${editing.id}/reassign`, { method: 'POST', idempotencyKey: newIdempotencyKey(), body: { reason } });
            toast(r.workItems.unassignedCount ? 'bad' : 'ok', `Moved ${r.workItems.moved} record(s) and ${r.tasks.moved} task(s).${r.workItems.unassignedCount ? ` ${r.workItems.unassignedCount} had no backup and stayed.` : ''}`);
          } else if (confirm === 'mfa') {
            await apiData(`/api/v1/users/${editing.id}/mfa/reset`, { method: 'POST', body: { reason } });
            toast('ok', 'Two-factor reset. The user enrols again at next sign-in.');
          } else {
            await apiData(`/api/v1/users/${editing.id}`, { method: 'PATCH', body: {
              role: form.role, status: form.status, department: form.department || null, onLeave: Boolean(form.onLeave),
              backupUserId: form.backupUserId ? Number(form.backupUserId) : null, managerUserId: form.managerUserId ? Number(form.managerUserId) : null, reason
            } });
            toast('ok', 'User saved.');
          }
          setEditing(null); reload();
        }} />
    </>
  );
}

function RolesTab() {
  const { can } = useSession();
  const toast = useToast();
  const [matrix, reload] = useAsync(() => apiData<Matrix>('/api/v1/roles'), []);
  const [change, setChange] = useState<{ role: string; permission: Permission; granted: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState({ key: '', name: '', requiresMfa: false });
  const editable = can('access.manage');

  if (matrix.status === 'loading') return <LoadingState />;
  if (matrix.status === 'error') return <ErrorState error={matrix.error} onRetry={reload} />;
  const roles = matrix.data.roles.filter((r) => r.status === 'ACTIVE');
  const resources = [...new Set(matrix.data.permissions.map((p) => p.resource))];
  return (
    <>
      {editable && <div className="row" style={{ marginBottom: 12 }}><Button variant="secondary" onClick={() => setCreating(true)}>Add role</Button>
        <span className="muted">Only add roles the client has confirmed.</span></div>}
      {resources.map((res) => (
        <section key={res} className="card" aria-labelledby={`res-${res}`}>
          <h2 id={`res-${res}`} className="card-title" style={{ textTransform: 'capitalize' }}>{res}</h2>
          <div className="table-wrap">
            <table className="table matrix">
              <caption className="sr-only">{res} permissions</caption>
              <thead><tr><th scope="col">Permission</th>{roles.map((r) => <th key={r.key} scope="col">{r.name}</th>)}</tr></thead>
              <tbody>
                {matrix.data.permissions.filter((p) => p.resource === res).map((p) => (
                  <tr key={p.key}>
                    <td data-label="Permission"><strong>{ACTION_LABEL[p.action]}</strong> · {p.description}{p.ownerOnly && <><br /><span className="muted">Owner only</span></>}</td>
                    {roles.map((r) => {
                      const granted = r.allPermissions || p.grantedTo.includes(r.key);
                      const locked = !editable || r.allPermissions || (p.ownerOnly && !granted);
                      return (
                        <td key={r.key} data-label={r.name}>
                          <input type="checkbox" checked={granted} disabled={locked} aria-label={`${r.name}: ${p.description}`}
                            onChange={() => setChange({ role: r.key, permission: p, granted: !granted })} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <ReasonDialog open={Boolean(change)} title={change ? `${change.granted ? 'Grant' : 'Remove'} "${change.permission.description}" for ${change.role.toLowerCase()}` : ''}
        onClose={() => setChange(null)}
        onConfirm={async (reason) => {
          if (!change) return;
          await apiData(`/api/v1/roles/${change.role}/permissions/${change.permission.key}`, { method: 'PUT', body: { granted: change.granted, reason } });
          toast('ok', 'Permission updated. It applies immediately.'); reload();
        }} />
      <ReasonDialog open={creating} title="Add role" confirmLabel="Create role" onClose={() => setCreating(false)}
        onConfirm={async (reason) => {
          await apiData('/api/v1/roles', { method: 'POST', idempotencyKey: newIdempotencyKey(), body: { key: newRole.key.toUpperCase().replace(/[^A-Z0-9_]/g, '_'), name: newRole.name, requiresMfa: newRole.requiresMfa, reason } });
          setNewRole({ key: '', name: '', requiresMfa: false }); toast('ok', 'Role created with no permissions.'); reload();
        }}>
        <TextInput label="Name" required value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value, key: e.target.value })} />
        <TextInput label="Key" required value={newRole.key.toUpperCase().replace(/[^A-Z0-9_]/g, '_')} onChange={(e) => setNewRole({ ...newRole, key: e.target.value })} hint="Letters, digits and underscores." />
        <label className="checkbox"><input type="checkbox" checked={newRole.requiresMfa} onChange={(e) => setNewRole({ ...newRole, requiresMfa: e.target.checked })} /> Require two-factor authentication</label>
      </ReasonDialog>
    </>
  );
}
