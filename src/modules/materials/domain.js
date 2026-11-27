import {decimal,add,sub,compare,format} from '../../../public/money.js';
import {conflict,validationFailed} from '../../core/errors.js';
export const MATERIAL_NOTE='Customer-owned returned goods remain quarantined. This ledger never increases saleable stock, creates a credit note, issues a replacement order, or sends a message. Replacement and credit links require existing independently approved records.';
/** New cases require physical evidence; legacy cases keep their original history. */
export function assertMaterialOperationAction(action,required,material){
 if(action==='APPROVE'&&required&&(!material?.inspected||['WAITING_MATERIAL','PARTIALLY_RECEIVED','RECEIVED','CANCELLED'].includes(material.status)))throw conflict('Receive and independently inspect the material through Return material custody before approval.');
 if(action==='RESOLVE'&&((required&&!material)||material&&material.status!=='CLOSED'))throw conflict('Finish the physical material case before resolving this return or warranty claim.');
 if(action==='CANCEL'&&material&&material.status!=='CANCELLED')throw conflict('Reconcile or cancel the linked physical material case first.');
}
export function quantity(value,positive=true){if(typeof value!=='string'||!/^\d{1,12}(?:\.\d{1,6})?$/.test(value)||positive&&compare(decimal(value),decimal('0'))<=0)throw validationFailed('Use an exact positive quantity with up to six decimal places.');return format(decimal(value),6);}
export function receiptSerials(value,n){const serials=String(value||'').split(/[\n,]+/).map(x=>x.trim()).filter(Boolean);if(new Set(serials).size!==serials.length||serials.some(x=>x.length>100||/[\x00-\x1f\x7f]/.test(x))||serials.length&&compare(decimal(String(serials.length)),decimal(n))!==0)throw validationFailed('Provide distinct serials, one per received or corrected unit.');return serials;}
const sum=(events,action)=>events.filter(e=>e.action===action).reduce((n,e)=>e.action==='RECEIVE'&&e.data?.reversalOf?sub(n,decimal(e.quantity||'0')):add(n,decimal(e.quantity||'0')),decimal('0'));
export function materialBalance(row,events){
 const claimed=decimal(row.quantity),received=sum(events,'RECEIVE'),inspection=events.find(e=>e.action==='INSPECT'),accepted=decimal(inspection?.data.accepted||'0'),rejected=decimal(inspection?.data.rejected||'0'),supplier=sum(events,'SUPPLIER_HANDOVER'),replacement=sum(events,'REPLACEMENT'),credit=sum(events,'CREDIT_LINK'),returns=events.filter(e=>e.action==='ORIGINAL_RETURN'),returnedAccepted=returns.reduce((n,e)=>add(n,decimal(e.data.accepted||'0')),decimal('0')),returnedRejected=returns.reduce((n,e)=>add(n,decimal(e.data.rejected||'0')),decimal('0')),repaired=returns.filter(e=>e.data.repaired===true).reduce((n,e)=>add(n,decimal(e.data.accepted||'0')),decimal('0'));
 const resolution=add(add(replacement,credit),repaired),custodyOut=add(supplier,returnedAccepted);
 const openMaterial=sub(claimed,received),openAccepted=sub(accepted,resolution),openRejected=sub(rejected,returnedRejected),openCustody=sub(accepted,custodyOut);
 for(const value of [openMaterial,openAccepted,openRejected,openCustody])if(compare(value,decimal('0'))<0)throw conflict('Material quantities exceed their verified source. Review the movement history.');
 if(inspection&&compare(add(accepted,rejected),received)!==0)throw conflict('Inspection does not reconcile with received material.');
 return Object.fromEntries(Object.entries({claimed,received,accepted,rejected,supplier,replacement,credit,repaired,returnedAccepted,returnedRejected,openMaterial,openAccepted,openRejected,openCustody}).map(([key,value])=>[key,format(value,6)]));
}
export function nextMaterialState(row,events,command,actorId){
 if(['CLOSED','CANCELLED'].includes(row.status))throw conflict('This material case is closed. Its history cannot be changed.');
 const b=materialBalance(row,events),n=command.quantity?quantity(command.quantity):'0',zero=value=>compare(decimal(value),decimal('0'))===0,within=(value,available)=>{if(compare(decimal(value),decimal(available))>0)throw conflict('Quantity exceeds the available material balance.');};
 const inspected=events.some(e=>e.action==='INSPECT'),handover=events.some(e=>e.action==='SUPPLIER_HANDOVER');
 switch(command.action){
  case 'RECEIVE':if(inspected)throw conflict('Material cannot be added or corrected after inspection.');if(command.data.reversalOf){within(n,b.received);return compare(sub(decimal(b.received),decimal(n)),decimal('0'))===0?'WAITING_MATERIAL':'PARTIALLY_RECEIVED';}within(n,b.openMaterial);return compare(decimal(n),decimal(b.openMaterial))===0?'RECEIVED':'PARTIALLY_RECEIVED';
  case 'INSPECT':if(inspected||!zero(b.openMaterial))throw conflict('Receive the complete claimed quantity before one independent inspection.');if(actorId===row.created_by||events.some(e=>e.action==='RECEIVE'&&!e.data?.reversalOf&&e.actor_id===actorId))throw conflict('The case creator and material receivers cannot approve its inspection.');quantity(command.data.accepted,false);quantity(command.data.rejected,false);if(compare(add(decimal(command.data.accepted),decimal(command.data.rejected)),decimal(b.received))!==0)throw validationFailed('Accepted plus rejected quantities must equal the received quantity.');return 'INSPECTED';
  case 'SUPPLIER_HANDOVER':if(!inspected||handover)throw conflict('Inspect material before its single supplier handover.');within(n,b.openCustody);return 'SUPPLIER_PENDING';
  case 'SUPPLIER_RESULT':if(!handover||events.some(e=>e.action==='SUPPLIER_RESULT'))throw conflict('Record one result against the existing supplier handover.');return 'REMEDY_PENDING';
  case 'REPLACEMENT':case 'CREDIT_LINK':if(!inspected)throw conflict('Inspect material before recording a remedy.');within(n,b.openAccepted);return 'REMEDY_PENDING';
  case 'ORIGINAL_RETURN':if(!inspected)throw conflict('Inspect material before its return dispatch.');quantity(command.data.accepted,false);quantity(command.data.rejected,false);within(command.data.accepted,b.openCustody);within(command.data.rejected,b.openRejected);if(zero(format(add(decimal(command.data.accepted),decimal(command.data.rejected)),6)))throw validationFailed('Return at least one unit.');if(command.data.repaired)within(command.data.accepted,b.openAccepted);return 'REMEDY_PENDING';
  case 'CLOSE':if(!inspected||![b.openMaterial,b.openAccepted,b.openRejected,b.openCustody].every(zero)||handover&&!events.some(e=>e.action==='SUPPLIER_RESULT'))throw conflict('Reconcile receipts, inspection, original custody, supplier result and every accepted/rejected unit before closure.');if(actorId===row.created_by)throw conflict('A different authorised person must close the material case.');return 'CLOSED';
  case 'CANCEL':if(events.some(e=>!['OPEN','RECEIVE'].includes(e.action))||!zero(b.received))throw conflict('A case with unreconciled physical movements cannot be cancelled. Review its receipts and independent corrections first.');return 'CANCELLED';
  default:throw validationFailed('Choose a supported material action.');
 }
}
