'use client';
import {Button,Card,Notice,SelectField,TextAreaField,TextField} from '@/components/ds';
import type {IntakeDetail,IntakeHeader,IntakeLine,MessageType} from './api';

const instructions:Record<string,string>={
 CUSTOMER_ONBOARDING_REQUIRED:'Select a verified customer, or open Customer onboarding to create one.',
 CUSTOMER_MATCH_AMBIGUOUS:'Several customers match. Confirm the correct existing customer.',
 CUSTOMER_IDENTIFIER_CONFLICT:'The supplied GSTIN differs from the selected customer. Check the original document before correcting it.',
 CUSTOMER_COMPANY_REVIEW_REQUIRED:'Confirm the customer for the selected selling company.',
 CUSTOMER_NOT_ACTIVE:'The customer must be active before this request can proceed.',
 CUSTOMER_APPROVAL_REQUIRED:'Complete customer onboarding approval in Customers.',
 CUSTOMER_HANDLER_REVIEW_REQUIRED:'The customer owner or an authorised colleague must handle this request.',
 DO_NOT_QUOTE:'This customer is restricted from quotations. An authorised customer-policy decision is required.',
 SALESPERSON_REVIEW_REQUIRED:'An administrator must assign an active salesperson with the required access.',
 ITEM_REVIEW:'Match this line to the correct catalogue item.',UNIT_REVIEW:'Check the unit against the catalogue item.',HSN_REVIEW:'Confirm the HSN/SAC against the catalogue item.',
 ITEM_COST_REQUIRED:'Ask the cost-authorised owner to enter the item cost in Quotations. Refresh this request afterwards.',
 PLACE_OF_SUPPLY_REQUIRED:'Enter the two-digit place-of-supply state code.',
 QUOTATION_VALIDITY_REQUIRED:'Enter the quotation validity date, or ask the Owner to configure the validity policy.',
 TAX_TREATMENT_REVIEW_REQUIRED:'Ask the Owner to confirm the tax treatment in Intake settings.',
 SELLER_STATE_CONFIRMATION_REQUIRED:'Ask the Owner to confirm the selling-company state in Intake settings.',
 QUOTATION_POLICY_REQUIRED:'Ask the Owner to configure the quotation rules in Rules.',
 DECLARED_TOTAL_MISMATCH:'Compare the original PO total with the reviewed quantities, prices, discounts and GST. Do not change it simply to force a match.',
 TAXABLE_AMOUNT_MISMATCH:'Check this line’s declared taxable amount against its price, quantity and discount.',
 PO_REVISION_REVIEW_REQUIRED:'Another request already uses this PO. Review the original request before treating this as a revision.',
 EXISTING_PO_REVIEW_REQUIRED:'This PO already exists. Review the existing customer PO before proceeding.',
 PO_ALREADY_HAS_SALES_ORDER:'This PO already has a sales order. Continue through the linked order.',
 QUOTATION_MATCH_REVIEW_REQUIRED:'The referenced quotation must belong to this customer and selling company.',
 QUOTATION_ALREADY_LINKED:'This quotation is already linked to another request. Review that request.',
 QUOTATION_MATCH_NOT_CURRENTLY_APPROVED:'Review the referenced quotation’s approval and current version.',
 DISCOUNT_PRECISION_REVIEW_REQUIRED:'The amount discount cannot be represented exactly. Confirm the intended discount with the customer.',
 DISCOUNT_EXCEEDS_LINE_VALUE:'The discount exceeds the line value. Check the original document.',
 QUOTATION_DECIMAL_LIMIT_REVIEW_REQUIRED:'The supplied precision exceeds quotation limits. Confirm the required values before proceeding.'
};
const fieldLabels:Record<string,string>={poNumber:'Customer PO number',poDate:'Customer PO date',buyerName:'Buyer / company name',totalPoValue:'Declared PO total',description:'Description',quantity:'Quantity',uom:'Unit of measurement',unitPrice:'Unit price',discount:'Discount',gstRate:'GST rate'};
function missingLabel(path:string){
 if(path==='items')return 'Item lines';
 const [group,line,field]=path.split('.');
 return group==='items'?`Line ${line}: ${fieldLabels[field]??field??'item details'}`:fieldLabels[line]??path;
}
export function ReviewIssues({blockers}:{blockers:string[]}){
 return <Notice tone="warning" title="Information needs review"><p>Resolve the items below, enter a reason and save. Remaining checks will stay visible; saving does not approve a quotation.</p><ul>{blockers.map((b,i)=>{const [code,...context]=b.split(':');return <li key={i}><strong>{code==='MISSING'?'Missing '+missingLabel(context.join(':')):code.replaceAll('_',' ')}</strong>: {code==='MISSING'?'Complete this field using the customer’s source document.':code==='QUOTE_PREPARATION'?'Complete the indicated item-line field.':instructions[code]??'Review this requirement in the linked CRM workflow, then refresh preparation.'}{code!=='MISSING'&&context.length>0&&<span> ({context.join(' · ')})</span>}</li>;})}</ul></Notice>;
}

type TextKey=Exclude<keyof IntakeHeader,'billingAddress'|'deliveryAddress'|'quotationId'|'customerId'>;
export function ReviewedHeader({header:h,type,onChange}:{header:IntakeHeader;type:MessageType;onChange:(h:IntakeHeader)=>void}){
 const field=(key:TextKey,label:string,type='text')=><TextField key={key} label={label} type={type} value={h[key]??''} onChange={e=>onChange({...h,[key]:e.target.value||null})}/>;
 return <div className="stack">
  <div className="grid-2">{field('buyerName','Buyer / company name')}{field('supplierName','Supplier / vendor name')}{field('gstin','GSTIN supplied for review')}{field('contactPerson','Contact person')}{field('email','Customer email','email')}{field('phone','Customer phone')}{type==='CUSTOMER_PO'&&<>{field('poNumber','Customer PO number')}{field('poDate','Customer PO date','date')}{field('totalPoValue','Declared PO total')}</>}{field('deliveryDate','Requested delivery date','date')}{field('placeOfSupply','Place of supply (state code)')}{field('validUntil','Quotation valid until','date')}
   <SelectField label="Supply treatment" value={h.supplyType??''} placeholder="Not supplied" options={[{value:'DOMESTIC_STANDARD',label:'Domestic standard'},{value:'SEZ',label:'SEZ — review required'},{value:'EXPORT',label:'Export — review required'},{value:'SPECIAL',label:'Special — review required'}]} onChange={e=>onChange({...h,supplyType:e.target.value||null})}/>
  </div>
  {(['billingAddress','deliveryAddress'] as const).map(key=><fieldset className="stack" key={key}><legend>{key==='billingAddress'?'Billing address':'Delivery address'}</legend><div className="grid-2">{(['text','line1','line2','city','stateCode','pincode','country'] as const).map(part=><TextField key={part} label={`${key==='billingAddress'?'Billing':'Delivery'} ${({text:'address text',line1:'address line 1',line2:'address line 2',city:'city',stateCode:'state code',pincode:'postal code',country:'country'})[part]}`} value={h[key]?.[part]??''} onChange={e=>{const address={...h[key],[part]:e.target.value||null};onChange({...h,[key]:Object.values(address).some(Boolean)?address:null});}}/>)}</div></fieldset>)}
  <TextAreaField label="Requested payment terms" value={h.paymentTerms??''} onChange={e=>onChange({...h,paymentTerms:e.target.value||null})}/>
  <TextAreaField label="Other customer terms" value={h.otherTerms??''} onChange={e=>onChange({...h,otherTerms:e.target.value||null})}/>
 </div>;
}

export function OriginalExtraction({detail:d}:{detail:IntakeDetail}){
 return <Card title="Original extracted information"><p className="muted">Review corrections are stored separately. The original extraction and source evidence remain unchanged.</p><details><summary>Compare with original fields and item lines</summary><dl className="stack">{Object.entries(d.normalized.header).map(([key,value])=><div key={key}><dt>{key.replace(/([A-Z])/g,' $1')}</dt><dd>{value===null?'Not supplied':typeof value==='object'?Object.values(value).filter(Boolean).join(', '):String(value)}</dd></div>)}</dl>{d.normalized.items.map(l=><p key={l.lineId}>Line {l.lineId}: {l.productCode??'Code not supplied'} · {l.description??'Description not supplied'} · {l.quantity??'Quantity not supplied'} {l.uom??''} · Price {l.unitPrice??'not supplied'} · GST {l.gstRate??'not supplied'}</p>)}</details></Card>;
}

export function ReviewedLineExtras({line:l,onChange}:{line:IntakeLine;onChange:(patch:Partial<IntakeLine>)=>void}){
 const schedule=(index:number,patch:Partial<IntakeLine['deliverySchedules'][number]>)=>onChange({deliverySchedules:l.deliverySchedules.map((s,i)=>i===index?{...s,...patch}:s)});
 return <div className="stack"><TextAreaField label={`Line terms ${l.lineId}`} value={l.terms??''} onChange={e=>onChange({terms:e.target.value||null})}/>{l.deliverySchedules.map((s,i)=><fieldset className="stack" key={i}><legend>Line {l.lineId}, delivery schedule {i+1}</legend><TextField label={`Schedule date ${l.lineId}-${i+1}`} type="date" value={s.date} onChange={e=>schedule(i,{date:e.target.value})}/><TextField label={`Schedule quantity ${l.lineId}-${i+1}`} value={s.quantity} onChange={e=>schedule(i,{quantity:e.target.value})}/><TextAreaField label={`Schedule terms ${l.lineId}-${i+1}`} value={s.terms??''} onChange={e=>schedule(i,{terms:e.target.value||null})}/><Button variant="ghost" onClick={()=>onChange({deliverySchedules:l.deliverySchedules.filter((_,j)=>j!==i)})}>Remove schedule {i+1} from line {l.lineId}</Button></fieldset>)}<Button variant="secondary" disabled={l.deliverySchedules.length>=50} onClick={()=>onChange({deliverySchedules:[...l.deliverySchedules,{date:'',quantity:'',terms:null}]})}>Add delivery schedule to line {l.lineId}</Button></div>;
}
