'use client';

import Link from 'next/link';
import {useEffect,useMemo,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {newIdempotencyKey,type Pagination} from '@/lib/api/client';
import {useSession} from '@/lib/session';
import {Badge,Button,Checkbox,DataTable,EmptyState,ErrorState,Modal,Notice,SelectField,TextAreaField,TextField} from '@/components/ds';

interface Product {id:number;part_code:string;description:string;hsn:string|null;uom:string;status:string;reasons?:string[]}
interface Source {record_key:string;record_id:string;name:string;part_code:string;parent_name:string;guid:string|null;master_id:string|null;hsn:string|null;uom:string|null;brand:string|null;description:string|null;stable:boolean;identityIssue:string|null;linked:null|{itemId:number};legacy:null|{itemId:number;status:string};duplicates:Product[];duplicateCount:number}
interface Draft {source:Source;action:'create'|'link';itemId:string;target?:Product;partCode:string;packSize:string;acknowledgeDuplicates:boolean}
interface Listing {data:Source[];groups:string[];brands:string[];missingBrand:number;pagination:Pagination;note:string}
interface Preview {company:{name:string};rows:{entry:{recordKey:string;action:string;partCode?:string;packSize?:string};source:Source|null;target:Product|null;issues:string[];outcome:string}[];canSave:boolean;previewFingerprint:string;note:string}
interface Result {results:{recordKey:string;itemId:number;outcome:string}[]}
const reasonLabel=(reason:string)=>({PART_NUMBER:'Similar part number',HSN_UOM:'Same HSN and unit'}[reason]||reason);

export function TallyItemWizard({companyId,companyName,open,onClose,onSaved}:{companyId:string;companyName:string;open:boolean;onClose:()=>void;onSaved:()=>void}){
  return <Modal open={open} onClose={onClose} title="Review Tally items for CRM" size="lg" description={companyName}>{open&&<Wizard key={companyId} companyId={companyId} companyName={companyName} onSaved={onSaved}/>}</Modal>;
}
function Wizard({companyId,companyName,onSaved}:{companyId:string;companyName:string;onSaved:()=>void}){
  const api=useApi(),{can}=useSession();
  const [page,setPage]=useState(1),[search,setSearch]=useState(''),[group,setGroup]=useState(''),[brand,setBrand]=useState(''),[brandStatus,setBrandStatus]=useState('all'),[duplicates,setDuplicates]=useState('all'),[linkage,setLinkage]=useState('unlinked');
  const [list,setList]=useState<Listing>(),[loading,setLoading]=useState(false),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState<Record<string,Draft>>({}),[reason,setReason]=useState(''),[preview,setPreview]=useState<Preview>(),[result,setResult]=useState<Result>(),[requestKey,setRequestKey]=useState('');
  const [targetSearch,setTargetSearch]=useState(''),[targets,setTargets]=useState<Product[]>([]),[targetError,setTargetError]=useState<unknown>();
  const drafts=Object.values(selected);
  const body=useMemo(()=>({companyId,reason,entries:Object.values(selected).map(d=>({recordKey:d.source.record_key,action:d.action,...(d.action==='link'?{itemId:d.itemId?Number(d.itemId):undefined}:{partCode:d.partCode,...(d.packSize?{packSize:d.packSize}:{})}),acknowledgeDuplicates:d.acknowledgeDuplicates}))}),[companyId,reason,selected]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError(undefined);
    const timer=setTimeout(()=>{api.data<Listing>('GET','/api/v1/tally/item-wizard',undefined,{query:{companyId,page,pageSize:25,search,group:group||undefined,brand:brand||undefined,brandStatus,duplicates,linkage},signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setList(value);}).catch(e=>{if(!controller.signal.aborted)setError(e);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},200);
    return()=>{clearTimeout(timer);controller.abort();};
  },[api,companyId,page,search,group,brand,brandStatus,duplicates,linkage]);
  useEffect(()=>{
    const controller=new AbortController();setTargetError(undefined);
    const timer=setTimeout(()=>{api.data<{data:Product[]}>('GET','/api/v1/tally/item-wizard/targets',undefined,{query:{companyId,search:targetSearch},signal:controller.signal}).then(r=>{if(!controller.signal.aborted)setTargets(r.data);}).catch(e=>{if(!controller.signal.aborted)setTargetError(e);});},200);
    return()=>{clearTimeout(timer);controller.abort();};
  },[api,companyId,targetSearch]);
  const update=(key:string,patch:Partial<Draft>)=>{setSelected(all=>({...all,[key]:{...all[key],...patch}}));setPreview(undefined);};
  const toggle=(source:Source,checked:boolean)=>{
    if(checked&&drafts.length>=100){setError(new Error('Review at most 100 specific items per batch.'));return;}
    setSelected(all=>{const next={...all};if(checked)next[source.record_key]={source,action:can('items.create')?'create':'link',itemId:'',partCode:source.part_code,packSize:'',acknowledgeDuplicates:false};else delete next[source.record_key];return next;});setPreview(undefined);
  };
  if(result)return <div className="stack"><Notice tone="success" title="Reviewed item batch saved">{result.results.length} reviewed results for {companyName}. Tally masters were not changed.</Notice><ul>{result.results.map(r=><li key={r.recordKey}><Link href={`/items?open=${r.itemId}`}>Open CRM product #{r.itemId}</Link> · {r.outcome.replaceAll('_',' ')}</li>)}</ul></div>;
  return <div className="stack-lg">
    <Notice tone="info" title={`Selected company: ${companyName}`}>BR-17: stock items originate in Tally. This wizard creates CRM references only. No items are preselected, no prices or costs are invented, and Tally is never rewritten.</Notice>
    {Boolean(error)&&<ErrorState error={error}/>}
    {preview?<>
      <h3>Review {preview.rows.length} item actions</h3><p>{preview.note}</p><p><strong>Reason:</strong> {reason}</p>
      <ul className="ds-list">{preview.rows.map((r,i)=><li className="ds-list-item" key={`${r.entry.recordKey}-${i}`}><div className="stack-sm"><strong>{r.source?.name||r.entry.recordKey}</strong><Badge tone={r.issues.length?'warning':'success'}>{r.outcome.replaceAll('_',' ')}</Badge><p>Company: {preview.company.name} · GUID: {r.source?.guid||'Not delivered'} · Master ID: {r.source?.master_id||'Not delivered'}</p><p>HSN: {r.source?.hsn||'Not delivered'} · Unit: {r.source?.uom||'Not delivered'} · Brand: {r.source?.brand||'Not delivered'}</p>{r.target?<p>Link to {r.target.part_code} · CRM #{r.target.id}. Existing CRM fields remain unchanged.</p>:<p>New CRM part code: {r.entry.partCode||r.source?.part_code} · Pack size: {r.entry.packSize||'Not set'}. Description: {r.source?.description||r.source?.name}.</p>}{r.source?.duplicates.map(d=><p key={d.id}>Possible duplicate: {d.part_code} · #{d.id} · {d.reasons?.map(reasonLabel).join(', ')}.</p>)}{r.source&&r.source.duplicateCount>20&&<p>{r.source.duplicateCount} possible duplicates in total. The first 20 are shown; use product search to review others.</p>}{r.issues.map(issue=><Notice key={issue} tone="warning">{issue}</Notice>)}</div></li>)}</ul>
      <div className="cluster"><Button variant="secondary" disabled={busy} onClick={()=>setPreview(undefined)}>Back to selection</Button><Button disabled={busy||!preview.canSave} onClick={async()=>{setBusy(true);setError(undefined);try{setResult(await api.data<Result>('POST','/api/v1/tally/item-wizard/commit',{...body,previewFingerprint:preview.previewFingerprint},{idempotencyKey:requestKey}));onSaved();}catch(e){setError(e);}finally{setBusy(false);}}}>{busy?'Saving reviewed batch...':'Save reviewed batch'}</Button></div>
    </>:<>
      <div className="cluster"><SelectField label="Stock group" value={group} onChange={e=>{setGroup(e.target.value);setPage(1);}} placeholder="All stock groups" options={(list?.groups??[]).map(value=>({value,label:value}))}/><SelectField label="Brand delivery" value={brandStatus} onChange={e=>{setBrandStatus(e.target.value);setBrand('');setPage(1);}} options={[{value:'all',label:'All items'},{value:'delivered',label:'Brand delivered'},{value:'missing',label:'Brand not delivered'}]}/><SelectField label="Brand" value={brand} disabled={brandStatus==='missing'} onChange={e=>{setBrand(e.target.value);setPage(1);}} placeholder="All delivered brands" options={(list?.brands??[]).map(value=>({value,label:value}))}/><SelectField label="Duplicates" value={duplicates} onChange={e=>{setDuplicates(e.target.value);setPage(1);}} options={[{value:'all',label:'All candidates'},{value:'with',label:'Possible duplicates'},{value:'without',label:'No duplicates'}]}/><SelectField label="Existing links" value={linkage} onChange={e=>{setLinkage(e.target.value);setPage(1);}} options={[{value:'unlinked',label:'Unlinked only'},{value:'linked',label:'Linked only'},{value:'all',label:'All items'}]}/></div>
      {list&&<p className="muted">{list.note} Brand not delivered for {list.missingBrand} source items.</p>}
      <DataTable<Source> id="item-wizard-candidates" caption="Tally stock item candidates" rows={list?.data} loading={loading} rowKey={r=>r.record_key} pagination={list?.pagination} onPage={setPage} search={{value:search,onChange:value=>{setSearch(value);setPage(1);},placeholder:'Search part number, item, HSN or source ID'}} columns={[
        {key:'select',header:'Select',render:r=><Checkbox label={`Select ${r.name}`} checked={Boolean(selected[r.record_key])} disabled={!r.stable||Boolean(r.linked)||busy} onChange={e=>toggle(r,e.target.checked)}/>},
        {key:'name',header:'Tally item',render:r=><div className="stack-sm"><strong>{r.name}</strong><small>Part: {r.part_code} · {r.parent_name||'Group not delivered'}</small><small>GUID: {r.guid||'Not delivered'} · Master ID: {r.master_id||'Not delivered'}</small>{r.identityIssue&&<span>{r.identityIssue}</span>}{r.linked&&<Link href={`/items?open=${r.linked.itemId}`}>Linked: CRM #{r.linked.itemId}</Link>}{r.legacy&&<span>Name-based mapping: CRM #{r.legacy.itemId}; explicit identity review required.</span>}</div>},
        {key:'tax',header:'HSN / unit / brand',render:r=><>{r.hsn||'HSN not delivered'}<br/>{r.uom||'Unit not delivered'}<br/>{r.brand||'Brand not delivered'}</>},
        {key:'duplicates',header:'Possible CRM duplicates',render:r=>r.duplicateCount?<div><p>{r.duplicateCount} possible matches</p><ul>{r.duplicates.map(d=><li key={d.id}>{d.part_code} · #{d.id} · {d.reasons?.map(reasonLabel).join(', ')} · {d.status}</li>)}</ul></div>:'No matching part number or HSN/unit combination'}
      ]} empty={<EmptyState title="No matching stock items">Adjust the filters or check the selected company's stock import.</EmptyState>}/>
      <div className="cluster-between"><strong>{drafts.length} of 100 selected</strong><Button variant="secondary" disabled={!drafts.length} onClick={()=>setSelected({})}>Clear selection</Button></div>
      {drafts.length>0&&<><TextField label="Find existing CRM products" value={targetSearch} onChange={e=>setTargetSearch(e.target.value)} hint="Search part code, description, HSN or CRM ID. Up to 100 active products are shown; narrow the search if needed."/>{Boolean(targetError)&&<ErrorState error={targetError}/>}
        {drafts.map(d=>{const products=Array.from(new Map([...(d.target?[d.target]:[]),...d.source.duplicates,...targets].map(i=>[i.id,i])).values());return <section className="ds-card" key={d.source.record_key}><div className="ds-card-body stack"><h3>{d.source.name}</h3><SelectField label="Reviewed action" value={d.action} onChange={e=>update(d.source.record_key,{action:e.target.value as Draft['action']})} options={[...(can('items.create')?[{value:'create',label:'Create and link a CRM product'}]:[]),...(can('items.update')?[{value:'link',label:'Link to an existing CRM product'}]:[])]}/>{d.action==='link'?<SelectField label="Existing CRM product" value={d.itemId} onChange={e=>update(d.source.record_key,{itemId:e.target.value,target:products.find(p=>String(p.id)===e.target.value)})} placeholder="Select explicitly; no automatic matching" options={products.filter(p=>p.status==='ACTIVE').map(p=>({value:String(p.id),label:`${p.part_code} · #${p.id} · ${p.uom} · HSN ${p.hsn||'Not set'}`}))}/>:<><TextField label="CRM part code" required value={d.partCode} onChange={e=>update(d.source.record_key,{partCode:e.target.value})} hint="Starts with the delivered part number, or exact Tally item name if no part number was delivered. Changing this CRM label never renames Tally."/><TextField label="Confirmed pack size" required inputMode="decimal" value={d.packSize} onChange={e=>update(d.source.record_key,{packSize:e.target.value})} hint="Enter an exact positive decimal. No pack size, MOQ, cost or price is assumed."/><Checkbox label="I reviewed the part-number and HSN/unit similarities and confirm a separate CRM product" checked={d.acknowledgeDuplicates} onChange={e=>update(d.source.record_key,{acknowledgeDuplicates:e.target.checked})}/></>}<Button variant="ghost" onClick={()=>toggle(d.source,false)}>Remove from batch</Button></div></section>;})}
        <TextAreaField label="Reason for this batch" required minLength={3} maxLength={1000} value={reason} onChange={e=>{setReason(e.target.value);setPreview(undefined);}}/><Button disabled={busy||reason.trim().length<3} onClick={async()=>{setBusy(true);setError(undefined);try{setPreview(await api.data<Preview>('POST','/api/v1/tally/item-wizard/preview',body));setRequestKey(newIdempotencyKey());}catch(e){setError(e);}finally{setBusy(false);}}}>{busy?'Preparing preview...':'Preview selected actions'}</Button>
      </>}
    </>}
  </div>;
}
