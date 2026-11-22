'use client';
import Link from 'next/link';
import {useCallback,useEffect,useState} from 'react';
import {Button,DataTable,Notice,TextField,TextAreaField,SelectField} from '@/components/ds';
import {useApi} from '@/lib/api/provider';
import {useSession} from '@/lib/session';
import {useScope} from '@/lib/scope';
import type {Category,Settings,WriteCategory,Mapping,Source,Job,Monitor} from '@/features/tally-write/api';
import {MappingReview} from '@/features/tally-write/mapping-review';
import {PostingReadiness} from '@/features/tally-write/readiness';

const categoryOptions=[{value:'SALES_ORDER',label:'Sales Orders'},{value:'PURCHASE_ORDER',label:'Purchase Orders'},{value:'PARTY_LEDGER',label:'New party ledgers'}];
const modes=[{value:'',label:'Not set — blocks writes'},{value:'AUTO_AFTER_BUSINESS_APPROVAL',label:'After independent business approval'},{value:'SEPARATE_PUSH_APPROVAL',label:'Separate push approval'}];
const thresholds=['max_attempts','backoff_seconds','failure_threshold','min_gap_seconds','per_day_cap','lease_seconds'] as const;

export default function TallyWritePage(){
 const api=useApi(),{state}=useSession(),{companyId,companies}=useScope();
 const owner=state.kind==='ready'&&state.user.role==='OWNER';
 const [settings,setSettings]=useState<Settings|null>(null),[monitor,setMonitor]=useState<Monitor|null>(null),[kind,setKind]=useState<Category>('SALES_ORDER');
 const [mappings,setMappings]=useState<Mapping[]>([]),[mappingJson,setMappingJson]=useState('{}'),[mappingParent,setMappingParent]=useState<string|null>(null);
 const [draft,setDraft]=useState<WriteCategory|null>(null),[conflicts,setConflicts]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [sourceEntity,setSourceEntity]=useState('ledgers'),[search,setSearch]=useState(''),[sources,setSources]=useState<Source[]>([]),[entityId,setEntityId]=useState(''),[job,setJob]=useState<Job|null>(null);
 const [liveConfirmed,setLiveConfirmed]=useState(false),[inspected,setInspected]=useState(false),[partyType,setPartyType]=useState('CUSTOMER'),[partyId,setPartyId]=useState(''),[reviewId,setReviewId]=useState('');
 const query=companyId?`?companyId=${encodeURIComponent(companyId)}`:'';
 const load=useCallback(async()=>{
  if(!owner)return;
  const current=await api.data<Settings>('GET','/api/tally-write/settings');setSettings(current);
  if(companyId){const [outbox,versions]=await Promise.all([api.data<Monitor>('GET',`/api/tally-write/outbox?companyId=${encodeURIComponent(companyId)}`),api.data<Mapping[]>('GET',`/api/tally-write/mappings?companyId=${encodeURIComponent(companyId)}&category=${kind}`)]);setMonitor(outbox);setMappings(versions);}
 },[api,companyId,kind,owner]);
 useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:'Could not load write settings.'));},[load]);
 useEffect(()=>{const row=settings?.categories.find(c=>c.category===kind);setDraft(row?{...row}:null);setConflicts(row?.conflict_winner?JSON.stringify(row.conflict_winner,null,2):'');setLiveConfirmed(false);setMappingJson('{}');setMappingParent(null);setJob(null);},[settings,kind]);
 const run=async(fn:()=>Promise<unknown>,success:string)=>{
  if(reason.trim().length<3){setError('Enter a reason of at least three characters.');return;}
  setBusy(true);setError('');setMessage('');try{await fn();setMessage(success);await load();}catch(e){setError(e instanceof Error?e.message:'The action was blocked.');}finally{setBusy(false);}
 };
 const saveCategory=()=>run(async()=>{
  if(!draft)return;
  const {enabled,dry_run_only,mapping_id,approval_mode,tally_version,xml_import_verified,max_attempts,backoff_seconds,failure_threshold,min_gap_seconds,per_day_cap,lease_seconds}=draft;
  await api.data('PUT',`/api/tally-write/categories/${kind}`,{enabled,dry_run_only,company_id:companyId,mapping_id,approval_mode,tally_version,xml_import_verified,max_attempts,backoff_seconds,failure_threshold,min_gap_seconds,per_day_cap,lease_seconds,conflict_winner:conflicts.trim()?JSON.parse(conflicts):null,confirmLive:liveConfirmed,reason});
 },'Category settings saved. Existing queued approvals may now be held for review.');
 const saveMapping=(status:'DRAFT'|'APPROVED')=>run(async()=>{
  await api.data('POST','/api/tally-write/mappings',{category:kind,companyId,configuration:JSON.parse(mappingJson),status,parentVersionId:mappingParent,reason});
 },'A new immutable mapping version was saved. Select it explicitly in category settings.');
 const openJob=async(id:string)=>{try{setJob(await api.data<Job>('GET',`/api/tally-write/outbox/${id}${query}`));setInspected(false);}catch(e){setError(e instanceof Error?e.message:'Could not open job.');}};
 const action=(value:string)=>run(async()=>{if(!job)return;await api.data('POST',`/api/tally-write/outbox/${job.id}/${value==='APPROVE'?'approve':'actions'}${query}`,{action:value,confirmManualTallyInspection:inspected,reason});await openJob(job.id);},'Review action recorded.');
 if(!owner)return <Notice tone="warning">Only the Owner can open Tally Write settings.</Notice>;
 return <div className="stack">
  <header><p><Link href="/tally">Tally</Link> / Write review</p><h1>Tally Write</h1><p>Review new CRM documents before creating them in Tally. Read sync remains separate.</p><p><strong>Selected company:</strong> {companies.find(c=>c.id===companyId)?.name??'Select a company in the header'}</p></header>
  <Notice tone="warning">All categories start OFF and dry-run only. Missing Owner-confirmed values block the workflow. This screen never supplies business defaults.</Notice>
  <PostingReadiness companyId={companyId}/>
  {error&&<Notice tone="danger">{error}</Notice>}{message&&<Notice tone="info">{message}</Notice>}
  <TextAreaField label="Reason for the next action" required value={reason} onChange={e=>setReason(e.target.value)} hint="Every change and approval is audited."/>
  <section className="ds-card stack"><h2>Master switch</h2><p>Status: <strong>{settings?.control.master_enabled?'ON':'OFF'}</strong>. Turning this OFF holds unsent work and marks potentially sent work UNKNOWN.</p>
   <SelectField label="Global approval mode" options={modes} value={settings?.control.approval_mode??''} onChange={e=>setSettings(s=>s?{...s,control:{...s.control,approval_mode:e.target.value||null}}:s)}/>
   <div className="row"><Button disabled={busy||!settings} onClick={()=>void run(()=>api.data('PUT','/api/tally-write/control',{masterEnabled:false,approvalMode:settings?.control.approval_mode,reason}),'Master switch is OFF.')}>Turn OFF / stop new writes</Button><Button variant="secondary" disabled={busy||!settings} onClick={()=>void run(()=>api.data('PUT','/api/tally-write/control',{masterEnabled:true,approvalMode:settings?.control.approval_mode,reason}),'Master switch is ON. Individual category gates still apply.')}>Turn master ON</Button></div>
  </section>
  <SelectField label="Category to review" options={categoryOptions} value={kind} onChange={e=>setKind(e.target.value as Category)}/>
  {draft&&<section className="ds-card stack"><h2>Category settings</h2>
   <label><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/> Enabled</label>
   <label><input type="checkbox" checked={draft.dry_run_only} onChange={e=>setDraft({...draft,dry_run_only:e.target.checked})}/> Dry-run only (no Tally CREATE)</label>
   <SelectField label="Approval mode" options={modes} value={draft.approval_mode??''} onChange={e=>setDraft({...draft,approval_mode:e.target.value||null})}/>
   <SelectField label="Owner-approved mapping version" value={draft.mapping_id??''} options={[{value:'',label:'Not set — blocks writes'},...mappings.filter(m=>m.status==='APPROVED').map(m=>({value:m.id,label:`Version ${m.version}`}))]} onChange={e=>setDraft({...draft,mapping_id:e.target.value||null})}/>
   <TextField label="Verified Tally version / edition" placeholder="Unverified" value={draft.tally_version??''} onChange={e=>setDraft({...draft,tally_version:e.target.value||null})}/>
   <SelectField label="XML import availability" options={[{value:'',label:'Unverified'},{value:'true',label:'Human verified — available'},{value:'false',label:'Verified unavailable'}]} value={draft.xml_import_verified===null?'':String(draft.xml_import_verified)} onChange={e=>setDraft({...draft,xml_import_verified:e.target.value===''?null:e.target.value==='true'})}/>
   <div className="stack">{thresholds.map(key=><TextField key={key} label={key.replaceAll('_',' ')} type="number" min="1" step="1" placeholder="Not set" value={draft[key]??''} onChange={e=>setDraft({...draft,[key]:e.target.value===''?null:Number(e.target.value)})}/>)}</div>
   <TextAreaField label="Conflict winner per mapped field (JSON: CRM or TALLY)" placeholder="Not set" value={conflicts} onChange={e=>setConflicts(e.target.value)}/>
   {!draft.dry_run_only&&<label><input type="checkbox" checked={liveConfirmed} onChange={e=>setLiveConfirmed(e.target.checked)}/> I explicitly authorize this category for live CREATE after separate human verification.</label>}
   <p>Breaker: {draft.paused?'PAUSED':'Not paused'} · consecutive failures: {draft.consecutive_failures}</p>
   <Button disabled={busy||!companyId||!draft.dry_run_only&&!liveConfirmed} onClick={()=>void saveCategory()}>Save category settings</Button>
   {draft.paused&&<Button variant="secondary" disabled={busy} onClick={()=>void run(()=>api.data('POST',`/api/tally-write/categories/${kind}/resume`,{reason}),'Breaker resumed; held jobs still require review.')}>Resume breaker after investigation</Button>}
  </section>}
  <section className="ds-card stack"><h2>Versioned field mapping</h2><p>Start empty. Use imported record keys and stable Tally IDs from the selected company. Name-only bindings are rejected.</p>
   <SelectField label="Review an existing version" value={mappingParent??''} options={[{value:'',label:'New empty mapping'},...mappings.map(m=>({value:m.id,label:`Version ${m.version} — ${m.status}`}))]} onChange={e=>{const m=mappings.find(r=>r.id===e.target.value);setMappingParent(m?.id??null);setMappingJson(JSON.stringify(m?.configuration??{},null,2));}}/>
   <TextAreaField label="Mapping JSON" rows={18} value={mappingJson} onChange={e=>setMappingJson(e.target.value)}/>
   <div className="row"><Button variant="secondary" disabled={busy||!companyId} onClick={()=>void saveMapping('DRAFT')}>Save new draft version</Button></div><p>Approval requires a retained draft, a different Owner and a named Tally expert review in the review panel below.</p>
   <h3>Real imported records for mapping review</h3><SelectField label="Source dataset" value={sourceEntity} options={['ledgers','items','groups','godowns','units','voucher_types'].map(s=>({value:s,label:s.replaceAll('_',' ')}))} onChange={e=>setSourceEntity(e.target.value)}/>
   <TextField label="Search imported names" value={search} onChange={e=>setSearch(e.target.value)}/><Button variant="secondary" disabled={busy||!companyId} onClick={()=>void run(async()=>setSources(await api.data<Source[]>('GET',`/api/tally-write/sources${query}&entity=${sourceEntity}&search=${encodeURIComponent(search)}`)),'Imported records loaded for this company.')}>Load imported records</Button>
   <DataTable id="write-mapping-sources" caption="Selected-company source identities" rows={sources} rowKey={r=>r.record_key} columns={[{key:'name',header:'Imported name',render:r=>r.name},{key:'key',header:'Stable source key',render:r=><code>{r.record_key}</code>},{key:'guid',header:'Tally ID',render:r=>r.tally_guid??r.master_id??'Not delivered — blocks use'}]}/>
  </section>
  <MappingReview companyId={companyId} category={kind} mappings={mappings} onSaved={load}/>
  {kind==='PARTY_LEDGER'&&<section className="ds-card stack"><h2>Extra party-ledger approval</h2><SelectField label="CRM party type" value={partyType} options={[{value:'CUSTOMER',label:'Customer'},{value:'VENDOR',label:'Vendor'}]} onChange={e=>setPartyType(e.target.value)}/><TextField label="Existing CRM party ID" value={partyId} onChange={e=>setPartyId(e.target.value)}/><Button disabled={busy||!companyId} onClick={()=>void run(async()=>{const r=await api.data<{id:string}>('POST','/api/tally-write/party-reviews',{companyId,entityType:partyType,entityId:partyId,reason});setReviewId(r.id);},'Party snapshot requested for independent review.')}>Request party review</Button><TextField label="Party review ID" value={reviewId} onChange={e=>setReviewId(e.target.value)}/><Button disabled={busy||!companyId||!reviewId} onClick={()=>void run(()=>api.data('POST',`/api/tally-write/party-reviews/${reviewId}/approve`,{companyId,reason}),'Independent party approval recorded.')}>Approve party snapshot</Button></section>}
  <section className="ds-card stack"><h2>Dry-run XML preview</h2><p>Choose an approved, locked CRM document ID (or approved party review ID). Missing settings are shown as a block. Preview jobs send nothing.</p><TextField label="CRM document / party review ID" value={entityId} onChange={e=>setEntityId(e.target.value)}/><Button disabled={busy||!companyId} onClick={()=>void run(async()=>{const result=await api.data<{id?:string;inactive?:boolean}>('POST','/api/tally-write/preview',{category:kind,companyId,entityId,reason});if(result.inactive)throw new Error('Master or category is OFF. No XML was built.');if(result.id)await openJob(result.id);},'Dry-run snapshot stored for review.')}>Build and review dry-run</Button></section>
  <section className="ds-card stack"><h2>Outbox and sync monitor</h2><p>{monitor?.counts.map(c=>`${c.status}: ${c.count} (oldest ${c.oldest})`).join(' · ')||'No queued documents for this company.'}</p><Button variant="secondary" disabled={busy||!companyId} onClick={()=>void run(()=>api.data('POST',`/api/tally-write/reconcile${query}`,{reason}),'Imported values compared; mismatches are in the existing conflict review.')}>Compare confirmed jobs with normal Tally imports</Button><Link href="/tally">Open Tally conflict review</Link>
   {monitor?.alerts.map(a=><Notice key={a.id} tone="warning">{a.code}: {a.message}</Notice>)}
   <DataTable id="tally-write-outbox" caption="Company-scoped write jobs" rows={monitor?.jobs??[]} rowKey={r=>r.id} columns={[{key:'document',header:'Document',render:r=><button type="button" onClick={()=>void openJob(r.id)}>{r.category} / {r.entity_id}</button>},{key:'status',header:'State',render:r=>`${r.status}${r.dry_run?' · dry-run':''}`},{key:'attempts',header:'Attempts',render:r=>r.attempts},{key:'error',header:'Review',render:r=>r.last_error??'—'}]}/>
  </section>
  {job&&<section className="ds-card stack"><h2>Job {job.entity_id} — {job.status}</h2><p>{job.dry_run?'Dry-run: nothing is sent.':'Live job: independent approval and verified read-back required.'}</p><details><summary>Approved CRM source snapshot</summary><pre>{JSON.stringify(job.snapshot,null,2)}</pre></details><details open><summary>Exact CREATE XML (new record)</summary><pre>{job.payload_xml??'No XML'}</pre></details><details><summary>Validation report</summary><pre>{JSON.stringify(job.validation_report,null,2)}</pre></details><details><summary>Tally response</summary><pre>{job.response_xml??'No response received'}</pre></details><details><summary>Audited events</summary><pre>{JSON.stringify(job.events,null,2)}</pre></details>
   <div className="row"><Button disabled={busy||!['PENDING','HELD','FAILED','APPROVED'].includes(job.status)} onClick={()=>void action('APPROVE')}>Independent push approval / safe retry review</Button><Button variant="secondary" disabled={busy||job.status==='CONFIRMED'} onClick={()=>void action('HOLD')}>Hold</Button><Button variant="secondary" disabled={busy||job.status==='CONFIRMED'} onClick={()=>void action('CANCEL')}>Cancel unsent job</Button></div>
   {['UNKNOWN','FAILED'].includes(job.status)&&<><h3>Resolve uncertainty</h3><p>Step 1: request an authenticated connector read-back. If the key exists and values match, the server confirms it without another CREATE.</p><Button disabled={busy} onClick={()=>void action('REQUEST_READBACK')}>Request read-back only</Button><p>Step 2: only after the connector proves absence, a different Owner must inspect Tally manually. Resolution returns the job to HELD and clears its approval.</p><label><input type="checkbox" checked={inspected} onChange={e=>setInspected(e.target.checked)}/> I manually verified in Tally that this document was not created.</label><Button disabled={busy||!inspected} onClick={()=>void action('RESOLVE_ABSENT')}>Record absence and require fresh approval</Button></>}
  </section>}
 </div>;
}
