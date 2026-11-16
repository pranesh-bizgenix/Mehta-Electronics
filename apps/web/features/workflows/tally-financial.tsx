'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import type {Company} from '@/lib/scope';
import type {Paginated} from '@/lib/api/client';
import {Badge,Button,CardSkeleton,DataTable,Drawer,EmptyState,ErrorState,Notice,PageHeader,SelectField,TextField,useAsync} from '@/components/ds';
import {FreshnessBadge,type DatasetFreshness} from './tally-freshness';
import {formatDateTime} from '@/lib/format';
type Fields=Record<string,unknown>;
interface SourceLink {number:string|null;recordKey:string;path:string}
interface CustomerLink {id:number;name:string;path:string}
interface VoucherRow {id:string;type:string;number:string|null;party:string|null;date:string|null;amount:string|null;status:string|null;instruments:string[];observedAt:string}
interface BillRow {id:string;party:string|null;reference:string|null;sourceDate:string|null;date:string|null;closingAmount:string|null;dueDate:string|null;overdue:string|null;customer:CustomerLink|null;invoice:SourceLink|null}
interface Listing<T> extends Paginated<T> {freshness:DatasetFreshness[];note:string;originalPayload?:string|null;unparsedDates?:number;verified?:boolean;sourceObservedAt?:string|null}
interface VoucherDetail {company:Company;freshness:DatasetFreshness[];data:{id:string;observedAt:string;document:Fields&{lines:Fields[];totals:Fields;voucher_type:string;voucher_number:string|null;party_name:string|null;date:string|null;document_total:string|null;reference:string|null};banks:Fields[];bills:Fields[];links:{customer:CustomerLink|null;invoices:(Fields&{invoice:SourceLink|null})[];note:string};originalPayload:string|null}}
const text=(value:unknown)=>value==null||value===''?'Not supplied':String(value);
const date=(value:string|null)=>value&&/^\d{8}$/.test(value)?`${value.slice(6)}/${value.slice(4,6)}/${value.slice(0,4)}`:text(value);
export function TallyFinancial({company,open}:{company:Company;open?:string}){
 const [mode,setMode]=useState('vouchers'),[selected,setSelected]=useState<string>();
 useEffect(()=>{if(open)setSelected(open);},[open]);
 return <section className="stack"><PageHeader title="Receipts, payments & outstanding" crumbs={[{label:'Tally',href:'/tally'},{label:'Financial records'}]} description="Read-only Tally evidence for Owner and Accounts. Amounts and signs remain as supplied."/>
  <strong>Source company: {company.display_name||company.name}</strong><SelectField label="Financial view" value={mode} onChange={event=>setMode(event.target.value)} options={[{value:'vouchers',label:'Receipts and payments'},{value:'receivable',label:'Bill-wise receivable outstanding'},{value:'payable',label:'Bill-wise payable outstanding'}]}/>
  {mode==='vouchers'?<Vouchers key={mode} company={company} onOpen={setSelected}/>:<Bills key={mode} company={company} direction={mode}/>}
  {selected&&<FinancialDrawer key={selected} companyId={company.id} id={selected} onClose={()=>setSelected(undefined)}/>}
 </section>;
}
function Vouchers({company,onOpen}:{company:Company;onOpen:(id:string)=>void}){
 const api=useApi(),[page,setPage]=useState(1),[search,setSearch]=useState(''),[kind,setKind]=useState('receipts_payments'),[amount,setAmount]=useState(''),[percentage,setPercentage]=useState(''),[cheque,setCheque]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState('');
 const [state,reload]=useAsync(signal=>api.get<Listing<VoucherRow>>('/api/v1/tally/financial/vouchers',{query:{companyId:company.id,page,search,kind,amount,percentage,cheque,from,to},signal}),[api,company.id,page,search,kind,amount,percentage,cheque,from,to]);
 const list=state.status==='ready'?state.data:null;
 return <section className="stack">{list&&<><FreshnessBadge data={list.freshness}/><p>{list.note}</p></>}
  <div className="ds-form-grid"><TextField label="Any supplied amount (exact)" inputMode="decimal" value={amount} onChange={event=>{setAmount(event.target.value);setPage(1);}}/><TextField label="Supplied percentage (exact)" inputMode="decimal" value={percentage} onChange={event=>{setPercentage(event.target.value);setPage(1);}}/><TextField label="Instrument / cheque number contains" value={cheque} onChange={event=>{setCheque(event.target.value);setPage(1);}}/><TextField label="Voucher date from" type="date" value={from} onChange={event=>{setFrom(event.target.value);setPage(1);}}/><TextField label="Voucher date to" type="date" value={to} onChange={event=>{setTo(event.target.value);setPage(1);}}/></div>
  <DataTable<VoucherRow> id="financial-vouchers" caption="Imported financial vouchers" rows={list?.data} rowKey={row=>row.id} loading={state.status==='loading'} error={state.status==='error'?state.error:undefined} onRetry={reload} onRowClick={row=>onOpen(row.id)} pagination={list?.pagination} onPage={setPage} search={{value:search,onChange:value=>{setSearch(value);setPage(1);},placeholder:'Voucher, party or reference'}} filters={<SelectField label="Source types" value={kind} options={[{value:'receipts_payments',label:'Receipt and Payment'},{value:'receipts',label:'Receipt'},{value:'payments',label:'Payment'},{value:'all',label:'All source voucher types (includes custom types)'}]} onChange={event=>{setKind(event.target.value);setPage(1);}}/>} columns={[
   {key:'type',header:'Type',render:row=>row.type},{key:'number',header:'Voucher',render:row=>text(row.number)},{key:'party',header:'Party',render:row=>text(row.party)},
   {key:'date',header:'Date',render:row=>date(row.date)},{key:'amount',header:'Supplied total',render:row=>text(row.amount)},{key:'instrument',header:'Instrument / cheque',render:row=>row.instruments.join(', ')||'Not supplied'},{key:'status',header:'Source status',render:row=>text(row.status)}
  ]} empty={<EmptyState title="No source vouchers match">Check the selected company and filters. Custom voucher types are available under All source voucher types. No transactions are fabricated.</EmptyState>}/>
 </section>;
}
function Bills({company,direction}:{company:Company;direction:string}){
 const api=useApi(),[page,setPage]=useState(1),[search,setSearch]=useState(''),[amount,setAmount]=useState('');
 const [state,reload]=useAsync(signal=>api.get<Listing<BillRow>>('/api/v1/tally/financial/outstanding',{query:{companyId:company.id,direction,page,search,amount},signal}),[api,company.id,direction,page,search,amount]);
 const list=state.status==='ready'?state.data:null;
 return <section className="stack">{list&&<><FreshnessBadge data={list.freshness}/><p>{list.note}</p><Badge tone="neutral">{list.verified?'Source report structure recognised':'Report structure not verified'}</Badge>{list.sourceObservedAt&&<p>Imported: {formatDateTime(list.sourceObservedAt)}</p>}{Boolean(list.unparsedDates)&&<Notice tone="info">{list.unparsedDates} source dates do not include an unambiguous full year. Search the date exactly as Tally displays it; a century is not guessed.</Notice>}</>}
  <TextField label="Closing amount (exact, signed)" inputMode="decimal" value={amount} onChange={event=>{setAmount(event.target.value);setPage(1);}}/>
  <DataTable<BillRow> id={`outstanding-${direction}`} caption="Bill-wise source outstanding" rows={list?.data} rowKey={row=>row.id} loading={state.status==='loading'} error={state.status==='error'?state.error:undefined} onRetry={reload} pagination={list?.pagination} onPage={setPage} search={{value:search,onChange:value=>{setSearch(value);setPage(1);},placeholder:'Party, bill reference or source date (as displayed)'}} columns={[
   {key:'party',header:'Tally party',render:row=>text(row.party)},{key:'bill',header:'Bill reference',render:row=>text(row.reference)},{key:'date',header:'Bill date (source)',render:row=>text(row.sourceDate)},{key:'amount',header:'Closing amount (source)',render:row=>text(row.closingAmount)},
   {key:'due',header:'Due date (source)',render:row=>text(row.dueDate)},{key:'overdue',header:'Overdue (source)',render:row=>text(row.overdue)},{key:'customer',header:'Linked CRM customer',render:row=>row.customer?<Link href={row.customer.path}>{row.customer.name}</Link>:'Not linked'},
   {key:'invoice',header:'Source invoice',render:row=>row.invoice?<Link href={row.invoice.path}>{row.invoice.number||'Open invoice'}</Link>:'No unique source invoice link'}
  ]} empty={<EmptyState title="No usable matching bill rows">No zero outstanding balance is inferred. Check the source report and selected company.</EmptyState>}/>
  {list?.originalPayload&&<OriginalPayload path={list.originalPayload} companyId={company.id}/>}
 </section>;
}
function OriginalPayload({path,companyId}:{path:string;companyId:string}){
 const api=useApi(),[content,setContent]=useState<string>(),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 const load=async()=>{setBusy(true);setError(undefined);try{const result=await api.get<{data:{content:string}}>(path,{query:{companyId}});setContent(result.data.content);}catch(e){setError(e);}finally{setBusy(false);}};
 return <section className="stack"><Button variant="secondary" disabled={busy} onClick={()=>void load()}>{busy?'Loading original…':'Open original retained XML'}</Button>{Boolean(error)&&<ErrorState error={error}/>} {content!==undefined&&<details open><summary>Original source XML</summary><pre className="tally-raw-view">{content}</pre></details>}</section>;
}
function FinancialDrawer({companyId,id,onClose}:{companyId:string;id:string;onClose:()=>void}){
 const api=useApi(),[state,reload]=useAsync(signal=>api.get<VoucherDetail>(`/api/v1/tally/financial/vouchers/${encodeURIComponent(id)}`,{query:{companyId},signal}),[api,companyId,id]);
 const detail=state.status==='ready'?state.data:null,record=detail?.data,document=record?.document;
 return <Drawer open title={document?`${document.voucher_type} ${document.voucher_number||''}`:'Financial source voucher'} onClose={onClose}>
  {state.status==='error'?<ErrorState error={state.error} onRetry={reload}/>:!detail||!record||!document?<CardSkeleton/>:<div className="stack"><strong>Source company: {detail.company.display_name||detail.company.name}</strong><FreshnessBadge data={detail.freshness}/>
   <dl className="ds-facts">{[['Party',document.party_name],['Voucher date',date(document.date)],['Reference',document.reference],['Supplied total',document.document_total],['Imported',formatDateTime(record.observedAt)]].map(([key,value])=><div key={key}><dt>{key}</dt><dd>{text(value)}</dd></div>)}</dl>
   {record.links.customer&&<Link href={record.links.customer.path}>Open linked customer: {record.links.customer.name}</Link>}<p>{record.links.note}</p>
   <DataTable<Fields> id="voucher-bank-allocations" caption="Supplied instrument and bank allocations" rows={record.banks} rowKey={row=>String(row.position)} columns={['instrumentNumber','instrumentDate','transactionType','bankName','partyName','amount'].map(key=>({key,header:key.replace(/([A-Z])/g,' $1'),render:row=>text(row[key])}))}/>
   <DataTable<Fields&{invoice:SourceLink|null}> id="voucher-bill-allocations" caption="Supplied bill allocations" rows={record.links.invoices} rowKey={row=>String(row.position)} columns={[...['ledgerName','name','type','amount','sourceBillId'].map(key=>({key,header:key.replace(/([A-Z])/g,' $1'),render:(row:Fields)=>text(row[key])})),{key:'invoice',header:'Source invoice',render:row=>row.invoice?<Link href={row.invoice.path}>{row.invoice.number||'Open invoice'}</Link>:'No unique source invoice link'}]}/>
   {document.lines.length>0&&<DataTable<Fields> id="financial-invoice-lines" caption="Source inventory lines" rows={document.lines} rowKey={row=>String(row.position)} columns={['stockItemName','actualQuantity','billedQuantity','rate','amount'].map(key=>({key,header:key.replace(/([A-Z])/g,' $1'),render:row=>text(row[key])}))}/>}
   {record.originalPayload&&<OriginalPayload key={record.originalPayload} path={record.originalPayload} companyId={companyId}/>}<p>No payment, accounting entry or statutory invoice is issued from this view.</p>
  </div>}
 </Drawer>;
}
