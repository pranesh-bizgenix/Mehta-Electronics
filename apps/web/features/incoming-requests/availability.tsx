'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {Badge,Button,Card,DataTable,Drawer,EmptyState,ErrorState,Notice,SelectField,TextAreaField,TextField,Timeline} from '@/components/ds';
import {useApi} from '@/lib/api/provider';
import {useScope} from '@/lib/scope';
import {useSession} from '@/lib/session';
import {formatDateTime,formatQty} from '@/lib/format';
interface AvailabilityRow {id:string;quotation_id:number;quotation_version:number;status:string;assigned_store_id:number|null;assigned_name:string|null;version:number;created_at:string}
interface AvailabilityLine {id:string;sourceLineId:string;partCode:string;description:string;quantity:string;uom:string;warehouse:string|null;warehouses:{key:string;onHand:string;reserved:string;free:string}[];onHand:string|null;sourceReserved:string|null;localReserved:string;availableQuantity:string|null;shortageQuantity:string|null;checkedQuantity:string|null;checkedBy:number|null;checkedAt:string|null;evidence:string|null;sourceTimestamp:string|null;sourceStatus:string;issues:string[];ready:boolean}
interface Availability {id:string;quotationId:number;quotationVersion:number;status:string;version:number;assignedStoreId:number|null;reviewedBy:number|null;reviewedAt:string|null;ready:boolean;lines:AvailabilityLine[];events:{action:string;actor_id:number;version:number;reason:string;created_at:string}[]}
const base='/api/crm/logistics/availability';
const human=(s:string)=>s.replaceAll('_',' ');
const amount=(v:string|null)=>v===null?'Unknown':formatQty(v);
export function AvailabilityQueue(){
 const api=useApi(),scope=useScope(),{can}=useSession();
 const [page,setPage]=useState(1),[search,setSearch]=useState(''),[status,setStatus]=useState('');
 const [companies,setCompanies]=useState<{id:string;name:string}[]>([]),[localCompany,setLocalCompany]=useState('');
 const companyId=companies.some(c=>c.id===localCompany)?localCompany:companies.some(c=>c.id===scope.companyId)?scope.companyId:companies.length===1?companies[0].id:null;
 useEffect(()=>setLocalCompany(''),[scope.companyId]);
 useEffect(()=>setPage(1),[companyId,search,status]);
 const [rows,setRows]=useState<AvailabilityRow[]>(),[detail,setDetail]=useState<Availability>(),[error,setError]=useState<unknown>(),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;void api.data<{id:string;name:string}[]>('GET',`${base}/companies`).then(c=>{if(active)setCompanies(c);}).catch(e=>{if(active)setError(e);});return()=>{active=false;};},[api,revision]);
 useEffect(()=>{setRows(undefined);setDetail(undefined);if(!companyId)return;let active=true;void api.data<AvailabilityRow[]>('GET',base,undefined,{query:{companyId,page,search,status}}).then(v=>{if(active)setRows(v);}).catch(e=>{if(active)setError(e);});return()=>{active=false;};},[api,companyId,revision,page,search,status]);
 const open=async(r:AvailabilityRow)=>{setError(undefined);try{setDetail(await api.data<Availability>('GET',`${base}/${r.id}`,undefined,{query:{companyId}}));}catch(e){setError(e);}};
 return <Card title="Pre-order warehouse availability" actions={<Button variant="ghost" onClick={()=>setRevision(n=>n+1)}>Refresh availability</Button>}>
  <p className="muted">Stock requests appear here before a sales order exists. Every line stays visible while shortages are resolved.</p>
  {companies.length>0&&<SelectField label="Warehouse request company" value={companyId??''} placeholder="Choose an assigned company" options={companies.map(c=>({value:c.id,label:c.name}))} onChange={e=>setLocalCompany(e.target.value)}/>}
  {error!==undefined&&<ErrorState error={error}/>}{!companyId?<EmptyState title={can('logistics.assignment.manage')?'Select a company':'No assigned warehouse requests'}>Assigned pre-order checks will appear here for the relevant company.</EmptyState>:<DataTable id="pre-order-availability" caption="Pre-order warehouse requests" rows={rows} rowKey={r=>r.id} loading={!rows} filters={<><TextField label="Search quotation ID or Store staff" type="search" value={search} onChange={e=>setSearch(e.target.value)}/><SelectField label="Warehouse review status" value={status} placeholder="All statuses" options={['REQUESTED','CHECKING','SHORTAGE','PARTIALLY_AVAILABLE','READY_FOR_REVIEW','AVAILABILITY_APPROVED','INVALIDATED','CANCELLED'].map(value=>({value,label:human(value)}))} onChange={e=>setStatus(e.target.value)}/></>} empty={<EmptyState title="No pre-order requests">Eligible intake quotation drafts create requests here.</EmptyState>} columns={[
   {key:'quote',header:'Request',render:r=><Button variant="ghost" onClick={()=>void open(r)}>Quotation #{r.quotation_id} · v{r.quotation_version}</Button>},
   {key:'status',header:'Warehouse status',render:r=><Badge tone={r.status==='AVAILABILITY_APPROVED'?'success':'warning'}>{human(r.status)}</Badge>},
   {key:'staff',header:'Store assignment',render:r=>r.assigned_name??'Unassigned'},
   {key:'date',header:'Requested',render:r=>formatDateTime(r.created_at)}
  ]}/>}
  {companyId&&<div className="cluster"><Button variant="secondary" disabled={page===1||!rows} onClick={()=>setPage(p=>p-1)}>Previous warehouse page</Button><span>Page {page}</span><Button variant="secondary" disabled={!rows||rows.length<100} onClick={()=>setPage(p=>p+1)}>Next warehouse page</Button></div>}
  <Drawer open={Boolean(detail)} title={detail?`Warehouse request · Quotation #${detail.quotationId}`:'Warehouse request'} onClose={()=>setDetail(undefined)}>{detail&&companyId&&<AvailabilityDetails key={detail.id+':'+detail.version} value={detail} companyId={companyId} onSaved={v=>{setDetail(v);setRows(old=>old?.map(r=>r.id===v.id?{...r,status:v.status,version:v.version,assigned_store_id:v.assignedStoreId}:r));}}/>}</Drawer>
 </Card>;
}
export function QuoteAvailability({quoteId,version,required=false}:{quoteId:number;version:number;required?:boolean}){
 const api=useApi();const [value,setValue]=useState<Availability|null>(),[error,setError]=useState<unknown>(),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;void api.data<Availability|null>('GET',`/api/crm/quotations/${quoteId}/availability`).then(v=>{if(active)setValue(v);}).catch(e=>{if(active)setError(e);});return()=>{active=false;};},[api,quoteId,version,revision]);
 if(error)return <ErrorState error={error} onRetry={()=>setRevision(n=>n+1)}/>;if(!value)return required?<Notice tone="warning" title="Warehouse request required">Select the selling company in the header and save this draft to request a warehouse check before commercial submission.</Notice>:null;
 return <Card title="Warehouse availability" actions={<Button variant="ghost" onClick={()=>setRevision(n=>n+1)}>Refresh stock check</Button>}><div className="stack"><Badge tone={value.status==='AVAILABILITY_APPROVED'&&value.ready?'success':'warning'}>{human(value.status)}</Badge><p>Quote version {value.quotationVersion}. Current evidence: {value.ready?'Every line verified':'Review required'}. Commercial approval requires a current independent warehouse decision.</p><AvailabilityLines lines={value.lines}/><p className="muted">Warehouse shortages require receiving and refreshed verified stock evidence. A supplier PO alone cannot establish stock.</p></div></Card>;
}
function AvailabilityLines({lines}:{lines:AvailabilityLine[]}){return <div className="stack">{lines.map(l=><section key={l.id} className="stack-sm"><h3>{l.sourceLineId} · {l.partCode}</h3><p>{l.description}</p><p>Required <strong>{formatQty(l.quantity)} {l.uom}</strong> · Warehouse {l.warehouse??'Not selected'}</p><p>Verified available {amount(l.availableQuantity)} · Source reserved {amount(l.sourceReserved)} · Other CRM holds {amount(l.localReserved)} · Shortage {amount(l.shortageQuantity)}</p><p className="muted">Source {human(l.sourceStatus)} · {l.sourceTimestamp?formatDateTime(l.sourceTimestamp):'No verified stock timestamp'}</p>{l.issues.length>0&&<ul>{l.issues.map(i=><li key={i}>{human(i)}</li>)}</ul>}</section>)}</div>;}
function AvailabilityDetails({value:v,companyId,onSaved}:{value:Availability;companyId:string;onSaved:(v:Availability)=>void}){
 const api=useApi(),{can,state}=useSession();const me=state.kind==='ready'?state.user.id:null;
 const [reason,setReason]=useState(''),[staff,setStaff]=useState<{id:number;name:string}[]>([]),[assigned,setAssigned]=useState(v.assignedStoreId?String(v.assignedStoreId):''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 const [checks,setChecks]=useState(()=>Object.fromEntries(v.lines.map(l=>[l.id,{warehouse:l.warehouse??'',quantity:l.checkedQuantity??'',evidence:l.evidence??''}])));
 useEffect(()=>{if(!can('logistics.assignment.manage'))return;void api.data<{id:number;name:string}[]>('GET','/api/crm/logistics/store-staff').then(setStaff).catch(setError);},[api,can]);
 const submit=async(action:string)=>{setBusy(true);setError(undefined);try{onSaved(await api.data<Availability>('POST',`${base}/${v.id}`,{version:v.version,action,reason,...(action==='ASSIGN'?{assignedStoreId:Number(assigned)}:{}),...(action==='CHECK'?{lines:Object.entries(checks).map(([id,l])=>({id,...l}))}:{})},{query:{companyId}}));}catch(e){setError(e);}finally{setBusy(false);}};
 const current=!['INVALIDATED','CANCELLED'].includes(v.status),write=current&&v.status!=='AVAILABILITY_APPROVED';
 return <div className="stack-lg"><Badge tone={v.status==='AVAILABILITY_APPROVED'?'success':'warning'}>{human(v.status)}</Badge><Notice tone="info" title="Operational stock review">A staff check cannot create stock. Availability must reconcile to current item and warehouse balances from the retained source.</Notice><AvailabilityLines lines={v.lines}/>
  {can('quotations.read')&&<Link href={`/quotations/${v.quotationId}`}>Open the linked quotation</Link>}
  {can('purchasing.read')&&<Link href="/purchasing">Open existing procurement and receiving workflows</Link>}
  {error!==undefined&&<ErrorState error={error}/>}
  {current&&<TextAreaField label="Warehouse action reason" value={reason} onChange={e=>setReason(e.target.value)}/>}
  {write&&can('logistics.assignment.manage')&&<div className="stack"><SelectField label="Assigned Store staff" value={assigned} placeholder="Select Store staff" options={staff.map(s=>({value:String(s.id),label:s.name}))} onChange={e=>setAssigned(e.target.value)}/><Button disabled={busy||!assigned||reason.trim().length<3} onClick={()=>void submit('ASSIGN')}>Assign warehouse check</Button></div>}
  {write&&v.assignedStoreId===me&&can('logistics.evidence.write')&&<Card title="Record checks for every line"><div className="stack-lg">{v.lines.map(l=><div key={l.id} className="stack"><h3>{l.partCode}</h3><SelectField label={`Warehouse ${l.sourceLineId}`} value={checks[l.id].warehouse} placeholder="Select verified warehouse" options={l.warehouses.map(w=>({value:w.key,label:`${w.key} · ${w.free} ${l.uom} source free`}))} onChange={e=>setChecks(c=>({...c,[l.id]:{...c[l.id],warehouse:e.target.value}}))}/><TextField label={`Checked quantity ${l.sourceLineId}`} value={checks[l.id].quantity} onChange={e=>setChecks(c=>({...c,[l.id]:{...c[l.id],quantity:e.target.value}}))}/><TextAreaField label={`Evidence reference ${l.sourceLineId}`} value={checks[l.id].evidence} onChange={e=>setChecks(c=>({...c,[l.id]:{...c[l.id],evidence:e.target.value}}))}/></div>)}<Button disabled={busy||reason.trim().length<3} onClick={()=>void submit('CHECK')}>Save warehouse checks</Button></div></Card>}
  {current&&can('logistics.grn.post')&&<div className="cluster"><Button disabled={busy||v.status!=='READY_FOR_REVIEW'||!v.ready||reason.trim().length<3} onClick={()=>void submit('APPROVE')}>Approve availability and reserve stock</Button><Button variant="secondary" disabled={busy||reason.trim().length<3} onClick={()=>void submit('RETURN')}>Invalidate and release for quotation revision</Button></div>}
  <Card title="Warehouse history"><Timeline items={v.events.map((e,i)=>({id:i,title:human(e.action),at:e.created_at,by:'Staff #'+e.actor_id,body:e.reason}))}/></Card>
 </div>;
}
