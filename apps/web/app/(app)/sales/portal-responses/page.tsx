'use client';
import Link from 'next/link';
import {useCallback,useEffect,useState} from 'react';
import {Badge,Button,Card,DataTable,ErrorState,Notice,PageHeader} from '@/components/ds';
import {useApi} from '@/lib/api/provider';
import {useSession} from '@/lib/session';
import type {Paginated,Pagination} from '@/lib/api/client';
import {formatDateTime,titleCase} from '@/lib/format';
interface Response{id:string;entity_kind:string;entity_id:number;entity_version:number;decision:string;message:string;created_at:string;customer_name:string}
export default function PartnerResponses(){
 const api=useApi(),{can}=useSession(),allowed=can('quotations.read')||can('orders.read'),[rows,setRows]=useState<Response[]>([]),[page,setPage]=useState(1),[pagination,setPagination]=useState<Pagination>(),[error,setError]=useState<unknown>();
 const load=useCallback(async()=>{if(!allowed)return;try{const r=await api.get<Paginated<Response>>('/api/crm/partner-review/acknowledgements',{query:{page}});setRows(r.data);setPagination(r.pagination);}catch(e){setError(e);}},[api,allowed,page]);useEffect(()=>{void load();},[load]);
 if(!allowed)return <Notice tone="warning">Quotation or order access is required to view customer responses.</Notice>;
 return <div className="stack-lg"><PageHeader title="Customer portal responses" description="Customer acknowledgements and requested changes to published quotations and approved orders." actions={<Button variant="secondary" onClick={()=>void load()}>Refresh responses</Button>}/><Notice tone="info">A customer response records their intention. Existing staff approval, credit, stock, dispatch and invoice controls continue to apply.</Notice><Card title="Response history"><DataTable<Response> id="customer-portal-responses" caption="Published document acknowledgements" rows={rows} pagination={pagination} onPage={setPage} rowKey={r=>r.id} columns={[{key:'customer',header:'Customer',render:r=>r.customer_name},{key:'doc',header:'Document',render:r=><Link href={r.entity_kind==='QUOTATION'?`/quotations/${r.entity_id}`:`/orders?open=${r.entity_id}`}>{titleCase(r.entity_kind)} {r.entity_id} · v{r.entity_version}</Link>},{key:'decision',header:'Customer response',render:r=><Badge>{titleCase(r.decision)}</Badge>},{key:'message',header:'Message',render:r=>r.message||'No additional message'},{key:'date',header:'Received',render:r=>formatDateTime(r.created_at)}]}/></Card>{Boolean(error)&&<ErrorState error={error}/>}</div>;
}
