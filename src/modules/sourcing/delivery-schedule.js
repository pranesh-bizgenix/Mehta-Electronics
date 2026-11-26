import {decimal,add,sub,compare,format} from '../../../public/money.js';
import {validationFailed} from '../../core/errors.js';
const zero=()=>decimal('0');
export function calendarDay(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw validationFailed('Enter a real calendar date in YYYY-MM-DD format.');
 return value;
}
/** Compares confirmed dates only. Transit time and delivery buffers are not guessed. */
export function deliverySchedule({po,receipts,revision=null,customerDate=null,today}){
 calendarDay(today);if(customerDate)calendarDay(customerDate);
 const original=calendarDay(po.payload.deliveryBy),promised=revision?calendarDay(revision.detail.promisedDate):original;
 const accepted=new Map();
 for(const receipt of receipts.filter(r=>r.status==='POSTED'&&!r.is_deleted))for(const line of receipt.payload.lines){
  const amount=decimal(line.accepted);if(compare(amount,zero())<0)throw validationFailed('Accepted goods cannot be negative.');
  accepted.set(line.poLineKey,add(accepted.get(line.poLineKey)??zero(),amount));
 }
 const lines=po.payload.lines.map(line=>{const ordered=decimal(line.quantity),received=accepted.get(line.lineKey)??zero();return {lineKey:line.lineKey,itemId:line.itemId,partCode:line.partCode,uom:line.uom,ordered:format(ordered,6),accepted:format(received,6),pending:format(compare(ordered,received)>0?sub(ordered,received):zero(),6)};});
 const pending=lines.some(line=>compare(decimal(line.pending),zero())>0),open=['ISSUED','PARTIALLY_RECEIVED'].includes(po.status);
 return {originalDate:original,promisedDate:promised,customerDate,revisionId:revision?.id??null,revisionReason:revision?.reason??null,evidence:revision?.detail.evidence??null,lines,late:open&&pending&&promised<today,lateDays:open&&pending&&promised<today?Math.round((Date.parse(today)-Date.parse(promised))/86400000):0,customerDateAtRisk:open&&pending&&Boolean(customerDate)&&promised>customerDate,pending,canRevise:open,note:'Supplier promises are recorded manually. Comparing calendar dates does not include transport time or guarantee customer delivery. Original approved PO terms remain unchanged.'};
}
