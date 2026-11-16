'use client';
import Link from 'next/link';
import {useState} from 'react';
import {WriteMonitorSummary} from '@/features/tally-write/monitor-summary';
import {useApi} from '@/lib/api/provider';
import {useScope} from '@/lib/scope';
import {useSession} from '@/lib/session';
import {formatDateTime} from '@/lib/format';
import {Button,Card,CardSkeleton,DataTable,EmptyState,ErrorState,PageHeader,TextField,UnauthorizedState,useAsync,useToast} from '@/components/ds';

type Job={id:string;status:string;message:string|null;record_count:number;started_at:string;last_progress_at:string};
type Upload={id:string;status:string;created_at:string;retained_payloads:number;indexed_datasets:number;incomplete_datasets:number;deliveryState:string;indexState:string};
type Connector={id:string;profile_name:string;paired:boolean;connectionState:string;agent_version:string|null;heartbeat_at:string|null;tally_available:boolean|null};
type Request={id:string;status:string;created_at:string;error_code:string|null};
type MonitorData={company:{id:string;display_name:string};asOf:string;connectors:Connector[];jobs:Job[];uploads:Upload[];requests:Request[];queue:{pendingReadRequests:number;failedReadRequests:number;inProgressUploads:number;connectorLocalQueueDepth:null;note:string};capabilities:{requestRead:boolean;payloads:boolean};note:string};
type Payload={id:string;dataset:string;received_at:string;bytes:number};
export default function SyncMonitorPage(){
 const {state,can}=useSession(),{companyId,companies}=useScope();
 if(state.kind==='loading')return <CardSkeleton/>;
 if(!can('tally.read'))return <UnauthorizedState/>;
 const company=companies.find(c=>c.id===companyId);
 return company?<Monitor key={company.id} companyId={company.id}/>:<EmptyState title="Select a company">Choose the imported source company in the header.</EmptyState>;
}
function Monitor({companyId}:{companyId:string}){
 const api=useApi(),toast=useToast(),[version,setVersion]=useState(0),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[actionError,setActionError]=useState<unknown>();
 const [state,reload]=useAsync(signal=>api.get<MonitorData>('/api/v1/tally/monitor',{query:{companyId},signal}),[api,companyId,version]);
 const data=state.status==='ready'?state.data:null;
 const run=async(job?:string)=>{if(busy)return;setBusy(true);setActionError(undefined);try{
  if(reason.trim().length<3)throw new Error('Enter a reason of at least three characters.');
  const result=await api.post<{alreadyRequested?:boolean}>('/api/v1/tally/monitor/'+(job?`jobs/${job}/retry`:'request-read'),{reason},{query:{companyId}});
  toast('success',result.alreadyRequested?'An existing pending read request will be used.':'Read requested. Wait for delivery and dataset receipts.');setVersion(v=>v+1);
 }catch(e){setActionError(e);}finally{setBusy(false);}};
 return <div className="stack-lg"><PageHeader title="Tally sync monitor" description="Pairing, reachability, delivery and indexing are separate stages." actions={<><Link className="ds-button" href="/tally/connector">Connector settings</Link><Button variant="secondary" onClick={reload}>Refresh evidence</Button></>}/>
  <WriteMonitorSummary companyId={companyId}/>
  {state.status==='error'?<ErrorState error={state.error} onRetry={reload}/>:!data?<CardSkeleton/>:<>
   <strong>Source company: {data.company.display_name} · Checked {formatDateTime(data.asOf)}</strong><p>{data.note}</p>
   <Card title="Server queues"><p>Pending read requests: {data.queue.pendingReadRequests} · Failed read requests: {data.queue.failedReadRequests} · Receiving uploads: {data.queue.inProgressUploads} · Connector local queue: Not reported</p><p>{data.queue.note}</p></Card>
   <DataTable<Connector> id="monitor-connectors" caption="Selected company connector health" rows={data.connectors} rowKey={r=>r.id} columns={[
    {key:'profile',header:'Profile',render:r=>r.profile_name},{key:'paired',header:'Pairing credential issued',render:r=>r.paired?'Yes':'Not recorded / legacy token'},{key:'state',header:'Connection evidence',render:r=>r.connectionState},{key:'version',header:'Reported version',render:r=>r.agent_version||'Not reported'},{key:'heartbeat',header:'Heartbeat',render:r=>r.heartbeat_at?formatDateTime(r.heartbeat_at):'Not received'},{key:'tally',header:'Tally reachable',render:r=>r.tally_available===null?'Unknown':r.tally_available?'Yes':'No'}
   ]}/>
   {data.capabilities.requestRead&&<Card title="Request a fresh read"><TextField label="Reason for read / retry" required value={reason} onChange={e=>setReason(e.target.value)}/><Button disabled={busy||reason.trim().length<3} onClick={()=>void run()}>Request company read</Button><p>This queues work for the existing connector. It does not mark data as synced.</p></Card>}
   {actionError!=null&&<ErrorState error={actionError}/>}
   <DataTable<Job> id="monitor-jobs" caption="Recent sync jobs (latest 30)" rows={data.jobs} rowKey={r=>r.id} columns={[
    {key:'status',header:'Recorded status',render:r=>r.status},{key:'at',header:'Started',render:r=>formatDateTime(r.started_at)},{key:'progress',header:'Last progress',render:r=>formatDateTime(r.last_progress_at)},{key:'message',header:'Reason / message',render:r=>r.message||'Not reported'},{key:'retry',header:'Recovery',render:r=>data.capabilities.requestRead&&['failed','stalled','quarantined','partial'].includes(r.status)?<Button variant="secondary" disabled={busy||reason.trim().length<3} onClick={()=>void run(r.id)}>Request retry read</Button>:'—'}
   ]}/>
   <DataTable<Upload> id="monitor-uploads" caption="Recent upload delivery and indexing (latest 30)" rows={data.uploads} rowKey={r=>r.id} columns={[
    {key:'at',header:'Received',render:r=>formatDateTime(r.created_at)},{key:'status',header:'Upload status',render:r=>r.status},{key:'delivery',header:'Delivery',render:r=>`${r.deliveryState} (${r.retained_payloads} payloads)`},{key:'index',header:'Indexing',render:r=>`${r.indexState} (${r.indexed_datasets} datasets, ${r.incomplete_datasets} incomplete)`}
   ]}/>
   <DataTable<Request> id="monitor-reads" caption="Read requests (latest 30)" rows={data.requests} rowKey={r=>r.id} columns={[{key:'at',header:'Requested',render:r=>formatDateTime(r.created_at)},{key:'status',header:'Status',render:r=>r.status},{key:'error',header:'Failure',render:r=>r.error_code||'None recorded'}]}/>
   {data.capabilities.payloads&&<Payloads companyId={companyId}/>}
  </>}
 </div>;
}
function Payloads({companyId}:{companyId:string}){
 const api=useApi();
 const [state,reload]=useAsync(signal=>api.get<{data:Payload[]}>('/api/v1/tally/retained/payloads',{query:{companyId},signal}),[api,companyId]);
 return <Card title="Retained payloads — financial access required"><DataTable<Payload> id="monitor-payloads" caption="Original retained XML" rows={state.status==='ready'?state.data.data:undefined} loading={state.status==='loading'} error={state.status==='error'?state.error:undefined} onRetry={reload} rowKey={r=>r.id} columns={[{key:'dataset',header:'Dataset',render:r=>r.dataset},{key:'at',header:'Received',render:r=>formatDateTime(r.received_at)},{key:'bytes',header:'Size (bytes)',render:r=>r.bytes},{key:'download',header:'Original',render:r=><a className="ds-button ds-button-secondary" href={`/api/v1/tally/retained/payloads/${encodeURIComponent(r.id)}/download?companyId=${encodeURIComponent(companyId)}`} download>Download XML</a>}]}/><p>Original XML downloads as an attachment in bounded chunks, including files above 16 MiB. Each request checks your session, financial access and selected company.</p></Card>;
}
