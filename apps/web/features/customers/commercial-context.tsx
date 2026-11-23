'use client';
import Link from 'next/link';
import {useMemo,useState} from 'react';
import {useApi} from '@/lib/api/provider';
import {useScope} from '@/lib/scope';
import {Button,ErrorState,Notice,useAsync} from '@/components/ds';
import {titleCase,formatMoney} from '@/lib/format';
import {customerManagementApi,pricingBinding,type PricingBinding} from './management-api';

export function CustomerCommercialSummary({customerId,companyId:provided}:{customerId:number;companyId?:string}){
 const api=useApi(),scope=useScope(),companyId=provided||scope.companyId,client=useMemo(()=>customerManagementApi(api,customerId),[api,customerId]);
 const [result]=useAsync(signal=>companyId?Promise.all([client.commercial(companyId,signal),client.classification(companyId,signal)]):Promise.resolve(null),[client,companyId]);
 if(!companyId)return <p className="muted">Select a company to review customer pricing and purchase history.</p>;
 if(result.status==='error')return <ErrorState error={result.error}/>;
 if(result.status!=='ready'||!result.data)return null;
 const [commercial,classification]=result.data;
 return <Notice tone={classification.restriction==='DO_NOT_QUOTE'?'warning':'info'} title={classification.restriction==='DO_NOT_QUOTE'?'Do Not Quote - Owner review required':'Customer commercial context'}><p>Pricing class: {commercial.context.pricingClass?titleCase(commercial.context.pricingClass):'Not classified'} · Purchase-history classification: {classification.classification?titleCase(classification.classification):titleCase(classification.state)}{classification.tier?' · '+titleCase(classification.tier):''}</p><Link href={`/customers/${customerId}`}>Review customer rules and history</Link></Notice>;
}
export interface CustomerPricePatch {unitPrice?:string;discountPercent?:string;customerPricing?:PricingBinding;pricingSelection?:{level:number;fingerprint:string}}
export function CustomerPricingLine({customerId,itemId,quantity,companyId:provided,onApply}:{customerId?:number|string;itemId?:number|string;quantity:string;companyId?:string;onApply:(patch:CustomerPricePatch)=>void}){
 const api=useApi(),scope=useScope(),companyId=provided||scope.companyId,[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(),[message,setMessage]=useState('');
 return <div className="stack-sm"><Button variant="secondary" disabled={busy||!customerId||!itemId||!quantity||!companyId} onClick={async()=>{setBusy(true);setError(undefined);setMessage('');try{const value=await customerManagementApi(api,Number(customerId)).previewPricing(companyId!,Number(itemId),quantity);if(value.state==='UNCLASSIFIED'){setMessage('No customer pricing class is recorded. Existing contract and quotation checks still apply.');return;}onApply({customerPricing:pricingBinding(value),...(value.state==='RESOLVED'?{unitPrice:value.unitPrice,discountPercent:'0',pricingSelection:value.source?.level&&value.source.fingerprint?{level:value.source.level,fingerprint:value.source.fingerprint}:undefined}:{})});setMessage(value.state==='RESOLVED'?`Applied ${titleCase(value.context.pricingClass||'customer')} net rate ${formatMoney(value.unitPrice||'0')}.`:'Manual-review class recorded; normal price and approval checks remain.');}catch(e){setError(e);}finally{setBusy(false);}}}>Apply customer pricing</Button>{message&&<p role="status">{message}</p>}{Boolean(error)&&<ErrorState error={error}/>}</div>;
}
