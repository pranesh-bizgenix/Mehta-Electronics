'use client';
import {useEffect,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {useScope} from '@/lib/scope';
import {Button,Card,DataTable,Drawer,ErrorState,SelectField,TextField} from '@/components/ds';
import {FreshnessBadge,type DatasetFreshness} from './tally-freshness';

type Allocation={godown:string|null;destinationGodown:string|null;batch:string|null;actualQuantity:string|null;billedQuantity:string|null;trackingNumber:string|null;orderNumber:string|null};
type SourceRow={id:string;name?:string;parent?:string|null;number?:string|null;type?:string|null;date?:string|null;party?:string|null;status?:string|null;reference?:string|null;observedAt:string;dispatch?:{shippedBy:string|null;documentNumber:string|null;vesselOrVehicle:string|null};lines?:{position:number;collection:string;item:string|null;actualQuantity:string|null;billedQuantity:string|null;allocations:Allocation[]}[]};
type Result={company:{id:string;display_name:string};data:SourceRow[];freshness:DatasetFreshness[];pagination:{page:number;pages:number;total:number};note:string};
const types=['Delivery Note','Receipt Note','Stock Journal','Physical Stock','Rejections In','Rejections Out'];
const shown=(value:string|null|undefined)=>value||'Not supplied';

export function TallyLogistics(){
 const api=useApi(),{companyId,companies}=useScope();
 const [kind,setKind]=useState('godowns'),[type,setType]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
 const [result,setResult]=useState<Result>(),[detail,setDetail]=useState<{companyId:string;row:SourceRow}>(),[error,setError]=useState<unknown>(),[loading,setLoading]=useState(false);
 const identity=`${companyId}:${kind}:${type}:${search}:${page}:${revision}`,[loaded,setLoaded]=useState('');
 useEffect(()=>{
  setDetail(undefined);setError(undefined);if(!companyId)return;
  const controller=new AbortController(),timer=setTimeout(()=>{
   setLoading(true);
   api.get<Result>('/api/crm/logistics/tally',{query:{companyId,kind,type,search,page},signal:controller.signal}).then(value=>{if(!controller.signal.aborted){setResult(value);setLoaded(identity);}}).catch(e=>{if(!controller.signal.aborted)setError(e);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  },200);
  return()=>{clearTimeout(timer);controller.abort();};
 },[api,companyId,kind,type,search,page,revision,identity]);
 const visible=loaded===identity?result:undefined;
 const [opening,setOpening]=useState(false);
 useEffect(()=>{setOpening(false);},[identity]);
 const [selection,setSelection]=useState<string>();
 useEffect(()=>{
  if(!selection||!companyId)return;
  const controller=new AbortController();setOpening(true);
  api.get<{data:SourceRow}>('/api/crm/logistics/tally/'+encodeURIComponent(selection),{query:{companyId},signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setDetail({companyId,row:value.data});}).catch(e=>{if(!controller.signal.aborted)setError(e);}).finally(()=>{if(!controller.signal.aborted)setOpening(false);});
  return()=>controller.abort();
 },[api,companyId,selection]);
 useEffect(()=>{setSelection(undefined);},[identity]);
 const row=detail?.companyId===companyId?detail.row:undefined;
 return <Card title="Tally logistics & stock locations"><div className="stack">
  <p><strong>Source company: {companies.find(c=>c.id===companyId)?.display_name||'Select a company in the header'}</strong> · Read only</p>
  <p>Browse imported godowns and movement documents. These records do not post CRM receipts or dispatches.</p>
  <div className="cluster">
   <SelectField label="View" value={kind} onChange={e=>{setKind(e.target.value);setType('');setPage(1);}} options={[{value:'godowns',label:'Godowns / store locations'},{value:'documents',label:'Movement documents'}]}/>
   {kind==='documents'&&<SelectField label="Document type" value={type} onChange={e=>{setType(e.target.value);setPage(1);}} options={[{value:'',label:'All supported types'},...types.map(value=>({value,label:value}))]}/>}
   <TextField label="Search name, voucher or party" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/>
   <Button variant="secondary" onClick={()=>setRevision(v=>v+1)} disabled={!companyId||loading}>Reload imported records</Button>
  </div>
  {error!=null&&<ErrorState error={error} onRetry={()=>setRevision(v=>v+1)}/>}
  {companyId&&!visible&&!error&&<p role="status">Loading imported records…</p>}
  {visible&&<><FreshnessBadge data={visible.freshness}/><p>{visible.pagination.total} imported records. {visible.note}</p>
   <DataTable<SourceRow> id={'tally-logistics-'+kind} caption={kind==='godowns'?'Imported godowns':'Imported logistics vouchers'} rows={visible.data} rowKey={r=>r.id} onRowClick={kind==='documents'?r=>setSelection(r.id):undefined} columns={kind==='godowns'?[
    {key:'name',header:'Location',render:r=>r.name},{key:'parent',header:'Parent',render:r=>shown(r.parent)}
   ]:[{key:'number',header:'Voucher',render:r=>shown(r.number)},{key:'type',header:'Type',render:r=>r.type},{key:'date',header:'Source date',render:r=>shown(r.date)},{key:'party',header:'Party',render:r=>shown(r.party)},{key:'status',header:'Source status',render:r=>shown(r.status)}]}/>
   {!visible.data.length&&<p>No {kind==='godowns'?'godowns':'movement documents'} received for this company and filter. An updated connector run is needed to fetch missing source data.</p>}
   <div className="cluster"><Button variant="secondary" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous</Button><span>Page {page} of {Math.max(1,visible.pagination.pages)}</span><Button variant="secondary" disabled={page>=visible.pagination.pages} onClick={()=>setPage(p=>p+1)}>Next</Button></div>
  </>}
  {opening&&<p role="status">Loading source document…</p>}
  <Drawer open={Boolean(row)} title={row?.number||'Tally movement'} onClose={()=>{setDetail(undefined);setSelection(undefined);}}><div className="stack">
   <p>Source company: {companies.find(c=>c.id===companyId)?.display_name} · Read only</p>
   <p>{row?.type} · {shown(row?.date)} · {shown(row?.status)}</p><p>Party: {shown(row?.party)} · Reference: {shown(row?.reference)}</p>
   <p>Shipped by: {shown(row?.dispatch?.shippedBy)} · Shipping document: {shown(row?.dispatch?.documentNumber)} · Vessel / vehicle: {shown(row?.dispatch?.vesselOrVehicle)}</p>
   {row?.lines?.map(line=><Card key={line.position} title={line.item||'Unnamed source item'}><p>{line.collection} · Actual: {shown(line.actualQuantity)} · Billed: {shown(line.billedQuantity)}</p>{line.allocations.map((a,i)=><p key={i}>Godown: {shown(a.godown)} · Destination: {shown(a.destinationGodown)} · Batch: {shown(a.batch)} · Actual: {shown(a.actualQuantity)} · Billed: {shown(a.billedQuantity)} · Tracking: {shown(a.trackingNumber)} · Order: {shown(a.orderNumber)}</p>)}</Card>)}
   {!row?.lines?.length&&<p>No inventory lines supplied in the retained document.</p>}
  </div></Drawer>
 </div></Card>;
}
