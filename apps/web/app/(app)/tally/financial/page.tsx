'use client';
import {Suspense,useEffect,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {useScope} from '@/lib/scope';
import {useSession} from '@/lib/session';
import {CardSkeleton,EmptyState,UnauthorizedState} from '@/components/ds';
import {TallyFinancial} from '@/features/workflows/tally-financial';
export default function FinancialPage(){return <Suspense fallback={<CardSkeleton/>}><FinancialScope/></Suspense>;}
function FinancialScope(){
 const {companyId,companies,setCompanyId}=useScope(),{state,can}=useSession(),query=useSearchParams(),requested=query.get('companyId')||'',open=query.get('open')||undefined;
 const [applied,setApplied]=useState<string|null>(null);
 useEffect(()=>{if(!companies.length)return;if(requested&&companies.some(company=>company.id===requested))setCompanyId(requested);setApplied(requested);},[requested,companies,setCompanyId]);
 if(state.kind==='loading')return <CardSkeleton/>;
 if(state.kind!=='ready'||!['OWNER','ACCOUNTS'].includes(state.user.role)||!can('tally.read'))return <UnauthorizedState message="Tally financial records require Owner or Accounts."/>;
 if(companies.length&&requested!==applied)return <CardSkeleton/>;
 if(requested&&!companies.some(company=>company.id===requested))return <EmptyState title="Requested company is unavailable">Choose a valid imported company before opening financial evidence.</EmptyState>;
 const company=companies.find(row=>row.id===companyId);
 return company?<TallyFinancial key={company.id} company={company} open={requested===company.id?open:undefined}/>:<EmptyState title="Select a company">Choose an imported Tally company in the header.</EmptyState>;
}
