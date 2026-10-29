'use client';

import { useState } from 'react';
import { apiData } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Button, ErrorState, LoadingState, Modal, PageHeader, ReasonDialog, StatusBadge, TextArea, Timeline, formatDateTime, useAsync, useToast } from '@/components/ui';

interface Rule { key: string; label: string; group: string; description: string; dependents: string[]; configured: boolean; value: unknown; version: number; updatedAt: string | null; updatedBy: string | null; reason: string | null; external: boolean }
interface Version { version: number; value: unknown; cleared: boolean; reason: string; at: string; by: string }

const EXAMPLES: Record<string, unknown> = {
  'sla.policy': { timezone: 'Asia/Kolkata', businessDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], businessHours: { start: '09:30', end: '18:30' }, holidays: [], turnaroundMinutes: { ENQUIRY: 0 } },
  'escalation.policy': { toBackupAfterMinutes: 0, toManagerAfterMinutes: 0 },
  'discount.levels': { level1: { min: '0', max: '0' }, level2: { min: '0', max: '0' }, level3: { min: '0', max: '0' } },
  'customers.potential_threshold': { metric: 'ORDER_COUNT', threshold: 0, periodDays: 0 }
};

/** Rules screen: owner-entered business values. Nothing is pre-filled; unset rules block the workflows listed under them. */
export default function RulesPage() {
  const { can } = useSession();
  const toast = useToast();
  const [rules, reload] = useAsync(() => apiData<Rule[]>('/api/v1/rules'), []);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [draft, setDraft] = useState('');
  const [parseError, setParseError] = useState<string>();
  const [confirm, setConfirm] = useState<'save' | 'clear' | null>(null);
  const [history, setHistory] = useState<Rule | null>(null);
  const [versions] = useAsync(() => history ? apiData<Version[]>(`/api/v1/rules/${history.key}/history`) : Promise.resolve([]), [history?.key]);

  const open = (r: Rule) => {
    setEditing(r); setParseError(undefined);
    // Examples show the shape only; every number must be entered by the owner.
    setDraft(JSON.stringify(r.configured ? r.value : EXAMPLES[r.key] ?? '', null, 2));
  };
  const parsed = (): unknown => { try { setParseError(undefined); return JSON.parse(draft); } catch { setParseError('Enter valid JSON (numbers, text in quotes).'); return undefined; } };

  const groups = rules.status === 'ready' ? [...new Set(rules.data.map((r) => r.group))] : [];
  return (
    <>
      <PageHeader title="Rules" description="Business values the owner controls. Each change is versioned and audited. While a rule is empty, the workflows that depend on it stop with a 'rule not configured' message." />
      {rules.status === 'loading' && <LoadingState />}
      {rules.status === 'error' && <ErrorState error={rules.error} onRetry={reload} />}
      {rules.status === 'ready' && groups.map((g) => (
        <section key={g} className="card" aria-labelledby={`g-${g}`}>
          <h2 id={`g-${g}`} className="card-title">{g}</h2>
          <div className="stack">
            {rules.data.filter((r) => r.group === g).map((r) => (
              <article key={r.key} className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div><h3 style={{ fontSize: 15 }}>{r.label}</h3><p className="muted mono">{r.key}</p></div>
                  <div className="row">
                    <StatusBadge status={r.configured ? 'ACTIVE' : 'NOT_CONFIGURED'} label={r.configured ? `set · v${r.version}` : 'not configured'} />
                    {!r.external && <Button variant="ghost" onClick={() => setHistory(r)}>History</Button>}
                    {can('rules.manage') && <Button variant="secondary" onClick={() => open(r)}>{r.configured ? 'Change' : 'Set'}</Button>}
                  </div>
                </div>
                <p className="muted">{r.description}</p>
                <p><strong>Blocks when empty:</strong> {r.dependents.join(', ')}</p>
                {r.configured && <pre className="secret" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(r.value, null, 2)}</pre>}
                {r.updatedAt && <p className="muted">Last changed {formatDateTime(r.updatedAt)}{r.updatedBy ? ` by ${r.updatedBy}` : ''}{r.reason ? ` — ${r.reason}` : ''}</p>}
              </article>
            ))}
          </div>
        </section>
      ))}

      <Modal open={Boolean(editing)} title={editing ? `${editing.configured ? 'Change' : 'Set'} ${editing.label}` : ''} onClose={() => setEditing(null)} footer={<>
        {editing?.configured && !editing.external && <Button variant="danger" onClick={() => setConfirm('clear')}>Clear (block again)</Button>}
        <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
        <Button onClick={() => { if (parsed() !== undefined) setConfirm('save'); }}>Review and save</Button>
      </>}>
        {editing && <>
          <p className="muted">{editing.description}</p>
          {!editing.configured && EXAMPLES[editing.key] !== undefined && <p className="notice notice-info">The shape below has zeros as placeholders. Replace every value with the client&apos;s decision; zeros are rejected where they are not allowed.</p>}
          <TextArea label="Value (JSON)" rows={12} className="mono" value={draft} onChange={(e) => setDraft(e.target.value)} error={parseError} spellCheck={false} />
        </>}
      </Modal>
      <ReasonDialog open={confirm !== null} title={confirm === 'clear' ? 'Clear rule' : 'Save rule'} danger={confirm === 'clear'} confirmLabel={confirm === 'clear' ? 'Clear rule' : 'Save new version'}
        onClose={() => setConfirm(null)}
        onConfirm={async (reason) => {
          if (!editing) return;
          if (confirm === 'clear') await apiData(`/api/v1/rules/${editing.key}/clear`, { method: 'POST', body: { reason } });
          else await apiData(`/api/v1/rules/${editing.key}`, { method: 'PUT', body: { value: JSON.parse(draft), reason } });
          setEditing(null); toast('ok', 'Rule saved.'); reload();
        }} />
      <Modal open={Boolean(history)} title={history ? `${history.label} — history` : ''} onClose={() => setHistory(null)}>
        {versions.status === 'loading' && <LoadingState />}
        {versions.status === 'error' && <ErrorState error={versions.error} />}
        {versions.status === 'ready' && <Timeline items={versions.data.map((v) => ({ id: v.version, title: v.cleared ? `v${v.version} cleared` : `v${v.version}`, at: v.at, by: v.by, detail: <>{v.reason}{!v.cleared && <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(v.value)}</pre>}</> }))} />}
      </Modal>
    </>
  );
}
