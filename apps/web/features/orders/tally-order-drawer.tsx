'use client';
import {useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {Button,CardSkeleton,DataTable,Drawer,ErrorState,useAsync} from '@/components/ds';
import {FreshnessBadge,type DatasetFreshness} from '@/features/workflows/tally-freshness';
interface Line {position:number;item:string|null;description:string|null;actualQuantity:string|null;billedQuantity:string|null;pendingQuantity:string|null;dueDate:string|null;rate?:string|null;amount?:string|null}
interface Detail {company:{id:string;name:string};financial:boolean;freshness:DatasetFreshness[];data:{type:string;number:string|null;party:string|null;date:string|null;status:string|null;effectiveDate:string|null;reference:string|null;referenceDate:string|null;observedAt:string;lines:Line[];linesAvailable:boolean;totals?:Record<string,string|null>;currency?:string|null;originalPayload:{path:string;dataset:string}|null;note:string}}
const text=(value:string|null|undefined)=>value||'Not supplied';
const date=(value:string|null|undefined)=>value&&/^\d{8}$/.test(value)?`${value.slice(6)}/${value.slice(4,6)}/${value.slice(0,4)}`:text(value);
export function TallyOrderDrawer({id,companyId,onClose}:{id:string;companyId:string;onClose:()=>void}){
 const api=useApi(),[raw,setRaw]=useState<string>(),[rawError,setRawError]=useState<unknown>(),[rawBusy,setRawBusy]=useState(false);
 const [state,reload]=useAsync(signal=>api.get<Detail>(`/api/crm/tally-orders/${encodeURIComponent(id)}`,{query:{companyId},signal}),[api,id,companyId]);
 const detail=state.status==='ready'?state.data:null,data=detail?.data;
 const original=async()=>{if(!data?.originalPayload)return;setRawBusy(true);setRawError(undefined);try{const result=await api.get<{data:{content:string}}>(data.originalPayload.path,{query:{companyId}});setRaw(result.data.content);}catch(error){setRawError(error);}finally{setRawBusy(false);}};
 return <Drawer open title={data?`${data.type} ${data.number||''}`:'Tally order'} onClose={onClose} description="Read-only imported voucher">
  {state.status==='error'?<ErrorState error={state.error} onRetry={reload}/>:!detail||!data?<CardSkeleton/>:<div className="stack">
   <strong>Source company: {detail.company.name}</strong><FreshnessBadge data={detail.freshness}/>
   <dl className="ds-facts">{[['Party',data.party],['Voucher date',date(data.date)],['Effective date',date(data.effectiveDate)],['Reference',data.reference],['Reference date',date(data.referenceDate)],['Source status',data.status],['Imported at',new Date(data.observedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{text(value)}</dd></div>)}</dl>
   <h3>Items and quantities</h3><p>{data.note}</p>{!data.linesAvailable&&<p>The original parsed voucher is unavailable for this snapshot. Re-import is needed to inspect its lines.</p>}
   <DataTable<Line> id="tally-order-lines" caption="Imported order lines" rows={data.lines} rowKey={line=>String(line.position)} columns={[
    {key:'item',header:'Item',render:line=>text(line.item)},{key:'description',header:'Description',render:line=>text(line.description)},
    {key:'quantity',header:'Actual quantity',render:line=>text(line.actualQuantity)},{key:'billed',header:'Billed quantity',render:line=>text(line.billedQuantity)},
    {key:'pending',header:'Pending quantity (source)',render:line=>text(line.pendingQuantity)},{key:'due',header:'Due date',render:line=>date(line.dueDate)},
    ...(detail.financial?[{key:'rate',header:'Rate (source)',render:(line:Line)=>text(line.rate)},{key:'amount',header:'Amount (source)',render:(line:Line)=>text(line.amount)}]:[])
   ]}/>
   {detail.financial&&data.totals&&<><h3>Delivered totals {data.currency||''}</h3><dl className="ds-facts">{Object.entries(data.totals).map(([key,value])=><div key={key}><dt>{key.replace(/([A-Z])/g,' $1')}</dt><dd>{text(value)}</dd></div>)}</dl></>}
   {data.originalPayload&&<Button variant="secondary" disabled={rawBusy} onClick={()=>void original()}>{rawBusy?'Loading original…':'Open original XML payload'}</Button>}
   {Boolean(rawError)&&<ErrorState error={rawError}/>} {raw!==undefined&&<details open><summary>Original XML</summary><pre className="tally-raw-view">{raw}</pre></details>}
  </div>}
 </Drawer>;
}
