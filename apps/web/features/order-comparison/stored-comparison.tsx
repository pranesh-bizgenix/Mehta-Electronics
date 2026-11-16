'use client';
import {useRef,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {useSession} from '@/lib/session';
import {Button,Checkbox,Combobox,Drawer,ErrorState,Notice,SelectField,useAsync,type Option} from '@/components/ds';
import {ComparisonResult,type OrderComparisonResult} from './comparison-result';

interface TallyOption {id:string;voucher_number:string|null;party_name:string|null;status:string|null}
interface CustomerOption {id:number;poNumber:string;customer_name:string;status:string}
interface Result {data:OrderComparisonResult;sources:{salesOrder:{number:string|null;snapshotId:string};purchaseOrder:{number:string|null;version?:number;snapshotId?:string}};note:string}

export function StoredOrderComparison({companyId}:{companyId:string}){
 const api=useApi(),{state,can}=useSession();
 const [open,setOpen]=useState(false);
 const role=state.kind==='ready'?state.user.role:null;
 if(!['OWNER','ACCOUNTS'].includes(role??'')||!can('tally.read'))return null;
 return <><Button variant="secondary" onClick={()=>setOpen(true)}>Compare order documents</Button>{open&&<ComparisonForm key={companyId} companyId={companyId} onClose={()=>setOpen(false)} customerAllowed={can('orders.read')}/>}</>;
}

function ComparisonForm({companyId,onClose,customerAllowed}:{companyId:string;onClose:()=>void;customerAllowed:boolean}){
 const api=useApi();
 const [availability,reloadAvailability]=useAsync(signal=>api.get<{enabled:boolean}>('/api/crm/order-comparison/status',{signal}),[api]);
 const [mode,setMode]=useState('SUPPLIER_PO'),[sales,setSales]=useState<Option|null>(null),[purchase,setPurchase]=useState<Option|null>(null),[reviewed,setReviewed]=useState(false);
 const [result,setResult]=useState<Result>(),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false);
 const revision=useRef(0);
 const reset=()=>{revision.current++;setResult(undefined);setError(undefined);};
 const searchTally=async(term:string,kind:string)=>(await api.get<{data:TallyOption[]}>('/api/crm/tally-orders',{query:{companyId,kind,search:term,pageSize:50}})).data.map(row=>({value:row.id,label:`${row.voucher_number||row.id} · ${row.party_name||'Party not supplied'}`,hint:row.status||'Status not supplied'}));
 const searchCustomer=async(term:string)=>(await api.get<{data:CustomerOption[]}>('/api/crm/orders',{query:{search:term}})).data.map(row=>({value:String(row.id),label:`${row.poNumber} · ${row.customer_name}`,hint:`${row.status}; must be bound to the selected company`}));
 const compare=async()=>{
  const current=revision.current;setBusy(true);setResult(undefined);setError(undefined);
  try{
   const value=await api.post<Result>('/api/crm/order-comparison',{mode,salesOrderKey:sales?.value,...(mode==='SUPPLIER_PO'?{purchaseOrderKey:purchase?.value}:{customerOrderId:Number(purchase?.value)}),netExTaxConfirmed:reviewed},{query:{companyId}});
   if(current===revision.current)setResult(value);
  }catch(e){if(current===revision.current)setError(e);}finally{setBusy(false);}
 };
 return <Drawer open title="Compare order documents" onClose={onClose} description="Review selected stored records without changing either order">
  <div className="stack">
   <Notice>Select the documents deliberately. Matching item names or totals do not establish that two orders belong together. Customer POs use saved CRM entries and confirmed item links.</Notice>
   {availability.status==='error'&&<ErrorState error={availability.error} onRetry={reloadAvailability}/>}
   {availability.status==='ready'&&!availability.data.enabled&&<Notice tone="warning" title="Order comparison is disabled">Ask the operator to enable read-only order comparison in the application configuration.</Notice>}
   <SelectField label="Comparison" value={mode} options={[{value:'SUPPLIER_PO',label:'Sales Order against supplier Purchase Order'},...(customerAllowed?[{value:'CUSTOMER_PO',label:'Sales Order against CRM-entered customer PO'}]:[])]} onChange={e=>{reset();setMode(e.target.value);setPurchase(null);setReviewed(false);}}/>
   <Combobox label="Imported Tally Sales Order" required value={sales} onChange={value=>{reset();setSales(value);}} search={term=>searchTally(term,'sales_orders')}/>
   <Combobox key={mode} label={mode==='SUPPLIER_PO'?'Imported Tally supplier Purchase Order':'Saved CRM customer PO'} required value={purchase} onChange={value=>{reset();setPurchase(value);}} search={term=>mode==='SUPPLIER_PO'?searchTally(term,'purchase_orders'):searchCustomer(term)}/>
   <Checkbox label="I checked that both documents use net prices excluding tax" checked={reviewed} onChange={e=>{reset();setReviewed(e.target.checked);}}/>
   <Button disabled={busy||!sales||!purchase||availability.status!=='ready'||!availability.data.enabled} onClick={()=>void compare()}>{busy?'Comparing…':'Compare selected documents'}</Button>
   {Boolean(error)&&<ErrorState error={error}/>}
   {result&&<><p>Sales Order: {result.sources.salesOrder.number||sales?.label} · PO: {result.sources.purchaseOrder.number||purchase?.label}</p><ComparisonResult result={result.data}/><Notice>{result.note}</Notice></>}
  </div>
 </Drawer>;
}
