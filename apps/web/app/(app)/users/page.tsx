'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/api/provider';
import { newIdempotencyKey } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import { titleCase } from '@/lib/format';
import { permissionAuditReason, permissionCellLocked } from '@/features/users/permission-matrix';
import {
  Avatar, Badge, Button, Card, CardSkeleton, Checkbox, DataTable, Drawer, ErrorState, Icon, Notice, PageHeader, ReasonDialog, SelectField, StatusBadge, Switch,
  TabPanel, Tabs, TextField, Tooltip, useAsync, useToast
} from '@/components/ds';

interface UserRow { id: number; name: string; email: string; phone: string | null; role: string; status: string; department: string | null; onLeave: boolean; backupUserId: number | null; backup: string | null; managerUserId: number | null; manager: string | null; ownerUserId: number | null; owner: string | null; mustChangePassword: boolean; mfaEnabled: boolean; mfaRequired: boolean }
interface Role { key: string; name: string; description?: string | null; requiresMfa: boolean; allPermissions: boolean; isSystem: boolean; status: string; allowedPermissions?: string[] }
interface Permission { key: string; resource: string; action: 'R' | 'W' | 'A' | 'F'; description: string; ownerOnly: boolean; grantedTo: string[] }
interface Matrix { roles: Role[]; permissions: Permission[]; history: {id: number; role: string; permission: string | null; change: string; reason: string; changedAt: string; changedBy: string | null}[] }

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
        description="Six defined roles, including Logistics lead and Store staff. Logistics has no cost, margin or Tally financial access. Custom roles start without permissions. Departments only route work." />
      {can('rules.manage')&&<a href="/users/automation-credentials">Owner: manage scoped automation credentials</a>}
      <Tabs label="Users and roles" value={tab} onChange={(id) => router.replace(`/users${id === 'roles' ? '?tab=roles' : ''}`)}
        items={[{ id: 'users', label: 'People', icon: 'customers' }, ...(can('access.read') ? [{ id: 'roles', label: 'Role permissions', icon: 'shield' as const }] : [])]} />
      <TabPanel id={tab}>{tab === 'users' ? <PeopleTab /> : <RolesTab />}</TabPanel>
    </>
  );
}

interface Capacity { activeOwnerCount: number; warnings: { code: string; workflow?: string; message: string }[] }
function CapacityWarnings({ value }: { value?: Capacity }) {
  if (!value) return null;
  return <div className="stack-sm">{value.warnings.map((w, i) => <Notice key={`${w.code}-${w.workflow ?? i}`} tone="warning">{w.message}</Notice>)}</div>;
}
function PeopleTab() {
  const api = useApi(), { can, state } = useSession(), toast = useToast();
  const [users, reload] = useAsync(() => api.data<UserRow[]>('GET', '/api/v1/users'), []);
  const [roles] = useAsync(() => can('access.read') ? api.data<Matrix>('GET', '/api/v1/roles').then(m => m.roles) : Promise.resolve<Role[]>([]), []);
  const [capacity, reloadCapacity] = useAsync(() => api.data<Capacity>('GET', '/api/v1/users/provisioning'), [users.data]);
  const [editing, setEditing] = useState<UserRow | null>(null), [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [confirm, setConfirm] = useState<'save' | 'create' | 'deactivate' | 'reassign' | 'mfa' | null>(null);
  const [preview, setPreview] = useState<Capacity>(), [previewError, setPreviewError] = useState<unknown>(), [requestKey, setRequestKey] = useState('');
  const list = users.data;
  const others = (list ?? []).filter(u => u.id !== editing?.id && u.status === 'ACTIVE' && !u.onLeave).map(u => ({ value: String(u.id), label: u.name }));
  const close = () => { setEditing(null); setCreating(false); setForm({}); setPreview(undefined); setPreviewError(undefined); };
  const edit = (u: UserRow) => { setCreating(false); setEditing(u); setForm({ name: u.name, email: u.email, phone: u.phone ?? '', role: u.role, status: u.status, department: u.department ?? '', ownerUserId: u.ownerUserId ? String(u.ownerUserId) : '', backupUserId: u.backupUserId ? String(u.backupUserId) : '', onLeave: u.onLeave }); };
  const create = () => { setEditing(null); setCreating(true); setRequestKey(newIdempotencyKey()); setForm({ name: '', email: '', phone: '', password: '', role: 'EXECUTIVE', ownerUserId: '', backupUserId: '', department: '', status: 'ACTIVE', onLeave: false }); };
  const previewStatus = confirm === 'deactivate' ? 'INACTIVE' : form.status;
  useEffect(() => {
    if (!creating && !editing) return;
    const controller = new AbortController(); setPreview(undefined); setPreviewError(undefined);
    const timer = setTimeout(() => { api.data<Capacity>('POST', '/api/v1/users/provisioning-preview', { ...(editing ? { userId: editing.id } : {}), ...(form.name ? { name: form.name } : {}), role: form.role, status: previewStatus, onLeave: Boolean(form.onLeave) }, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setPreview(value); }).catch(e => { if (!controller.signal.aborted) setPreviewError(e); }); }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [api, creating, editing?.id, form.role, previewStatus, form.onLeave, form.name]);
  const ownerCount = capacity.data?.activeOwnerCount;
  return <>
    <div className="cluster-between"><p className="muted">{ownerCount === undefined ? 'Checking Owner and reviewer coverage?' : `${ownerCount} active Owner${ownerCount === 1 ? '' : 's'}. Reviewers must be different, ready people with the required permissions.`}</p><div className="cluster"><Button variant="secondary" onClick={() => { reload(); reloadCapacity(); }}>Refresh coverage</Button>{can('users.create') && <Button icon="plus" onClick={create}>Create staff</Button>}</div></div>
    {capacity.status === 'error' ? <ErrorState error={capacity.error} onRetry={reloadCapacity} /> : <CapacityWarnings value={capacity.data} />}
    <DataTable<UserRow> id="users" caption="Staff accounts" rows={list} rowKey={u => u.id} onRowClick={can('users.update') ? edit : undefined} loading={users.status === 'loading'} error={users.status === 'error' ? users.error : undefined} onRetry={reload} columns={[
      { key: 'name', header: 'Person', render: u => <span className="cluster"><Avatar name={u.name} /><span><span className="ds-cell-primary">{u.name}</span><br /><span className="ds-cell-secondary">{u.email}</span></span></span> },
      { key: 'role', header: 'Role', render: u => titleCase(u.role) },
      { key: 'owner', header: 'Owner / backup owner', render: u => <><span>{u.owner ?? 'No owner assigned'}</span><br /><span className="ds-cell-secondary">{u.backup ?? 'No backup assigned'}</span></> },
      { key: 'ready', header: 'Sign-in setup', render: u => u.mustChangePassword ? <Badge tone="warning">Password change pending</Badge> : <Badge tone="success">Password ready</Badge> },
      { key: 'mfa', header: 'Two-factor', optional: true, render: u => u.mfaEnabled ? <Badge tone="success">On</Badge> : u.mfaRequired ? <Badge tone="warning">Required</Badge> : 'Off' },
      { key: 'status', header: 'Status', render: u => <span className="cluster"><StatusBadge status={u.status} />{u.onLeave && <Badge tone="warning">On leave</Badge>}</span> }
    ]} />
    <Drawer open={creating || Boolean(editing)} title={creating ? 'Create staff account' : editing?.name ?? ''} description={creating ? 'An individual account with a temporary password and named coverage.' : editing?.email} onClose={close} footer={<>
      {editing && can('work.reassign') && <Button variant="secondary" onClick={() => setConfirm('reassign')}>Move open work to backup</Button>}
      {editing?.mfaEnabled && <Button variant="secondary" onClick={() => setConfirm('mfa')}>Reset two-factor</Button>}
      {editing?.status === 'ACTIVE' && <Button variant="secondary" disabled={(editing.role === 'OWNER' && ownerCount === 1) || (state.kind === 'ready' && editing.id === state.user.id)} onClick={() => setConfirm('deactivate')}>Deactivate with reason</Button>}
      <Button onClick={() => setConfirm(creating ? 'create' : 'save')}>{creating ? 'Create staff' : 'Save changes'}</Button>
    </>}>
      {(creating || editing) && <div className="stack">
        {creating && <Notice tone="info">A password change is mandatory at first sign-in. No password is generated, seeded or sent automatically.</Notice>}
        <TextField label="Full name" required value={String(form.name ?? '')} onChange={e => setForm({ ...form, name: e.target.value })} />
        <TextField label="Email" type="email" required value={String(form.email ?? '')} onChange={e => setForm({ ...form, email: e.target.value })} />
        <TextField label="Phone (optional)" type="tel" value={String(form.phone ?? '')} onChange={e => setForm({ ...form, phone: e.target.value })} />
        <SelectField label="Role" value={String(form.role)} onChange={e => setForm({ ...form, role: e.target.value })} options={(roles.data?.length ? roles.data.filter(r => r.status === 'ACTIVE') : [{ key: editing?.role ?? 'EXECUTIVE', name: titleCase(editing?.role ?? 'EXECUTIVE') }]).map(r => ({ value: r.key, label: r.name }))} />
        <SelectField label="Owner (reporting / escalation)" required={creating} value={String(form.ownerUserId ?? '')} onChange={e => setForm({ ...form, ownerUserId: e.target.value })} placeholder="Select owner" options={others.filter(u => u.value !== form.backupUserId)} hint="Uses the existing reporting manager field. This assignment grants no approval permission." />
        <SelectField label="Backup owner" value={String(form.backupUserId ?? '')} onChange={e => setForm({ ...form, backupUserId: e.target.value })} placeholder="Unassigned" options={others.filter(u => u.value !== form.ownerUserId)} hint="Assign a different person when available. An unassigned backup provides no leave or reassignment coverage." />
        {!form.backupUserId && <Notice tone="warning">No backup owner selected. Coverage remains unassigned until you choose a different active person.</Notice>}
        <SelectField label="Department (routing label)" value={String(form.department ?? '')} onChange={e => setForm({ ...form, department: e.target.value })} placeholder="None" options={DEPARTMENTS.map(d => ({ value: d, label: titleCase(d) }))} />
        {creating ? <TextField label="Temporary password" type="password" autoComplete="new-password" required value={String(form.password ?? '')} onChange={e => setForm({ ...form, password: e.target.value })} hint="12 to 128 characters, with upper/lower case, a number and a symbol. Share it securely yourself." /> : <>
          <SelectField label="Status" value={String(form.status)} onChange={e => setForm({ ...form, status: e.target.value })} options={['ACTIVE','INACTIVE','LOCKED'].map(v => ({ value: v, label: titleCase(v) }))} />
          <Switch label="On leave" checked={Boolean(form.onLeave)} onChange={e => setForm({ ...form, onLeave: e.target.checked })} />
        </>}
        {previewError != null ? <ErrorState error={previewError} /> : preview ? <CapacityWarnings value={preview} /> : <p className="muted">Checking reviewer coverage for these changes?</p>}
      </div>}
    </Drawer>
    <ReasonDialog open={confirm !== null} onClose={() => setConfirm(null)} danger={confirm === 'mfa' || confirm === 'deactivate'} title={confirm === 'create' ? 'Create staff account' : confirm === 'deactivate' ? 'Deactivate this staff account' : confirm === 'reassign' ? 'Move all open work to backup' : confirm === 'mfa' ? 'Reset two-factor' : 'Save changes'}
      confirmDisabled={['create','save','deactivate'].includes(confirm ?? '') && (!preview || previewError != null)}
      description={confirm === 'deactivate' ? 'Their sessions will be revoked. The account and audit history are retained. Review the remaining Owner and reviewer coverage below.' : 'Review coverage and enter the reason for this change.'}
      onConfirm={async reason => {
        if (['create','save','deactivate'].includes(confirm ?? '') && !preview) throw new Error('Wait for reviewer coverage to load before confirming.');
        if (confirm === 'create') {
          await api.data('POST','/api/v1/users',{name: form.name,email: form.email,phone: form.phone || null,role: form.role,ownerUserId: Number(form.ownerUserId),backupUserId: form.backupUserId ? Number(form.backupUserId) : null,department: form.department || null,password: form.password,reason},{idempotencyKey: requestKey});
          toast('success','Staff account created. First sign-in requires a password change.');
        } else if (editing && confirm === 'reassign') {
          const r = await api.data<{workItems:{moved:number;unassignedCount:number};tasks:{moved:number}}>('POST',`/api/v1/users/${editing.id}/reassign`,{reason},{idempotencyKey:newIdempotencyKey()});
          toast(r.workItems.unassignedCount ? 'danger' : 'success',`Moved ${r.workItems.moved} records and ${r.tasks.moved} tasks. ${r.workItems.unassignedCount} records had no backup.`);
        } else if (editing && confirm === 'mfa') {
          await api.data('POST',`/api/v1/users/${editing.id}/mfa/reset`,{reason}); toast('success','Two-factor reset.');
        } else if (editing) {
          await api.data('PATCH',`/api/v1/users/${editing.id}`,{name: form.name,email: form.email,phone: form.phone || null,role: form.role,status: confirm === 'deactivate' ? 'INACTIVE' : form.status,department: form.department || null,onLeave: Boolean(form.onLeave),ownerUserId: form.ownerUserId ? Number(form.ownerUserId) : null,backupUserId: form.backupUserId ? Number(form.backupUserId) : null,reason}); toast('success','Staff account updated.');
        }
        setConfirm(null);close();reload();reloadCapacity();
      }}>
      {previewError != null ? <ErrorState error={previewError} /> : <CapacityWarnings value={preview} />}
      {['create','save','deactivate'].includes(confirm ?? '') && !preview && previewError == null && <p role="status">Checking reviewer coverage before confirmation...</p>}
      {!form.backupUserId && <Notice tone="warning">Backup ownership is unassigned. This change does not establish backup coverage.</Notice>}
      <p className="muted">Reviewer coverage checks account readiness and permissions. Record-specific approval and maker-checker checks still apply.</p>
    </ReasonDialog>
  </>;
}

function RolesTab() {
  const api = useApi();
  const { can } = useSession();
  const toast = useToast();
  const [matrix, reload] = useAsync(() => api.data<Matrix>('GET', '/api/v1/roles'), []);
  const [savedMatrix, setSavedMatrix] = useState<Matrix>();
  const permissionRequest = useRef(false);
  const [savingPermission, setSavingPermission] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [newRole, setNewRole] = useState({ name: '', requiresMfa: false });
  const editable = can('access.manage');
  if (matrix.status === 'loading' && !matrix.data) return <CardSkeleton lines={6} />;
  if (matrix.status === 'error') return <ErrorState error={matrix.error} onRetry={reload} />;
  const m = savedMatrix ?? matrix.data!;
  const roles = m.roles.filter((r) => r.status === 'ACTIVE');
  const resources = [...new Set(m.permissions.map((p) => p.resource))];
  const savePermission = async (role: Role, permission: Permission, granted: boolean) => {
    if (permissionRequest.current || matrix.status !== 'ready') return;
    permissionRequest.current = true;
    const key = `${role.key}:${permission.key}`;
    setSavingPermission(key); setPermissionError('');
    try {
      const updated = await api.data<Matrix>('PUT', `/api/v1/roles/${role.key}/permissions/${permission.key}`, {
        granted,
        reason: permissionAuditReason(permission.key, granted)
      });
      setSavedMatrix(updated);
      toast('success', `${permission.description}: ${granted ? 'enabled' : 'disabled'} for ${role.name}.`);
    } catch (error) {
      setPermissionError(error instanceof Error ? error.message : 'The permission could not be updated.');
    } finally { permissionRequest.current = false; setSavingPermission(null); }
  };
  return (
    <div className="stack-lg">
      {editable && <div className="cluster-between"><div><p className="muted">Click an available checkbox to save it immediately. The audit trail records the exact permission change automatically.</p><p className="ds-cell-secondary">Grey boxes are protected: Owner always has full access, owner-only permissions cannot be delegated, and Logistics/Store roles keep their approved operational limits.</p></div><Button variant="secondary" icon="plus" onClick={() => setCreating(true)}>Add role</Button></div>}
      {permissionError && <Notice tone="danger">{permissionError}</Notice>}
      <Card title="Role settings">
        <p className="muted">Inactive roles cannot sign in. Move active staff before deactivating a role. Owner must remain active with two-factor required.</p>
        {m.roles.map(role => <div className="cluster-between" key={role.key}><span><strong>{role.name}</strong> ? {role.status} ? {role.requiresMfa ? 'Two-factor required' : 'Two-factor optional'}</span>{editable && <Button variant="secondary" onClick={() => setEditingRole({...role})}>Edit {role.name}</Button>}</div>)}
      </Card>
      <ReasonDialog open={Boolean(editingRole)} title="Update role" description="Permission grants remain unchanged. Every role change records your reason." onClose={() => setEditingRole(null)} onConfirm={async reason => {
        if (!editingRole) return;
        await api.data('PATCH', `/api/v1/roles/${editingRole.key}`, {name: editingRole.name, description: editingRole.description ?? null, requiresMfa: editingRole.requiresMfa, status: editingRole.status, reason});
        setEditingRole(null); setSavedMatrix(undefined); toast('success','Role updated.'); reload();
      }}>
        {editingRole && <div className="stack">
          <TextField label="Role name" value={editingRole.name} onChange={event => setEditingRole({...editingRole,name:event.target.value})} required />
          <TextField label="Description" value={editingRole.description ?? ''} onChange={event => setEditingRole({...editingRole,description:event.target.value})} />
          <Switch label="Require two-factor sign-in" checked={editingRole.requiresMfa} disabled={editingRole.allPermissions} onChange={event => setEditingRole({...editingRole,requiresMfa:event.target.checked})} />
          <SelectField label="Role status" value={editingRole.status} disabled={editingRole.allPermissions} options={[{value:'ACTIVE',label:'Active'},{value:'INACTIVE',label:'Inactive'}]} onChange={event => setEditingRole({...editingRole,status:event.target.value})} />
        </div>}
      </ReasonDialog>
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
                    const key = `${r.key}:${p.key}`;
                    const locked = permissionCellLocked(r, p, granted);
                    return <td key={r.key} data-label={r.name} style={{ textAlign: 'center' }}>
                      <Checkbox label={<span className="sr-only">{r.name}: {p.description}</span>} checked={granted} disabled={!editable || locked || savingPermission !== null} aria-busy={savingPermission === key} title={locked ? 'This permission is protected by the role policy.' : 'Click to save immediately.'} onChange={(event) => void savePermission(r, p, event.target.checked)} />
                    </td>;
                  })}
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      ))}
      <Card title="Permission and role history">
        <DataTable id="access-history" caption="Recent role and permission changes" rows={m.history} rowKey={row => row.id} columns={[
          {key:'role',header:'Role',render:row=>titleCase(row.role)},
          {key:'permission',header:'Permission',render:row=>row.permission ?? 'Role settings'},
          {key:'change',header:'Change',render:row=>titleCase(row.change)},
          {key:'changedBy',header:'Changed by',render:row=>row.changedBy ?? 'System'},
          {key:'reason',header:'Reason',render:row=>row.reason},
          {key:'changedAt',header:'When',render:row=>new Date(row.changedAt).toLocaleString()}
        ]} />
      </Card>
      <ReasonDialog open={creating} title="Add role" confirmLabel="Create role" description="A new role starts with no permissions. Its name grants no special access. Record why this role is needed." onClose={() => setCreating(false)}
        onConfirm={async (reason) => {
          await api.data('POST', '/api/v1/roles', { key: newRole.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, ''), name: newRole.name, requiresMfa: newRole.requiresMfa, reason }, { idempotencyKey: newIdempotencyKey() });
          setNewRole({ name: '', requiresMfa: false }); setSavedMatrix(undefined); toast('success', 'Role created.'); reload();
        }}>
        <TextField label="Role name" required value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} hint={newRole.name ? `Key: ${newRole.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')}` : undefined} />
        <Switch label="Require two-factor sign-in" checked={newRole.requiresMfa} onChange={(e) => setNewRole({ ...newRole, requiresMfa: e.target.checked })} />
      </ReasonDialog>
    </div>
  );
}

export default function UsersPage() { return <Suspense fallback={<CardSkeleton />}><UsersAndRoles /></Suspense>; }
