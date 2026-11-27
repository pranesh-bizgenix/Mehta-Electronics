import {decimal,format,add} from '../../../public/money.js';
import {calculateQuotation} from '../../../public/quotation-math.js';
import {validateSplit,sameUnit,withCommercialCharges} from './domain.js';
import {calendarDay} from './delivery-schedule.js';
import {validationFailed,conflict,forbidden} from '../../core/errors.js';

export function splitAwardGroups({requested,offers,allocations,today,buyerState,termsConfirmed}){
 calendarDay(today);
 if(termsConfirmed!==true)throw validationFailed('Confirm that suppliers agreed the awarded quantities, unit prices and full quoted charges.');
 if(new Set(requested.map(l=>l.itemId)).size!==requested.length)throw validationFailed('Resolve repeated RFQ item lines before allocating suppliers.');
 const rows=validateSplit(requested,offers,allocations),groups=new Map();
 for(const row of rows){
  const offer=offers.find(o=>o.id===row.replyId),wanted=requested.find(l=>l.itemId===row.itemId),source=offer.lines.find(l=>l.itemId===row.itemId);
  if(offer.status!=='RECORDED'||offer.vendorStatus!=='ACTIVE'||offer.validUntil<today)throw conflict('An allocated supplier or reply is inactive or expired.');
  if(!offer.commercial||offer.commercial.chargesConfirmed!==true)throw conflict('Confirm supplier freight and packing before awarding.');
  if(!sameUnit(row.uom,wanted.uom))throw conflict('The offered base unit no longer matches the requested item.');
  const delivery=calendarDay(row.promisedOn);if(delivery<today)throw validationFailed('Use a current or future confirmed delivery date.');
  const blocking=(offer.flagsByItem?.[row.itemId]||[]).filter(code=>!['PARTIAL_QUANTITY','QUANTITY_REQUOTE_REQUIRED'].includes(code));
  if(blocking.length)throw conflict('Resolve supplier comparison blockers before awarding: '+blocking.join(', '));
  let group=groups.get(row.vendorId);
  if(!group){group={vendorId:row.vendorId,vendor:offer.vendor,replyId:offer.id,replyVersion:offer.version,validUntil:offer.validUntil,commercial:offer.commercial,terms:offer.terms||'',deliveryBy:delivery,lines:[]};groups.set(row.vendorId,group);}
  if(group.replyId!==row.replyId)throw validationFailed('Use one current reply per supplier.');
  if(delivery>group.deliveryBy)group.deliveryBy=delivery;
  group.lines.push({...wanted,lineKey:row.lineKey,quantity:row.quantity,unitPrice:row.unitPrice,discountPercent:row.discountPercent,taxPercent:source.taxPercent,promisedOn:delivery});
 }
 for(const group of groups.values()){
  try{const base=calculateQuotation(group.lines,group.vendor.stateCode,buyerState);group.totals=withCommercialCharges(base,group.commercial,group.vendor.stateCode,buyerState);}catch(error){if(error.status)throw error;throw validationFailed(error.message);}
  group.subtotal=group.totals.subtotal;group.total=group.totals.total;
 }
 return {groups:[...groups.values()],allocationCount:rows.length,total:format([...groups.values()].reduce((sum,g)=>add(sum,decimal(g.total)),decimal('0')),2)};
}

export function splitAwardDecision(row,action,actorId,expectedVersion){
 if(row.version!==expectedVersion)throw conflict('Split award changed. Reload before continuing.');
 if(action==='APPROVE'&&row.status==='PENDING_APPROVAL'){
  if(row.created_by===actorId)throw forbidden('A different authorised reviewer must approve the split.');return 'APPROVED';
 }
 if(action==='REJECT'&&row.status==='PENDING_APPROVAL'){
  if(row.created_by===actorId)throw forbidden('A different authorised reviewer must reject the split.');return 'REJECTED';
 }
 if(action==='CANCEL'&&['PENDING_APPROVAL','APPROVED','ORDERED'].includes(row.status))return 'CANCELLED';
 if(action==='CREATE_ORDERS'&&row.status==='APPROVED')return 'ORDERED';
 if(action==='CREATE_ORDERS'&&row.status==='ORDERED')return 'ORDERED';
 throw conflict('This split award cannot perform the requested action.');
}
