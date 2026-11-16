'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {Card,Notice} from '@/components/ds';
import {useApi} from '@/lib/api/provider';
import {useSession} from '@/lib/session';
import type {Monitor} from './api';

export function WriteMonitorSummary({companyId}:{companyId:string}){
 const api=useApi(),{can}=useSession(),[data,setData]=useState<Monitor|null>(null),[error,setError]=useState('');
 const allowed=can('tally.write.read');
 useEffect(()=>{if(!allowed)return;let current=true;const load=async()=>{try{const gate=await api.data<{active?:boolean}>('GET','/api/tally-write/banner');if(!gate.active){if(current)setData(null);return;}const result=await api.data<Monitor>('GET',`/api/tally-write/outbox?companyId=${encodeURIComponent(companyId)}`);if(current){setData(result);setError('');}}catch(e){if(current)setError(e instanceof Error?e.message:'Write monitor unavailable.');}};void load();const timer=setInterval(()=>void load(),15000);return()=>{current=false;clearInterval(timer);};},[api,companyId,allowed]);
 if(!data)return null;
 return <Card title="Tally write queue"><Link href="/tally/write">Review outbox, settings and kill switch</Link>{error&&<Notice tone="warning">{error}</Notice>}<p>{data.counts.map(c=>`${c.status}: ${c.count}; oldest ${c.oldest}`).join(' · ')||'No jobs'}</p>{data.categories.map(c=><p key={c.category}>{c.category}: {c.paused?'breaker paused':'not paused'}; failures {c.consecutive_failures}; {c.dry_run_only?'dry-run only':'live eligible'}</p>)}{data.alerts.map(a=><Notice key={a.id} tone="warning">{a.code}: {a.message}</Notice>)}</Card>;
}
