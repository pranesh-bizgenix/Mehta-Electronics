/** Same-origin links carry identities, never business names or editable prices. */
export function navigationId(value){
 const text=String(value??'');
 if(!/^[1-9]\d*$/.test(text)||!Number.isSafeInteger(Number(text)))throw new Error('The link contains an invalid record ID.');
 return text;
}
export function contextId(params,key){
 const values=params.getAll(key);
 if(!values.length)return null;
 if(values.length!==1)throw new Error(`The link contains more than one ${key}.`);
 return navigationId(values[0]);
}
const link=(path,query)=>`${path}?${new URLSearchParams(query)}`;
export const customerEnquiryHref=id=>link('/enquiries',{new:'1',customerId:navigationId(id)});
export const quotationOrderHref=id=>link('/orders',{new:'1',quotationId:navigationId(id)});
export function commercialRecordHref(kind,id,managed=true){
 const key=navigationId(id);
 if(kind==='enquiries')return link('/enquiries',{open:key});
 if(kind==='quotes')return managed?`/quotations/${key}`:`/api/quotations/${key}/pdf`;
 if(kind==='orders')return link('/orders',{open:key,...(!managed?{legacy:'1'}:{})});
 throw new Error('Unsupported commercial record.');
}
export function tallyRecordHref(entity,companyId,recordKey){
 if(typeof entity!=='string'||!/^[a-z_]+$/.test(entity))throw new Error('Invalid source entity.');
 if(typeof companyId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId))throw new Error('A source company is required.');
 if(typeof recordKey!=='string'||!recordKey.trim()||recordKey.length>1000)throw new Error('A stable source record key is required.');
 return link('/tally',{entity,companyId,recordKey});
}
