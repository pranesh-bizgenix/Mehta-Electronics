'use client';

import Link from 'next/link';
import { useApi } from '@/lib/api/provider';
import { useSession } from '@/lib/session';
import { Badge, Button, Card, CardSkeleton, EmptyState, ErrorState, Notice, PageHeader, useAsync } from '@/components/ds';
import { formatDateTime } from '@/lib/format';

interface Readiness {checkedAt:string;readyCount:number;total:number;rows:{key:string;label:string;status:'READY'|'NEEDS_ATTENTION';detail:string;href:string;action:string}[]}

export default function SetupPage() {
  const {state}=useSession();
  if(state.kind!=='ready')return <CardSkeleton/>;
  if(state.user.role!=='OWNER')return <Notice tone="warning" title="Owner access required">Only the Owner can view setup readiness.</Notice>;
  return <SetupChecklist/>;
}

function SetupChecklist() {
  const api=useApi();
  const [result,reload]=useAsync(()=>api.data<Readiness>('GET','/api/v1/setup'),[]);
  return <div className="stack-lg">
    <PageHeader title="Setup checklist" crumbs={[{label:'Administration'},{label:'Setup'}]} description="Live account, CRM and operational prerequisites. Review each gap before using the workflows it affects." actions={<Button variant="secondary" icon="refresh" onClick={reload}>Refresh readiness</Button>}/>
    {result.status==='loading'&&!result.data?<CardSkeleton/>:result.status==='error'?<ErrorState error={result.error} onRetry={reload}/>:result.data&&<>
      {!result.data.rows.length&&<EmptyState title="No readiness checks returned">Refresh readiness. An empty response does not mean the system is ready.</EmptyState>}
      <Card title={`${result.data.readyCount} of ${result.data.total} checks ready`}><p className="muted">Checked {formatDateTime(result.data.checkedAt)}. Refresh after making changes.</p><p>Readiness records configuration and account availability. Each transaction still runs its own approval, pricing, stock and credit checks.</p></Card>
      <Card title="Readiness checks" padded={false}><ul className="ds-list">{result.data.rows.map(row=><li key={row.key} className="ds-list-item"><div className="stack-sm"><div className="cluster-between"><strong>{row.label}</strong><Badge tone={row.status==='READY'?'success':'warning'}>{row.status==='READY'?'Ready':'Needs attention'}</Badge></div><p>{row.detail}</p><Link href={row.href}>{row.action}</Link></div></li>)}</ul></Card>
    </>}
    <section id="mfa" className="stack-sm"><Card title="MFA setup"><p>Role requirements and enrollment come from the database. Runtime enforcement is controlled by <code>MFA_ENABLED</code> in this app's environment. If it is OFF, the operator must set it to true and restart the existing application.</p><p><Link href="/users?tab=roles">Review role MFA requirements</Link> and <Link href="/users">staff enrollment</Link>. Each person enrolls through the existing sign-in flow; the Owner can enroll in <Link href="/settings">Settings</Link>.</p><p className="muted">This checklist does not change MFA policy or runtime configuration.</p></Card></section>
    <section id="backup" className="stack-sm"><Card title="Create a verified local backup"><p>From this repository, the operator runs <code>npm.cmd run db:backup</code>. A completed, verified archive is saved under the ignored backups folder, and its receipt is recorded in the database. Then refresh this checklist.</p><p>The age check uses the existing 10-minute production migration requirement. It is not an invented daily backup schedule. The migration runner independently checks the actual archive, size and checksum before migration.</p><p className="muted">A recorded receipt confirms a completed backup at that time. It does not prove the archive still exists or that restoration has been tested. <Link href="/audit">View the audit trail</Link>.</p></Card></section>
  </div>;
}
