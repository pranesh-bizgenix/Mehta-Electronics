'use client';
import Link from 'next/link';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {newIdempotencyKey} from '@/lib/api/client';
import {useSession} from '@/lib/session';
import {Button,Card,Checkbox,DataTable,ErrorState,Notice,SelectField,TextAreaField,TextField} from '@/components/ds';
import {PdfActions} from '@/features/billing/pdf-actions';
import {formatMoney,titleCase} from '@/lib/format';
import type {Comparison} from './api';

interface Allocation {key:string;itemId:string;replyId:string;quantity:string;promisedOn:string}
interface AwardLine {lineKey:string;itemId:number;partCode:string;quantity:string;uom:string;unitPrice:string;promisedOn:string}
interface AwardGroup {vendorId:number;vendor:{name:string};lines:AwardLine[];subtotal:string;total:string;deliveryBy:string}
interface Award {id:string;status:string;version:number;created_by:number;creator_name:string;reviewer_name?:string;evidence:string;snapshot:{preview:{total:string;groups:AwardGroup[]}};orders:{id:number;number:string;status:string;vendor_id:number}[]}
const blank=(itemId=''):Allocation=>({key:newIdempotencyKey(),itemId,replyId:'',quantity:'',promisedOn:''});
function allocated(values:string[]){
 try{let sum=BigInt(0);for(const value of values){if(!value)continue;if(!/^\d{1,12}(?:\.\d{1,6})?$/.test(value))return 'Check quantity';const [whole,fraction='']=value.split('.');sum+=BigInt(whole)*BigInt(1000000)+BigInt(fraction.padEnd(6,'0'));}return `${sum/BigInt(1000000)}.${String(sum%BigInt(1000000)).padStart(6,'0')}`.replace(/\.?0+$/,'');}catch{return 'Check quantity';}
}

export function SplitAwards({comparison}:{comparison:Comparison}){
 const api=useApi(),{can,state}=useSession(),[plans,setPlans]=useState<Award[]>([]),[rows,setRows]=useState<Allocation[]>(()=>comparison.rfq.payload.lines.map(item=>blank(String(item.itemId)))),[evidence,setEvidence]=useState(''),[reason,setReason]=useState(''),[termsConfirmed,setTermsConfirmed]=useState(false),[actionReason,setActionReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[notice,setNotice]=useState('');
 const retry=useRef({body:'',key:''});
 const load=useCallback(async()=>{setPlans(await api.data<Award[]>('GET',`/api/crm/sourcing/rfqs/${comparison.rfq.id}/awards`));},[api,comparison.rfq.id]);
 useEffect(()=>{const abort=new AbortController();api.data<Award[]>('GET',`/api/crm/sourcing/rfqs/${comparison.rfq.id}/awards`,undefined,{signal:abort.signal}).then(setPlans).catch(e=>{if(!abort.signal.aborted)setError(e);});return()=>abort.abort();},[api,comparison.rfq.id]);
 const active=plans.some(p=>['PENDING_APPROVAL','APPROVED','ORDERED'].includes(p.status));
 const update=(key:string,patch:Partial<Allocation>)=>setRows(current=>current.map(row=>row.key===key?{...row,...patch}:row));
 const run=async(task:()=>Promise<unknown>,message:string)=>{if(busy)return;setBusy(true);setError(undefined);setNotice('');try{await task();await load();setNotice(message);}catch(e){setError(e);}finally{setBusy(false);}};
 const submit=()=>run(async()=>{
  const body={rfqVersion:comparison.rfq.version,comparisonFingerprint:comparison.comparisonFingerprint,termsConfirmed,evidence,reason,allocations:rows.map(row=>({itemId:Number(row.itemId),replyId:Number(row.replyId),quantity:row.quantity,promisedOn:row.promisedOn}))};
  const serialized=JSON.stringify(body);if(retry.current.body!==serialized)retry.current={body:serialized,key:newIdempotencyKey()};
  await api.post(`/api/crm/sourcing/rfqs/${comparison.rfq.id}/awards`,{...body,requestKey:retry.current.key});
 },'Split submitted for independent approval. No supplier PO has been issued.');
 const act=(plan:Award,action:string)=>run(async()=>{await api.post(`/api/crm/sourcing/awards/${plan.id}/decision`,{version:plan.version,action,reason:actionReason});retry.current={body:'',key:''};},action==='CREATE_ORDERS'?'Supplier PO drafts created. Open each PO for its existing approval and issue checks.':'Split decision recorded.');
 return <Card title="Split supplier award">
  <div className="stack">
   <p>Allocate the requested quantity across suppliers, confirm their rates and charges, then send the complete split for independent approval.</p>
   <Notice tone="info">Freight and packing are copied once per supplier PO at the full quoted amount. A split never approves or issues its generated POs.</Notice>
   {notice&&<Notice>{notice}</Notice>}{error!==undefined&&<ErrorState error={error}/>}
   <DataTable bare id="split-demand" caption="Requested and allocated quantities" rows={comparison.rfq.payload.lines} rowKey={item=>item.itemId} columns={[{key:'item',header:'Item',render:item=>item.partCode},{key:'requested',header:'Requested',render:item=>`${item.quantity} ${item.uom}`},{key:'allocated',header:'Allocated in this form',render:item=>`${allocated(rows.filter(row=>row.itemId===String(item.itemId)).map(row=>row.quantity))} ${item.uom}`}]} />
   {can('purchasing.write')&&!active&&comparison.rfq.status==='OPEN'&&<form className="stack" onSubmit={event=>{event.preventDefault();void submit();}}>
    {rows.map((row,index)=>{
     const selected=comparison.landedRows.find(item=>item.item.itemId===Number(row.itemId));
     return <fieldset key={row.key} className="stack-sm" disabled={busy}><legend>Allocation {index+1}</legend><div className="row">
      <SelectField label={`Item for allocation ${index+1}`} required value={row.itemId} placeholder="Choose requested item" options={comparison.rfq.payload.lines.map(item=>({value:String(item.itemId),label:item.partCode}))} onChange={event=>update(row.key,{itemId:event.target.value,replyId:''})}/>
      <SelectField label={`Supplier for allocation ${index+1}`} required value={row.replyId} placeholder="Choose an offered supplier" options={(selected?.offers||[]).filter(offer=>offer.available).map(offer=>({value:String(offer.replyId),label:`${offer.vendorName||'Supplier '+offer.vendorId} · offered ${offer.baseQuantity} · landed ${offer.landedBaseRateExGst}`}))} onChange={event=>{const offer=selected?.offers.find(value=>String(value.replyId)===event.target.value);update(row.key,{replyId:event.target.value,promisedOn:offer?.promisedOn||row.promisedOn});}}/>
      <TextField label={`Base-unit quantity ${index+1}`} inputMode="decimal" required value={row.quantity} onChange={event=>update(row.key,{quantity:event.target.value})}/>
      <TextField label={`Confirmed delivery date ${index+1}`} type="date" required value={row.promisedOn} onChange={event=>update(row.key,{promisedOn:event.target.value})}/>
     </div><Button variant="ghost" disabled={rows.length===1||busy} onClick={()=>setRows(current=>current.filter(value=>value.key!==row.key))}>Remove allocation {index+1}</Button></fieldset>;
    })}
    <Button variant="secondary" disabled={busy||rows.length>=300} onClick={()=>setRows(current=>[...current,blank()])}>Add supplier allocation</Button>
    <TextAreaField label="Supplier confirmation evidence" required value={evidence} onChange={event=>setEvidence(event.target.value)}/>
    <Checkbox label="Suppliers confirmed these awarded quantities, unit prices and full freight/packing charges" checked={termsConfirmed} onChange={event=>setTermsConfirmed(event.target.checked)}/>
    <TextAreaField label="Split award reason" required value={reason} onChange={event=>setReason(event.target.value)}/>
    <Button type="submit" disabled={busy||!termsConfirmed||reason.trim().length<3||evidence.trim().length<3}>Request split approval</Button>
   </form>}
   {active&&<Notice>The active split is shown below. Resolve it before creating another plan or selecting an ordinary RFQ winner.</Notice>}
   {plans.length>0&&<TextAreaField label="Split decision / PO creation reason" value={actionReason} onChange={event=>setActionReason(event.target.value)}/>}
   {plans.map(plan=><section key={plan.id} className="stack-sm"><h3>{titleCase(plan.status)} · Version {plan.version}</h3><p>Prepared by {plan.creator_name}. {plan.reviewer_name&&`Reviewed by ${plan.reviewer_name}.`} Total {formatMoney(plan.snapshot.preview.total)}</p>
    <DataTable bare id={`award-${plan.id}`} caption="Awarded supplier commitments" rows={plan.snapshot.preview.groups} rowKey={group=>group.vendorId} columns={[{key:'supplier',header:'Supplier',render:group=>group.vendor.name},{key:'allocation',header:'Items and delivery commitments',render:group=>group.lines.map(line=>`${line.partCode}: ${line.quantity} ${line.uom} by ${line.promisedOn}`).join('; ')},{key:'cost',header:'Total including GST and charges',render:group=>formatMoney(group.total)}]}/>
    <div className="cluster">
     {can('purchasing.approve')&&plan.status==='PENDING_APPROVAL'&&state.kind==='ready'&&state.user.id!==plan.created_by&&<><Button disabled={busy||actionReason.trim().length<3} onClick={()=>void act(plan,'APPROVE')}>Approve split</Button><Button variant="secondary" disabled={busy||actionReason.trim().length<3} onClick={()=>void act(plan,'REJECT')}>Reject split</Button></>}
     {can('purchasing.write')&&plan.status==='APPROVED'&&<Button disabled={busy||actionReason.trim().length<3} onClick={()=>void act(plan,'CREATE_ORDERS')}>Create supplier PO drafts</Button>}
     {can('purchasing.write')&&['PENDING_APPROVAL','APPROVED','ORDERED'].includes(plan.status)&&<Button variant="ghost" disabled={busy||actionReason.trim().length<3} onClick={()=>void act(plan,'CANCEL')}>Cancel split</Button>}
    </div>
    {plan.orders?.map(order=><Link key={order.id} href={`/purchasing?kind=pos&open=${order.id}`}>{order.number} · {titleCase(order.status)}</Link>)}
    <details><summary>Download split award PDF</summary><PdfActions path={`/api/crm/sourcing/awards/${plan.id}/pdf`} body={{}} filename={`supplier-split-${plan.id}.pdf`}/></details>
   </section>)}
  </div>
 </Card>;
}
