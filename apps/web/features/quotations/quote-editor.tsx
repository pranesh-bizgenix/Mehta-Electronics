'use client';
import {CustomerCommercialSummary,CustomerPricingLine} from '@/features/customers/commercial-context';
import {LevelPrice} from './level-price';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useRef, useState } from 'react';
import { newIdempotencyKey } from '@/lib/api/client';
import { useSession } from '@/lib/session';
import { formatDate, formatMoney, formatPercent, formatQty, titleCase } from '@/lib/format';
import {
  Badge, Button, Card, CardSkeleton, Checkbox, Combobox, DataTable, Drawer, EmptyState, ErrorState, Icon, IconButton, MarginFlag, Modal, Notice, ReasonDialog, SelectField,
  StatusBadge, Stepper, TextAreaField, TextField, Timeline, Truncate, UnauthorizedState, useAsync, useToast, type Option, type Step
} from '@/components/ds';
import { quotationOrderHref } from '../../../../public/crm-navigation.js';
import { STATE_NAMES, type QuoteAction, type QuoteStatus } from './api';
import { marginFlag, useQuoteEditor, type QuoteEditor } from './use-quote-editor';
import {PolicyDrawer, CostDrawer} from './owner-tools';
import {QuoteAvailability} from '@/features/incoming-requests/availability';

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
export function QuoteEditorView({ id, enquiryId, customerId }: { id?: string; enquiryId?: string | null; customerId?: string | null }) {
  const ed = useQuoteEditor({ id, enquiryId, customerId });
  const { can, state: session } = useSession();
  const router = useRouter();
  const toast = useToast();
  const [reasonFor, setReasonFor] = useState<null | { kind: 'save' } | { kind: 'action'; action: QuoteAction } | { kind: 'duplicate' }>(null);
  const [override, setOverride] = useState(false);
  const [ownerAcknowledged,setOwnerAcknowledged]=useState(false);
  const [preview, setPreview] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [setup,setSetup]=useState<'policy'|'costs'|null>(null);
  const [saveError,setSaveError]=useState<unknown>();
  const createKey = useRef(newIdempotencyKey());
  const approvalKey=useRef({signature:'',key:''});
  const q = ed.quote;
  const me = session.kind === 'ready' ? session.user.id : 0;

  if(session.kind==='ready'&&!can(id?'quotations.read':'quotations.create'))return <UnauthorizedState message="Your role cannot open this quotation editor."/>;
  if (ed.loadError) return <ErrorState error={ed.loadError} onRetry={() => void ed.reload()} />;
  if (ed.policy === undefined || (id && !q)) return <div className="stack"><CardSkeleton lines={2} /><div className="grid-main-aside"><CardSkeleton lines={8} /><CardSkeleton lines={5} /></div></div>;

  const r = ed.calc.result;
  const floor = q?.pricing?.floorPercent ?? ed.policy?.floor_percent;
  const local = ed.policy?.seller_state === ed.placeOfSupply;
  const totalFlag = ed.costAccess && r ? (r.missingCost ? null : marginFlag(r.marginPercent, floor)) : null;

  const create = async () => {
    if(busy||ed.problems.length)return;
    setBusy(true);setSaveError(undefined);
    try { const saved = await ed.api.create(ed.toInput('Quotation created'), createKey.current); toast('success', `${saved.quotation_number} saved as a draft.`); window.location.replace(`/quotations/${saved.id}`); }
    catch (e) { setSaveError(e); } finally { setBusy(false); }
  };
  const runAction = async (action: QuoteAction, reason: string) => {
    if (!q) return;
    const body={ action, version: q.version, reason,...(action==='APPROVE'&&q.approval?.ownerSelfApproval?{ownerSelfApproval:ownerAcknowledged}:{}), ...(action === 'APPROVE' && q.pricing?.belowFloor ? { overrideFloor: override } : {}),...(action==='APPROVE'&&q.approval?{roundId:q.approval.roundId,stageId:q.approval.pendingStageId??undefined}:{}) };
    if(action==='APPROVE'){const signature=JSON.stringify(body);if(approvalKey.current.signature!==signature)approvalKey.current={signature,key:newIdempotencyKey()};}
    const updated = await ed.api.action(q.id, {...body,...(action==='APPROVE'?{requestKey:approvalKey.current.key}:{})});
    ed.setQuote(updated); toast('success', `Quotation ${titleCase(updated.status).toLowerCase()}.`);
  };
  const actions: { action: QuoteAction; label: string; variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }[] = [];
  if (q) {
    const author = q.created_by === me;
    if (q.status === 'DRAFT' && can('quotations.update') && !ed.dirty) actions.push({ action: 'SUBMIT', label: 'Submit for approval', variant: 'primary' });
    if(q.status==='PENDING_APPROVAL'){
      if(q.approval?q.approval.canApprove:can('quotations.approve')&&!author)actions.push({action:'APPROVE',label:q.approval&&q.approval.total>1?`Approve step ${q.approval.completed+1} of ${q.approval.total}`:'Approve',variant:'primary'});
      if(q.approval?q.approval.canReturn:can('quotations.approve')&&!author)actions.push({action:'RETURN',label:'Return to draft',variant:'secondary'});
    }
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
          {!q&&<Link className="ds-button" data-variant="secondary" href="/quotations">Back to quotations</Link>}
          {q && <Button variant="secondary" icon="eye" onClick={() => setPreview(true)}>Preview</Button>}
          {q && <a className="ds-button" data-variant="secondary" href={`/api/crm/quotations/${q.id}/pdf`} target="_blank" rel="noopener"><Icon name="download" /><span>PDF</span></a>}
          {q && <a className="ds-button" data-variant="secondary" href="/api/crm/quotation-supplier-terms" target="_blank" rel="noopener"><Icon name="download" /><span>KGEP supplier terms</span></a>}
          {q && can('quotations.create') && <Button variant="ghost" icon="plus" onClick={() => setReasonFor({ kind: 'duplicate' })}>Duplicate</Button>}
        </div>
      </header>

      {!q&&<p className="muted">Choose a customer, add items and review your totals. Save a draft when you are ready.</p>}
      {ed.policy===null&&<Notice tone="warning" title="Set up quotation policy before saving">The Owner must confirm the margin floor, margin basis, seller GST state and letterhead. You can prepare the fields below. {can('quotations.policy.manage')?<Button variant="link" onClick={()=>setSetup('policy')}>Set policy and letterhead</Button>:<span>Ask the Owner to complete quotation setup.</span>}</Notice>}
      {ed.policy?.confirmed===false&&<Notice tone="warning" title="Quotation policy awaits Owner confirmation">The saved policy is retained for review. The Owner must confirm it before this quotation can proceed. {can('rules.manage')&&<Link href="/decisions">Review decisions</Link>}</Notice>}
      {ed.sourceWarning&&<Notice tone="warning" title="Review the source enquiry">{ed.sourceWarning}<Button variant="link" onClick={()=>ed.setSourceWarning(undefined)}>I have reviewed and added the missing items</Button></Notice>}
      <Card><Stepper label={q?'Quotation approval':'Create a quotation'} steps={q?flowSteps(q.status):[{label:'Customer & validity',state:ed.customer&&ed.validUntil&&ed.placeOfSupply?'done':'current'},{label:'Items & pricing',state:ed.lineErrors.every(error=>!error)?'done':'todo'},{label:'Review & save draft',state:ed.problems.length?'todo':'current'}]} /></Card>
      {q&&<QuoteAvailability quoteId={q.id} version={q.version} required={q.requiresWarehouseReview}/>}

      <div className={`grid-main-aside${!q?' quote-create-layout':''}`} style={{ marginTop: 'var(--space-3)' }}>
        <div className="stack-lg">
          {ed.customer&&<CustomerCommercialSummary customerId={Number(ed.customer.value)} companyId={ed.quote?.companyId}/>}
          <Card title="Customer and terms">
            <div className="stack">
              {ed.editable?<Combobox label="Customer" required value={ed.customer} error={ed.customerError} hint={ed.customerLoading?'Loading customer details…':'Search active CRM customers by name or GSTIN.'} onChange={(o) => void ed.pickCustomer(o)} search={async (t) => (await ed.api.customers(t)).data.map((c) => ({ value: String(c.id), label: c.name, hint: c.gstin ?? undefined }))}/>:<p>{ed.customer?.label}</p>}
              {ed.customer&&<div className="quote-customer-strip"><Icon name="customers"/><div><strong>{ed.customer.label}</strong><small>{ed.customer.hint?`GSTIN: ${ed.customer.hint}`:'GSTIN not recorded'}</small></div><Link href={`/customers/${ed.customer.value}`}>View customer</Link></div>}
              <div className="grid-2">
                <SelectField label="Place of supply" required value={ed.placeOfSupply} disabled={!ed.editable} onChange={(e) => ed.setPlaceOfSupply(e.target.value)} placeholder="Choose state" options={STATE_OPTIONS}
                  hint={!ed.policy?'Confirm the seller state in quotation policy to calculate GST.':ed.placeOfSupply ? (local ? `Same state as seller: CGST + ${r?.localTaxLabel ?? 'SGST'}` : 'Inter-state: IGST') : 'Suggested from the customer; confirm it.'} />
                <TextField label="Valid until" type="date" required value={ed.validUntil} disabled={!ed.editable} onChange={(e) => ed.setValidUntil(e.target.value)} />
              </div>
              <TextField label="Customer RFQ / reference" value={ed.request.reference} maxLength={200} disabled={!ed.editable} onChange={event=>ed.updateRequest({reference:event.target.value})} hint="The customer's enquiry number or reference, if supplied."/>
              <TextAreaField label="Customer quantity instructions" value={ed.request.quantityInstructions} maxLength={1000} rows={2} disabled={!ed.editable} onChange={event=>ed.updateRequest({quantityInstructions:event.target.value})} hint="Record set or colour instructions as received. Enter final quoted quantities in the item lines; no multiplier is applied automatically."/>
              {ed.request.quantityInstructions&&<Checkbox label="I checked the set / colour breakdown and confirmed the final line quantities" checked={ed.request.quantityConfirmed} disabled={!ed.editable} onChange={event=>ed.updateRequest({quantityConfirmed:event.target.checked})}/>}
              <TextAreaField label="Customer requested terms (internal review)" value={ed.request.customerTerms??''} maxLength={4000} disabled={!ed.editable} onChange={event=>ed.updateRequest({customerTerms:event.target.value,termsConfirmed:false})} hint="Keep requested payment, freight, warranty, LD and certificate conditions here. Only the accepted Terms below are printed."/>
              {ed.request.customerTerms&&<Checkbox label="I reviewed the requested terms and recorded our accepted quotation terms" checked={Boolean(ed.request.termsConfirmed)} disabled={!ed.editable} onChange={event=>ed.updateRequest({termsConfirmed:event.target.checked})}/>}
              <Checkbox label="Development reference only (historical prices; cannot be issued)" checked={Boolean(ed.request.referenceOnly)} disabled={!ed.editable} onChange={event=>ed.updateRequest({referenceOnly:event.target.checked,referenceDate:''})}/>
              {ed.request.referenceOnly&&<><Notice tone="warning">Historical prices are for development reference. This draft cannot be submitted, approved or issued. Production rejects creation of reference quotations.</Notice><TextField label="Historical pricing date" type="date" value={ed.request.referenceDate??''} disabled={!ed.editable} onChange={event=>ed.updateRequest({referenceDate:event.target.value})}/></>}
            </div>
          </Card>

          <Card title={`Quotation items (${ed.lines.length})`} padded={false}>
            {!q&&<p className="quote-lines-intro">Select CRM items and enter the agreed quantity, rate, discount and GST. Enter 0 explicitly where no discount or tax applies.</p>}
            {ed.editable ? <LineGrid ed={ed} floor={floor} /> : (
              <DataTable bare id="quote-lines" caption="Quotation lines" rows={(q?.lines ?? []).map((line,index)=>({...line,rowPosition:index+1}))} rowKey={(l) => String(l.rowPosition)}
                columns={[
                  { key: 'item', header: 'Item', render: (l) => <><span className="mono ds-cell-primary">{l.partCode}</span><br /><Truncate className="ds-cell-secondary" text={l.description} /><SavedRequestDetails details={l.requestDetails}/></> },
                  { key: 'hsn', header: 'HSN', render: (l) => <span className="mono">{l.hsn || '—'}</span>, optional: true },
                  { key: 'qty', header: 'Qty', numeric: true, render: (l) => formatQty(l.quantity, l.uom) },
                  { key: 'rate', header: 'Rate', numeric: true, render: (l) => formatMoney(l.unitPrice) },
                  { key: 'disc', header: 'Disc.', numeric: true, render: (l) => formatPercent(l.discountPercent) },
                  { key: 'gst', header: 'GST', numeric: true, render: (l) => formatPercent(l.taxPercent, 0) },
                  { key: 'total', header: 'Line total', numeric: true, render: (l) => <strong>{formatMoney(l.total)}</strong> },
                  ...(q?.pricing ? [{ key: 'margin', header: 'Margin', render: (l: { rowPosition: number }) => { const p = q.pricing!.lines[l.rowPosition-1]; const flag = marginFlag(p?.marginPercent, floor); return flag ? <MarginFlag flag={flag}>{formatPercent(p!.marginPercent)}</MarginFlag> : <span className="subtle">No cost</span>; } }] : [])
                ]} />
            )}
          </Card>

          <Card title="Terms and notes">
            <div className="stack">
              <TextAreaField label="Terms (printed on the quotation)" rows={3} value={ed.terms} disabled={!ed.editable} onChange={(e) => ed.setTerms(e.target.value)} maxLength={10000} hint="Delivery, payment and validity terms the customer sees." />
              <TextAreaField label="Notes (printed on the quotation)" rows={2} value={ed.notes} disabled={!ed.editable} onChange={(e) => ed.setNotes(e.target.value)} maxLength={10000} hint="These notes appear on the customer's PDF." />
            </div>
          </Card>

          {q && <HistoryCard ed={ed} />}
        </div>

        <aside className="stack" style={{ position: 'sticky', top: 'calc(var(--topbar-height) + var(--space-2))' }} aria-label="Totals and actions">
          <div className="ds-card ds-card-pad stack">
            <div className="cluster-between"><h2 style={{ fontSize: 'var(--text-md)' }}>Quotation summary</h2><Badge tone="neutral">{q?'Saved quotation':'Unsaved draft'}</Badge></div>
            {!q&&<p className="ds-cell-secondary">{ed.customer?.label||'No customer selected'} · {ed.lines.length} item line{ed.lines.length===1?'':'s'}</p>}
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
                {r.missingCost ? <Notice tone="warning" title="Submission blocked: cost missing">The Owner must enter costs for every item. A draft can still be saved. {can('quotations.cost.manage')&&<Button variant="link" onClick={()=>setSetup('costs')}>Set item costs</Button>}</Notice> : (
                  <div className="cluster-between"><span>Margin {floor ? <span className="subtle">(floor {formatPercent(floor)})</span> : null}</span>{totalFlag && <MarginFlag flag={totalFlag}>{formatPercent(r.marginPercent)}</MarginFlag>}</div>
                )}
                {r.belowFloor && !r.missingCost && <p className="ds-cell-secondary">Below the floor: approval needs an explicit exception.</p>}
              </div>
            )}
          </div>

          <div className="ds-card ds-card-pad stack">
            {Boolean(saveError)&&<ErrorState error={saveError}/>}
            {ed.requestBlock&&<Notice tone="warning" title="Quotation review needed">{ed.requestBlock} You can save a draft while this is unresolved.</Notice>}
            {ed.problems.length > 0 && ed.editable && <Notice tone="warning" title="Before saving">{ed.problems.map((p) => <span key={p} style={{ display: 'block' }}>{p}</span>)}</Notice>}
            {!q && can('quotations.create') && <Button size="lg" block icon="check" busy={busy} disabled={ed.problems.length > 0} onClick={() => void create()}>Save draft</Button>}
            {!q&&<p className="ds-cell-secondary">Saving creates a draft for review. Approval is required before sending. Owner may explicitly approve their own quotation; other roles need a different eligible reviewer.</p>}
            {q&&ed.editable&&ed.costSnapshotChanged&&<Notice tone="warning" title="Save updated costs before submitting">The margin above uses current item costs. This saved quotation still contains older costs. Save a new version to capture the current costs.</Notice>}
            {q && ed.editable && can('quotations.update') && (ed.dirty||ed.costSnapshotChanged) && <Button size="lg" block icon="check" disabled={ed.problems.length > 0} onClick={() => setReasonFor({ kind: 'save' })}>{ed.costSnapshotChanged?'Save updated costs':'Save new version'}</Button>}
            {q && ed.editable && ed.dirty && q.status !== 'DRAFT' && <p className="ds-cell-secondary">Saving returns the quotation to draft; it must be approved again.</p>}
            {actions.map((a) => <Button key={a.action} block disabled={a.action==='SUBMIT'&&(Boolean(ed.requestBlock)||ed.costSnapshotChanged)} variant={a.variant ?? 'secondary'} onClick={() => setReasonFor({ kind: 'action', action: a.action })}>{a.label}</Button>)}
            {q?.approval&&<section className="stack-sm" aria-label="Approval progress"><h3>Approval progress</h3><p>{q.approval.completed} of {q.approval.total} required steps completed.</p><ol>{q.approval.steps.map(step=><li key={step.id}>Step {step.number}: {titleCase(step.status)}</li>)}</ol>{q.approval.blocked&&<Notice tone="warning">{q.approval.note}</Notice>}</section>}
            {waitingOnOthers && <Notice tone="info">Waiting for an eligible independent reviewer for the pending step.</Notice>}
            {q && ['APPROVED', 'SENT'].includes(q.status) && can('quotations.send') && <Button block variant="secondary" icon="mail" onClick={() => setEmailing(true)}>Email PDF to customer</Button>}
            {q && ['APPROVED', 'SENT', 'WON'].includes(q.status) && can('orders.create') && <Link className="ds-button" data-variant="secondary" data-block="true" href={quotationOrderHref(q.id)}><Icon name="truck" /><span>Create sales order</span></Link>}
            {q && !ed.editable && <p className="ds-cell-secondary">{['SENT', 'WON', 'LOST'].includes(q.status) ? 'Sent quotations are locked. Duplicate to make changes.' : 'This quotation is closed.'}</p>}
          </div>
        </aside>
      </div>

      <ReasonDialog open={reasonFor !== null} onClose={() => { setReasonFor(null); setOverride(false);setOwnerAcknowledged(false); }}
        title={reasonFor?.kind === 'save' ? 'Save new version' : reasonFor?.kind === 'duplicate' ? 'Duplicate quotation' : reasonFor?.kind === 'action' ? (actions.find((a) => a.action === reasonFor.action)?.label ?? 'Update') : ''}
        danger={reasonFor?.kind === 'action' && ['CANCEL', 'LOST'].includes(reasonFor.action)}
        confirmLabel={reasonFor?.kind === 'action' ? actions.find((a) => a.action === reasonFor.action)?.label : 'Confirm'}
        onConfirm={async (reason) => {
          if (!reasonFor) return;
          if (reasonFor.kind === 'save' && q) { ed.setQuote(await ed.api.revise(q.id, ed.toInput(reason))); toast('success', 'New version saved.'); }
          else if (reasonFor.kind === 'duplicate' && q) { const copy = await ed.api.duplicate(q.id, reason); toast('success', `${copy.quotation_number} created as a new draft.`); router.push(`/quotations/${copy.id}`); }
          else if (reasonFor.kind === 'action') {
            if(reasonFor.action==='APPROVE'&&q?.approval?.ownerSelfApproval&&!ownerAcknowledged)throw new Error('Acknowledge Owner self-approval before continuing.');
            if (reasonFor.action === 'APPROVE' && q?.pricing?.belowFloor && !override) throw new Error('Tick the below-floor exception to approve.');
            await runAction(reasonFor.action, reason);
          }
        }}>
        {reasonFor?.kind==='action'&&reasonFor.action==='APPROVE'&&q?.approval?.ownerSelfApproval&&<><Notice tone="warning" title="Owner self-approval">You created or last edited this quotation. Your approval will be recorded as an Owner self-approval exception.</Notice><Checkbox label="I acknowledge that I am approving my own quotation as Owner" checked={ownerAcknowledged} onChange={e=>setOwnerAcknowledged(e.target.checked)}/></>}
        {reasonFor?.kind === 'action' && reasonFor.action === 'APPROVE' && q?.pricing?.belowFloor && <><Notice tone="warning" title="Margin below the floor">Approving records an exception with your name and reason.</Notice><Checkbox label="I approve this below-floor exception" checked={override} onChange={(e) => setOverride(e.target.checked)} /></>}
      </ReasonDialog>
      {q && <PreviewDrawer open={preview} id={q.id} number={q.quotation_number} onClose={() => setPreview(false)} />}
      {q && <EmailModal open={emailing} ed={ed} onClose={() => setEmailing(false)} />}
      <PolicyDrawer open={setup==='policy'} onClose={()=>{setSetup(null);void ed.refreshPolicy();}}/>
      <CostDrawer open={setup==='costs'} initialItem={ed.lines.length===1?ed.lines[0].item:undefined} onClose={()=>{setSetup(null);ed.refreshCosts();}}/>
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
          <Fragment key={l.key}><div className="ds-line-row" role="row" data-invalid={Boolean(ed.lineErrors[i] && (l.item || l.quantity)) || undefined}>
            <div role="cell"><Combobox label={`Item ${i + 1}`} value={l.item} search={async (t) => (await ed.api.items(t)).data.map((it) => { items.current.set(String(it.id), it); return { value: String(it.id), label: it.part_code, hint: it.description }; })}
              onChange={(o) => { const it = o ? items.current.get(o.value) : undefined; ed.updateLine(l.key, { item: o, partCode: it?.part_code ?? o?.label ?? '', uom: it?.uom ?? l.uom, hsn: it?.hsn ?? '', description: it?.description ?? o?.hint ?? l.description }); }} /></div>
            <div role="cell"><TextField label={`Description ${i+1}`} value={l.description} onChange={(e) => ed.updateLine(l.key, { description: e.target.value })} maxLength={1000} /><small className="quote-item-meta">{[l.uom&&`Unit: ${l.uom}`,l.hsn&&`HSN: ${l.hsn}`].filter(Boolean).join(' · ')||'Select an item to see its unit and HSN'}</small></div>
            <div role="cell"><TextField label={`Qty${l.uom ? ` (${l.uom})` : ''}`} inputMode="decimal" value={l.quantity} onChange={(e) => ed.updateLine(l.key, { quantity: e.target.value.replace(/[^\d.]/g, '') })} /></div>
            <div role="cell"><TextField label="Rate" inputMode="decimal" value={l.unitPrice} onChange={(e) => ed.updateLine(l.key, { unitPrice: e.target.value.replace(/[^\d.]/g, '') })} /></div>
            <div role="cell"><TextField label="Disc. %" inputMode="decimal" value={l.discountPercent} onChange={(e) => ed.updateLine(l.key, { discountPercent: e.target.value.replace(/[^\d.]/g, '') })} /></div>
            <div role="cell"><TextField label="GST %" inputMode="decimal" value={l.taxPercent} onChange={(e) => ed.updateLine(l.key, { taxPercent: e.target.value.replace(/[^\d.]/g, '') })} /></div>
            <div role="cell" className="ds-line-total">
              {v ? <><strong className="num">{formatMoney(v.total)}</strong>{p && <MarginFlag flag={p}>{formatPercent(v.marginPercent)}</MarginFlag>}{ed.costAccess && v.unitCost === null && <span className="subtle">No cost</span>}</> : <span className="ds-cell-secondary">{ed.lineErrors[i] ?? '—'}</span>}
            </div>
            <div role="cell"><IconButton icon="x" label={`Remove line ${i + 1}`} disabled={ed.lines.length === 1} onClick={() => ed.removeLine(l.key)} /></div>
          </div>
          <div className="quote-line-detail" role="row"><div role="cell" aria-colspan={8}><CustomerPricingLine customerId={ed.customer?.value} companyId={ed.quote?.companyId} itemId={l.item?.value} quantity={l.quantity} onApply={patch=>ed.updateLine(l.key,patch)}/><LevelPrice referenceDate={ed.request.referenceOnly?ed.request.referenceDate:undefined} customerId={ed.customer?.value} itemId={l.item?.value} quantity={l.quantity} selection={l.pricingSelection} onApply={(price,pricingSelection)=>ed.updateLine(l.key,{pricingSelection,...(price!==null?{unitPrice:price,discountPercent:'0'}:{})})}/><details>
            <summary>Line {i+1}: customer references, specifications & delivery{l.requestDetails.tag?` · ${l.requestDetails.tag}`:''}</summary>
            <div className="stack">
              <div className="ds-form-grid">
                <TextField label={`Source line / customer part reference ${i+1}`} value={l.requestDetails.sourceLine} maxLength={100} onChange={event=>ed.updateLine(l.key,{requestDetails:{...l.requestDetails,sourceLine:event.target.value}})}/>
                <TextField label={`Tag / equipment reference ${i+1}`} value={l.requestDetails.tag} maxLength={200} onChange={event=>ed.updateLine(l.key,{requestDetails:{...l.requestDetails,tag:event.target.value}})}/>
                <TextField label={`Quoted make ${i+1}`} value={l.requestDetails.make} maxLength={100} onChange={event=>ed.updateLine(l.key,{requestDetails:{...l.requestDetails,make:event.target.value}})}/>
              </div>
              <TextAreaField label={`Requested specification ${i+1}`} rows={2} value={l.requestDetails.requestedSpecification} maxLength={1000} onChange={event=>ed.updateLine(l.key,{requestDetails:{...l.requestDetails,requestedSpecification:event.target.value}})} hint="Preserve size, colour, insulation, voltage and requested compliance. This records a customer requirement, not certification."/>
              <div className="ds-form-grid">
                <TextField label={`Stock / availability statement ${i+1}`} value={l.requestDetails.availability} maxLength={300} onChange={event=>ed.updateLine(l.key,{requestDetails:{...l.requestDetails,availability:event.target.value}})} hint="Enter only what you have checked; this is a manual quotation statement."/>
                <TextField label={`Availability checked on ${i+1}`} type="date" value={l.requestDetails.availabilityAsOf} required={Boolean(l.requestDetails.availability)} onChange={event=>ed.updateLine(l.key,{requestDetails:{...l.requestDetails,availabilityAsOf:event.target.value}})}/>
                <TextField label={`Availability source ${i+1}`} value={l.requestDetails.availabilitySource} required={Boolean(l.requestDetails.availability)} maxLength={300} onChange={event=>ed.updateLine(l.key,{requestDetails:{...l.requestDetails,availabilitySource:event.target.value}})} hint="Reference used for the check; saved for review, not printed."/>
              </div>
              <TextField label={`Delivery lead time from PO date ${i+1}`} value={l.requestDetails.leadTime} maxLength={300} onChange={event=>ed.updateLine(l.key,{requestDetails:{...l.requestDetails,leadTime:event.target.value}})} hint="Enter the agreed lead time and conditions. No standard lead time is assumed."/>
            </div>
          </details></div></div></Fragment>
        );
      })}
    </div>
    <div style={{ padding: 'var(--space-1-5) var(--space-2)' }}><Button variant="secondary" icon="plus" onClick={ed.addLine}>Add line</Button></div>
    </>
  );
}

function SavedRequestDetails({details}:{details?:import('../../../../public/quotation-request.js').QuotationLineRequest}){
 if(!details)return null;
 const fields=[['Customer reference',details.sourceLine],['Tag',details.tag],['Make',details.make],['Requested specification',details.requestedSpecification],['Availability',details.availability],['Checked on',details.availabilityAsOf],['Check source (review only)',details.availabilitySource],['Lead time from PO',details.leadTime]];
 return <div className="stack-sm">{fields.filter(([,value])=>value).map(([label,value])=><small key={label}>{label}: {value}</small>)}</div>;
}

function HistoryCard({ ed }: { ed: QuoteEditor }) {
  const q = ed.quote!;
  const [state, reload] = useAsync((signal) => ed.api.history(q.id, signal), [q.id, q.version, q.status,q.approval?.roundId,q.approval?.completed]);
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
