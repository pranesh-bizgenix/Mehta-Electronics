import {decimal,add,sub,compare,format} from '../../../public/money.js';
import {validationFailed,conflict} from '../../core/errors.js';
export const sumQuantity=values=>values.reduce((n,value)=>add(n,decimal(value)),decimal('0'));
export function warehouseQuantity(value){if(typeof value!=='string'||!/^\d{1,12}(?:\.\d{1,6})?$/.test(value)||compare(decimal(value),decimal('0'))<=0)throw validationFailed('Enter a positive base-unit quantity with at most six decimal places.');return format(decimal(value),6);}
export function custodyCapacity({accepted,recorded,quantity,serials=[]}){
 const q=warehouseQuantity(quantity);if(compare(decimal(q),sub(decimal(accepted),sumQuantity(recorded)))>0)throw conflict('Receipt custody exceeds posted accepted goods. Rejected or already recorded goods cannot be counted again.');
 if(new Set(serials.map(s=>s.trim().toUpperCase())).size!==serials.length||serials.some(s=>!s.trim()||s.length>100))throw validationFailed('Serial numbers must be unique, non-empty and at most 100 characters.');
 if(serials.length&&compare(decimal(String(serials.length)),decimal(q))!==0)throw validationFailed('A serial-tracked lot requires one serial number per whole base unit.');return q;
}
export function packingIssues({items,scans,allocations,photoCount}){
 const issues=[];if(!items.length)issues.push('Add the box items.');if(!photoCount)issues.push('Attach at least one box photo.');
 if(scans.some(s=>s.status==='MISMATCH'))issues.push('Review and reject incorrect scans before checking the box.');
 for(const item of items){
  const scansQty=sumQuantity(scans.filter(s=>s.order_line_id===item.order_line_id&&s.status==='MATCHED').map(s=>s.quantity));
  if(compare(scansQty,decimal(item.quantity))!==0)issues.push('Scanned quantity differs for '+item.order_line_id+'.');
  const picked=sumQuantity(allocations.filter(a=>a.order_line_id===item.order_line_id&&a.status==='RESERVED').map(a=>a.quantity));
  if(compare(picked,decimal(item.quantity))!==0)issues.push('Receipt-lot allocation differs for '+item.order_line_id+'.');
 }
 return issues;
}
export function packingDispatchQuantities(boxes,items,picked){
 if(!boxes.length||boxes.some(box=>box.status!=='PACKED'))throw conflict('Select independently checked, undispatched boxes.');
 const selected=new Set(boxes.map(box=>box.id)),actual=new Map();for(const item of items){if(!selected.has(item.box_id))continue;actual.set(item.order_line_id,add(actual.get(item.order_line_id)||decimal('0'),decimal(item.quantity)));}
 if(actual.size!==picked.length||picked.some(line=>!actual.has(line.id)||compare(actual.get(line.id),decimal(line.quantity))!==0))throw conflict('Dispatch quantities must exactly match all contents of the selected boxes. Use separate boxes for partial dispatch.');
}
