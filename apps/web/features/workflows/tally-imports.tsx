'use client';

import Link from 'next/link';
import {TallyInitialSync} from './tally-initial-sync';
import {tallyRecordHref} from '../../../../public/crm-navigation.js';
import {FreshnessBadge,type DatasetFreshness} from './tally-freshness';
import {TallySalesDocuments} from './tally-sales-documents';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useApi } from '@/lib/api/provider';
import type { Pagination } from '@/lib/api/client';
import { useScope } from '@/lib/scope';
import { useSession } from '@/lib/session';
import { Avatar, Badge, Button, Card, CardSkeleton, DataTable, Drawer, EmptyState, ErrorState, Icon, TextField } from '@/components/ds';
import { TALLY_ENTITY_DESCRIPTORS, describeTallyField, formatTallyField } from '../../../../public/tally-entity-descriptors.js';

interface ImportedRow { id: string; record_key: string; name: string; display_name?: string; parent_name?: string; fields: Record<string, unknown> }
interface Listing { freshness:DatasetFreshness[]; data: ImportedRow[]; pagination: Pagination; lastUpdated: string | null; emptyReason: string }
interface Overview { counts: { entity: string; count: number }[]; sync: { status: string; completed_at?: string }[]; warnings: number; quarantine: number }
const time = (value?: string | null) => value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'No completed import recorded';
const usefulValue = (value: unknown) => value != null && String(value).trim() !== '' && !['not applicable', 'not delivered', 'not supplied', '-'].includes(String(value).trim().toLowerCase());
const friendlyLabel = (label: string) => label.replace(/^XML\s*\/\s*/i, '').replaceAll('_', ' ').replaceAll('/', ' · ').replace(/\s+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());

/** Explicit sources prevent imported masters being mistaken for editable CRM records. */
export function RecordWorkspace({ kind, children, preferredSource }: { kind: 'customers' | 'items' | 'quotations' | 'enquiries'; children: ReactNode; preferredSource?:'crm'|'tally' }) {
  const [source, setSource] = useState<string>(preferredSource??'tally');
  useEffect(()=>{if(preferredSource)setSource(preferredSource);},[preferredSource]);
  const id = useId();
  return <section className="record-workspace">
    <div className="record-source-bar">
      <div role="tablist" aria-label="Record source" className="record-tabs">{[['tally', 'Tally imports'], ['crm', kind === 'items' ? 'CRM products & prices' : `CRM ${kind}`]].map(([key, label], index) =>
        <button key={key} id={`${id}-${key}`} type="button" role="tab" aria-selected={source === key} aria-controls={`${id}-panel-${key}`} tabIndex={source === key ? 0 : -1}
          onClick={() => setSource(key)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'tally' : event.key === 'End' ? 'crm' : index === 0 ? 'crm' : 'tally'; setSource(next); document.getElementById(`${id}-${next}`)?.focus(); } }}>
          <Icon name={key === 'tally' ? 'ledger' : kind === 'items' ? 'items' : 'customers'} />{label}
        </button>)}</div>
      <span className="record-source-hint"><Icon name={source === 'tally' ? 'shield' : 'customers'} />{source === 'tally' ? 'Read-only source data' : 'Your working records'}</span>
    </div>
    <div role="tabpanel" id={`${id}-panel-tally`} aria-labelledby={`${id}-tally`} hidden={source !== 'tally'}>{kind === 'quotations' || kind === 'enquiries' ? <TallySalesDocuments kind={kind}/> : <TallyImports kind={kind} />}</div>
    <div role="tabpanel" id={`${id}-panel-crm`} aria-labelledby={`${id}-crm`} hidden={source !== 'crm'}>{children}</div>
  </section>;
}

export function TallyImports({kind}:{kind:'customers'|'items'}){
 const {companyId,companies}=useScope(),{can}=useSession();
 if(companyId)return <CompanyTallyImports key={companyId} kind={kind}/>;
 if(!companies.length)return can('tally.read')?<TallyInitialSync/>:<EmptyState title="Tally data is not available yet">The first company import has not completed. Ask your Manager to check the sync monitor.</EmptyState>;
 return <EmptyState title="Select a company">Choose an imported company in the header.</EmptyState>;
}
function CompanyTallyImports({ kind }: { kind: 'customers' | 'items' }) {
  const api = useApi(), { companyId } = useScope(), { can } = useSession();
  const [page, setPage] = useState(1), [search, setSearch] = useState(''), [version, setVersion] = useState(0);
  const [data, setData] = useState<Listing>(), [error, setError] = useState<unknown>(), [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ImportedRow>();
  const [fieldSearch, setFieldSearch] = useState('');
  const allowed = can(kind === 'items' ? 'items.read' : 'customers.read');
  useEffect(() => { setPage(1); setSelected(undefined); setData(undefined); }, [companyId]);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setError(undefined); setLoading(true);
    api.get<Listing>(`/api/v1/tally/visibility/${kind}`, { query: { companyId, page, pageSize: 25, search }, signal: controller.signal })
      .then(setData).catch(e => { if (!controller.signal.aborted) setError(e); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, allowed, companyId, kind, page, search, version]);
  useEffect(() => { const timer = setInterval(() => setVersion(v => v + 1), 30000); return () => clearInterval(timer); }, []);
  if (!allowed) return null;
  const field = (row: ImportedRow, key: string) => String(row.fields[`/stored/${key}`] ?? 'Not supplied');
  return <section className="import-workspace" aria-label={`Imported Tally ${kind}`}>
    <div className="import-heading">
      <div><span className="workspace-eyebrow">TALLY DIRECTORY</span><h2>{kind === 'items' ? 'Stock catalogue' : 'Customer directory'} {data && !loading && <Badge tone="neutral">{data.pagination.total.toLocaleString('en-IN')}</Badge>}</h2><p>Browse imported {kind === 'items' ? 'stock and availability' : 'customer details'}. Select a row to inspect its fields.</p></div>
      <Button variant="secondary" icon="refresh" onClick={() => setVersion(v => v + 1)} disabled={loading}>{loading ? 'Updating...' : 'Refresh'}</Button>
    </div>
    <div className="import-context"><span><Icon name="clock" />Last imported <strong>{data ? time(data.lastUpdated) : 'Checking...'}</strong></span><span>Selected company / refreshes every 30 seconds</span></div>
    <DataTable<ImportedRow> id={`imported-${kind}`} caption={`Imported ${kind}`} rows={data?.data} rowKey={r => r.id} loading={loading && !data} error={error} onRetry={() => setVersion(v => v + 1)} pagination={data?.pagination} onPage={setPage} onRowClick={row => { setSelected(row); setFieldSearch(''); }}
      search={{ value: search, onChange: value => { setSearch(value); setPage(1); }, placeholder: `Search all imported ${kind}` }}
      columns={[
        { key: 'name', header: kind === 'items' ? 'Stock item' : 'Customer', render: r => <span className="import-record-name">{kind === 'customers' && <Avatar name={r.display_name || r.name} />}<span className="ds-cell-primary">{r.display_name || r.name}</span></span> },
        { key: 'group', header: 'Tally group', render: r => r.parent_name || field(r, 'parent_name') },
        ...(kind === 'items' ? [
          { key: 'unit', header: 'Unit', render: (r: ImportedRow) => field(r, 'base_unit') },
          { key: 'quantity', header: 'Closing quantity', render: (r: ImportedRow) => field(r, 'closing_quantity_text') }
        ] : [{ key: 'gstin', header: 'GSTIN', render: (r: ImportedRow) => field(r, 'gstin') }]),
        { key: 'details', header: 'Details', render: r => <Button variant="link" onClick={() => { setSelected(r); setFieldSearch(''); }}>View details</Button> }
      ]}
      empty={<EmptyState title={search ? 'No imported records match' : 'No imported records available'}>{search ? 'Try another name or clear the search.' : data?.emptyReason || 'Waiting for a completed Tally import.'}</EmptyState>} />
    <Drawer open={Boolean(selected)} title={selected?.display_name || selected?.name || 'Imported details'} onClose={() => setSelected(undefined)}>
      {selected && <div className="import-record-detail">{data?.freshness&&<FreshnessBadge data={data.freshness}/>}
        <section className="import-record-hero"><div><span className="workspace-eyebrow">{kind === 'items' ? 'STOCK ITEM' : 'CUSTOMER'}</span><h3>{selected.display_name || selected.name || 'Unnamed record'}</h3><p>{selected.parent_name || 'Imported from Tally'}</p></div><Badge tone="neutral">Tally · Read only</Badge></section>
        <section className="import-record-section"><h4>{kind === 'items' ? 'Stock details' : 'Contact & registration'}</h4><dl className="import-record-grid">{Object.entries(selected.fields).filter(([key, value]) => key.startsWith('/stored/') && key !== '/stored/id' && usefulValue(value)).map(([key, value]) => {
          const descriptor = describeTallyField(key, kind);
          return <div key={key}><dt>{friendlyLabel(descriptor.label)}</dt><dd>{formatTallyField(value, descriptor, selected.fields)}</dd></div>;
        })}</dl></section>
        <Link href={tallyRecordHref(kind,companyId!,selected.record_key)}>Open import history and CRM linking</Link>
        <details className="import-record-advanced"><summary>Original Tally fields</summary><p>Imported XML and source values. Empty fields are hidden.</p><TextField label="Find a field" value={fieldSearch} onChange={e => setFieldSearch(e.target.value)} placeholder="Search GSTIN, address, stock" /><dl className="import-record-grid">{Object.entries(selected.fields).filter(([key, value]) => usefulValue(value) && `${key} ${String(value)}`.toLowerCase().includes(fieldSearch.toLowerCase())).map(([key, value]) => {
          const descriptor = describeTallyField(key, kind);
          return <div key={key}><dt title={key}>{friendlyLabel(descriptor.label)}</dt><dd title={key}>{formatTallyField(value, descriptor, selected.fields)}</dd></div>;
        })}</dl></details>
      </div>}
    </Drawer>
  </section>;
}

export function TallyImportCoverage() {
  const api = useApi(), { companyId, companies } = useScope(), { can } = useSession();
  const [data, setData] = useState<Overview>(), [customers, setCustomers] = useState<number>(), [error, setError] = useState<unknown>(), [version, setVersion] = useState(0);
  const allowed = can('tally.read');
  useEffect(() => {
    setData(undefined); setCustomers(undefined); setError(undefined);
    if (!allowed || !companyId) return;
    const controller = new AbortController();
    Promise.all([
      api.get<Overview>('/api/v1/tally/visibility/overview', { query: { companyId }, signal: controller.signal }),
      can('customers.read') ? api.get<Listing>('/api/v1/tally/visibility/customers', { query: { companyId, pageSize: 1 }, signal: controller.signal }) : Promise.resolve(undefined)
    ]).then(([overview, list]) => { setData(overview); setCustomers(list?.pagination.total); }).catch(e => { if (!controller.signal.aborted) setError(e); });
    return () => controller.abort();
  }, [api, allowed, can, companyId, version]);
  useEffect(() => { const timer = setInterval(() => setVersion(v => v + 1), 30000); return () => clearInterval(timer); }, []);
  if (!allowed) return null;
  const entities = Object.values(TALLY_ENTITY_DESCRIPTORS).filter(e => e.id === e.baseEntity && can(e.permission));
  const completed = data?.sync.find(s => s.status === 'stored' && s.completed_at);
  const missing = entities.filter(entity => !Number(data?.counts.find(c => c.entity === entity.id)?.count ?? 0));
  const imported = entities.length - missing.length;
  const itemCount = data?.counts.find(c => c.entity === 'items')?.count;
  if (!companyId && !companies.length) return <TallyInitialSync/>;
  return <Card title="Tally data overview" actions={<Link className="workspace-text-link" href={can('tally.connector.manage') ? '/tally/connector' : '/tally/monitor'}>{can('tally.connector.manage') ? 'Connection details' : 'Sync monitor'} <Icon name="chevronRight" /></Link>}>
    {!companyId ? <EmptyState title={companies.length ? 'Select a Tally company' : 'No Tally data imported yet'}>{companies.length ? 'Choose a company from the company and period menu at the top of the page.' : 'The CRM has not received an imported company yet. Pairing or a heartbeat alone does not mean data has arrived. Complete a successful connector upload, then refresh this page.'}</EmptyState> : error ? <ErrorState error={error} onRetry={() => setVersion(v => v + 1)} /> : !data ? <CardSkeleton /> : <div className="import-overview">
      <div className="import-metrics">
        <Link href="/customers"><span>Imported customers</span><strong>{customers === undefined ? 'Unavailable' : customers.toLocaleString('en-IN')}</strong><small>Browse customer directory <Icon name="arrowRight" /></small></Link>
        <Link href="/items"><span>Stock items</span><strong>{Number(itemCount ?? 0).toLocaleString('en-IN')}</strong><small>Browse stock catalogue <Icon name="arrowRight" /></small></Link>
        <div><span>Data coverage</span><strong>{imported}<span> / {entities.length}</span></strong><small>Collections with imported records</small></div>
      </div>
      <div className="import-sync-line"><span><Icon name="clock" />Last completed import <strong>{time(completed?.completed_at)}</strong></span><Button variant="link" icon="refresh" onClick={() => setVersion(v => v + 1)}>Refresh</Button></div>
      <details className="import-coverage"><summary><span>Collection coverage</span><Badge tone={missing.length ? 'warning' : 'success'}>{missing.length ? `${missing.length} without records` : 'All collections populated'}</Badge></summary>
        <p>Stored imports for the selected company, across all dates. An empty collection may have no records in Tally or may not have been delivered.</p>
        <div className="import-collection-grid">{entities.map(entity => {
          const count = Number(data.counts.find(c => c.entity === entity.id)?.count ?? 0);
          return <Link key={entity.id} href={`/tally?entity=${entity.id}&companyId=${companyId || ''}`} className="import-collection"><span>{entity.label}</span><strong>{count ? count.toLocaleString('en-IN') : 'No records'}</strong><Icon name="chevronRight" /></Link>;
        })}</div>
      </details>
      {(data.warnings > 0 || data.quarantine > 0) && <div className="import-attention"><Icon name="alert" /><span>{data.warnings} import warnings / {data.quarantine} records held for inspection</span><Link href="/tally">Review imports</Link></div>}
    </div>}
  </Card>;
}

