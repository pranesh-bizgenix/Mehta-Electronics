'use client';
import Link from 'next/link';
import {Icon,type IconName} from '@/components/ds';
import {useSession} from '@/lib/session';

type Shortcut={href:string;title:string;description:string;permission:string;icon:IconName};
const sales:Shortcut[]=[
 {href:'/incoming-requests',title:'Sales requests',description:'Review customer POs, quotation requests and enquiries.',permission:'sales_intake.read',icon:'inbox'},
 {href:'/quotations',title:'Quotations',description:'Prepare prices and follow the approval steps.',permission:'quotations.read',icon:'quote'},
 {href:'/orders',title:'Customer orders',description:'See ordered, supplied and pending quantities.',permission:'orders.read',icon:'truck'}
];
const operations:Shortcut[]=[
 {href:'/operations/requests',title:'Operations requests',description:'Review order, stock and procurement messages.',permission:'operations.read',icon:'inbox'},
 {href:'/items/stock-checks',title:'Stock checks',description:'Check recorded availability and shortages.',permission:'items.read',icon:'items'},
 {href:'/purchasing',title:'Purchasing',description:'Follow supplier enquiries and purchase orders.',permission:'purchasing.read',icon:'cart'},
 {href:'/purchasing/sourcing',title:'Supplier comparisons',description:'Compare quantities, delivery and landed prices.',permission:'purchasing.read',icon:'cart'}
];
const accounts:Shortcut[]=[
 {href:'/accounts/incoming',title:'Accounts requests',description:'Review invoice, payment and balance messages.',permission:'collections.read',icon:'inbox'},
 {href:'/billing',title:'Invoice documents',description:'Access invoice records and available PDF copies.',permission:'collections.read',icon:'ledger'},
 {href:'/operations?kind=COLLECTION',title:'Collection follow-ups',description:'Track outstanding-payment follow-ups.',permission:'collections.read',icon:'clock'},
 {href:'/operations?kind=RECEIPT',title:'Payment receipts',description:'Review recorded receipts and confirmations.',permission:'collections.read',icon:'ledger'}
];
const support:Shortcut[]=[
 {href:'/support/incoming',title:'Support requests',description:'Review incoming product and service questions.',permission:'operations.read',icon:'inbox'},
 {href:'/operations?kind=SUPPORT',title:'Customer complaints',description:'Follow assigned complaints and response history.',permission:'operations.read',icon:'tasks'},
 {href:'/operations?kind=WARRANTY',title:'Warranty claims',description:'Check evidence and follow claim decisions.',permission:'operations.read',icon:'tasks'},
 {href:'/operations?kind=RETURN',title:'Returns',description:'Follow return requests and recorded decisions.',permission:'operations.read',icon:'truck'}
];
export function DepartmentWorkspace(){
 const {can}=useSession();
 const shortcuts=can('access.manage')?[sales[0],operations[0],accounts[0],support[0]]:can('collections.write')?accounts:can('purchasing.write')&&!can('quotations.create')?operations:can('quotations.create')?sales:support;
 const visible=shortcuts.filter(s=>can(s.permission));
 if(!visible.length)return null;
 return <section className="cd-workspaces" aria-labelledby="workspace-title"><h2 id="workspace-title">Your workspaces</h2><nav className="ds-workspace-launcher" aria-label="Your work areas">{visible.map(s=><Link key={s.href} href={s.href} className="ds-workspace-shortcut"><span className="cd-shortcut-icon"><Icon name={s.icon}/></span><span className="cd-shortcut-copy"><strong>{s.title}</strong><small>{s.description}</small></span><Icon name="chevronRight" className="cd-shortcut-arrow"/></Link>)}</nav></section>;
}
