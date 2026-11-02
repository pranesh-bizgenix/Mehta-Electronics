'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {DataTable,EmptyState,ErrorState,SelectField} from '@/components/ds';
import type {Pagination} from '@/lib/api/client';
import {formatDateTime,titleCase} from '@/lib/format';
interface Row {id:string;reference:string;title:string;status:string;updated_at:string}
export function CustomerOperations({customerId,financial}:{customerId:string;financial:boolean}){
 const api=useApi(),[kind,setKind]=useState('SUPPORT'),[page,setPage]=useState(1),[rows,setRows]=useState<{data:Row[];pagination:Pagination}>(),[error,setError]=useState<unknown>(),[loading,setLoading]=useState(false);
 useEffect(()=>{const abort=new AbortController();setLoading(true);setError(undefined);api.get<NonNullable<typeof rows>>(`/api/v1/operations/${kind}`,{query:{customerId:Number(customerId),page},signal:abort.signal}).then(setRows).catch(e=>{if(!abort.signal.aborted)setError(e);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();},[api,customerId,kind,page]);
 return <div className="stack"><div className="cluster"><SelectField label="Customer workflow" value={kind} onChange={e=>{setKind(e.target.value);setPage(1);}} options={['SUPPORT','WARRANTY','RETURN','INTAKE',...(financial?['INVOICE','COLLECTION','RECEIPT','PAYMENT']:[])].map(value=>({value,label:titleCase(value)}))}/><Link href={`/contracts?customerId=${customerId}`}>Customer rate contracts</Link><Link href={`/operations?kind=${kind}&customerId=${customerId}`}>Open workflow</Link></div>{Boolean(error)&&<ErrorState error={error}/>}<DataTable<Row> id="customer-operations" caption="Customer records" rows={rows?.data} rowKey={r=>r.id} loading={loading} pagination={rows?.pagination} onPage={setPage} empty={<EmptyState title="No records for this customer">Only records linked to this customer ID appear here.</EmptyState>} columns={[{key:'reference',header:'Reference',render:r=><Link href={`/operations?kind=${kind}&open=${r.id}`}>{r.reference}</Link>},{key:'title',header:'Title',render:r=>r.title},{key:'status',header:'Status',render:r=>titleCase(r.status)},{key:'updated',header:'Updated',render:r=>formatDateTime(r.updated_at)}]}/></div>;
}
