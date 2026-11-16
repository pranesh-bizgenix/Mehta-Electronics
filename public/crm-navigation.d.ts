export function navigationId(value:unknown):string;
export function contextId(params:URLSearchParams|{getAll(key:string):string[]},key:string):string|null;
export function customerEnquiryHref(id:string|number):string;
export function quotationOrderHref(id:string|number):string;
export function commercialRecordHref(kind:'enquiries'|'quotes'|'orders',id:string|number,managed?:boolean):string;
export function tallyRecordHref(entity:string,companyId:string,recordKey:string):string;
