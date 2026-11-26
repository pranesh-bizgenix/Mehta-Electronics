import {createHash} from 'node:crypto';
import {calculateQuotation,scaled,money} from '../../../public/quotation-math.js';
import {amountInWords,financialYear} from '../../purchase-document-math.js';
import {validDate,validateTax} from '../../crm-modules.js';
import {validationFailed,conflict} from '../../core/errors.js';
import {INVOICE_REFERENCE_FIELDS,INVOICE_COMPANY_EXTRA_FIELDS} from '../../../public/invoice-fields.js';

export const text=(value,label,max=1000,required=true)=>{
 if(value==null&&!required)return '';
 if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw validationFailed(`${label} is required (maximum ${max} characters).`);
 return value.trim();
};
export const uuid=value=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw validationFailed('Invalid document identifier.');return value;};
export function invoiceNumber(prefix,date,sequence){
 if(!/^[A-Za-z0-9]{1,3}$/.test(prefix)||BigInt(sequence)<1n||BigInt(sequence)>999999n)throw validationFailed('Configure a 1–3 character invoice prefix; sequence supports 999999 invoices per year.');
 const fy=financialYear(date);return `${prefix}/${fy.slice(2,4)}${fy.slice(-2)}/${String(sequence).padStart(6,'0')}`;
}
export function validateBillingSettings(value){
 const v={};for(const key of ['name','address','gstin','contact','prefix','terms','signatory'])v[key]=text(value?.[key],key,key==='terms'?10000:500);
 for(const field of INVOICE_COMPANY_EXTRA_FIELDS)v[field.key]=text(value?.[field.key],field.label,field.maxLength,false);
 const tax=validateTax(v.gstin,'33');v.gstin=tax.gstin;v.stateCode='33';
 invoiceNumber(v.prefix,'2026-04-01',1);
 if(typeof value.crmIssuanceEnabled!=='boolean'||typeof value.irnRequired!=='boolean'||value.confirmed!==true)throw validationFailed('Explicitly confirm invoice origin, GST applicability and company details.');
 return {...v,crmIssuanceEnabled:value.crmIssuanceEnabled,irnRequired:value.irnRequired,confirmed:true};
}
export function invoiceReferences(value){
 const refs=value??{};
 if(typeof refs!=='object'||Array.isArray(refs)||Object.keys(refs).some(key=>!INVOICE_REFERENCE_FIELDS.some(field=>field.key===key)))throw validationFailed('Use the supported invoice payment and transport reference fields.');
 const references={};for(const field of INVOICE_REFERENCE_FIELDS){const value=text(refs[field.key],field.label,field.maxLength,false);if(value&&field.type==='date'&&!validDate(value))throw validationFailed('Enter a valid agreed payment due date.');references[field.key]=value;}
 return references;
}
export function invoicePayload(input,customer,company){
 if(!validDate(input.date))throw validationFailed('Enter a valid invoice date.');
 const supply=text(input.placeOfSupply,'Place of supply',2);if(!/^(0[1-9]|[12][0-9]|3[0-8])$/.test(supply))throw validationFailed('Enter a two-digit place-of-supply state code.');
 if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>100)throw validationFailed('Enter 1 to 100 invoice lines.');
 const lines=input.lines.map(l=>({code:text(l.code,'Item code',100),description:text(l.description,'Description',1000),hsn:text(l.hsn,'HSN',8),uom:text(l.uom,'UoM',20),quantity:String(l.quantity??''),unitPrice:String(l.unitPrice??''),discountPercent:'0',taxPercent:String(l.taxPercent??'')}));
 for(const l of lines)if(!/^\d{4,8}$/.test(l.hsn))throw validationFailed('HSN must contain 4 to 8 digits.');
 let totals;try{totals=calculateQuotation(lines,'33',supply);}catch(e){throw validationFailed(e.message);}
 if(scaled(totals.total)>999999999999000000n)throw validationFailed('Invoice total exceeds supported limit.');
 const minor=scaled(totals.total)/10000n,rounded=input.roundToRupee===true?((minor+50n)/100n)*100n:minor;
 totals={...totals,roundOff:money(rounded-minor),total:money(rounded)};
 const references=invoiceReferences(input.references);
 return {date:input.date,placeOfSupply:supply,billTo:text(input.billTo,'Bill-to address',1000),shipTo:text(input.shipTo,'Ship-to address',1000),customer:{id:customer.id,name:customer.name,gstin:customer.gstin||''},company:company||{},references,lines:totals.lines,totals,amountInWords:amountInWords(totals.total),terms:text(input.terms,'Terms',10000,false)};
}
export function requireIssuance(settings){
 if(!settings?.confirmed||!settings.crmIssuanceEnabled)throw conflict('CRM invoice issuance is not enabled in confirmed billing settings.');
 if(settings.irnRequired)throw conflict('IRN-required issuance is blocked until a verified GST-provider integration exists. No IRN is fabricated.');
}
export function originalPdf(base64){
 if(typeof base64!=='string'||base64.length>6990510||!/^[-A-Za-z0-9+/=]+$/.test(base64))throw validationFailed('Choose a PDF no larger than 5 MB.');
 const bytes=Buffer.from(base64,'base64');
 if(bytes.length>5242880||bytes.subarray(0,5).toString()!=='%PDF-'||!bytes.subarray(-2048).includes(Buffer.from('%%EOF')))throw validationFailed('Choose a complete PDF no larger than 5 MB.');
 return {bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
}
