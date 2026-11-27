import {sub,format} from '../../../public/money.js';
export const MARGIN_REPORT_NOTE='Quoted margin uses the latest saved quotation cost and pricing snapshot, excluding GST. It is not realised invoice profit or a current supplier cost. Missing cost or threshold evidence remains unavailable. Flags use the floor captured on that quotation; no new commercial threshold is assumed.';
const valid=value=>typeof value==='string'&&/^\d{1,30}(?:\.\d{1,6})?$/.test(value);
const decimal=value=>{const [whole,fraction='']=value.split('.');return {n:BigInt(whole+fraction),d:10n**BigInt(fraction.length)};};
export function quotationMargin(row){
 const pub=row.public_snapshot||{},privateData=row.private_snapshot||{},known=privateData.missingCost===false&&valid(pub.subtotal)&&valid(privateData.cost),threshold=valid(String(privateData.floorPercent??''));
 return {reference:String(row.reference),customer_name:String(row.customer_name),status:row.status,net_ex_gst:valid(pub.subtotal)?pub.subtotal:'',captured_cost:known?privateData.cost:'',quoted_profit:known?format(sub(decimal(pub.subtotal),decimal(privateData.cost)),6):'',margin_percent:known&&typeof privateData.marginPercent==='string'&&/^-?\d{1,30}(?:\.\d{1,6})?$/.test(privateData.marginPercent)?privateData.marginPercent:'',captured_floor:threshold?String(privateData.floorPercent):'',flag:!known?'COST_NOT_AVAILABLE':!threshold||typeof privateData.belowFloor!=='boolean'?'THRESHOLD_NOT_AVAILABLE':privateData.belowFloor?'BELOW_CAPTURED_FLOOR':'WITHIN_CAPTURED_FLOOR',basis:String(privateData.marginBasis||'NOT_RECORDED')};
}
