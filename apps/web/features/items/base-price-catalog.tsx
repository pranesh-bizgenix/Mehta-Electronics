'use client';
import {useEffect,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import type {Paginated} from '@/lib/api/client';
import {DataTable,ErrorState,Notice} from '@/components/ds';
import {formatMoney} from '@/lib/format';
interface Row {sourceRow:number;partCode:string;description:string|null;unitPrice:string|null;uom:string|null;edition:string|null;issues:string[]}
export function BasePriceCatalog(){
 const api=useApi(),[page,setPage]=useState(1),[search,setSearch]=useState(''),[result,setResult]=useState<Paginated<Row>>(),[loading,setLoading]=useState(false),[error,setError]=useState<unknown>();
 useEffect(()=>{const abort=new AbortController();setLoading(true);setError(undefined);api.get<Paginated<Row>>('/api/crm/base-price-catalog',{query:{page,search},signal:abort.signal}).then(setResult).catch(e=>{if(!abort.signal.aborted)setError(e);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();},[api,page,search]);
 return <section className="stack"><h2>Master base price list</h2><Notice tone="info">Base prices from the Excel master price sheet, before discounts. Reference only: quotation prices and approvals stay separate. Missing units and uncertain prices need review.</Notice>{error!==undefined&&<ErrorState error={error}/>}<DataTable<Row> id="master-base-prices" caption="Master base price list" rows={result?.data} rowKey={r=>r.sourceRow} loading={loading} pagination={result?.pagination} onPage={setPage} search={{value:search,onChange:v=>{setSearch(v);setPage(1);},placeholder:'Search Excel article code or description'}} columns={[{key:'code',header:'Article code',render:r=>r.partCode},{key:'description',header:'Description',render:r=>r.description??'Not supplied'},{key:'price',header:'Base list price (INR)',render:r=>r.unitPrice===null?'Needs review':formatMoney(r.unitPrice)},{key:'unit',header:'Unit',render:r=>r.uom??'Not supplied'},{key:'edition',header:'Source edition',render:r=>r.edition??'Not supplied'},{key:'review',header:'Review',render:r=>r.issues.join('; ')||'Literal source price'}]}/></section>;
}
