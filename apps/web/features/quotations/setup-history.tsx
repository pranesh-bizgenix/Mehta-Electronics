'use client';
import {useEffect,useMemo,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {Notice} from '@/components/ds';
import {formatDate} from '@/lib/format';
import {quotationsApi,type PricingEvent} from './api';

function describe(value:unknown):string {
 if(value==null)return 'Not set';
 if(typeof value==='string')return value;
 const p=value as {floor_percent?:string;margin_basis?:string;seller_state?:string;letterhead?:Record<string,string>};
 return [`Margin floor: ${p.floor_percent}%`, `Applies to: ${p.margin_basis}`, `Seller state: ${p.seller_state}`, ...Object.entries(p.letterhead??{}).map(([key,v])=>`${key}: ${v||'Not set'}`)].join(' · ');
}
export function SetupHistory({itemId,revision}:{itemId?:string;revision:number}) {
 const client=useApi(),api=useMemo(()=>quotationsApi(client),[client]);
 const [rows,setRows]=useState<PricingEvent[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let live=true;setLoading(true);setError('');api.pricingHistory(itemId).then(data=>{if(live)setRows(data);}).catch(e=>{if(live)setError(e instanceof Error?e.message:'Could not load history.');}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[api,itemId,revision]);
 return <section className="stack"><h3>Change history</h3>{loading?<p>Loading history…</p>:error?<Notice tone="danger">{error}</Notice>:!rows.length?<p>No recorded changes.</p>:rows.map(row=><article className="stack" key={row.id}><strong>{row.actor} · {formatDate(row.created_at)} · {new Date(row.created_at).toLocaleTimeString()}</strong><p>{row.reason}</p><p className="break-words">Before: {describe(row.private_detail.before)}</p><p className="break-words">After: {describe(row.private_detail.after)}</p></article>)}</section>;
}
