'use client';
import {useEffect,useRef} from 'react';
import {useScope} from '@/lib/scope';
import {useSession} from '@/lib/session';
import {EmptyState,UnauthorizedState} from '@/components/ds';
import {TallyConflicts} from '@/features/workflows/tally-conflicts';
export default function ConflictsPage(){
 const {companyId,companies,setCompanyId}=useScope(),{can}=useSession(),applied=useRef(false);
 useEffect(()=>{if(applied.current||!companies.length)return;applied.current=true;const requested=new URLSearchParams(window.location.search).get('companyId');if(requested&&companies.some(company=>company.id===requested))setCompanyId(requested);},[companies,setCompanyId]);
 if(!can('tally.read'))return <UnauthorizedState/>;
 const company=companies.find(row=>row.id===companyId);
 return company?<TallyConflicts key={company.id} company={company}/>:<EmptyState title="Select a company">Choose an imported Tally company in the header.</EmptyState>;
}
