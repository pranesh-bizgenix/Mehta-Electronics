'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {useSession} from '@/lib/session';
import {Notice} from '@/components/ds';

export function TallyWriteLiveBanner(){
 const api=useApi(),{state}=useSession(),[live,setLive]=useState<{live:boolean;categories?:{category:string;company_id:string}[]}|null>(null);
 useEffect(()=>{if(state.kind!=='ready'||state.user.mustChangePassword)return;let active=true;const load=()=>api.data<typeof live>('GET','/api/tally-write/banner').then(value=>{if(active)setLive(value);}).catch(()=>{if(active)setLive(null);});void load();const timer=setInterval(()=>void load(),15000);return()=>{active=false;clearInterval(timer);};},[api,state.kind,state.kind==='ready'&&state.user.mustChangePassword]);
 if(!live?.live)return null;
 return <Notice tone="warning"><strong>Tally CREATE writes are live.</strong> {live.categories?.map(c=>`${c.category} (${c.company_id})`).join(', ')}. {state.kind==='ready'&&state.user.role==='OWNER'&&<Link href="/tally/write">Review settings, monitor or turn OFF</Link>}</Notice>;
}
