'use client';
import Link from 'next/link';
import {useSession} from '@/lib/session';

export function InboxNavigation({current}:{current:'SALES'|'ACCOUNTS'}){
 const {can}=useSession();
 const inboxes=[
  {id:'SALES',href:'/incoming-requests',label:'Sales requests',visible:can('sales_intake.read')},
  {id:'ACCOUNTS',href:'/accounts/incoming',label:'Accounts requests',visible:can('collections.read')},
  {id:'OPERATIONS',href:'/operations/requests',label:'Operations requests',visible:can('orders.read')||can('items.read')||can('purchasing.read')||can('operations.read')}
 ].filter(inbox=>inbox.visible);
 if(!inboxes.length)return null;
 return <div className="stack-sm"><nav className="cluster" aria-label="Incoming request inboxes"><span className="muted">Open inbox:</span>{inboxes.map(inbox=><Link key={inbox.id} href={inbox.href} aria-current={current===inbox.id?'page':undefined}>{current===inbox.id?<strong>{inbox.label}</strong>:inbox.label}</Link>)}</nav><p className="muted">Customer POs, quotations and enquiries appear in Sales. Invoice, payment and due-date messages appear in Accounts. Order, stock and procurement messages appear in Operations.</p></div>;
}
