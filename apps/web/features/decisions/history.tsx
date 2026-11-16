'use client';
import {useEffect,useMemo,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {DataTable,ErrorState} from '@/components/ds';
import {decisionsApi,type DecisionHistoryEntry} from './api';
import {describeDecisionValue} from './presentation';

export function DecisionHistory({decisionKey}:{decisionKey:string}){
 const api=useApi(),client=useMemo(()=>decisionsApi(api),[api]),[rows,setRows]=useState<DecisionHistoryEntry[]>(),[error,setError]=useState<unknown>();
 useEffect(()=>{const abort=new AbortController();setRows(undefined);setError(undefined);client.history(decisionKey,abort.signal).then(setRows).catch(reason=>{if(!abort.signal.aborted)setError(reason);});return()=>abort.abort();},[client,decisionKey]);
 return <section className="stack"><h3>Decision history</h3><p>Latest 100 versions, newest first. Earlier answers remain in the audit history.</p>{Boolean(error)?<ErrorState error={error}/>:<DataTable id="decision-history" caption="Retained decision versions" rows={rows} loading={!rows} rowKey={row=>row.version} columns={[{key:'version',header:'Version',render:row=>row.version},{key:'status',header:'Status',render:row=>row.status},{key:'answer',header:'Answer',render:row=>describeDecisionValue(row.value)},{key:'reason',header:'Reason and evidence',render:row=><span>{row.reason}<br/>{row.evidenceSource??'No evidence recorded'}</span>},{key:'at',header:'Saved',render:row=>new Date(row.at).toLocaleString()}]}/>}</section>;
}
