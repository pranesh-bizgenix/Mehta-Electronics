'use client';
import {WorkflowNavigation} from '@/components/ds';
import {useSession} from '@/lib/session';

export function InboxNavigation({current}:{current:'SALES'|'ACCOUNTS'|'SUPPORT'}){
 const {can}=useSession();
 const inboxes=[
  {id:'SALES',href:'/incoming-requests',label:'Sales requests',visible:can('sales_intake.read')},
  {id:'ACCOUNTS',href:'/accounts/incoming',label:'Accounts requests',visible:can('collections.read')},
  {id:'SUPPORT',href:'/support/incoming',label:'Support requests',visible:can('operations.read')},
  {id:'OPERATIONS',href:'/operations/requests',label:'Operations requests',visible:can('orders.read')||can('items.read')||can('purchasing.read')||can('operations.read')}
 ].filter(inbox=>inbox.visible);
 if(!inboxes.length)return null;
 return <WorkflowNavigation label={'Department inboxes, viewing '+current.toLowerCase()} links={inboxes.map(inbox=>({href:inbox.href,label:inbox.label,icon:'inbox'}))}/>;
}
