import Link from 'next/link';
import {Badge} from '@/components/ds';
import {formatDateTime,titleCase} from '@/lib/format';
export interface OrderSync {status:string;company:{id:string;name:string}|null;lastSyncAt:string|null;lastAttemptAt:string|null;lastError:Record<string,unknown>|null;conflict:{id:string;path:string}|null;note:string}
export function OrderSyncStatus({value,compact=false}:{value?:OrderSync;compact?:boolean}){
 if(!value)return <span>Sync evidence unavailable</span>;
 const label=value.status==='NOT_YET_SYNCED'?'Not yet synced':titleCase(value.status);
 return <div className="stack"><Badge tone={['FAILED','CONFLICT','MISMATCH'].includes(value.status)?'warning':'neutral'}>{label}</Badge>{!compact&&<><p>{value.note}</p>{value.company&&<p>Source company: {value.company.name}</p>}<p>Last source import: {value.lastSyncAt?formatDateTime(value.lastSyncAt):'Not recorded'} · Last attempt: {value.lastAttemptAt?formatDateTime(value.lastAttemptAt):'Not recorded'}</p>{value.lastError&&<p>Last error: {String(value.lastError.message||value.lastError.code||'Recorded; inspect sync evidence')}</p>}</>}{value.conflict&&<Link href={value.conflict.path}>Review conflict</Link>}</div>;
}
