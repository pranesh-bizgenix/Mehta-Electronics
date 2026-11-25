import {decimal,add,mul,div,sub,compare,format} from '../../../public/money.js';
import {validationFailed} from '../../core/errors.js';
import {calculateQuotation} from '../../../public/quotation-math.js';
const zero=()=>decimal('0');
export function exact(value,label,{positive=false,percent=false}={}){
 if(typeof value!=='string'||!/^\d{1,14}(?:\.\d{1,6})?$/.test(value))throw validationFailed(`${label} must be an exact non-negative decimal string with up to six decimal places.`);
 const n=decimal(value);if(positive&&n.n===0n||percent&&compare(n,decimal('100'))>0)throw validationFailed(`Invalid ${label}.`);return n;
}
export const sameUnit=(a,b)=>String(a).trim().toUpperCase()===String(b).trim().toUpperCase();
export function withCommercialCharges(totals,commercial,sellerState,buyerState){
 if(!commercial)return totals;
 if(commercial.chargesConfirmed!==true)throw validationFailed('Confirm whether freight, packing and other supplier charges apply before creating a purchase order.');
 if(!Array.isArray(commercial.charges)||commercial.charges.length>10)throw validationFailed('Invalid supplier charge details.');
 const chargeLines=commercial.charges.map((charge,index)=>{exact(charge.amount,'Supplier charge');exact(charge.taxPercent,'Charge GST',{percent:true});return {itemId:index+1,description:charge.kind,uom:'Charge',quantity:'1',unitPrice:charge.amount,discountPercent:'0',taxPercent:charge.taxPercent};});
 const chargeTotals=calculateQuotation(chargeLines,sellerState,buyerState),result={...totals,commercial,chargeTotals};
 for(const key of ['subtotal','cgst','sgst','igst','total'])result[key]=format(add(decimal(totals[key]),decimal(chargeTotals[key])),2);
 if(compare(decimal(result.total),decimal('999999999999'))>0)throw validationFailed('Purchasing total exceeds the supported limit.');
 return result;
}
export function normalizeOffer(line,quote,factor){
 const quantity=exact(quote.quantity,'Supplier quantity',{positive:true}),price=exact(quote.unitPrice,'Supplier unit price'),discount=exact(quote.discountPercent??line.discountPercent??'0','Supplier discount',{percent:true});
 if(typeof factor!=='string'||!/^\d{1,14}(?:\.\d{1,12})?$/.test(factor))throw validationFailed('Approved unit factor must be an exact decimal.');const conversion=decimal(factor);if(conversion.n<=0n)throw validationFailed('Approved unit factor must be positive.');
 const baseQuantity=mul(quantity,conversion),baseRate=div(price,conversion),netRate=mul(baseRate,div(sub(decimal('100'),discount),decimal('100'))),net=mul(mul(quantity,price),div(sub(decimal('100'),discount),decimal('100')));
 const quantityText=format(baseQuantity,6),rateText=format(baseRate,6);
 return {itemId:line.itemId,baseUom:line.uom,supplierUom:quote.uom,supplierQuantity:quote.quantity,supplierUnitPrice:quote.unitPrice,factor,discountPercent:format(discount,6),baseQuantity:quantityText,baseUnitPrice:rateText,netBaseRate:format(netRate,12),net:format(net,2),requiresPrecisionReview:compare(decimal(quantityText),baseQuantity)!==0||compare(decimal(rateText),baseRate)!==0};
}
export function landedComparison(requested,offers,asOf){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf))throw validationFailed('Comparison date is required.');
 return requested.map(item=>({item,offers:offers.map(offer=>{
  const line=offer.lines.find(l=>l.itemId===item.itemId),flags=[];
  if(!line)return {replyId:offer.id,vendorId:offer.vendorId,available:false,flags:['ITEM_NOT_OFFERED']};
  if(offer.validUntil<asOf)flags.push('OFFER_EXPIRED');if(!offer.chargesConfirmed)flags.push('FREIGHT_PACKING_NOT_CONFIRMED');if(line.requiresPrecisionReview)flags.push('BASE_RATE_PRECISION_REVIEW');
  const quotedTotal=offer.lines.reduce((sum,l)=>add(sum,decimal(l.net)),zero());
  const chargeTotal=offer.charges.reduce((sum,c)=>add(sum,exact(c.amount,'Supplier charge')),zero());
  let allocatedCharge=zero();if(compare(quotedTotal,zero())>0)allocatedCharge=mul(chargeTotal,div(decimal(line.net),quotedTotal));else if(compare(chargeTotal,zero())>0)flags.push('CHARGE_ALLOCATION_REVIEW');
  const requestedQty=exact(item.quantity,'Requested quantity',{positive:true}),offeredQty=exact(line.baseQuantity,'Offered quantity',{positive:true});const quantityMatch=compare(offeredQty,requestedQty)===0;if(compare(offeredQty,requestedQty)<0)flags.push('PARTIAL_QUANTITY');if(compare(offeredQty,requestedQty)>0)flags.push('QUANTITY_REQUOTE_REQUIRED');
  const landed=div(add(decimal(line.net),allocatedCharge),offeredQty);
  return {replyId:offer.id,vendorId:offer.vendorId,vendorName:offer.vendorName,available:true,...line,landedBaseRateExGst:format(landed,12),allocatedChargesExGst:format(allocatedCharge,2),requestedCostExGst:quantityMatch?format(mul(landed,requestedQty),2):null,promisedOn:offer.promisedOn??null,flags};
 })}));
}
export function validateSplit(requested,offers,allocations){
 if(!Array.isArray(allocations)||!allocations.length||allocations.length>300)throw validationFailed('Provide between one and 300 split allocations.');
 const demand=new Map(requested.map(l=>[l.itemId,l])),totals=new Map(),used=new Set(),capacity=new Map(),rows=[];
 for(const a of allocations){const key=a.replyId+':'+a.itemId;if(used.has(key))throw validationFailed('Combine repeated supplier/item allocations.');used.add(key);const offer=offers.find(o=>o.id===a.replyId),line=offer?.lines.find(l=>l.itemId===a.itemId);if(!line||!demand.has(a.itemId))throw validationFailed('Allocate only invited supplier replies and requested items.');if(line.requiresPrecisionReview)throw validationFailed('The base unit rate requires explicit supplier review before ordering.');const n=exact(a.quantity,'Allocated base quantity',{positive:true});totals.set(a.itemId,add(totals.get(a.itemId)??zero(),n));capacity.set(key,add(capacity.get(key)??zero(),n));if(compare(capacity.get(key),decimal(line.baseQuantity))>0)throw validationFailed('Allocation exceeds the supplier offered quantity.');rows.push({...a,quantity:format(n,6),vendorId:offer.vendorId,sourceReplyVersion:offer.version,unitPrice:line.baseUnitPrice,uom:line.baseUom,discountPercent:line.discountPercent});}
 for(const [itemId,line] of demand)if(compare(totals.get(itemId)??zero(),exact(line.quantity,'Requested quantity',{positive:true}))!==0)throw validationFailed('The approved split must cover each requested item exactly; shortages remain unawarded.');
 return rows;
}
