const scalar=v=>v==null?null:typeof v==='object'?scalar(v['#text']):String(v).trim()||null;
const array=v=>v==null?[]:Array.isArray(v)?v:[v];
const get=(r,...keys)=>keys.map(k=>scalar(r?.[k])).find(Boolean)||null;
const quantity=text=>{
  const m=String(text||'').match(/^([+-]?\d+(?:\.\d+)?)\s*(.*?)\s*$/);
  return m?{value:m[1],unit:m[2]||null}:{value:null,unit:null};
};
/** Preserve source numbers, names, signs and raw fields. No tax/currency assumptions. */
export function normalizeTallyOrder(raw,{companyId,kind,currency=null,source='TALLY'}={}){
  if(!companyId)throw new Error('A source company ID is required.');
  if(!['sales_orders','purchase_orders'].includes(kind))throw new Error('Unknown order entity.');
  const guid=get(raw,'GUID'),masterId=get(raw,'MASTERID');
  if(!guid&&!masterId)throw new Error('Source order has neither GUID nor Master ID; review is required.');
  const lines=array(raw['ALLINVENTORYENTRIES.LIST']||raw['INVENTORYENTRIES.LIST']).map((line,index)=>{
    const qty=quantity(get(line,'BILLEDQTY','ACTUALQTY'));
    const rate=get(line,'RATE'),rateMatch=rate?.match(/^([+-]?\d+(?:\.\d+)?)\s*(?:\/(.+))?$/);
    return {id:String(index+1),itemId:get(line,'STOCKITEMGUID','STOCKITEMID'),itemCode:get(line,'STOCKITEMNAME'),
      description:get(line,'DESCRIPTION','BASICUSERDESCRIPTION'),quantity:qty.value,unit:get(line,'BASEUNITS','UNIT')||qty.unit||rateMatch?.[2]||null,
      unitPrice:rateMatch?.[1]||null,discountPercent:get(line,'DISCOUNT','DISCOUNTPERCENT'),discountAmount:get(line,'DISCOUNTAMOUNT'),
      netAmount:get(line,'NETAMOUNT','AMOUNT'),taxPercent:get(line,'GSTRATE'),hsn:get(line,'HSNCODE','GSTHSNCODE'),
      sourceRate:rate,sourceQuantity:get(line,'BILLEDQTY','ACTUALQTY'),raw:line};
  });
  return {id:`${kind}:${guid?'guid:'+guid:'master:'+masterId}`,companyId,source,kind,guid,masterId,alterId:get(raw,'ALTERID'),
    number:get(raw,'VOUCHERNUMBER'),date:get(raw,'DATE'),voucherType:get(raw,'VOUCHERTYPENAME')||scalar(raw['@_VCHTYPE']),
    partyName:get(raw,'PARTYLEDGERNAME','PARTYNAME'),reference:get(raw,'REFERENCE'),currency:get(raw,'CURRENCYNAME')||currency,
    status:/^yes$/i.test(get(raw,'ISCANCELLED')||'')?'CANCELLED':/^yes$/i.test(get(raw,'ISDELETED')||'')?'DELETED':/^yes$/i.test(get(raw,'ISOPTIONAL')||'')?'OPTIONAL':'RECORDED',
    priceBasis:'UNCONFIRMED',lines,raw};
}
