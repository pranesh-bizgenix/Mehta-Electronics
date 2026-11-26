'use client';
import {TextField} from '@/components/ds';
import {INVOICE_REFERENCE_FIELDS,INVOICE_COMPANY_EXTRA_FIELDS} from '../../../../public/invoice-fields.js';

export function InvoiceReferenceFields({value,onChange}:{value:Record<string,string>;onChange:(value:Record<string,string>)=>void}){
 return <details className="stack"><summary>Payment and transport references (optional)</summary><p className="muted">Enter agreed details only. Linked order, carrier and LR references are read from the recorded shipment when available.</p><div className="row">{INVOICE_REFERENCE_FIELDS.map(field=><TextField key={field.key} label={field.label} type={field.type??'text'} maxLength={field.maxLength} value={value[field.key]??''} onChange={e=>onChange({...value,[field.key]:e.target.value})}/>)}</div></details>;
}
export function InvoiceCompanyFields({value,onChange}:{value:Record<string,string|boolean>;onChange:(value:Record<string,string|boolean>)=>void}){
 return <details className="stack"><summary>Registration and remittance details (optional)</summary><p className="muted">These details appear on newly created invoice records. Existing invoices retain their saved company details.</p><div className="row">{INVOICE_COMPANY_EXTRA_FIELDS.map(field=><TextField key={field.key} label={field.label} maxLength={field.maxLength} value={String(value[field.key]??'')} onChange={e=>onChange({...value,[field.key]:e.target.value})}/>)}</div></details>;
}
