'use client';
import {useEffect,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {Badge} from '@/components/ds';
export interface DatasetFreshness {dataset:string;lastSuccessfulSync:string|null;sourceTimestamp:string|null;ageSeconds:number|null;state:string;latestAttempt:{status:string;at:string|null}|null;note:string}
const time=(value:string|null)=>value?new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'Not reported';
export function FreshnessBadge({data}:{data:DatasetFreshness[]}){
 return <details className="ds-cell-secondary"><summary><Badge tone="warning">Source freshness unverified</Badge> · Sync age and evidence</summary><p>Last import time does not prove that Tally is current.</p>{data.map(row=><p key={row.dataset}><strong>{row.dataset}</strong> · Last successful import: {time(row.lastSuccessfulSync)} · Age: {row.ageSeconds===null?'Unknown':`${Math.floor(row.ageSeconds/60)} min`} · Source timestamp: {time(row.sourceTimestamp)} · Latest attempt: {row.latestAttempt?.status||'No receipt'}</p>)}</details>;
}
export function CompanyFreshness({companyId}:{companyId:string}){
 const api=useApi(),[data,setData]=useState<DatasetFreshness[]>(),[failed,setFailed]=useState(false),[version,setVersion]=useState(0);
 useEffect(()=>{const timer=setInterval(()=>setVersion(value=>value+1),30000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{const controller=new AbortController();api.get<{data:DatasetFreshness[]}>('/api/v1/tally/visibility/freshness',{query:{companyId},signal:controller.signal}).then(result=>{if(!controller.signal.aborted){setData(result.data);setFailed(false);}}).catch(()=>{if(!controller.signal.aborted)setFailed(true);});return()=>controller.abort();},[api,companyId,version]);
 if(failed)return <p role="status">Sync freshness could not be checked. Stored data may be out of date.</p>;
 return data?<FreshnessBadge data={data}/>:<p role="status">Checking sync freshness…</p>;
}
