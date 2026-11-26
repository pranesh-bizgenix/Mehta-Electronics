import {decimal,add,sub,compare,format} from '../../../public/money.js';
import {validationFailed} from '../../core/errors.js';

const zero=()=>decimal('0');
const unit=value=>String(value??'').trim().toUpperCase();
export const invoiceReference=value=>String(value??'').trim().toUpperCase();
function quantity(value){
 if(typeof value!=='string'||!/^\d{1,18}(?:\.\d{1,6})?$/.test(value))throw validationFailed('Matching requires non-negative decimal quantities with at most six places.');
 return decimal(value);
}

/** Only posted accepted goods and independently reviewed invoices consume quantities.
 * No payment, stock mutation or assumed price tolerance is performed here. */
export function threeWayMatch({po,invoice,receipts,priorInvoices,duplicateInvoices=[]}){
 const blockers=[],differences=[],rows=[],ordered=new Map(),accepted=new Map(),damaged=new Map(),billed=new Map();
 const block=(code,itemId)=>blockers.push({code,...(itemId===undefined?{}:{itemId})});
 if(!['ISSUED','PARTIALLY_RECEIVED','RECEIVED'].includes(po.status))block('PO_NOT_ISSUED');
 if(!invoiceReference(invoice.payload.reference))block('INVOICE_REFERENCE_REQUIRED');
 if(duplicateInvoices.length)block('DUPLICATE_SUPPLIER_INVOICE_REFERENCE');
 for(const line of po.payload.lines){if(ordered.has(line.itemId))block('AMBIGUOUS_PO_ITEM',line.itemId);ordered.set(line.itemId,line);}
 const posted=receipts.filter(r=>r.status==='POSTED'&&!r.is_deleted);
 if(!posted.length)block('NO_POSTED_GOODS_RECEIPT');
 for(const receipt of posted)for(const line of receipt.payload.lines){
  const source=po.payload.lines.find(p=>p.lineKey===line.poLineKey);
  if(!source){block('RECEIPT_LINE_NOT_IN_PO');continue;}
  accepted.set(source.itemId,add(accepted.get(source.itemId)??zero(),quantity(line.accepted)));
  damaged.set(source.itemId,add(damaged.get(source.itemId)??zero(),quantity(line.rejected)));
 }
 const previous=priorInvoices.filter(d=>d.id!==invoice.id&&d.kind==='DISPATCH_INVOICE'&&d.status==='REVIEWED'&&!d.is_deleted);
 for(const doc of previous)for(const line of doc.payload.lines??[]){
  const source=ordered.get(line.itemId);
  if(!source||unit(source.uom)!==unit(line.uom)){block('PRIOR_INVOICE_ITEM_REQUIRES_REVIEW',line.itemId);continue;}
  billed.set(line.itemId,add(billed.get(line.itemId)??zero(),quantity(line.quantity)));
 }
 const seen=new Set();
 if(!invoice.payload.lines?.length)block('INVOICE_LINES_REQUIRED');
 for(const line of invoice.payload.lines??[]){
  const source=ordered.get(line.itemId),current=quantity(line.quantity);
  if(seen.has(line.itemId))block('DUPLICATE_INVOICE_ITEM',line.itemId);seen.add(line.itemId);
  if(!source){block('INVOICE_ITEM_NOT_IN_PO',line.itemId);continue;}
  if(unit(source.uom)!==unit(line.uom))block('INVOICE_UNIT_DIFFERS_FROM_PO',line.itemId);
  if(compare(current,zero())<=0)block('INVOICE_QUANTITY_MUST_BE_POSITIVE',line.itemId);
  const received=accepted.get(line.itemId)??zero(),prior=billed.get(line.itemId)??zero(),cumulative=add(prior,current),orderQty=quantity(source.quantity);
  if(compare(cumulative,received)>0)block('INVOICE_EXCEEDS_ACCEPTED_GOODS',line.itemId);
  if(compare(cumulative,orderQty)>0)block('INVOICE_EXCEEDS_ORDERED_QUANTITY',line.itemId);
  for(const [key,code] of [['unitPrice','INVOICE_RATE_DIFFERENCE'],['discountPercent','INVOICE_DISCOUNT_DIFFERENCE'],['taxPercent','INVOICE_GST_DIFFERENCE']]){
   if(compare(quantity(line[key]??'0'),quantity(source[key]??'0'))!==0)differences.push({code,itemId:line.itemId});
  }
  rows.push({itemId:line.itemId,partCode:source.partCode,uom:source.uom,ordered:format(orderQty,6),accepted:format(received,6),rejected:format(damaged.get(line.itemId)??zero(),6),previouslyInvoiced:format(prior,6),thisInvoice:format(current,6),remainingAccepted:format(compare(received,cumulative)>0?sub(received,cumulative):zero(),6),outstandingDelivery:format(compare(orderQty,received)>0?sub(orderQty,received):zero(),6)});
 }
 return {rows,blockers,differences,matched:blockers.length===0&&differences.length===0,receiptEvidence:posted.map(r=>({id:r.id,version:r.version})),invoiceEvidence:previous.map(r=>({id:r.id,version:r.version})),duplicateEvidence:duplicateInvoices.map(r=>({id:r.id,version:r.version})),note:'Compares ordered quantities, posted accepted goods and previously reviewed supplier invoices. Rejected goods cannot be billed. Matching does not authorise payment or confirm tax credit.'};
}
