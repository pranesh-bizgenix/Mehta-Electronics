'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/api/provider';
import { newIdempotencyKey } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import { titleCase } from '@/lib/format';
import {
  Avatar, Badge, Button, Card, CardSkeleton, Checkbox, DataTable, Drawer, ErrorState, Icon, PageHeader, ReasonDialog, SelectField, StatusBadge, Switch,
  TabPanel, Tabs, TextField, Tooltip, useAsync, useToast
} from '@/components/ds';

interface UserRow { id: number; name: string; email: string; role: string; status: string; department: string | null; onLeave: boolean; backupUserId: number | null; backup: string | null; managerUserId: number | null; manager: string | null; mfaEnabled: boolean; mfaRequired: boolean }
interface Role { key: string; name: string; requiresMfa: boolean; allPermissions: boolean; isSystem: boolean; status: string }
interface Permission { key: string; resource: string; action: 'R' | 'W' | 'A' | 'F'; description: string; ownerOnly: boolean; grantedTo: string[] }
interface Matrix { roles: Role[]; permissions: Permission[] }

const ACTION = { R: 'Read', W: 'Write', A: 'Approve', F: 'Field privacy' } as const;
const DEPARTMENTS = ['SALES', 'OPERATIONS', 'ACCOUNTS', 'CUSTOMER_SUPPORT'];

function UsersAndRoles() {
  const { can } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get('tab') === 'roles' && can('access.read') ? 'roles' : 'users';
  return (
    <>
      <PageHeader title="Users & roles" crumbs={[{ label: 'Admin' }, { label: 'Users & roles' }]}
        description="Roles decide which screens, actions and fields a person can use; the server enforces every rule. Departments only route work." />
      <Tabs label="Users and roles" value={tab} onChange={(id) => router.replace(`/users${id === 'roles' ? '?tab=roles' : ''}`)}
        items={[{ id: 'users', label: 'People', icon: 'customers' }, ...(can('access.read') ? [{ id: 'roles', label: 'Role permissions', icon: 'shield' as const }] : [])]} />
      <TabPanel id={tab}>{tab === 'users' ? <PeopleTab /> : <RolesTab />}</TabPanel>
    </>
  );
}

function PeopleTab() {
  const api = useApi();
  const { can } = useSession();
  const toast = useToast();
  const [users, reload] = useAsync(() => api.data<UserRow[]>('GET', '/api/v1/users'), []);
  const [roles] = useAsync(() => can('access.read') ? api.data<Matrix>('GET', '/api/v1/roles').then((m) => m.roles) : Promise.resolve<Role[]>([]), []);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [confirm, setConfirm] = useState<'save' | 'reassign' | 'mfa' | null>(null);
  const list = users.status === 'ready' ? users.data : users.data;
  const others = (list ?? []).filter((u) => u.id !== editing?.id && u.status === 'ACTIVE').map((u) => ({ value: String(u.id), label: u.name }));
  const edit = (u: UserRow) => { setEditing(u); setForm({ role: u.role, status: u.status, department: u.department ?? '', backupUserId: u.backupUserId ? String(u.backupUserId) : '', managerUserId: u.managerUserId ? String(u.managerUserId) : '', onLeave: u.onLeave }); };

  return (
    <>
      <DataTable<UserRow> id="users" caption="Users" rows={list} rowKey={(u) => u.id} onRowClick={can('users.update') ? edit : undefined} loading={users.status === 'loading'} error={users.status === 'error' ? users.error : undefined} onRetry={reload}
        columns={[
          { key: 'name', header: 'Person', render: (u) => <span className="cluster" style={{ flexWrap: 'nowrap' }}><Avatar name={u.name} /><span style={{ minWidth: 0 }}><span className="ds-cell-primary">{u.name}</span><br /><span className="ds-cell-secondary">{u.email}</span></span></span> },
          { key: 'role', header: 'Role', render: (u) => titleCase(u.role) },
          { key: 'dept', header: 'Department', render: (u) => u.department ? titleCase(u.department) : <span className="subtle">—</span> },
          { key: 'cover', header: 'Backup / manager', render: (u) => <><span>{u.backup ?? <span className="subtle">No backup</span>}</span><br /><span className="ds-cell-secondary">{u.manager ?? 'No manager'}</span></> },
          { key: 'mfa', header: 'Two-factor', optional: true, render: (u) => u.mfaEnabled ? <Badge tone="success">On</Badge> : u.mfaRequired ? <Badge tone="warning">Required</Badge> : <span className="subtle">Off</span> },
          { key: 'status', header: 'Status', render: (u) => <span className="cluster"><StatusBadge status={u.status} />{u.onLeave && <Badge tone="warning">On leave</Badge>}</span> }
        ]} />
      <Drawer open={Boolean(editing)} title={editing?.name ?? ''} description={editing?.email} onClose={() => setEditing(null)} footer={editing && <>
        {can('work.reassign') && <Button variant="secondary" icon="arrowRight" onClick={() => setConfirm('reassign')}>Move open work to backup</Button>}
        {editing.mfaEnabled && <Button variant="secondary" onClick={() => setConfirm('mfa')}>Reset two-factor</Button>}
        <Button onClick={() => setConfirm('save')}>Save changes</Button>
      </>}>
        {editing && <div className="stack">
          <SelectField label="Role" value={String(form.role)} onChange={(e) => setForm({ ...form, role: e.target.value })}
            options={(roles.status === 'ready' && roles.data.length ? roles.data.filter((r) => r.status === 'ACTIVE') : [{ key: editing.role, name: titleCase(editing.role) }]).map((r) => ({ value: r.key, label: r.name }))} />
          <SelectField label="Status" value={String(form.status)} onChange={(e) => setForm({ ...form, status: e.target.value })} options={['ACTIVE', 'INACTIVE', 'LOCKED'].map((v) => ({ value: v, label: titleCase(v) }))} />
          <SelectField label="Department (routing label)" value={String(form.department)} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="None" options={DEPARTMENTS.map((d) => ({ value: d, label: titleCase(d) }))} />
          <SelectField label="Backup owner" value={String(form.backupUserId)} onChange={(e) => setForm({ ...form, backupUserId: e.target.value })} placeholder="None" options={others} hint="Takes over open work on leave or escalation." />
          <SelectField label="Escalation manager" value={String(form.managerUserId)} onChange={(e) => setForm({ ...form, managerUserId: e.target.value })} placeholder="None" options={others} />
          <Switch label="On leave" checked={Boolean(form.onLeave)} onChange={(e) => setForm({ ...form, onLeave: e.target.checked })} />
        </div>}
      </Drawer>
      <ReasonDialog open={confirm !== null} onClose={() => setConfirm(null)} danger={confirm === 'mfa'}
        title={confirm === 'reassign' ? 'Move all open work to backup' : confirm === 'mfa' ? 'Reset two-factor' : 'Save changes'}
        onConfirm={async (reason) => {
          if (!editing) return;
          if (confirm === 'reassign') {
            const r = await api.data<{ workItems: { moved: number; unassignedCount: number }; tasks: { moved: number } }>('POST', `/api/v1/users/${editing.id}/reassign`, { reason }, { idempotencyKey: newIdempotencyKey() });
            toast(r.workItems.unassignedCount ? 'danger' : 'success', `Moved ${r.workItems.moved} record(s) and ${r.tasks.moved} task(s).${r.workItems.unassignedCount ? ` ${r.workItems.unassignedCount} had no backup and stayed.` : ''}`);
          } else if (confirm === 'mfa') {
            await api.data('POST', `/api/v1/users/${editing.id}/mfa/reset`, { reason }); toast('success', 'Two-factor reset. They enrol again at next sign-in.');
          } else {
            await api.data('PATCH', `/api/v1/users/${editing.id}`, { role: form.role, status: form.status, department: form.department || null, onLeave: Boolean(form.onLeave), backupUserId: form.backupUserId ? Number(form.backupUserId) : null, managerUserId: form.managerUserId ? Number(form.managerUserId) : null, reason });
            toast('success', 'Saved.');
          }
          setEditing(null); reload();
        }} />
    </>
  );
}

function RolesTab() {
  const api = useApi();
  const { can } = useSession();
  const toast = useToast();
  const [matrix, reload] = useAsync(() => api.data<Matrix>('GET', '/api/v1/roles'), []);
  const [change, setChange] = useState<{ role: string; permission: Permission; granted: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState({ name: '', requiresMfa: false });
  const editable = can('access.manage');
  if (matrix.status === 'loading' && !matrix.data) return <CardSkeleton lines={6} />;
  if (matrix.status === 'error') return <ErrorState error={matrix.error} onRetry={reload} />;
  const m = matrix.data!;
  const roles = m.roles.filter((r) => r.status === 'ACTIVE');
  const resources = [...new Set(m.permissions.map((p) => p.resource))];
  return (
    <div className="stack-lg">
      {editable && <div className="cluster-between"><p className="muted">Changes apply immediately and are recorded with your reason.</p><Button variant="secondary" icon="plus" onClick={() => setCreating(true)}>Add role</Button></div>}
      {resources.map((res) => (
        <Card key={res} title={titleCase(res)} padded={false}>
          <div className="ds-table-scroll">
            <table className="ds-table">
              <caption className="sr-only">{res} permissions</caption>
              <thead><tr><th scope="col">Permission</th>{roles.map((r) => <th key={r.key} scope="col" style={{ textAlign: 'center' }}>{r.name}</th>)}</tr></thead>
              <tbody>{m.permissions.filter((p) => p.resource === res).map((p) => (
                <tr key={p.key}>
                  <td data-label="Permission"><Badge tone={p.action === 'F' ? 'info' : p.action === 'A' ? 'warning' : 'neutral'}>{ACTION[p.action]}</Badge> {p.description}{p.ownerOnly && <Tooltip content="Reserved for the owner and cannot be granted to other roles."><Icon name="lock" style={{ display: 'inline', width: 'var(--icon-sm)', height: 'var(--icon-sm)', marginInlineStart: 'var(--space-0-5)', verticalAlign: 'text-bottom' }} /></Tooltip>}</td>
                  {roles.map((r) => {
                    const granted = r.allPermissions || p.grantedTo.includes(r.key);
                    return <td key={r.key} data-label={r.name} style={{ textAlign: 'center' }}>
                      <Checkbox label={<span className="sr-only">{r.name}: {p.description}</span>} checked={granted} disabled={!editable || r.allPermissions || (p.ownerOnly && !granted)} onChange={() => setChange({ role: r.key, permission: p, granted: !granted })} />
                    </td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      ))}
      <ReasonDialog open={Boolean(change)} title={change ? `${change.granted ? 'Grant' : 'Remove'} “${change.permission.description}” for ${titleCase(change.role)}` : ''} onClose={() => setChange(null)}
        onConfirm={async (reason) => { if (!change) return; await api.data('PUT', `/api/v1/roles/${change.role}/permissions/${change.permission.key}`, { granted: change.granted, reason }); toast('success', 'Permission updated.'); reload(); }} />
      <ReasonDialog open={creating} title="Add role" confirmLabel="Create role" description="Only add roles the client has confirmed. A new role starts with no permissions." onClose={() => setCreating(false)}
        onConfirm={async (reason) => {
          await api.data('POST', '/api/v1/roles', { key: newRole.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''), name: newRole.name, requiresMfa: newRole.requiresMfa, reason }, { idempotencyKey: newIdempotencyKey() });
          setNewRole({ name: '', requiresMfa: false }); toast('success', 'Role created.'); reload();
        }}>
        <TextField label="Role name" required value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} hint={newRole.name ? `Key: ${newRole.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')}` : undefined} />
        <Switch label="Require two-factor sign-in" checked={newRole.requiresMfa} onChange={(e) => setNewRole({ ...newRole, requiresMfa: e.target.checked })} />
      </ReasonDialog>
    </div>
  );
}

export default function UsersPage() { return <Suspense fallback={<CardSkeleton />}><UsersAndRoles /></Suspense>; }
