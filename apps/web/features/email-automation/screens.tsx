'use client';

import Link from 'next/link';
import {useState} from 'react';
import {Badge,Card,DataTable,EmptyState,ErrorState,Notice,PageHeader,SelectField,Spinner,StatCard,useAsync} from '@/components/ds';
import type {Column} from '@/components/ds/data-table';
import {useApi} from '@/lib/api/provider';
import {useSession} from '@/lib/session';
import {formatDateTime} from '@/lib/format';
import type {Attachment,Collection,Counts,Email,EmailDetail,Envelope,Integration,ProcessingRun,RecordLink} from './contracts';
import styles from './screens.module.css';

type Screen='inbox'|'attachments'|'processing'|'errors'|'dashboard'|'integrations';
const titles:Record<Screen,string>={inbox:'Unified email inbox',attachments:'Attachment manager',processing:'Processing monitor',errors:'Error center',dashboard:'Automation dashboard',integrations:'Integration monitor'};
const endpoint='/api/v1/email-automation/';
const emailLink=(id:string)=><Link href={`/email-automation/inbox/${encodeURIComponent(id)}`}>View email</Link>;
function Status({value}:{value:string}) {return <Badge tone={['Failed','Unavailable'].includes(value)?'danger':['Processed','Succeeded','Connected','Available'].includes(value)?'success':'neutral'}>{value}</Badge>;}
function Source({sample,truncated}:{sample:boolean;truncated?:boolean}) {return <><Notice tone={sample?'warning':'info'} title={sample?'Sample data — fictional demonstration':'Stored email metadata'}>{sample?'Emails, attachments and processing results are fictional and stay in memory. No mailbox ingestion or sending is configured.':'Read-only metadata from existing records. Email bodies and files are not fetched from external storage.'}</Notice>{truncated&&<Notice tone="warning" title="Limited view">Showing the latest 1,000 records in each category. Counts and filters cover this window only.</Notice>}</>;}
function Permission({permission,children}:{permission:string;children:React.ReactNode}) {
  const {state,can}=useSession();
  if(state.kind!=='ready')return <Spinner/>;
  if(!can(permission))return <Notice title="Access restricted">Ask the Owner to assign the email automation permission to your role in Users &amp; roles.</Notice>;
  return children;
}
export function AutomationScreen({screen}:{screen:Screen}) {return <Permission permission={screen==='integrations'?'email_automation.integrations.read':'email_automation.read'}><div className="ds-page stack"><PageHeader title={titles[screen]} description="Read-only email automation workspace. No processing or sending actions are available." crumbs={[{label:'Email automation'},{label:titles[screen]}]}/>{screen==='dashboard'?<Dashboard/>:screen==='integrations'?<Integrations/>:<Listing screen={screen}/>}</div></Permission>;}

function Listing({screen}:{screen:'inbox'|'attachments'|'processing'|'errors'}) {
  const api=useApi();const [search,setSearch]=useState('');const [status,setStatus]=useState('');const [page,setPage]=useState(1);
  const resource=screen==='inbox'?'emails':screen;
  type Row=Email&Attachment&ProcessingRun;
  const [result,reload]=useAsync(signal=>api.get<Collection<Row>>(endpoint+resource,{signal,query:{search,status,page,pageSize:20}}),[screen,search,status,page]);
  const columns:Column<Row>[]=screen==='inbox'?[
    {key:'subject',header:'Subject',render:r=><Link href={`/email-automation/inbox/${encodeURIComponent(r.id)}`}>{r.subject}</Link>},
    {key:'sender',header:'From',render:r=>r.sender||'Not recorded'},
    {key:'receivedAt',header:'Received',render:r=>formatDateTime(r.receivedAt)},
    {key:'attachmentCount',header:'Attachments',numeric:true,render:r=>r.attachmentCount},
    {key:'status',header:'Status',render:r=><Status value={r.status}/>}
  ]:screen==='attachments'?[
    {key:'name',header:'Attachment',render:r=><><strong>{r.name}</strong><div className="ds-cell-secondary">{r.mimeType}</div></>},
    {key:'bytes',header:'Bytes',numeric:true,render:r=>r.bytes},
    {key:'location',header:'Storage reference',render:r=>r.s3Bucket&&r.s3Key?<span className={styles.reference}>s3://{r.s3Bucket}/{r.s3Key}</span>:'Not available'},
    {key:'status',header:'Status',render:r=><Status value={r.status}/>},
    {key:'email',header:'Source',render:r=>r.emailId?emailLink(r.emailId):<Link href="/email-automation/integrations">View integration</Link>}
  ]:[
    {key:'stage',header:'Stage',render:r=><><strong>{r.stage}</strong><div className="ds-cell-secondary">{r.id}</div></>},
    {key:'status',header:'Status',render:r=><Status value={r.status}/>},
    {key:'startedAt',header:'Started',render:r=>r.startedAt?formatDateTime(r.startedAt):'Not started'},
    {key:'finishedAt',header:'Finished',render:r=>r.finishedAt?formatDateTime(r.finishedAt):'Not finished'},
    {key:'errorCode',header:'Error code',render:r=><>{r.errorCode||'None'}{r.source&&<div className="ds-cell-secondary">{r.source}</div>}</>},
    {key:'email',header:'Source',render:r=>r.emailId?emailLink(r.emailId):<Link href="/email-automation/integrations">View integration</Link>}
  ];
  const statuses=screen==='inbox'?['Pending','Processed','Failed','Unknown']:screen==='attachments'?['Available','Unavailable']:screen==='errors'?['Failed']:['Pending','Running','Succeeded','Failed'];
  return <>{result.data&&<Source sample={result.data.sample} truncated={result.data.truncated}/>}<DataTable id={`email-automation-${screen}`} caption={titles[screen]} columns={columns} rows={result.data?.data} rowKey={r=>r.id} loading={result.status==='loading'} error={result.status==='error'?result.error:undefined} onRetry={reload} pagination={result.data?.pagination} onPage={setPage} search={{value:search,onChange:value=>{setSearch(value);setPage(1);},placeholder:'Search these records'}} filters={<SelectField label="Status" options={[{value:'',label:'All statuses'},...statuses.map(s=>({value:s,label:s}))]} value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}/>} empty={<EmptyState title="No matching records">No records match this filter. This module does not ingest or process emails.</EmptyState>}/>{screen==='errors'&&<Notice title="Read-only error view">Failures link to the source email. Retry, replay and resolution actions are outside Phase 1. Provider connectivity is shown in <Link href="/email-automation/integrations">Integration monitor</Link>.</Notice>}</>;
}
function Dashboard() {
  const api=useApi();const [result,reload]=useAsync(signal=>api.get<Envelope<Counts>>(endpoint+'dashboard',{signal}),[]);
  if(result.status==='error')return <ErrorState error={result.error} onRetry={reload}/>;if(result.status!=='ready')return <Spinner/>;
  return <><Source sample={result.data.sample} truncated={result.data.truncated}/><div className="grid-kpis">{Object.entries(result.data.data).map(([label,value])=><StatCard key={label} label={label} value={value}/>)}</div><Card title="Explore email records"><div className="cluster"><Link href="/email-automation/inbox">Open inbox</Link><Link href="/email-automation/attachments">View attachments</Link><Link href="/email-automation/processing">View processing</Link><Link href="/email-automation/errors">View errors</Link></div><p className="subtle">Counts describe the records in this workspace; they do not indicate a running ingestion pipeline.</p></Card></>;
}
function Integrations() {
  const api=useApi();const [result,reload]=useAsync(signal=>api.get<Envelope<Integration[]>>(endpoint+'integrations',{signal}),[]);
  return <><Notice title="Actual connectivity checks only">PostgreSQL is checked when this page loads. Gmail, S3 and the AI provider have no configured check and are shown as Not configured. No credentials are displayed.</Notice><DataTable id="email-automation-integrations" caption="Integration health" columns={[{key:'provider',header:'Integration',render:r=>r.provider},{key:'status',header:'Status',render:r=><Status value={r.status}/>},{key:'checkedAt',header:'Last real check',render:r=>r.checkedAt?formatDateTime(r.checkedAt):'Never checked'}]} rows={result.data?.data} rowKey={r=>r.provider} loading={result.status==='loading'} error={result.status==='error'?result.error:undefined} onRetry={reload}/></>;
}
function CrmLink({link}:{link:RecordLink}) {
  const href=link.kind==='customers'||link.kind==='quotations'?`/${link.kind}/${link.id}`:`/${link.kind}?open=${link.id}`;
  return <Link href={href}>{link.kind} #{link.id}</Link>;
}
export function EmailDetails({id}:{id:string}) {return <Permission permission="email_automation.read"><Detail id={id}/></Permission>;}
function Detail({id}:{id:string}) {
  const api=useApi();const [result,reload]=useAsync(signal=>api.get<Envelope<EmailDetail>>(endpoint+'emails/'+encodeURIComponent(id),{signal}),[id]);
  if(result.status==='error')return <div className="ds-page"><ErrorState error={result.error} onRetry={reload}/></div>;if(result.status!=='ready')return <Spinner/>;
  const email=result.data.data;
  return <div className="ds-page stack"><PageHeader title="Email details" description={email.subject} crumbs={[{label:'Unified email inbox',href:'/email-automation/inbox'},{label:'Email details'}]}/><Source sample={result.data.sample}/><Card title="Message"><dl className="ds-facts"><dt>From</dt><dd>{email.sender||'Not recorded'}</dd><dt>Received</dt><dd>{formatDateTime(email.receivedAt)}</dd><dt>Status</dt><dd><Status value={email.status}/></dd><dt>Message ID</dt><dd>{email.id}</dd></dl><p className={styles.body}>{email.body||'Email body preview is unavailable. Phase 1 does not retrieve external body contents.'}</p></Card><Card title="Matched CRM records">{email.links.length?<div className="cluster">{email.links.map(link=><CrmLink key={link.kind+link.id} link={link}/>)}</div>:<p>No matched CRM records available to your role.</p>}</Card><Card title="Attachments">{email.attachments.length?<ul>{email.attachments.map(a=><li key={a.id}><strong>{a.name}</strong> · {a.mimeType} · {a.bytes} bytes · {a.status}</li>)}</ul>:<p>No attachments recorded.</p>}<p className="subtle">Metadata only. File preview and download are not connected to S3.</p></Card><Card title="Processing history">{email.runs.length?<ul>{email.runs.map(run=><li key={run.id}>{run.stage} · <Status value={run.status}/> {run.errorCode&&<code>{run.errorCode}</code>}</li>)}</ul>:<p>No processing runs recorded.</p>}</Card></div>;
}
