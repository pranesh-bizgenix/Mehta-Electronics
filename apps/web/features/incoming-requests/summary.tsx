'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {Card,EmptyState,ErrorState} from '@/components/ds';
import {useApi} from '@/lib/api/provider';
import {useScope} from '@/lib/scope';
import {useSession} from '@/lib/session';
import {intakeApi,type IntakeRow} from './api';
export function SalesIntakeSummary(){
 const api=useApi(),{can}=useSession(),{companyId}=useScope(),[rows,setRows]=useState<IntakeRow[]>(),[total,setTotal]=useState<number>(),[error,setError]=useState<unknown>();
 useEffect(()=>{setRows(undefined);setTotal(undefined);if(!companyId||!can('sales_intake.read'))return;let active=true;void intakeApi(api,companyId).list({page:1}).then(r=>{if(active){setRows(r.data);setTotal(r.pagination.total);}}).catch(e=>{if(active)setError(e);});return()=>{active=false;};},[api,can,companyId]);
 if(!can('sales_intake.read'))return null;
 return <Card title="Incoming sales requests" actions={<Link href="/incoming-requests">Open request inbox</Link>}>{error?<ErrorState error={error}/>:!companyId?<p>Select the selling company above.</p>:!rows?<p role="status">Loading saved requests...</p>:rows.length===0?<EmptyState title="No saved requests">Fictional examples are available in the inbox sample walkthrough.</EmptyState>:<div className="stack"><p>{total} saved request{total===1?'':'s'} in your permitted queue.</p>{rows.slice(0,5).map(r=><div key={r.id}><Link href={`/incoming-requests?requestId=${r.id}`}>{r.buyer_name??'Customer matching required'} · {r.message_type.replaceAll('_',' ')}</Link><p className="muted">{r.status.replaceAll('_',' ')} · {r.assigned_name??'Unassigned'} · {r.blockers.length} preparation blocker{r.blockers.length===1?'':'s'}</p></div>)}</div>}</Card>;
}
