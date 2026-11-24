'use client';
import {useEffect,useState} from 'react';
import {PageHeader,SelectField} from '@/components/ds';
import {useSession} from '@/lib/session';
import {OperationsRequests,operationLabels} from '@/features/operations-intake/requests';
import type {OperationsKind} from '@/features/operations-intake/api';
export default function OperationsRequestsPage(){const [kind,setKind]=useState<OperationsKind>('ORDER_STATUS'),{can}=useSession();const permissions={ORDER_STATUS:'orders.read',STOCK:'items.read',PROCUREMENT:'purchasing.read',OTHER:'operations.read'};useEffect(()=>{if(!can(permissions[kind])){const first=(Object.keys(permissions) as OperationsKind[]).find(k=>can(permissions[k]));if(first)setKind(first);}},[can,kind]);return <div className="stack"><PageHeader title="Incoming Operations requests" description="Review requests delivered by the existing Operations automation."/><SelectField label="Request category" value={kind} options={(Object.keys(operationLabels) as OperationsKind[]).filter(k=>can(permissions[k])).map(value=>({value,label:operationLabels[value]}))} onChange={e=>setKind(e.target.value as OperationsKind)}/><OperationsRequests kind={kind}/></div>;}
