'use client';
import {useEffect,useState} from 'react';
import {Notice} from '@/components/ds';
import {useApi} from '@/lib/api/provider';
import type {Category} from './api';

interface Readiness {
 company:{id:string;name:string};observedAt:string;
 connection:'AVAILABLE'|'UNKNOWN_OR_OFFLINE';writeCapability:'RECENTLY_OBSERVED'|'UNKNOWN';
 categories:{category:Category;status:'BLOCKED'|'REQUIRES_DOCUMENT_VALIDATION';blockers:string[]}[];
 unsupported:{record:string;reason:string}[];note:string;
}
const labels:Record<Category,string>={SALES_ORDER:'Sales orders',PURCHASE_ORDER:'Operational supplier purchase orders',PARTY_LEDGER:'Party ledgers'};

export function PostingReadiness({companyId}:{companyId:string|null}){
 const api=useApi();
 const [state,setState]=useState<{data?:Readiness;error?:string}>({});
 useEffect(()=>{
  let cancelled=false;setState({});
  if(companyId)void api.data<Readiness>('GET',`/api/tally-write/readiness?companyId=${encodeURIComponent(companyId)}`).then(data=>{if(!cancelled)setState({data});}).catch(error=>{if(!cancelled)setState({error:error instanceof Error?error.message:'Readiness could not be loaded.'});});
  return()=>{cancelled=true;};
 },[api,companyId]);
 if(!companyId)return <Notice tone="warning">Select a company to check posting readiness.</Notice>;
 if(state.error)return <Notice tone="danger">{state.error}</Notice>;
 if(!state.data)return <p role="status">Checking posting readiness…</p>;
 const data=state.data;
 return <section className="ds-card stack" aria-label="CRM to Tally posting readiness">
  <h2>What can CRM send to Tally?</h2>
  <p><strong>Tally connection:</strong> {data.connection==='AVAILABLE'?'Recent heartbeat; Tally reported available':'Not verified or offline'}. <strong>Write protocol:</strong> {data.writeCapability==='RECENTLY_OBSERVED'?'Recently observed':'Not yet verified'}.</p>
  <p>A running connector does not mean every CRM record is posted.</p>
  {data.categories.map(row=><details key={row.category}><summary>{labels[row.category]} — {row.status==='BLOCKED'?'Posting blocked':'Configuration checks passed; document validation required'}</summary>{row.blockers.length>0&&<ul>{row.blockers.map((text,index)=><li key={index}>{text}</li>)}</ul>}</details>)}
  <h3>Additional posting development required</h3>
  <ul>{data.unsupported.map(row=><li key={row.record}><strong>{row.record}:</strong> {row.reason}</li>)}</ul>
  <p className="muted">{data.note}</p>
  <p className="muted">Observed {new Date(data.observedAt).toLocaleString()}. Reload after changing posting settings or connector state.</p>
 </section>;
}
