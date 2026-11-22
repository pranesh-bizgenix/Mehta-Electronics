import {decimal,mul,div,compare,format} from '../../../public/money.js';
/** Preserve source discount meaning. An amount can enter the existing percent
 * quotation service only when the conversion is exactly representable at its
 * six-place precision. Never round a commercial discount into another value. */
export function quotationDiscount(line){
 if(!line.discount)return {percent:null,blocker:'DISCOUNT_REQUIRED'};
 if(line.discount.kind==='PERCENT')return {percent:line.discount.value,blocker:null};
 if(line.quantity==null||line.unitPrice==null)return {percent:null,blocker:'DISCOUNT_BASE_REQUIRED'};
 const gross=mul(decimal(line.quantity),decimal(line.unitPrice)),amount=decimal(line.discount.value);
 if(compare(amount,gross)>0)return {percent:null,blocker:'DISCOUNT_EXCEEDS_LINE_VALUE'};
 if(compare(gross,decimal('0'))===0)return {percent:'0',blocker:null};
 const percent=mul(div(amount,gross),decimal('100')),text=format(percent,6);
 return compare(percent,decimal(text))===0?{percent:text,blocker:null}:{percent:null,blocker:'DISCOUNT_PRECISION_REVIEW_REQUIRED'};
}
