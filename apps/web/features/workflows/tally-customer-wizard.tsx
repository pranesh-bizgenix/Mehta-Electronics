'use client';

import Link from 'next/link';
import {useEffect,useMemo,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {newIdempotencyKey,type Pagination} from '@/lib/api/client';
import {useSession} from '@/lib/session';
import {Badge,Button,Checkbox,DataTable,EmptyState,ErrorState,Modal,Notice,SelectField,TextAreaField,TextField} from '@/components/ds';

interface Customer {id:number;name:string;gstin:string|null;status:string;phones:string[];linkedRecordKey?:string|null}
interface Source {recordKey:string;revision:string;name:string;parent_name:string;guid:string|null;masterId:string|null;gstin:string;phone:string;email:string;address:string;stable:boolean;identityIssue:string|null;linked:null|{customerId:number};duplicates:(Customer&{reasons:string[]})[]}
interface Entry {recordKey:string;action:'create'|'link';customerId?:number;creditLimit?:string;creditDays?:number;acknowledgeDuplicates:boolean}
interface Draft {target?:Customer;source:Source;action:'create'|'link';customerId:string;creditLimit:string;creditDays:string;acknowledgeDuplicates:boolean}
interface Listing {data:Source[];groups:string[];pagination:Pagination;note:string}
interface Preview {company:{id:string;name:string};rows:{source:Source|null;target:Customer|null;entry:Entry;outcome:string;issues:string[]}[];canSave:boolean;previewFingerprint:string;note:string}
interface Result {results:{recordKey:string;customerId:number;outcome:string}[]}

export function TallyCustomerWizard({companyId,companyName,open,onClose,onSaved}:{companyId:string;companyName:string;open:boolean;onClose:()=>void;onSaved:()=>void}) {
  return <Modal open={open} onClose={onClose} title="Review Tally customers for CRM" size="lg" description={companyName}>{open&&<Wizard key={companyId} companyId={companyId} companyName={companyName} onSaved={onSaved}/>}</Modal>;
}

function Wizard({companyId,companyName,onSaved}:{companyId:string;companyName:string;onSaved:()=>void}) {
  const api=useApi(),{can}=useSession();
  const [page,setPage]=useState(1),[search,setSearch]=useState(''),[group,setGroup]=useState(''),[duplicates,setDuplicates]=useState('all'),[linkage,setLinkage]=useState('unlinked');
  const [list,setList]=useState<Listing>(),[loading,setLoading]=useState(false),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState<Record<string,Draft>>({}),[reason,setReason]=useState(''),[preview,setPreview]=useState<Preview>(),[result,setResult]=useState<Result>(),[requestKey,setRequestKey]=useState('');
  const [targetSearch,setTargetSearch]=useState(''),[targets,setTargets]=useState<Customer[]>([]),[targetError,setTargetError]=useState<unknown>();
  const drafts=Object.values(selected);
  const body=useMemo(()=>({companyId,reason,entries:Object.values(selected).map(d=>({recordKey:d.source.recordKey,action:d.action,...(d.action==='link'?{customerId:d.customerId?Number(d.customerId):undefined}:{...(d.creditLimit?{creditLimit:d.creditLimit}:{}),...(d.creditDays!==''?{creditDays:Number(d.creditDays)}:{})}),acknowledgeDuplicates:d.acknowledgeDuplicates}))}),[companyId,reason,selected]);
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError(undefined);setList(undefined);
    const timer=setTimeout(()=>{api.data<Listing>('GET','/api/v1/tally/customer-wizard',undefined,{query:{companyId,page,pageSize:25,search,group:group||undefined,duplicates,linkage},signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setList(value);}).catch(e=>{if(!controller.signal.aborted)setError(e);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},200);
    return()=>{clearTimeout(timer);controller.abort();};
  },[api,companyId,page,search,group,duplicates,linkage]);
  useEffect(()=>{
    const controller=new AbortController();setTargetError(undefined);
    const timer=setTimeout(()=>{api.data<{data:Customer[]}>('GET','/api/v1/tally/customer-wizard/targets',undefined,{query:{companyId,search:targetSearch},signal:controller.signal}).then(r=>{if(!controller.signal.aborted)setTargets(r.data);}).catch(e=>{if(!controller.signal.aborted)setTargetError(e);});},200);
    return()=>{clearTimeout(timer);controller.abort();};
  },[api,companyId,targetSearch]);
  const update=(key:string,patch:Partial<Draft>)=>{setSelected(all=>({...all,[key]:{...all[key],...patch}}));setPreview(undefined);};
  const toggle=(source:Source,checked:boolean)=>{
    if(checked&&drafts.length>=100){setError(new Error('Review at most 100 selected ledgers per batch.'));return;}
    setError(undefined);setSelected(all=>{const next={...all};if(checked){next[source.recordKey]={source,action:can('customers.create')?'create':'link',customerId:'',creditLimit:'',creditDays:'',acknowledgeDuplicates:false};}else delete next[source.recordKey];return next;});setPreview(undefined);
  };
  if(result)return <div className="stack"><Notice tone="success" title="Reviewed batch saved">{result.results.filter(r=>r.outcome==='CREATE_AND_LINK').length} created; {result.results.filter(r=>r.outcome==='LINK_EXISTING').length} linked to existing customers; {result.results.filter(r=>r.outcome==='ALREADY_LINKED').length} already linked. Company: {companyName}.</Notice><ul>{result.results.map(r=><li key={r.recordKey}><Link href={`/customers/${r.customerId}`}>Open CRM customer #{r.customerId}</Link></li>)}</ul><p>Tally was not changed.</p></div>;
  return <div className="stack-lg">
    <Notice tone="info" title={`Selected company: ${companyName}`}>Only Sundry Debtors and their subgroups appear. Nothing is selected or linked automatically. Each source requires a stable GUID or Master ID. Changes are saved only after your preview and reason.</Notice>
    {Boolean(error)&&<ErrorState error={error}/>}
    {preview?<>
      <h3>Review {preview.rows.length} selected actions</h3><p>{preview.note}</p><p><strong>Reason:</strong> {reason}</p>
      <ul className="ds-list">{preview.rows.map((r,i)=><li className="ds-list-item" key={`${r.entry.recordKey}-${i}`}><div className="stack-sm"><strong>{r.source?.name||r.entry.recordKey}</strong><Badge tone={r.issues.length?'warning':'success'}>{r.outcome.replaceAll('_',' ')}</Badge><p>Company: {preview.company.name} · GUID: {r.source?.guid||'Not delivered'} · Master ID: {r.source?.masterId||'Not delivered'}</p>{r.target?<p>Link to: {r.target.name} · CRM #{r.target.id}. Existing fields will be retained.</p>:r.entry.action==='create'&&<p>Create using delivered name, GSTIN, PAN, address and contact information. Credit limit: {r.entry.creditLimit??'Not set'}; credit days: {r.entry.creditDays??'Not set'}.</p>}{r.source&&<p>GSTIN: {r.source.gstin||'Not delivered'} · Phone: {r.source.phone||'Not delivered'} · Email: {r.source.email||'Not delivered'} · Address: {r.source.address||'Not delivered'}</p>}{r.source?.duplicates.map(d=><p key={d.id}>Possible duplicate: {d.name} (CRM #{d.id}) — {d.reasons.join(', ')}.</p>)}{r.issues.map(issue=><Notice key={issue} tone="warning">{issue}</Notice>)}</div></li>)}</ul>
      <div className="cluster"><Button variant="secondary" disabled={busy} onClick={()=>setPreview(undefined)}>Back to selection</Button><Button disabled={busy||!preview.canSave} onClick={async()=>{setBusy(true);setError(undefined);try{const saved=await api.data<Result>('POST','/api/v1/tally/customer-wizard/commit',{...body,previewFingerprint:preview.previewFingerprint},{idempotencyKey:requestKey});setResult(saved);onSaved();}catch(e){setError(e);}finally{setBusy(false);}}}>{busy?'Saving reviewed batch...':'Save reviewed batch'}</Button></div>
    </>:<>
      <div className="cluster"><SelectField label="Customer subgroup" value={group} onChange={e=>{setGroup(e.target.value);setPage(1);}} placeholder="All debtor subgroups" options={(list?.groups??[]).map(value=>({value,label:value}))}/><SelectField label="Duplicate suggestions" value={duplicates} onChange={e=>{setDuplicates(e.target.value);setPage(1);}} options={[{value:'all',label:'All candidates'},{value:'with',label:'Has possible duplicates'},{value:'without',label:'No possible duplicates'}]}/><SelectField label="Existing links" value={linkage} onChange={e=>{setLinkage(e.target.value);setPage(1);}} options={[{value:'unlinked',label:'Unlinked only'},{value:'linked',label:'Linked only'},{value:'all',label:'All customer ledgers'}]}/></div>
      <DataTable<Source> id="customer-wizard-candidates" caption="Customer ledger candidates" rows={list?.data} loading={loading} rowKey={r=>r.recordKey} pagination={list?.pagination} onPage={setPage} search={{value:search,onChange:value=>{setSearch(value);setPage(1);},placeholder:'Search name, GSTIN, phone or source ID'}} columns={[
        {key:'select',header:'Select',render:r=><Checkbox label={`Select ${r.name}`} checked={Boolean(selected[r.recordKey])} disabled={!r.stable||Boolean(r.linked)||busy} onChange={e=>toggle(r,e.target.checked)}/>},
        {key:'name',header:'Tally customer',render:r=><div className="stack-sm"><strong>{r.name}</strong><small>{r.parent_name}</small><small>GUID: {r.guid||'Not delivered'} · Master ID: {r.masterId||'Not delivered'}</small>{r.identityIssue&&<span>{r.identityIssue}</span>}{r.linked&&<Link href={`/customers/${r.linked.customerId}`}>Linked: CRM #{r.linked.customerId}</Link>}</div>},
        {key:'details',header:'GSTIN / phone',render:r=><>{r.gstin||'GSTIN not delivered'}<br/>{r.phone||'Phone not delivered'}</>},
        {key:'duplicates',header:'Possible CRM duplicates',render:r=>r.duplicates.length?<ul>{r.duplicates.map(d=><li key={d.id}>{d.name} · #{d.id} · {d.reasons.join(', ')} · {d.status}</li>)}</ul>:'No matching GSTIN, normalised name or phone'}
      ]} empty={<EmptyState title="No customer candidates">No Sundry Debtors ledgers match these filters in this company.</EmptyState>}/>
      <div className="cluster-between"><strong>{drafts.length} of 100 selected for this batch</strong><Button variant="secondary" disabled={!drafts.length} onClick={()=>setSelected({})}>Clear selection</Button></div>
      {drafts.length>0&&<>
        <TextField label="Find existing CRM customers" value={targetSearch} onChange={e=>setTargetSearch(e.target.value)} hint="Search name, GSTIN, phone or CRM ID. Results show at most 100 active customers; narrow the search if needed."/>
        {Boolean(targetError)&&<ErrorState error={targetError}/>}
        {drafts.map(d=>{const customers=Array.from(new Map([...(d.target?[d.target]:[]),...d.source.duplicates,...targets].map(c=>[c.id,c])).values());return <section className="ds-card" key={d.source.recordKey}><div className="ds-card-body stack"><h3>{d.source.name}</h3><SelectField label="Reviewed action" value={d.action} onChange={e=>update(d.source.recordKey,{action:e.target.value as Draft['action']})} options={[...(can('customers.create')?[{value:'create',label:'Create and link a new CRM customer'}]:[]),...(can('customers.update')?[{value:'link',label:'Link to an existing CRM customer'}]:[])]}/>{d.action==='link'?<SelectField label="Existing CRM customer" value={d.customerId} onChange={e=>update(d.source.recordKey,{customerId:e.target.value,target:customers.find(c=>String(c.id)===e.target.value)})} placeholder="Select explicitly; no automatic matching" options={customers.filter(c=>c.status==='ACTIVE'&&(!c.linkedRecordKey||c.linkedRecordKey===d.source.recordKey)).map(c=>({value:String(c.id),label:`${c.name} · #${c.id} · ${c.gstin||'No GSTIN'}`}))}/>:<><TextField label="Credit limit (INR)" inputMode="decimal" value={d.creditLimit} onChange={e=>update(d.source.recordKey,{creditLimit:e.target.value})} hint="Enter a confirmed value. No default is supplied."/><TextField label="Credit days" type="number" min="0" max="3650" step="1" value={d.creditDays} onChange={e=>update(d.source.recordKey,{creditDays:e.target.value})}/><Checkbox label="I reviewed name/phone similarities and confirm this should be a separate customer" checked={d.acknowledgeDuplicates} onChange={e=>update(d.source.recordKey,{acknowledgeDuplicates:e.target.checked})}/></>}<Button variant="ghost" onClick={()=>toggle(d.source,false)}>Remove from batch</Button></div></section>;})}
        <TextAreaField label="Reason for this batch" required minLength={3} maxLength={1000} value={reason} onChange={e=>{setReason(e.target.value);setPreview(undefined);}}/>
        <Button disabled={busy||reason.trim().length<3} onClick={async()=>{setBusy(true);setError(undefined);try{setPreview(await api.data<Preview>('POST','/api/v1/tally/customer-wizard/preview',body));setRequestKey(newIdempotencyKey());}catch(e){setError(e);}finally{setBusy(false);}}}>{busy?'Preparing preview...':'Preview selected actions'}</Button>
      </>}
    </>}
  </div>;
}
