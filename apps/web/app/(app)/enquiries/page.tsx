'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/api/provider';
import { useSession } from '@/lib/session';
import { formatDate, formatQty, formatRelative, titleCase } from '@/lib/format';
import {
  Badge, Button, Card, CardSkeleton, DataTable, EmptyState, ErrorState, Icon, IconButton, PageHeader, ReasonDialog, SelectField, SlaChip, StatusBadge, Stepper, TextField,
  Timeline, Truncate, useAsync, useDebounced, useToast, type Step
} from '@/components/ds';
import { screenHref } from '@/components/shell/nav-config';
import { EnquiryForm } from '@/features/enquiries/enquiry-form';
import { SOURCES, TRANSITIONS, enquiriesApi, type Enquiry, type EnquiryRow, type EnquiryStatus } from '@/features/enquiries/api';

const STATUS_FILTERS: { value: string; label: string }[] = [{ value: '', label: 'All' }, { value: 'NEW', label: 'New' }, { value: 'QUOTED', label: 'Quoted' }, { value: 'WON', label: 'Won' }, { value: 'LOST', label: 'Lost' }];

function steps(status: EnquiryStatus): Step[] {
  const order: EnquiryStatus[] = ['NEW', 'QUOTED', status === 'LOST' ? 'LOST' : 'WON'];
  if (status === 'CANCELLED') return [{ label: 'New', state: 'done' }, { label: 'Cancelled', state: 'blocked' }];
  const index = order.indexOf(status === 'QUALIFIED' ? 'NEW' : status);
  return order.map((s, i) => ({ label: titleCase(s), state: s === 'LOST' && i === index ? 'blocked' : i < index || (i === index && i === order.length - 1) ? 'done' : i === index ? 'current' : 'todo' }));
}

function Inbox() {
  const client = useApi();
  const api = useMemo(() => enquiriesApi(client), [client]);
  const { can } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [status, setStatus] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);
  const [owners] = useAsync(() => api.owners(), [api]);
  const [list, reload] = useAsync((signal) => api.list({ page, search: debounced, status, ownerId, source }, signal), [api, page, debounced, status, ownerId, source]);
  const selectedId = params.get('open');
  const [detail, reloadDetail] = useAsync((signal) => selectedId ? api.get(selectedId, signal) : Promise.resolve(null), [api, selectedId]);
  const [creating, setCreating] = useState(false);
  const [revising, setRevising] = useState(false);
  const [transition, setTransition] = useState<EnquiryStatus | null>(null);
  useEffect(() => { if (params.get('new') && can('enquiries.create')) setCreating(true); }, [params, can]);
  useEffect(() => { setPage(1); }, [debounced, status, ownerId, source]);

  const rows = list.status === 'ready' ? list.data : list.data;
  const select = (id: number | null) => router.replace(id ? `/enquiries?open=${id}` : '/enquiries', { scroll: false });
  const enquiry = detail.status === 'ready' ? detail.data : detail.data;

  return (
    <>
      <PageHeader title="Enquiries" crumbs={[{ label: 'Sales' }, { label: 'Enquiries' }]}
        description="Every customer requirement with an owner and an SLA. NEW → QUOTED → WON or LOST."
        actions={can('enquiries.create') && <Button icon="plus" onClick={() => setCreating(true)}>New enquiry</Button>} />

      <div className="ds-split">
        <section className={`ds-card ${selectedId ? 'ds-desktop-only-split' : ''}`} aria-label="Enquiry list">
          <div className="ds-card-body stack-sm" style={{ paddingBottom: 'var(--space-1-5)' }}>
            <TextField label="Search number, subject or customer" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="ds-presets" role="group" aria-label="Status">{STATUS_FILTERS.map((s) => <Button key={s.value || 'all'} size="sm" variant={status === s.value ? 'primary' : 'ghost'} aria-pressed={status === s.value} onClick={() => setStatus(s.value)}>{s.label}</Button>)}</div>
            <div className="grid-2" style={{ gap: 'var(--space-1)' }}>
              <SelectField label="Owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} placeholder="Anyone" options={owners.status === 'ready' ? owners.data.map((o) => ({ value: String(o.id), label: o.name })) : []} />
              <SelectField label="Source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Any" options={SOURCES.map((s) => ({ value: s, label: s }))} />
            </div>
          </div>
          <div className="ds-split-list" aria-busy={list.status === 'loading' || undefined}>
            {list.status === 'error' && <ErrorState error={list.error} onRetry={reload} />}
            {!rows && list.status === 'loading' && <div className="ds-card-body"><CardSkeleton lines={4} /></div>}
            {rows && rows.data.length === 0 && <EmptyState title={search || status ? 'No enquiries match' : 'No enquiries yet'} illustration={search ? 'search' : 'empty'}>{search || status ? 'Try another word or status.' : 'New enquiries from email, phone or walk-in appear here.'}</EmptyState>}
            <ul className="ds-list">
              {rows?.data.map((r: EnquiryRow) => (
                <li key={r.id}>
                  <button type="button" className="ds-list-item" aria-current={String(r.id) === selectedId || undefined} onClick={() => select(r.id)}>
                    <span className="cluster-between" style={{ flexWrap: 'nowrap' }}><span className="mono ds-cell-secondary">{r.enquiry_number}</span><StatusBadge status={r.status} /></span>
                    <Truncate className="ds-cell-primary" text={r.subject} />
                    <span className="cluster-between" style={{ flexWrap: 'nowrap' }}><Truncate className="ds-cell-secondary" text={`${r.customer_name} · ${r.line_count} item${r.line_count === 1 ? '' : 's'}`} /><span className="ds-cell-secondary" style={{ whiteSpace: 'nowrap' }}>{formatRelative(r.updated_at)}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          {rows && rows.pagination.pages > 1 && <div className="ds-table-footer"><span>Page {rows.pagination.page} of {rows.pagination.pages}</span><span className="ds-pager"><IconButton icon="chevronLeft" label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)} /><IconButton icon="chevronRight" label="Next page" disabled={page >= rows.pagination.pages} onClick={() => setPage(page + 1)} /></span></div>}
        </section>

        <section aria-label="Enquiry detail" className={selectedId ? undefined : 'ds-desktop-only'}>
          {!selectedId && <div className="ds-card"><EmptyState title="Select an enquiry" illustration="empty">Pick one from the list to see its items, history and next step.</EmptyState></div>}
          {selectedId && detail.status === 'error' && <ErrorState error={detail.error} onRetry={reloadDetail} />}
          {selectedId && !enquiry && detail.status === 'loading' && <CardSkeleton lines={6} />}
          {selectedId && enquiry && <Detail enquiry={enquiry} onBack={() => select(null)} onRevise={() => setRevising(true)} onTransition={setTransition} />}
        </section>
      </div>

      <EnquiryForm open={creating} onClose={() => setCreating(false)} onSaved={(e) => { setCreating(false); toast('success', `${e.enquiry_number} created.`); reload(); select(e.id); }} />
      {enquiry && <EnquiryForm open={revising} enquiry={enquiry} onClose={() => setRevising(false)} onSaved={() => { setRevising(false); toast('success', 'Revision saved.'); reload(); reloadDetail(); }} />}
      <ReasonDialog open={transition !== null} title={transition ? `Mark as ${titleCase(transition).toLowerCase()}` : ''} danger={transition === 'LOST' || transition === 'CANCELLED'} confirmLabel="Update status"
        onClose={() => setTransition(null)}
        onConfirm={async (reason) => { if (!enquiry || !transition) return; await api.setStatus(enquiry.id, transition, reason); toast('success', `Marked ${titleCase(transition).toLowerCase()}.`); reload(); reloadDetail(); }} />
    </>
  );
}

/** Until Quotations is rebuilt, the existing editor opens pre-filled from this enquiry. */
function quoteHref(enquiryId: number): string {
  const target = screenHref(`/quotations/new?enquiry=${enquiryId}`);
  return /^https?:/.test(target) ? `${target}#quote-enquiry=${enquiryId}` : target;
}

function Detail({ enquiry, onBack, onRevise, onTransition }: { enquiry: Enquiry; onBack: () => void; onRevise: () => void; onTransition: (s: EnquiryStatus) => void }) {
  const client = useApi();
  const api = useMemo(() => enquiriesApi(client), [client]);
  const { can } = useSession();
  const [revisions] = useAsync((signal) => api.revisions(enquiry.id, signal), [api, enquiry.id, enquiry.updated_at]);
  const next = TRANSITIONS[enquiry.status].filter((s) => s !== 'QUOTED');
  const open = ['NEW', 'QUALIFIED'].includes(enquiry.status);
  return (
    <div className="stack page-enter">
      <header className="ds-record" style={{ marginBottom: 0 }}>
        <span className="ds-record-avatar" aria-hidden="true"><Icon name="inbox" /></span>
        <div style={{ minWidth: 0 }}>
          <div className="cluster"><span className="mono subtle">{enquiry.enquiry_number}</span><StatusBadge status={enquiry.status} />{enquiry.source && <Badge tone="info">{enquiry.source}</Badge>}</div>
          <h2 className="truncate" style={{ fontSize: 'var(--text-xl)' }} title={enquiry.subject}>{enquiry.subject}</h2>
          <div className="ds-record-meta">
            <Link href={`/customers/${enquiry.customer_id}`}><Icon name="customers" />{enquiry.customer_name}</Link>
            <span><Icon name="user" />{enquiry.assigned_name ?? 'Unassigned'}</span>
            {enquiry.expected_by && <span><Icon name="calendar" />Expected {formatDate(enquiry.expected_by)}</span>}
          </div>
        </div>
        <div className="ds-record-actions">
          <Button className="ds-mobile-only" variant="ghost" icon="chevronLeft" onClick={onBack}>All enquiries</Button>
          {open && can('enquiries.update') && <Button variant="secondary" icon="settings" onClick={onRevise}>Revise</Button>}
          {open && can('quotations.create') && <a className="ds-button" data-variant="primary" href={quoteHref(enquiry.id)}><Icon name="quote" /><span>Create quotation</span></a>}
        </div>
      </header>

      <Card title="Progress"><Stepper label="Enquiry progress" steps={steps(enquiry.status)} />
        {can('enquiries.update') && next.length > 0 && <div className="cluster" style={{ marginTop: 'var(--space-2)' }}>
          {next.map((s) => <Button key={s} size="sm" variant={s === 'WON' ? 'primary' : 'secondary'} onClick={() => onTransition(s)}>{s === 'WON' ? 'Mark won' : s === 'LOST' ? 'Mark lost' : 'Cancel enquiry'}</Button>)}
        </div>}
        {enquiry.expected_by && open && <div style={{ marginTop: 'var(--space-1-5)' }}><SlaChip dueAt={`${enquiry.expected_by}T18:30:00+05:30`} warnMinutes={24 * 60} /></div>}
      </Card>

      <Card title={`Requested items (${enquiry.lines.length})`} padded={false}><DataTable bare id="enquiry-lines" caption="Requested items" rows={enquiry.lines} rowKey={(l) => l.id}
        columns={[
          { key: 'part', header: 'Item', render: (l) => <span className="mono ds-cell-primary">{l.part_code ?? '—'}</span> },
          { key: 'desc', header: 'Description', render: (l) => <Truncate text={l.description} /> },
          { key: 'qty', header: 'Quantity', numeric: true, render: (l) => formatQty(l.quantity, l.uom) }
        ]} /></Card>

      {enquiry.notes && <Card title="Notes"><p style={{ whiteSpace: 'pre-wrap' }} className="wrap-anywhere">{enquiry.notes}</p></Card>}

      <Card title="History">
        {revisions.status === 'loading' && !revisions.data ? <CardSkeleton /> : revisions.status === 'error' ? <ErrorState error={revisions.error} /> :
          <Timeline items={(revisions.data ?? []).map((r) => ({ id: r.id, title: `Revision ${r.revision_number}`, at: r.created_at, by: r.created_by_name, body: r.reason, icon: r.revision_number === 1 ? 'plus' : 'settings' }))} />}
      </Card>
    </div>
  );
}

export default function EnquiriesPage() { return <Suspense fallback={<CardSkeleton />}><Inbox /></Suspense>; }
