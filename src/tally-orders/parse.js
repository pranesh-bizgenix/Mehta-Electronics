import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {normalizeTallyOrder} from './normalize.js';

const expected={sales_orders:'Sales Order',purchase_orders:'Purchase Order'};
/** Parse saved or freshly returned responses without changing existing import code. */
export function parseOrderResponse(xml,options){
  if(typeof xml!=='string'||Buffer.byteLength(xml)>32*1024*1024)throw new Error('Order XML is missing or exceeds 32 MB.');
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('DTD and entity declarations are not accepted.');
  if(XMLValidator.validate(xml)!==true)throw new Error('Malformed order XML.');
  if(!expected[options?.kind])throw new Error('Unknown order entity.');
  const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false,trimValues:true}).parse(xml);
  if(!Object.hasOwn(parsed,'ENVELOPE'))throw new Error('Tally response has no ENVELOPE.');
  const vouchers=[],errors=[];
  function visit(value){
    if(!value||typeof value!=='object')return;
    for(const [key,child] of Object.entries(value)){
      if(key==='LINEERROR'||key==='ERROR')throw new Error(`Tally returned an error: ${String(child).slice(0,300)}`);
      if(key==='VOUCHER')for(const voucher of Array.isArray(child)?child:[child])vouchers.push(voucher);
      else visit(child);
    }
  }
  visit(parsed);
  const records=[];let excluded=0;
  for(const [index,voucher] of vouchers.entries()){
    const type=String(voucher.VOUCHERTYPENAME||voucher['@_VCHTYPE']||'').trim();
    if(type!==expected[options.kind]){excluded++;continue;}
    try{records.push(normalizeTallyOrder(voucher,options));}
    catch(error){errors.push({index,message:error.message,raw:voucher});}
  }
  return {records,errors,excluded,received:vouchers.length,cancelled:records.filter(r=>r.status==='CANCELLED').length};
}
