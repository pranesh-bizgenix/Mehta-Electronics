import {validationFailed} from '../../core/errors.js';
import {decimal} from '../../crm-modules.js';
import {text} from './domain.js';
export function invoiceSourceLines(input,items){
 if(!Array.isArray(input)||input.length<1||input.length>100)throw validationFailed('Capture between 1 and 100 original invoice product lines.');
 const index=new Map();for(const item of items){const key=item.part_code.trim().toUpperCase(),rows=index.get(key)||[];rows.push(item);index.set(key,rows);}
 return input.map((row,i)=>{if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['code','description','uom','quantity'].includes(k))||Object.values(row).some(value=>typeof value==='string'&&/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)))throw validationFailed('Use only product code, description, unit and quantity for original invoice facts.');if(typeof row.quantity!=='string'||!/^\d{1,12}(?:\.\d{1,6})?$/.test(row.quantity))throw validationFailed('Use exact original invoice quantities as plain decimal strings.');const code=text(row.code,'Product code',100),uom=text(row.uom,'Unit',20),matches=index.get(code.toUpperCase())||[];if(matches.length!==1)throw validationFailed(`Invoice line ${i+1} must match one existing CRM product. Reconcile the SKU master first.`);const item=matches[0];if(!item.uom||uom.toUpperCase()!==item.uom.trim().toUpperCase())throw validationFailed(`Invoice line ${i+1} unit must match the verified product unit; no conversion is inferred.`);return {code:item.part_code,description:text(row.description||'','Description',1000,false),uom:item.uom,quantity:decimal(row.quantity,'Invoiced quantity',{positive:true}),itemId:item.id};});
}
export const sourceLineInput=lines=>lines.map(({code,description,uom,quantity})=>({code,description,uom,quantity}));
