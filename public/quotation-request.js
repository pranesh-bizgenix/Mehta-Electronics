/** Manual RFQ details only. Never extracts an email or derives prices/quantities. */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = (value,limit,label) => {
  if(value===undefined)return '';
  if(typeof value!=='string'||value.length>limit)throw new Error(`${label}: enter text of at most ${limit} characters.`);
  return value.trim();
};
export function quotationRequest(value) {
  if(value===undefined)return {reference:'',quantityInstructions:'',quantityConfirmed:false};
  if(!object(value))throw new Error('Customer request details must be an object.');
  if(value.quantityConfirmed!==undefined&&typeof value.quantityConfirmed!=='boolean')throw new Error('Quantity confirmation must be true or false.');
  return {reference:clean(value.reference,200,'RFQ reference'),quantityInstructions:clean(value.quantityInstructions,1000,'Quantity instructions'),quantityConfirmed:value.quantityConfirmed===true};
}
export function quotationLineRequest(value,today) {
  if(value===undefined)value={};
  if(!object(value))throw new Error('Line request details must be an object.');
  const limits={sourceLine:100,tag:200,make:100,requestedSpecification:1000,availability:300,availabilityAsOf:10,availabilitySource:300,leadTime:300};
  const out=Object.fromEntries(Object.entries(limits).map(([key,limit])=>[key,clean(value[key],limit,key)]));
  if(out.availability){
    const date=out.availabilityAsOf;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(`${date}T00:00:00Z`))||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date||date>today)throw new Error('Availability requires a valid check date that is not in the future.');
    if(!out.availabilitySource)throw new Error('Record the source used to check availability.');
  }else if(out.availabilityAsOf||out.availabilitySource)throw new Error('Enter the reviewed availability statement with its check date and source.');
  return out;
}
export function quotationRequestBlock(request) {
  return request?.quantityInstructions&&!request.quantityConfirmed?'Confirm the final quantities for sets, colours or other customer quantity instructions before submitting.':null;
}
