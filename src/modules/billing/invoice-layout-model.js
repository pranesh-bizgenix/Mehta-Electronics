import {add,decimal,div,format} from '../../../public/money.js';
import {validationFailed} from '../../core/errors.js';

export const INVOICE_LAYOUT_VERSION='mehta-reference-1';
const clean=value=>typeof value==='string'?value.trim():'';
const optional=(value,fallback='Not supplied')=>clean(value)||fallback;
const minor=value=>{
 if(typeof value!=='string'||! /^-?\d{1,18}(?:\.\d{1,2})?$/.test(value))throw validationFailed('The invoice contains an invalid stored money amount.');
 const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^-/,'').split('.');
 return (negative?-1n:1n)*(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
};
const amount=n=>format({n,d:100n},2);
export const invoiceQuantity=value=>format(decimal(value),6).replace(/\.?0+$/,'').replace(/^$/,'0');
function date(value){return /^\d{4}-\d{2}-\d{2}$/.test(clean(value))?value.slice(8,10)+'.'+value.slice(5,7)+'.'+value.slice(0,4):optional(value);}

/** Presentation-only model. Stored net/GST/round-off amounts are authoritative;
 * no supplier/customer data, legal text or statutory identifiers are inferred. */
export function invoiceLayoutModel(record){
 const p=record.payload,c=p.company??{},customer=p.customer??{},refs=p.references??{},t=p.totals;
 if(!Array.isArray(p.lines)||p.lines.length<1||p.lines.length>100)throw validationFailed('An invoice PDF requires between one and 100 saved lines.');
 const groups=new Map(),units=new Map();let net=0n,cgst=0n,sgst=0n,igst=0n,gross=0n;
 const lines=p.lines.map((line,index)=>{
  const values=Object.fromEntries(['net','cgst','sgst','igst','total'].map(k=>[k,minor(line[k])]));
  if(values.total!==values.net+values.cgst+values.sgst+values.igst)throw validationFailed('Saved invoice line amounts do not reconcile.');
  const rate=decimal(line.taxPercent),half=format(div(rate,decimal('2')),6).replace(/\.?0+$/,'');
  const beforeDiscount=minor(format({n:decimal(line.quantity).n*decimal(line.unitPrice).n,d:decimal(line.quantity).d*decimal(line.unitPrice).d},2));
  net+=values.net;cgst+=values.cgst;sgst+=values.sgst;igst+=values.igst;gross+=beforeDiscount;
  const local=p.placeOfSupply===(c.stateCode||'33'),key=clean(line.hsn)+'|'+format(rate,6)+'|'+local;
  let group=groups.get(key);if(!group){group={hsn:optional(line.hsn),rate:invoiceQuantity(line.taxPercent),halfRate:half||'0',net:0n,cgst:0n,sgst:0n,igst:0n};groups.set(key,group);}
  for(const k of ['net','cgst','sgst','igst'])group[k]+=values[k];
  const uom=optional(line.uom),unitKey=uom.toUpperCase(),unit=units.get(unitKey)??{uom,quantity:decimal('0')};unit.quantity=add(unit.quantity,decimal(line.quantity));units.set(unitKey,unit);
  return {index:index+1,code:optional(line.code),description:clean(line.description),hsn:optional(line.hsn),uom,quantity:invoiceQuantity(line.quantity),rate:format(decimal(line.unitPrice),2),gross:amount(beforeDiscount),discount:invoiceQuantity(line.discountPercent??'0'),net:amount(values.net),taxLabel:local?`CGST ${half||'0'}%\n${t.localTaxLabel||'SGST'} ${half||'0'}%`:`IGST ${invoiceQuantity(line.taxPercent)}%`,total:amount(values.total)};
 });
 const roundOff=minor(t.roundOff??'0.00'),total=minor(t.total);
 if(net!==minor(t.subtotal)||cgst!==minor(t.cgst)||sgst!==minor(t.sgst)||igst!==minor(t.igst)||net+cgst+sgst+igst+roundOff!==total)throw validationFailed('Saved invoice totals do not reconcile; review the record before downloading.');
 const local=p.placeOfSupply===(c.stateCode||'33');
 const bank=[['Beneficiary',c.bankBeneficiary],['Bank',c.bankName],['Account',c.bankAccount],['IFSC',c.bankIfsc]].filter(([,v])=>clean(v)).map(([label,v])=>label+': '+clean(v));
 return {
  layoutVersion:INVOICE_LAYOUT_VERSION,draft:record.status!=='ISSUED',title:record.status==='ISSUED'?'Tax-Invoice':'Invoice draft',number:optional(record.number,optional(record.id,'Unnumbered draft')),
  company:{name:optional(c.name,'[Mehta company name not configured]'),address:optional(c.address,'[Company address not configured]'),contact:clean(c.contact),gstin:optional(c.gstin,'[GSTIN not configured]'),cin:clean(c.cin),msme:clean(c.msme),signatory:optional(c.signatory,'[Signatory not configured]')},
  metadataLeft:[{label:record.number?'Tax-Invoice-ID':'Draft reference',value:optional(record.number,optional(record.id,'Assigned on issue'))},{label:'Invoice date',value:date(p.date)},{label:'Payment terms',value:optional(refs.paymentTerms)},{label:'Due date',value:date(refs.dueDate)},{label:'Sales order-ID',value:optional(refs.salesOrderNumber)},{label:'E-Way bill no.',value:optional(refs.eWayBillNumber)}],
  metadataRight:[{label:'Place of supply',value:optional(p.placeOfSupply)},{label:'Sales executive',value:optional(refs.salesExecutive)},{label:'Customer PO-ID',value:optional(refs.customerPoNumber)},{label:'Consignment note-ID',value:optional(refs.consignmentNote)},{label:'Carrier',value:optional(refs.carrier)},{label:'Packing list-ID',value:optional(refs.packingListNumber)},{label:'Package-ID',value:optional(refs.packageNumber)},{label:'Customer instructions',value:optional(refs.customerInstructions)}],
  billTo:{name:optional(customer.name),address:optional(p.billTo),gstin:optional(customer.gstin)},shipTo:{name:optional(customer.name),address:optional(p.shipTo),gstin:optional(customer.gstin)},
  lines,local,localTaxLabel:t.localTaxLabel||'SGST',itemsTotal:[...units.values()].map(u=>invoiceQuantity(format(u.quantity,6))+' '+u.uom).join('; '),
  totals:{gross:amount(gross),discount:amount(gross-net),subtotal:amount(net),cgst:amount(cgst),sgst:amount(sgst),igst:amount(igst),tax:amount(cgst+sgst+igst),beforeRound:amount(net+cgst+sgst+igst),roundOff:amount(roundOff),total:amount(total)},
  amountInWords:optional(p.amountInWords),bank:bank.length?bank:['[Bank details not configured]'],terms:optional(p.terms||c.terms,'[Terms not supplied]'),
  hsnRows:[...groups.values()].map(g=>({hsn:g.hsn,rate:g.rate,halfRate:g.halfRate,net:amount(g.net),cgst:amount(g.cgst),sgst:amount(g.sgst),igst:amount(g.igst),tax:amount(g.cgst+g.sgst+g.igst)}))
 };
}
