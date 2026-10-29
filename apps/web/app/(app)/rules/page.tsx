'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/api/provider';
import { useSession } from '@/lib/session';
import { formatDateTime, formatRelative } from '@/lib/format';
import {
  Button, Card, CardSkeleton, DataTable, Drawer, EmptyState, ErrorState, Modal, Notice, PageHeader, ReasonDialog, StatusBadge, Switch, TabPanel, Tabs, TextAreaField, Timeline, useAsync, useToast
} from '@/components/ds';

interface Rule { key: string; label: string; group: string; description: string; dependents: string[]; configured: boolean; value: unknown; version: number; updatedAt: string | null; updatedBy: string | null; reason: string | null; external: boolean }
interface Version { version: number; value: unknown; cleared: boolean; reason: string; at: string; by: string }
interface SwitchRow { key: string; name: string; description: string; enabled: boolean; rolloutStage: 'DRAFT_AND_APPROVAL' | 'SELECTIVE'; updatedAt: string; updatedBy: string | null }
interface Change { field: string; oldValue: string; newValue: string; reason: string; at: string; by: string }

/** Shape hints only: every number must be entered by the owner. */
const SHAPES: Record<string, unknown> = {
  'sla.policy': { timezone: 'Asia/Kolkata', businessDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], businessHours: { start: '09:30', end: '18:30' }, holidays: [], turnaroundMinutes: { ENQUIRY: 0 } },
  'escalation.policy': { toBackupAfterMinutes: 0, toManagerAfterMinutes: 0 },
  'discount.levels': { level1: { min: '0', max: '0' }, level2: { min: '0', max: '0' }, level3: { min: '0', max: '0' } },
  'customers.potential_threshold': { metric: 'ORDER_COUNT', threshold: 0, periodDays: 0 }
};

function RulesAndSwitches() {
  const { can } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get('tab') === 'switches' ? 'switches' : 'rules';
  return (
    <>
      <PageHeader title="Rules & switches" crumbs={[{ label: 'Admin' }, { label: 'Rules & switches' }]}
        description="Business values and automation switches the owner controls. Every change is versioned and audited." />
      <Tabs label="Rules and switches" value={tab} onChange={(id) => router.replace(`/rules${id === 'switches' ? '?tab=switches' : ''}`)}
        items={[{ id: 'rules', label: 'Business rules', icon: 'sliders' }, ...(can('automation.read') ? [{ id: 'switches', label: 'Automation switches', icon: 'toggle' as const }] : [])]} />
      <TabPanel id={tab}>{tab === 'rules' ? <RulesTab /> : <SwitchesTab />}</TabPanel>
    </>
  );
}

function RulesTab() {
  const api = useApi();
  const { can } = useSession();
  const toast = useToast();
  const [rules, reload] = useAsync(() => api.data<Rule[]>('GET', '/api/v1/rules'), []);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [draft, setDraft] = useState('');
  const [parseError, setParseError] = useState<string>();
  const [confirm, setConfirm] = useState<'save' | 'clear' | null>(null);
  const [history, setHistory] = useState<Rule | null>(null);
  const [versions] = useAsync(() => history ? api.data<Version[]>('GET', `/api/v1/rules/${history.key}/history`) : Promise.resolve([]), [history?.key]);

  if (rules.status === 'loading' && !rules.data) return <div className="stack">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>;
  if (rules.status === 'error') return <ErrorState error={rules.error} onRetry={reload} />;
  const list = rules.data ?? [];
  const groups = [...new Set(list.map((r) => r.group))];
  const unset = list.filter((r) => !r.configured).length;
  const open = (r: Rule) => { setEditing(r); setParseError(undefined); setDraft(JSON.stringify(r.configured ? r.value : SHAPES[r.key] ?? '', null, 2)); };
  const parse = () => { try { setParseError(undefined); return JSON.parse(draft) as unknown; } catch { setParseError('Enter valid JSON: numbers as digits, text in double quotes.'); return undefined; } };

  return (
    <div className="stack-lg">
      {unset > 0 && <Notice tone="warning" title={`${unset} rule${unset === 1 ? '' : 's'} not configured`}>Workflows that depend on an empty rule stop with a “rule not configured” message until the owner sets it.</Notice>}
      {groups.map((g) => (
        <Card key={g} title={g} padded={false}>
          <ul className="ds-list">
            {list.filter((r) => r.group === g).map((r) => (
              <li key={r.key} className="ds-list-item" style={{ cursor: 'default' }}>
                <div className="cluster-between">
                  <div style={{ minWidth: 0 }}><strong>{r.label}</strong><p className="ds-cell-secondary mono">{r.key}</p></div>
                  <div className="cluster">
                    <StatusBadge status={r.configured ? 'ACTIVE' : 'NOT_CONFIGURED'} label={r.configured ? `Set · v${r.version}` : 'Not configured'} />
                    {!r.external && r.version > 0 && <Button size="sm" variant="ghost" icon="clock" onClick={() => setHistory(r)}>History</Button>}
                    {can('rules.manage') && <Button size="sm" variant={r.configured ? 'secondary' : 'primary'} onClick={() => open(r)}>{r.configured ? 'Change' : 'Set value'}</Button>}
                  </div>
                </div>
                <p className="muted">{r.description}</p>
                <p className="ds-cell-secondary"><strong>Blocks when empty:</strong> {r.dependents.join(', ')}</p>
                {r.configured && <pre className="ds-secret" style={{ textAlign: 'start', whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)' }}>{JSON.stringify(r.value, null, 2)}</pre>}
                {r.updatedAt && <p className="ds-cell-secondary">Changed {formatRelative(r.updatedAt)}{r.updatedBy ? ` by ${r.updatedBy}` : ''}{r.reason ? ` — ${r.reason}` : ''}</p>}
              </li>
            ))}
          </ul>
        </Card>
      ))}
      <Modal open={Boolean(editing)} size="lg" title={editing ? `${editing.configured ? 'Change' : 'Set'} ${editing.label}` : ''} description={editing?.description} onClose={() => setEditing(null)} footer={<>
        {editing?.configured && !editing.external && <Button variant="danger" onClick={() => setConfirm('clear')}>Clear (blocks again)</Button>}
        <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
        <Button onClick={() => { if (parse() !== undefined) setConfirm('save'); }}>Review and save</Button>
      </>}>
        {editing && !editing.configured && SHAPES[editing.key] !== undefined && <Notice tone="info">The shape below has zeros as placeholders. Replace each value with the client’s decision.</Notice>}
        <TextAreaField label="Value (JSON)" rows={12} className="mono" value={draft} onChange={(e) => setDraft(e.target.value)} error={parseError} spellCheck={false} />
      </Modal>
      <ReasonDialog open={confirm !== null} title={confirm === 'clear' ? 'Clear rule' : 'Save new version'} danger={confirm === 'clear'} confirmLabel={confirm === 'clear' ? 'Clear rule' : 'Save version'} onClose={() => setConfirm(null)}
        onConfirm={async (reason) => {
          if (!editing) return;
          if (confirm === 'clear') await api.data('POST', `/api/v1/rules/${editing.key}/clear`, { reason });
          else await api.data('PUT', `/api/v1/rules/${editing.key}`, { value: JSON.parse(draft), reason });
          setEditing(null); toast('success', confirm === 'clear' ? 'Rule cleared.' : 'Rule saved as a new version.'); reload();
        }} />
      <Drawer open={Boolean(history)} title={history ? `${history.label}: history` : ''} onClose={() => setHistory(null)}>
        {versions.status === 'loading' && <CardSkeleton />}
        {versions.status === 'error' && <ErrorState error={versions.error} />}
        {versions.status === 'ready' && <Timeline items={versions.data.map((v) => ({ id: v.version, title: v.cleared ? `v${v.version} cleared` : `v${v.version}`, at: v.at, by: v.by, icon: v.cleared ? 'x' : 'check', tone: v.cleared ? 'warning' : 'success', body: <>{v.reason}{!v.cleared && <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(v.value)}</pre>}</> }))} />}
      </Drawer>
    </div>
  );
}

function SwitchesTab() {
  const api = useApi();
  const { can } = useSession();
  const toast = useToast();
  const [state, reload] = useAsync(() => api.data<{ switches: SwitchRow[]; history: Change[] }>('GET', '/api/v1/automation'), []);
  const [pending, setPending] = useState<{ sw: SwitchRow; body: { enabled?: boolean; rolloutStage?: SwitchRow['rolloutStage'] } } | null>(null);
  const owner = can('automation.enable');
  const data = state.status === 'ready' ? state.data : state.data;
  return (
    <div className="stack-lg">
      <Notice tone="info">Every automation starts OFF. Only the owner can turn one ON. Even when ON, outgoing emails still need an employee to approve each draft.</Notice>
      <DataTable<SwitchRow> id="switches" caption="Automation switches" rows={data?.switches} rowKey={(r) => r.key} loading={state.status === 'loading'} error={state.status === 'error' ? state.error : undefined} onRetry={reload}
        columns={[
          { key: 'name', header: 'Workflow', render: (r) => <><span className="ds-cell-primary">{r.name}</span><br /><span className="ds-cell-secondary">{r.description}</span></> },
          { key: 'state', header: 'State', render: (r) => (
            <Switch label={r.enabled ? 'On' : 'Off'} checked={r.enabled} disabled={r.enabled ? !(owner || can('automation.disable')) : !owner}
              onChange={() => setPending({ sw: r, body: { enabled: !r.enabled } })} aria-label={`${r.name}: ${r.enabled ? 'on' : 'off'}`} />
          ) },
          { key: 'stage', header: 'Rollout stage', render: (r) => <>{r.rolloutStage === 'SELECTIVE' ? 'Selective automation' : 'Draft and approval'}{owner && <><br /><Button size="sm" variant="link" onClick={() => setPending({ sw: r, body: { rolloutStage: r.rolloutStage === 'SELECTIVE' ? 'DRAFT_AND_APPROVAL' : 'SELECTIVE' } })}>Change stage</Button></>}</> },
          { key: 'changed', header: 'Last change', render: (r) => <><span className="num">{formatDateTime(r.updatedAt)}</span><br /><span className="ds-cell-secondary">{r.updatedBy ?? 'Never changed'}</span></> }
        ]} />
      <Card title="Change log">
        {!data ? <CardSkeleton /> : data.history.length === 0 ? <EmptyState title="No switch has been changed yet" /> :
          <Timeline items={data.history.map((h, i) => ({ id: i, title: `${h.field === 'enabled' ? 'Switch' : 'Rollout stage'}: ${h.oldValue} → ${h.newValue}`, at: h.at, by: h.by, body: h.reason, icon: 'toggle' }))} />}
      </Card>
      <ReasonDialog open={Boolean(pending)} danger={pending?.body.enabled === true} confirmLabel="Apply"
        title={pending ? `${pending.sw.name}: ${pending.body.enabled === true ? 'turn ON' : pending.body.enabled === false ? 'turn OFF' : 'change rollout stage'}` : ''}
        onClose={() => setPending(null)}
        onConfirm={async (reason) => {
          if (!pending) return;
          await api.data('PATCH', `/api/v1/automation/${pending.sw.key}`, { ...pending.body, reason });
          toast('success', 'Switch updated.'); reload();
        }}>
        {pending?.body.enabled === true && <Notice tone="warning">Turning this ON lets the workflow act within its rollout stage.</Notice>}
      </ReasonDialog>
    </div>
  );
}

export default function RulesPage() { return <Suspense fallback={<CardSkeleton />}><RulesAndSwitches /></Suspense>; }
