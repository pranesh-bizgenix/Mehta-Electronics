'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/api/provider';
import { useScope } from '@/lib/scope';
import type { Pagination } from '@/lib/api/client';
import { Badge, Button, Card, CardSkeleton, DataTable, Drawer, EmptyState, ErrorState, SelectField, TextField } from '@/components/ds';
import { describeTallyField, formatTallyField } from '../../../../public/tally-entity-descriptors.js';

type Kind = 'quotations' | 'enquiries';
type Fields = Record<string, unknown>;
interface Row { id: string; record_key: string; name: string; fields: Fields; observed_at: string; session_id: string }
interface Listing { data: Row[]; pagination: Pagination; lastUpdated: string | null; emptyReason: string; financial: boolean }
interface Summary { imported: number; sourceCount: number | null; pending: number | null; failed: number | null; cancelled: number; updated: number; notSeenInLatest?: number | null; types: {type: string;count: number;optional: number;non_optional: number;cancelled: number}[]; periods: {year: string; count: number}[]; receipt: {status: string; error: string | null; processedAt: string; sessionId: string; from: string; to: string} | null }
interface SourceDocument { [key: string]: unknown; lines: Fields[]; ledgers: Fields[]; totals: Fields; note: string }
interface Detail { data: Row; document?: SourceDocument; history: Row[]; financial: boolean; rawNote: string }
const text = (v: unknown) => v == null || v === '' ? 'Not supplied' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const date = (v: unknown) => { const s=String(v ?? ''); return /^\d{8}$/.test(s) ? `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}` : s ? new Date(s).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}) : 'Not available'; };

export function TallySalesDocuments({kind}: {kind: Kind}) {
  const api=useApi(), {companyId}=useScope();
  const [page,setPage]=useState(1),[search,setSearch]=useState(''),[fromDate,setFrom]=useState(''),[toDate,setTo]=useState(''),[customer,setCustomer]=useState(''),[voucherStatus,setStatus]=useState(''),[optional,setOptional]=useState(''),[group,setType]=useState(kind==='quotations'?'Sales Quotation':'Enquiry');
  const [list,setList]=useState<Listing>(),[summary,setSummary]=useState<Summary>(),[error,setError]=useState<unknown>(),[loading,setLoading]=useState(true),[version,setVersion]=useState(0);
  const [selected,setSelected]=useState<Row>(),[detail,setDetail]=useState<Detail>(),[detailError,setDetailError]=useState<unknown>(),[fieldSearch,setFieldSearch]=useState('');
  useEffect(()=>{setPage(1);setList(undefined);setSelected(undefined);setSummary(undefined);},[companyId]);
  useEffect(()=>{const timer=setInterval(()=>setVersion(v=>v+1),30000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError(undefined);
    api.get<Listing>(`/api/v1/tally/visibility/${kind}`,{query:{companyId,page,pageSize:25,search,fromDate,toDate,customer,voucherStatus,optional,group},signal:controller.signal})
      .then(setList).catch(e=>{if(!controller.signal.aborted)setError(e);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[api,companyId,kind,page,search,fromDate,toDate,customer,voucherStatus,optional,group,version]);
  useEffect(()=>{const controller=new AbortController();api.get<Summary>(`/api/v1/tally/inspection/${kind}/sync`,{query:{companyId},signal:controller.signal}).then(setSummary).catch(e=>{if(!controller.signal.aborted)setError(e);});return()=>controller.abort();},[api,companyId,kind,version]);
  useEffect(()=>{
    if(!selected)return;
    const controller=new AbortController();setDetail(undefined);setDetailError(undefined);setFieldSearch('');
    api.get<Detail>(`/api/v1/tally/visibility/${kind}/${encodeURIComponent(selected.record_key)}`,{query:{companyId,snapshotId:selected.id},signal:controller.signal}).then(setDetail).catch(e=>{if(!controller.signal.aborted)setDetailError(e);});
    return()=>controller.abort();
  },[api,companyId,kind,selected]);
  const field=(r:Row,k:string)=>r.fields[`/stored/${k}`];
  const filter=(setter:(v:string)=>void)=>(value:string)=>{setter(value);setPage(1);};
  return <section className="import-workspace stack" aria-label={`Tally ${kind}`}>
    <div className="import-heading"><div><span className="workspace-eyebrow">TALLY SOURCE DOCUMENTS</span><h2>{kind==='quotations'?'Sales quotations':'Enquiries'} {list&&<Badge tone="neutral">{list.pagination.total.toLocaleString('en-IN')}</Badge>}</h2><p>Original Tally records, separate from CRM approvals. All imported dates are shown until you apply a date filter.</p></div><Button variant="secondary" icon="refresh" disabled={loading} onClick={()=>setVersion(v=>v+1)}>Refresh</Button></div>
    {summary&&<div className="ds-tally-summary" aria-label="Sales document synchronization"><div><span>All source types / persisted</span><strong>{summary.sourceCount??'Unknown'} / {summary.imported}</strong></div><div><span>Cancelled</span><strong>{summary.cancelled}</strong></div><div><span>Changed source records</span><strong>{summary.updated}</strong></div><div><span>Failed / pending</span><strong>{summary.failed??'Unknown'} / {summary.pending??'Unknown'}</strong></div><div><span>Last import result</span><strong>{summary.receipt?.status||'No sales-document sync'}</strong></div></div>}
    {summary&&<div className="import-context">{summary.types.map(t=><span key={t.type}><strong>{t.type}</strong>: {t.non_optional} non-optional / {t.optional} optional / {t.cancelled} cancelled</span>)}</div>}
    {summary?.receipt?.error&&<p role="alert">{summary.receipt.error}</p>}
    {Boolean(summary?.notSeenInLatest)&&<p role="status">{summary?.notSeenInLatest} earlier records were not seen in the latest full snapshot. They remain available for review; they have not been deleted.</p>}
    {summary&&<details className="import-coverage"><summary>Source counts and date coverage</summary><div className="ds-card-body stack"><p>Types: {summary.types.map(t=>`${t.type}: ${t.count}`).join(' / ')||'No records delivered'}</p><p>Calendar years: {summary.periods.map(p=>`${p.year}: ${p.count}`).join(' / ')||'None'}</p><p>Last completed import: {date(summary.receipt?.processedAt)}. Source window: {text(summary.receipt?.from)} to {text(summary.receipt?.to)}.</p><p>These counts cover all imported dates and types. They may differ from the period selected in Tally.</p></div></details>}
    <DataTable<Row> id={`tally-sales-${kind}`} caption={`Tally ${kind}`} rows={list?.data} rowKey={r=>r.id} loading={loading&&!list} error={error} onRetry={()=>setVersion(v=>v+1)} pagination={list?.pagination} onPage={setPage} onRowClick={setSelected}
      search={{value:search,onChange:filter(setSearch),placeholder:'Search voucher number or customer'}}
      filters={<><TextField label="From date" type="date" value={fromDate} onChange={e=>filter(setFrom)(e.target.value)}/><TextField label="To date" type="date" value={toDate} onChange={e=>filter(setTo)(e.target.value)}/><TextField label="Customer" value={customer} onChange={e=>filter(setCustomer)(e.target.value)}/><SelectField label="Tally type" placeholder="All imported types" value={group} onChange={e=>filter(setType)(e.target.value)} options={[...new Set([...(kind==='quotations'?['Sales Quotation','Quotation1','Sales Order']:['Enquiry']),...(summary?.types.map(t=>t.type)||[])])].map(value=>({value,label:value}))}/><SelectField label="Optional vouchers" placeholder="Include all" value={optional} onChange={e=>filter(setOptional)(e.target.value)} options={[{value:'No',label:'Non-optional only'},{value:'Yes',label:'Optional only'}]}/><SelectField label="Voucher status" placeholder="All statuses" value={voucherStatus} onChange={e=>filter(setStatus)(e.target.value)} options={['RECORDED','OPTIONAL','CANCELLED','DELETED'].map(value=>({value,label:value}))}/></>}
      columns={[
        {key:'number',header:'Quotation / reference',render:r=><span className="mono ds-cell-primary">{field(r,'voucher_number')?text(field(r,'voucher_number')):`No number / Master ${text(field(r,'master_id'))}`}</span>},
        {key:'date',header:'Date',render:r=>date(field(r,'date'))},
        {key:'customer',header:'Customer',render:r=>text(field(r,'party_name'))},
        {key:'type',header:'Tally type',render:r=>text(field(r,'voucher_type'))},
        {key:'total',header:'Total (Tally sign)',numeric:true,render:r=>list?.financial?text(field(r,'document_total')):'Restricted'},
        {key:'status',header:'Voucher status',render:r=><Badge tone={field(r,'voucher_status')==='CANCELLED'?'danger':'neutral'}>{text(field(r,'voucher_status'))}</Badge>},
        {key:'sync',header:'Sync status',render:r=><span>{summary?.receipt?.sessionId===r.session_id?'Persisted in latest snapshot':'Retained source record'}<span className="ds-cell-secondary" style={{display:'block'}}>{date(r.observed_at)}</span></span>}
      ]}
      empty={<EmptyState title={search||customer||fromDate||toDate?'No source records match':`No Tally ${kind} imported`}>{list?.emptyReason||'Checking the selected company.'} {kind==='enquiries'?'No dummy enquiries are created.':''}</EmptyState>}/>
    <Drawer open={Boolean(selected)} title={`${kind==='quotations'?'Tally quotation':'Tally enquiry'} ${selected?text(field(selected,'voucher_number')||selected.name):''}`} onClose={()=>setSelected(undefined)}>
      {detailError?<ErrorState error={detailError}/>:!detail?<CardSkeleton/>:<div className="stack">
        <Badge tone="info">Tally source / Read only</Badge><p>Imported {date(detail.data.observed_at)}. {detail.history.length} retained snapshots. Source GUID: {text(detail.data.fields['/stored/guid'])}</p>
        {detail.document?<><dl className="ds-facts">{Object.entries(detail.document).filter(([key,v])=>!['lines','ledgers','totals','note','relationships'].includes(key)&&!Array.isArray(v)).map(([key,v])=><div key={key}><dt>{key.replaceAll('_',' ')}</dt><dd>{text(v)}</dd></div>)}</dl><p>{Array.isArray(detail.document.address)?detail.document.address.join(', '):''}</p>
          <h3>Items and delivered pricing</h3><DataTable<Fields> id={`source-lines-${kind}`} caption="Source item breakdown" rows={detail.document.lines} rowKey={r=>String(r.position)} columns={['stockItemName','stockItemId','description','actualQuantity','billedQuantity','unit','rate','amount','grossAmount','netAmount','discountPercent','discountAmount','hsn','gstRate','cgst','sgst','igst'].map(key=>({key,header:key.replace(/([A-Z])/g,' $1'),render:r=>text(r[key])}))}/>
          {Array.isArray(detail.document.relationships)&&<details className="import-coverage"><summary>Customer and item source links</summary><div className="ds-card-body stack">{(detail.document.relationships as Fields[]).map((r,i)=><p key={i}>{text(r.role)}: {text(r.name)} / {text(r.status)}{r.matchedBy?` (${text(r.matchedBy)})`:''}</p>)}</div></details>}
          <h3>Totals supplied by Tally</h3><dl className="ds-facts">{Object.entries(detail.document.totals).map(([key,v])=><div key={key}><dt>{key.replace(/([A-Z])/g,' $1')}</dt><dd>{text(v)}</dd></div>)}</dl><p>{detail.document.note}</p>
          <h3>Ledger, tax and discount entries</h3><DataTable<Fields> id={`source-ledgers-${kind}`} caption="Original ledger breakdown" rows={detail.document.ledgers.map((l,i)=>({...l,index:i}))} rowKey={r=>Number(r.index)} columns={['ledgerName','amount','isPartyLedger','isDeemedPositive','billAllocations'].map(key=>({key,header:key.replace(/([A-Z])/g,' $1'),render:r=>text(r[key])}))}/>
        </>:<p>Financial source details are restricted to Owner and Accounts. Permitted imported fields are available below.</p>}
        <details className="import-coverage"><summary>All original fields, tax details and custom fields</summary><div className="stack ds-card-body"><TextField label="Find original field" value={fieldSearch} onChange={e=>setFieldSearch(e.target.value)}/><dl className="stack">{Object.entries(detail.data.fields).filter(([key,v])=>`${key} ${text(v)}`.toLowerCase().includes(fieldSearch.toLowerCase())).map(([key,v])=>{const descriptor=describeTallyField(key,kind);return <div key={key}><dt>{descriptor.label}</dt><dd className="wrap-anywhere">{formatTallyField(v,descriptor,detail.data.fields)}</dd></div>;})}</dl></div></details>
        <Link href={`/tally?entity=${kind}&companyId=${companyId||''}`}>Inspect source history and export fields</Link>
      </div>}
    </Drawer>
  </section>;
}

export function TallySalesSyncOverview() {
  const api=useApi(),{companyId}=useScope();const [summaries,setSummaries]=useState<{kind:Kind;summary:Summary}[]>(),[error,setError]=useState<unknown>();
  useEffect(()=>{const controller=new AbortController();Promise.all((['quotations','enquiries'] as Kind[]).map(async kind=>({kind,summary:await api.get<Summary>(`/api/v1/tally/inspection/${kind}/sync`,{query:{companyId},signal:controller.signal})}))).then(setSummaries).catch(e=>{if(!controller.signal.aborted)setError(e);});return()=>controller.abort();},[api,companyId]);
  return <Card title="Tally quotations & enquiries">{error?<ErrorState error={error}/>:!summaries?<CardSkeleton/>:<div className="grid-2">{summaries.map(({kind,summary})=><div className="stack-sm" key={kind}><Link href={`/${kind}`}><strong>{summary.imported.toLocaleString('en-IN')} imported {kind}</strong></Link><p>{summary.cancelled} cancelled / {summary.updated} changed / {summary.pending??'Unknown'} pending</p><p>Last import: {date(summary.receipt?.processedAt)} / {summary.receipt?.status||'Not yet imported'}</p></div>)}</div>}</Card>;
}
