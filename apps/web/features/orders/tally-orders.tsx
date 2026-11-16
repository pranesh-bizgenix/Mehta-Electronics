'use client';
import {useMemo,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {useScope,type Company} from '@/lib/scope';
import type {ApiClient,Paginated} from '@/lib/api/client';
import {DataTable,EmptyState,SelectField,useAsync} from '@/components/ds';
import {titleCase} from '@/lib/format';
import {TallyOrderDrawer} from './tally-order-drawer';
import {StoredOrderComparison} from '@/features/order-comparison/stored-comparison';
interface OrderRow {id:string;company_id:string;voucher_type:string;voucher_number:string|null;party_name:string|null;date:string|null;status:string|null;observed_at:string;has_raw:boolean}
interface Listing extends Paginated<OrderRow> {company:Company;readOnly:true}
export const tallyOrdersApi=(client:ApiClient)=>({list:(companyId:string,page:number,search:string,kind:string,signal:AbortSignal)=>client.get<Listing>('/api/crm/tally-orders',{query:{companyId,page,search,kind},signal})});
export function TallyOrders({refreshVersion}:{refreshVersion:number}){
 const {companies,companyId}=useScope(),company=companies.find(c=>c.id===companyId);
 if(!company)return <EmptyState title="Select a company to view Tally orders">Choose an imported company in the header. Orders from all companies are never combined.</EmptyState>;
 return <CompanyOrders key={company.id} company={company} refreshVersion={refreshVersion}/>;
}
function CompanyOrders({company,refreshVersion}:{company:Company;refreshVersion:number}){
 const client=useApi(),api=useMemo(()=>tallyOrdersApi(client),[client]);
 const [selected,setSelected]=useState<string|null>(null);
 const [page,setPage]=useState(1),[search,setSearch]=useState(''),[kind,setKind]=useState('');
 const [state,reload]=useAsync(signal=>api.list(company.id,page,search,kind,signal),[api,company.id,page,search,kind,refreshVersion]);
 const listing=state.status==='ready'?state.data:undefined;
 return <section className="stack"><div><h2>Tally sales and purchase orders</h2><p><strong>Selected company: {company.display_name||company.name}</strong></p><p>Read-only connector records. Customer POs below follow the CRM verification and dispatch workflow.</p><StoredOrderComparison companyId={company.id}/></div><DataTable<OrderRow> id="tally-orders" caption={`Tally orders — ${company.display_name||company.name}`} rows={listing?.data} loading={state.status==='loading'} error={state.status==='error'?state.error:undefined} onRetry={reload} onRowClick={row=>setSelected(row.id)} rowKey={row=>`${row.company_id}:${row.id}`} pagination={listing?.pagination} onPage={setPage} search={{value:search,onChange:value=>{setSearch(value);setPage(1);},placeholder:'Search voucher number or party'}} filters={<SelectField label="Document type" value={kind} options={[{value:'',label:'All order types'},{value:'sales_orders',label:'Sales orders'},{value:'purchase_orders',label:'Purchase orders'}]} onChange={e=>{setKind(e.target.value);setPage(1);}}/>} columns={[{key:'type',header:'Type',render:row=>row.voucher_type},{key:'number',header:'Tally number',render:row=>row.voucher_number||'—'},{key:'party',header:'Party',render:row=>row.party_name||'—'},{key:'date',header:'Date',render:row=>row.date||'—'},{key:'status',header:'Tally status',render:row=>row.status?titleCase(row.status):'Not reported'}]} empty={<EmptyState title={search?'No matching Tally orders':'No Tally orders for this company'}>{search?'Try another voucher number or party.':'No Sales Order or Purchase Order vouchers have been imported for the selected company.'}</EmptyState>}/>{selected&&<TallyOrderDrawer key={`${company.id}:${selected}`} id={selected} companyId={company.id} onClose={()=>setSelected(null)}/>}</section>;
}
