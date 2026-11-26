'use client';
import {useState} from 'react';
import {formatQty} from '@/lib/format';
import {useApi} from '@/lib/api/provider';
import {useSession} from '@/lib/session';
import {Badge,Button,Checkbox,DataTable,ErrorState,Notice,TextAreaField,TextField} from '@/components/ds';
interface ScheduleLine {lineKey:string;itemId:number;partCode:string;uom:string;ordered:string;accepted:string;pending:string}
export interface DeliverySchedule {originalDate:string;promisedDate:string;customerDate:string|null;revisionId:number|null;revisionReason:string|null;evidence:string|null;lines:ScheduleLine[];late:boolean;lateDays:number;customerDateAtRisk:boolean;pending:boolean;canRevise:boolean;note:string}
export function DeliverySchedulePanel({schedule,poId,version,onSaved}:{schedule:DeliverySchedule;poId:number;version:number;onSaved:()=>void}){
 const api=useApi(),{can}=useSession(),[date,setDate]=useState(''),[evidence,setEvidence]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>();
 const save=async()=>{setBusy(true);setError(undefined);try{await api.post('/api/crm/purchasing/pos/'+poId+'/delivery-promise',{version,previousRevisionId:schedule.revisionId,promisedDate:date,evidence,reason,supplierConfirmed:confirmed});setDate('');setEvidence('');setReason('');setConfirmed(false);onSaved();}catch(e){setError(e);}finally{setBusy(false);}};
 return <section className="stack" aria-label="Supplier delivery schedule"><div className="cluster"><h3>Supplier delivery schedule</h3><Badge tone={schedule.late||schedule.customerDateAtRisk?'warning':'success'}>{!schedule.pending?'Goods received':schedule.late?'Supplier delivery late':schedule.customerDateAtRisk?'Customer date at risk':'Date recorded'}</Badge></div>
  <dl className="ds-facts"><dt>Original PO delivery date</dt><dd>{schedule.originalDate}</dd><dt>Latest supplier promise</dt><dd>{schedule.promisedDate}</dd><dt>Customer promised date</dt><dd>{schedule.customerDate??'Not recorded'}</dd>{schedule.evidence&&<><dt>Supplier evidence</dt><dd>{schedule.evidence}</dd><dt>Revision reason</dt><dd>{schedule.revisionReason}</dd></>}</dl>
  {schedule.late&&<Notice tone="warning">Delivery is {schedule.lateDays} calendar days late and accepted quantities are still pending.</Notice>}
  {schedule.customerDateAtRisk&&<Notice tone="warning">The supplier promise is later than the recorded customer deadline. Contact the customer and arrange a revised plan.</Notice>}
  <DataTable<ScheduleLine> id="supplier-delivery-quantities" caption="Supplier delivery quantities" rows={schedule.lines} rowKey={r=>r.lineKey} columns={[{key:'item',header:'Item',render:r=>r.partCode},{key:'unit',header:'Unit',render:r=>r.uom},{key:'ordered',header:'Ordered',numeric:true,render:r=>formatQty(r.ordered)},{key:'received',header:'Accepted',numeric:true,render:r=>formatQty(r.accepted)},{key:'pending',header:'Pending',numeric:true,render:r=>formatQty(r.pending)}]}/>
  <p className="muted">{schedule.note}</p>
  {can('purchasing.write')&&schedule.canRevise&&<details><summary>Record a revised supplier promise</summary><div className="stack"><TextField label="Revised supplier delivery date" type="date" required value={date} onChange={e=>setDate(e.target.value)}/><TextAreaField label="Supplier email or document evidence reference" required value={evidence} onChange={e=>setEvidence(e.target.value)}/><TextAreaField label="Reason for delivery revision" required value={reason} onChange={e=>setReason(e.target.value)}/><Checkbox label="The supplier confirmed this date" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><Button disabled={busy||!confirmed||!date||evidence.trim().length<3||reason.trim().length<3} onClick={()=>void save()}>Save supplier promise</Button></div></details>}
  {error!==undefined&&<ErrorState error={error}/>}
 </section>;
}
