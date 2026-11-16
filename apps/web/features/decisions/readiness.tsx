'use client';
import Link from 'next/link';
import {useEffect,useMemo,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {useSession} from '@/lib/session';
import {Card,ErrorState,Meter} from '@/components/ds';
import {decisionsApi,type DecisionsResponse} from './api';

/** Owner dashboard reads the same live register as /decisions; it never substitutes guessed counts. */
export function DecisionsReadiness(){
 const api=useApi(),client=useMemo(()=>decisionsApi(api),[api]),{state,can}=useSession(),owner=state.kind==='ready'&&state.user.role==='OWNER'&&can('rules.manage');
 const [data,setData]=useState<DecisionsResponse>(),[error,setError]=useState<unknown>();
 useEffect(()=>{if(!owner)return;const abort=new AbortController();client.list(abort.signal).then(setData).catch(reason=>{if(!abort.signal.aborted)setError(reason);});return()=>abort.abort();},[client,owner]);
 if(!owner)return null;
 return <Card title="Business decisions" actions={<Link href="/decisions" className="ds-button" data-variant="link">Review decisions</Link>}><div className="stack">{Boolean(error)?<ErrorState error={error}/>:!data?<p role="status">Reading decision readiness...</p>:<><Meter label="Decisions confirmed" value={data.summary.confirmedPercent}/><p>{data.summary.confirmed} of {data.summary.total} confirmed; {data.summary.blocked} awaiting confirmation. This measures configuration, not production readiness.</p>{data.summary.onlyOneOwner&&<p>Only one active Owner is available. Review account coverage in <Link href="/users">Users &amp; roles</Link>.</p>}<ul>{data.data.filter(row=>row.status!=='CONFIRMED').slice(0,5).map(row=><li key={row.key}><Link href={`/decisions?key=${encodeURIComponent(row.key)}`}>{row.plainQuestion}</Link><span className="ds-cell-secondary"> — blocks: {row.blockedWorkflows.join(', ')}</span></li>)}</ul></>}</div></Card>;
}
