'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { newIdempotencyKey } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import { formatDate, formatMoney, formatPercent, formatQty, titleCase } from '@/lib/format';
import {
  Badge, Button, Card, CardSkeleton, Checkbox, Combobox, DataTable, Drawer, EmptyState, ErrorState, Icon, IconButton, MarginFlag, Modal, Notice, ReasonDialog, SelectField,
  StatusBadge, Stepper, TextAreaField, TextField, Timeline, Truncate, useAsync, useToast, type Option, type Step
} from '@/components/ds';
import { screenHref } from '@/components/shell/nav-config';
import { STATE_NAMES, type QuoteAction, type QuoteStatus } from './api';
import { marginFlag, useQuoteEditor, type QuoteEditor } from './use-quote-editor';

const FLOW: { status: QuoteStatus; label: string }[] = [{ status: 'DRAFT', label: 'Draft' }, { status: 'PENDING_APPROVAL', label: 'Approval' }, { status: 'APPROVED', label: 'Approved' }, { status: 'SENT', label: 'Sent' }];
function flowSteps(status: QuoteStatus | undefined): Step[] {
  const s = status ?? 'DRAFT';
  const index = ['WON', 'LOST'].includes(s) ? 4 : FLOW.findIndex((f) => f.status === s);
  const steps: Step[] = FLOW.map((f, i) => ({ label: f.label, state: i < index ? 'done' : i === index ? 'current' : 'todo' }));
  steps.push({ label: s === 'LOST' ? 'Lost' : 'Won', state: s === 'WON' ? 'done' : s === 'LOST' ? 'blocked' : 'todo' });
  if (['EXPIRED', 'CANCELLED'].includes(s)) return [...steps.filter((x) => x.state === 'done'), { label: titleCase(s), state: 'blocked' }];
  return steps;
}
const STATE_OPTIONS: Option[] = Object.entries(STATE_NAMES).map(([code, name]) => ({ value: code, label: `${code} · ${name}` }));

/** S-04 Quotation editor: lines, live totals, margin flags and the approval flow. */
export function QuoteEditorView({ id, enquiryId }: { id?: string; enquiryId?: string | null }) {
  const ed = useQuoteEditor({ id, enquiryId });
  const { can, state: session } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [reasonFor, setReasonFor] = useState<null | { kind: 'save' } | { kind: 'action'; action: QuoteAction } | { kind: 'duplicate' }>(null);
  const [override, setOverride] = useState(false);
  const [preview, setPreview] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [busy, setBusy] = useState(false);
  const createKey = useRef(newIdempotencyKey());
  const q = ed.quote;
  const me = session.kind === 'ready' ? session.user.id : 0;

  if (ed.loadError) return <ErrorState error={ed.loadError} onRetry={() => void ed.reload()} />;
  if (ed.policy === undefined || (id && !q)) return <div className="stack"><CardSkeleton lines={2} /><div className="grid-main-aside"><CardSkeleton lines={8} /><CardSkeleton lines={5} /></div></div>;
  if (ed.policy === null) return <Notice tone="warning" title="Quotation policy not set">The owner must set the margin floor, seller state and letterhead (Quotations → Policy &amp; letterhead) before quotations can be created.</Notice>;

  const r = ed.calc.result;
  const floor = q?.pricing?.floorPercent ?? ed.policy.floor_percent;
  const local = ed.policy.seller_state === ed.placeOfSupply;
  const totalFlag = ed.costAccess && r ? (r.missingCost ? null : marginFlag(r.marginPercent, floor)) : null;

  const create = async () => {
    setBusy(true);
    try { const saved = await ed.api.create(ed.toInput('Quotation created'), createKey.current); toast('success', `${saved.quotation_number} saved as a draft.`); router.replace(`/quotations/${saved.id}`); }
    catch (e) { toast('danger', e instanceof Error ? e.message : 'Could not save.'); } finally { setBusy(false); }
  };
  const runAction = async (action: QuoteAction, reason: string) => {
    if (!q) return;
    const updated = await ed.api.action(q.id, { action, version: q.version, reason, ...(action === 'APPROVE' && q.pricing?.belowFloor ? { overrideFloor: override } : {}) });
    ed.setQuote(updated); toast('success', `Quotation ${titleCase(updated.status).toLowerCase()}.`);
  };
  const actions: { action: QuoteAction; label: string; variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }[] = [];
  if (q) {
    const author = q.created_by === me;
    if (q.status === 'DRAFT' && can('quotations.update') && !ed.dirty) actions.push({ action: 'SUBMIT', label: 'Submit for approval', variant: 'primary' });
    if (q.status === 'PENDING_APPROVAL' && can('quotations.approve') && !author) actions.push({ action: 'APPROVE', label: 'Approve', variant: 'primary' }, { action: 'RETURN', label: 'Return to draft', variant: 'secondary' });
    if (q.status === 'APPROVED' && can('quotations.status')) actions.push({ action: 'SEND', label: 'Mark as sent', variant: 'secondary' });
    if (q.status === 'SENT' && can('quotations.status')) actions.push({ action: 'WON', label: 'Mark won', variant: 'primary' }, { action: 'LOST', label: 'Mark lost', variant: 'secondary' });
    if (['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT'].includes(q.status) && q.validUntil < new Date().toISOString().slice(0, 10) && can('quotations.status')) actions.push({ action: 'EXPIRE', label: 'Mark expired', variant: 'ghost' });
    if (!['WON', 'LOST', 'EXPIRED', 'CANCELLED'].includes(q.status) && can('quotations.status')) actions.push({ action: 'CANCEL', label: 'Cancel quotation', variant: 'ghost' });
  }
  const waitingOnOthers = q?.status === 'PENDING_APPROVAL' && !actions.some((a) => a.action === 'APPROVE');

  return (
    <>
      <nav className="ds-breadcrumbs" aria-label="Breadcrumb"><ol><li><Link href="/quotations">Quotations</Link></li><li><span aria-current="page">{q?.quotation_number ?? 'New quotation'}</span></li></ol></nav>
      <header className="ds-record page-enter">
        <span className="ds-record-avatar" aria-hidden="true"><Icon name="quote" /></span>
        <div style={{ minWidth: 0 }}>
          <div className="cluster"><h1 className={q ? 'mono' : undefined} style={{ fontSize: q ? 'var(--text-xl)' : undefined }}>{q?.quotation_number ?? 'New quotation'}</h1>{q && <StatusBadge status={q.status} />}{q && <Badge tone="neutral">v{q.version}</Badge>}{q?.duplicateOf && <Badge tone="info">Duplicate</Badge>}</div>
          <div className="ds-record-meta">
            {ed.customer ? <Link href={`/customers/${ed.customer.value}`}><Icon name="customers" />{ed.customer.label}</Link> : <span>Choose a customer</span>}
            {ed.linkedEnquiry && <Link href={`/enquiries?open=${ed.linkedEnquiry}`}><Icon name="inbox" />From enquiry #{ed.linkedEnquiry}</Link>}
            <span><Icon name="calendar" />Valid until {formatDate(ed.validUntil)}</span>
          </div>
        </div>
        <div className="ds-record-actions">
          {q && <Button variant="secondary" icon="eye" onClick={() => setPreview(true)}>Preview</Button>}
          {q && <a className="ds-button" data-variant="secondary" href={`/api/crm/quotations/${q.id}/pdf`} target="_blank" rel="noopener"><Icon name="download" /><span>PDF</span></a>}
          {q && can('quotations.create') && <Button variant="ghost" icon="plus" onClick={() => setReasonFor({ kind: 'duplicate' })}>Duplicate</Button>}
        </div>
      </header>

      <Card><Stepper label="Quotation approval" steps={flowSteps(q?.status)} /></Card>

      <div className="grid-main-aside" style={{ marginTop: 'var(--space-3)' }}>
        <div className="stack-lg">
          <Card title="Customer and terms">
            <div className="stack">
              <Combobox label="Customer" required value={ed.customer} onChange={(o) => void ed.pickCustomer(o)} search={async (t) => (await ed.api.customers(t)).data.map((c) => ({ value: String(c.id), label: c.name, hint: c.gstin ?? undefined }))} />
              <div className="grid-2">
                <SelectField label="Place of supply" required value={ed.placeOfSupply} disabled={!ed.editable} onChange={(e) => ed.setPlaceOfSupply(e.target.value)} placeholder="Choose state" options={STATE_OPTIONS}
                  hint={ed.placeOfSupply ? (local ? `Same state as seller: CGST + ${r?.localTaxLabel ?? 'SGST'}` : 'Inter-state: IGST') : 'Suggested from the customer; confirm it.'} />
                <TextField label="Valid until" type="date" required value={ed.validUntil} disabled={!ed.editable} onChange={(e) => ed.setValidUntil(e.target.value)} />
              </div>
            </div>
          </Card>

          <Card title={`Lines (${ed.lines.length})`} padded={false}>
            {ed.editable ? <LineGrid ed={ed} floor={floor} /> : (
              <DataTable bare id="quote-lines" caption="Quotation lines" rows={q?.lines ?? []} rowKey={(l) => `${l.itemId}-${l.partCode}`}
                columns={[
                  { key: 'item', header: 'Item', render: (l) => <><span className="mono ds-cell-primary">{l.partCode}</span><br /><Truncate className="ds-cell-secondary" text={l.description} /></> },
                  { key: 'hsn', header: 'HSN', render: (l) => <span className="mono">{l.hsn || '—'}</span>, optional: true },
                  { key: 'qty', header: 'Qty', numeric: true, render: (l) => formatQty(l.quantity, l.uom) },
                  { key: 'rate', header: 'Rate', numeric: true, render: (l) => formatMoney(l.unitPrice) },
                  { key: 'disc', header: 'Disc.', numeric: true, render: (l) => formatPercent(l.discountPercent) },
                  { key: 'gst', header: 'GST', numeric: true, render: (l) => formatPercent(l.taxPercent, 0) },
                  { key: 'total', header: 'Line total', numeric: true, render: (l) => <strong>{formatMoney(l.total)}</strong> },
                  ...(q?.pricing ? [{ key: 'margin', header: 'Margin', render: (l: { itemId: number }) => { const p = q.pricing!.lines.find((x) => x.itemId === l.itemId); const flag = marginFlag(p?.marginPercent, floor); return flag ? <MarginFlag flag={flag}>{formatPercent(p!.marginPercent)}</MarginFlag> : <span className="subtle">No cost</span>; } }] : [])
                ]} />
            )}
          </Card>

          <Card title="Terms and notes">
            <div className="stack">
              <TextAreaField label="Terms (printed on the quotation)" rows={3} value={ed.terms} disabled={!ed.editable} onChange={(e) => ed.setTerms(e.target.value)} maxLength={10000} hint="Delivery, payment and validity terms the customer sees." />
              <TextAreaField label="Notes" rows={2} value={ed.notes} disabled={!ed.editable} onChange={(e) => ed.setNotes(e.target.value)} maxLength={10000} />
            </div>
          </Card>

          {q && <HistoryCard ed={ed} />}
        </div>

        <aside className="stack" style={{ position: 'sticky', top: 'calc(var(--topbar-height) + var(--space-2))' }} aria-label="Totals and actions">
          <div className="ds-card ds-card-pad stack">
            <h2 style={{ fontSize: 'var(--text-md)' }}>Totals</h2>
            {r ? <dl className="stack-sm" style={{ margin: 0 }}>
              <div className="cluster-between"><dt className="muted">Subtotal (after discount)</dt><dd className="num" style={{ margin: 0 }}>{formatMoney(r.subtotal)}</dd></div>
              {local ? <>
                <div className="cluster-between"><dt className="muted">CGST</dt><dd className="num" style={{ margin: 0 }}>{formatMoney(r.cgst)}</dd></div>
                <div className="cluster-between"><dt className="muted">{r.localTaxLabel}</dt><dd className="num" style={{ margin: 0 }}>{formatMoney(r.sgst)}</dd></div>
              </> : <div className="cluster-between"><dt className="muted">IGST</dt><dd className="num" style={{ margin: 0 }}>{formatMoney(r.igst)}</dd></div>}
              <div className="cluster-between" style={{ borderTop: 'var(--border-width) solid var(--color-border)', paddingTop: 'var(--space-1)' }}><dt><strong>Total</strong></dt><dd className="num ds-stat-value" style={{ margin: 0, fontSize: 'var(--text-2xl)' }}>{formatMoney(r.total)}</dd></div>
            </dl> : <p className="muted">{ed.calc.error ?? 'Totals appear as you complete the lines.'}</p>}
            {ed.costAccess && r && (
              <div className="ds-card ds-card-pad stack-sm" style={{ boxShadow: 'none', background: 'var(--color-surface-sunken)' }}>
                <span className="ds-menu-label" style={{ padding: 0 }}>Internal · not shown to the customer</span>
                {r.missingCost ? <Notice tone="warning" title="Cost missing">Enter the item cost (Quotations → Item costs) before submitting.</Notice> : (
                  <div className="cluster-between"><span>Margin {floor ? <span className="subtle">(floor {formatPercent(floor)})</span> : null}</span>{totalFlag && <MarginFlag flag={totalFlag}>{formatPercent(r.marginPercent)}</MarginFlag>}</div>
                )}
                {r.belowFloor && !r.missingCost && <p className="ds-cell-secondary">Below the floor: approval needs an explicit exception.</p>}
              </div>
            )}
          </div>

          <div className="ds-card ds-card-pad stack">
            {ed.problems.length > 0 && ed.editable && <Notice tone="warning" title="Before saving">{ed.problems.map((p) => <span key={p} style={{ display: 'block' }}>{p}</span>)}</Notice>}
            {!q && can('quotations.create') && <Button size="lg" block icon="check" busy={busy} disabled={ed.problems.length > 0} onClick={() => void create()}>Save draft</Button>}
            {q && ed.editable && can('quotations.update') && ed.dirty && <Button size="lg" block icon="check" disabled={ed.problems.length > 0} onClick={() => setReasonFor({ kind: 'save' })}>Save new version</Button>}
            {q && ed.editable && ed.dirty && q.status !== 'DRAFT' && <p className="ds-cell-secondary">Saving returns the quotation to draft; it must be approved again.</p>}
            {actions.map((a) => <Button key={a.action} block variant={a.variant ?? 'secondary'} onClick={() => setReasonFor({ kind: 'action', action: a.action })}>{a.label}</Button>)}
            {waitingOnOthers && <Notice tone="info">Waiting for a different manager or owner to approve.</Notice>}
            {q && ['APPROVED', 'SENT'].includes(q.status) && can('quotations.send') && <Button block variant="secondary" icon="mail" onClick={() => setEmailing(true)}>Email PDF to customer</Button>}
            {q && ['APPROVED', 'SENT', 'WON'].includes(q.status) && can('orders.create') && <a className="ds-button" data-variant="secondary" data-block="true" href={screenHref('/orders')}><Icon name="truck" /><span>Create sales order</span></a>}
            {q && !ed.editable && <p className="ds-cell-secondary">{['SENT', 'WON', 'LOST'].includes(q.status) ? 'Sent quotations are locked. Duplicate to make changes.' : 'This quotation is closed.'}</p>}
          </div>
        </aside>
      </div>

      <ReasonDialog open={reasonFor !== null} onClose={() => { setReasonFor(null); setOverride(false); }}
        title={reasonFor?.kind === 'save' ? 'Save new version' : reasonFor?.kind === 'duplicate' ? 'Duplicate quotation' : reasonFor?.kind === 'action' ? (actions.find((a) => a.action === reasonFor.action)?.label ?? 'Update') : ''}
        danger={reasonFor?.kind === 'action' && ['CANCEL', 'LOST'].includes(reasonFor.action)}
        confirmLabel={reasonFor?.kind === 'action' ? actions.find((a) => a.action === reasonFor.action)?.label : 'Confirm'}
        onConfirm={async (reason) => {
          if (!reasonFor) return;
          if (reasonFor.kind === 'save' && q) { ed.setQuote(await ed.api.revise(q.id, ed.toInput(reason))); toast('success', 'New version saved.'); }
          else if (reasonFor.kind === 'duplicate' && q) { const copy = await ed.api.duplicate(q.id, reason); toast('success', `${copy.quotation_number} created as a new draft.`); router.push(`/quotations/${copy.id}`); }
          else if (reasonFor.kind === 'action') {
            if (reasonFor.action === 'APPROVE' && q?.pricing?.belowFloor && !override) throw new Error('Tick the below-floor exception to approve.');
            await runAction(reasonFor.action, reason);
          }
        }}>
        {reasonFor?.kind === 'action' && reasonFor.action === 'APPROVE' && q?.pricing?.belowFloor && <><Notice tone="warning" title="Margin below the floor">Approving records an exception with your name and reason.</Notice><Checkbox label="I approve this below-floor exception" checked={override} onChange={(e) => setOverride(e.target.checked)} /></>}
      </ReasonDialog>
      {q && <PreviewDrawer open={preview} id={q.id} number={q.quotation_number} onClose={() => setPreview(false)} />}
      {q && <EmailModal open={emailing} ed={ed} onClose={() => setEmailing(false)} />}
    </>
  );
}

function LineGrid({ ed, floor }: { ed: QuoteEditor; floor?: string }) {
  const items = useRef(new Map<string, { part_code: string; description: string; uom: string; hsn: string | null }>());
  return (
    <>
    <div className="ds-line-grid" role="table" aria-label="Quotation lines">
      <div className="ds-line-row ds-line-head" role="row">
        {['Item', 'Description', 'Qty', 'Unit rate (₹)', 'Disc. %', 'GST %', 'Line total', ''].map((h) => <span key={h || 'actions'} role="columnheader">{h}</span>)}
      </div>
      {ed.lines.map((l, i) => {
        const v = ed.lineView(l.key);
        const p = v && ed.costAccess ? marginFlag(v.marginPercent, floor) : null;
        return (
          <div key={l.key} className="ds-line-row" role="row" data-invalid={Boolean(ed.lineErrors[i] && (l.item || l.quantity)) || undefined}>
            <div role="cell"><Combobox label={`Item ${i + 1}`} value={l.item} search={async (t) => (await ed.api.items(t)).data.map((it) => { items.current.set(String(it.id), it); return { value: String(it.id), label: it.part_code, hint: it.description }; })}
              onChange={(o) => { const it = o ? items.current.get(o.value) : undefined; ed.updateLine(l.key, { item: o, partCode: it?.part_code ?? o?.label ?? '', uom: it?.uom ?? l.uom, hsn: it?.hsn ?? '', description: it?.description ?? o?.hint ?? l.description }); }} /></div>
            <div role="cell"><TextField label="Description" value={l.description} onChange={(e) => ed.updateLine(l.key, { description: e.target.value })} maxLength={1000} /></div>
            <div role="cell"><TextField label={`Qty${l.uom ? ` (${l.uom})` : ''}`} inputMode="decimal" value={l.quantity} onChange={(e) => ed.updateLine(l.key, { quantity: e.target.value.replace(/[^\d.]/g, '') })} /></div>
            <div role="cell"><TextField label="Rate" inputMode="decimal" value={l.unitPrice} onChange={(e) => ed.updateLine(l.key, { unitPrice: e.target.value.replace(/[^\d.]/g, '') })} /></div>
            <div role="cell"><TextField label="Disc. %" inputMode="decimal" value={l.discountPercent} onChange={(e) => ed.updateLine(l.key, { discountPercent: e.target.value.replace(/[^\d.]/g, '') })} /></div>
            <div role="cell"><TextField label="GST %" inputMode="decimal" value={l.taxPercent} onChange={(e) => ed.updateLine(l.key, { taxPercent: e.target.value.replace(/[^\d.]/g, '') })} /></div>
            <div role="cell" className="ds-line-total">
              {v ? <><strong className="num">{formatMoney(v.total)}</strong>{p && <MarginFlag flag={p}>{formatPercent(v.marginPercent)}</MarginFlag>}{ed.costAccess && v.unitCost === null && <span className="subtle">No cost</span>}</> : <span className="ds-cell-secondary">{ed.lineErrors[i] ?? '—'}</span>}
            </div>
            <div role="cell"><IconButton icon="x" label={`Remove line ${i + 1}`} disabled={ed.lines.length === 1} onClick={() => ed.removeLine(l.key)} /></div>
          </div>
        );
      })}
    </div>
    <div style={{ padding: 'var(--space-1-5) var(--space-2)' }}><Button variant="secondary" icon="plus" onClick={ed.addLine}>Add line</Button></div>
    </>
  );
}

function HistoryCard({ ed }: { ed: QuoteEditor }) {
  const q = ed.quote!;
  const [state, reload] = useAsync((signal) => ed.api.history(q.id, signal), [q.id, q.version, q.status]);
  return (
    <Card title="History">
      {state.status === 'error' ? <ErrorState error={state.error} onRetry={reload} /> : !state.data ? <CardSkeleton /> :
        <Timeline items={state.data.events.map((e) => ({ id: e.id, title: `${titleCase(e.action)}${e.version ? ` · v${e.version}` : ''}`, at: e.created_at, by: e.actor, body: e.reason, icon: e.action === 'APPROVE' || e.action === 'WON' ? 'check' : e.action.includes('EMAIL') ? 'mail' : 'quote', tone: e.action === 'APPROVE' || e.action === 'WON' ? 'success' : e.action === 'LOST' || e.action === 'CANCEL' ? 'danger' : undefined }))} />}
    </Card>
  );
}

function PreviewDrawer({ open, id, number, onClose }: { open: boolean; id: number; number: string; onClose: () => void }) {
  return (
    <Drawer open={open} title={`Preview ${number}`} description="What the customer sees: no list price, discount, cost or margin." onClose={onClose}
      footer={<><a className="ds-button" data-variant="secondary" href={`/api/crm/quotations/${id}/print`} target="_blank" rel="noopener"><Icon name="eye" /><span>Open print view</span></a><a className="ds-button" data-variant="primary" href={`/api/crm/quotations/${id}/pdf`} target="_blank" rel="noopener"><Icon name="download" /><span>Download PDF</span></a></>}>
      {open && <iframe title={`Quotation ${number} preview`} src={`/api/crm/quotations/${id}/print`} style={{ width: '100%', height: '70vh', border: 'var(--border-width) solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-surface)' }} />}
    </Drawer>
  );
}

function EmailModal({ open, ed, onClose }: { open: boolean; ed: QuoteEditor; onClose: () => void }) {
  const q = ed.quote!;
  const toast = useToast();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(`Quotation ${q.quotation_number}`);
  const [message, setMessage] = useState('Dear Sir/Madam,\n\nPlease find our quotation attached.\n\nRegards');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [customer] = useAsync(() => open ? ed.api.customer(q.customerId) : Promise.resolve(null), [open, q.customerId]);
  const suggested = customer.status === 'ready' ? (customer.data?.contacts ?? []).map((c) => c.email).filter((e): e is string => Boolean(e)) : [];
  const send = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { setError('Enter the customer’s email address.'); return; }
    setBusy(true); setError(undefined);
    try { await ed.api.email(q.id, { to, subject, message, version: q.version, reason: 'Approved quotation emailed' }); toast('success', `Sent to ${to}.`); onClose(); ed.setQuote(await ed.api.get(q.id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Not sent.'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} title="Email quotation" description="The approved PDF is attached. No list price or discount is shown." onClose={() => !busy && onClose()}
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button icon="mail" busy={busy} onClick={() => void send()}>Send email</Button></>}>
      <TextField label="To" type="email" required value={to} onChange={(e) => setTo(e.target.value)} error={error} hint={suggested.length ? `Registered: ${suggested.join(', ')}` : undefined} list="quote-email-suggestions" />
      <datalist id="quote-email-suggestions">{suggested.map((s) => <option key={s} value={s} />)}</datalist>
      <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={300} />
      <TextAreaField label="Message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
    </Modal>
  );
}

export function QuoteEditorEmpty() { return <EmptyState title="Quotation not found" />; }
