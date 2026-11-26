'use client';
import Link from 'next/link';
import {usePathname,useSearchParams} from 'next/navigation';
import {Icon,type IconName} from './icons';

export interface WorkflowLink {href:string;label:string;icon?:IconName}
/** Context links are navigational anchors, with one exact active destination. */
export function WorkflowNavigation({label,links}:{label:string;links:WorkflowLink[]}){
 const pathname=usePathname(),query=useSearchParams();
 return <nav className="cd-workflow-nav" aria-label={label}>{links.map(link=>{
  const [path,search]=link.href.split('?'),expected=new URLSearchParams(search);
  const active=pathname===path&&[...expected].every(([key,value])=>query.get(key)===value);
  return <Link key={link.href} href={link.href} className="cd-workflow-link" aria-current={active?'page':undefined}>{link.icon&&<Icon name={link.icon}/>}<span>{link.label}</span></Link>;
 })}</nav>;
}
