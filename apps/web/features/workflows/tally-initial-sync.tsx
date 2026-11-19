'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {useSession} from '@/lib/session';
import {formatDateTime,titleCase} from '@/lib/format';
import {Button,Card,CardSkeleton,DataTable,EmptyState,ErrorState} from '@/components/ds';

type Progress={asOf:string;note:string;connectors:{id:string;profile_name:string;expected_company_name:string;heartbeat_at:string|null;tally_available:boolean|null}[];jobs?:{id:string;company_name:string;status:string;message:string|null;last_progress_at:string|null}[];uploads:{id:string;company_name:string;status:string;received_chunks:number;last_progress_at:string|null;message:string|null}[]};
export function TallyInitialSync(){
 const api=useApi(),{can}=useSession();
 const [data,setData]=useState<Progress>(),[error,setError]=useState<unknown>(),[version,setVersion]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();let busy=false;
  const load=async()=>{if(busy)return;busy=true;try{const result=await api.get<Progress>('/api/v1/tally/monitor/initial',{signal:controller.signal});if(!controller.signal.aborted){setData(result);setError(undefined);}}catch(e){if(!controller.signal.aborted)setError(e);}finally{busy=false;}};
  void load();const timer=setInterval(()=>void load(),15000);
  return()=>{controller.abort();clearInterval(timer);};
 },[api,version]);
 return <Card title="Tally import progress" actions={<><Button variant="secondary" onClick={()=>setVersion(v=>v+1)}>Refresh progress</Button>{can('tally.connector.manage')&&<Link href="/tally/connector">Connection details</Link>}</>}>
  {Boolean(error)&&<ErrorState error={error} onRetry={()=>setVersion(v=>v+1)}/>}
  {!data&&!error?<CardSkeleton/>:data&&<div className="stack">
   <p>{data.note}</p><p>Updates every 15 seconds. Last checked: {formatDateTime(data.asOf)}.</p>
   {data.connectors.map(c=><div key={c.id}><strong>{c.expected_company_name}</strong><p>Tally: {c.tally_available===true?'Reachable at last heartbeat':c.tally_available===false?'Unavailable at last heartbeat':'Not reported'}. Last heartbeat: {c.heartbeat_at?formatDateTime(c.heartbeat_at):'Not received'}. Upload activity is listed separately below.</p></div>)}
   {data.jobs&&<DataTable<NonNullable<Progress['jobs']>[number]> id="initial-tally-jobs" caption="Collection and import jobs" rows={data.jobs} rowKey={r=>r.id} columns={[
    {key:'company',header:'Company',render:r=>r.company_name},
    {key:'status',header:'Job status',render:r=>titleCase(r.status)},
    {key:'stage',header:'Current stage or error',render:r=>r.message||'Upload in progress; see received chunks below'},
    {key:'activity',header:'Last activity',render:r=>r.last_progress_at?formatDateTime(r.last_progress_at):'Not reported'}
   ]}/>}
   <DataTable<Progress['uploads'][number]> id="initial-tally-uploads" caption="Uploads received by this CRM" rows={data.uploads} rowKey={r=>r.id} columns={[
    {key:'company',header:'Company',render:r=>r.company_name},
    {key:'status',header:'Upload status',render:r=>titleCase(r.status)},
    {key:'chunks',header:'Chunks received',render:r=>r.received_chunks},
    {key:'activity',header:'Last upload activity',render:r=>r.last_progress_at?formatDateTime(r.last_progress_at):'Not reported'},
    {key:'message',header:'Details',render:r=>r.message||'Awaiting completed import'}
   ]} empty={<EmptyState title="No upload received">The connector must deliver a package to this CRM before records can be displayed.</EmptyState>}/>
  </div>}
 </Card>;
}
