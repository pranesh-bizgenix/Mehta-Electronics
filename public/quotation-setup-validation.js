// Shared browser/server validation. Decimal inputs stay strings throughout.
export function costErrors(body) {
 const errors={};
 if(typeof body.unitCost!=='string'||!/^\d{1,14}(?:\.\d{1,6})?$/.test(body.unitCost))errors.unitCost='Enter a non-negative decimal with at most 14 whole digits and six decimal places.';
 if(typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>2000)errors.reason='Enter a reason of 3 to 2,000 characters.';
 return errors;
}
export function policyErrors(body) {
 const errors={},l=body.letterhead??{};
 const floor=body.floorPercent;
 if(typeof floor!=='string'||!/^\d{1,3}(?:\.\d{1,6})?$/.test(floor))errors.floorPercent='Enter a margin floor from 0 to 100 with at most six decimal places.';
 else {const [whole,fraction='']=floor.split('.');if(BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'))>100000000n)errors.floorPercent='The margin floor cannot exceed 100%.';}
 if(!['LINE_AND_TOTAL','TOTAL'].includes(body.marginBasis))errors.marginBasis='Choose where the margin floor applies.';
 if(!/^(0[1-9]|[12][0-9]|3[0-8])$/.test(body.sellerState??''))errors.sellerState='Choose the seller GST state.';
 for(const [key,max]of Object.entries({name:200,address:1000,gstin:15,email:200,phone:60}))if(l[key]!=null&&(typeof l[key]!=='string'||l[key].length>max))errors[`letterhead.${key}`]=`Enter at most ${max} characters.`;
 if(typeof l.name!=='string'||!l.name.trim())errors['letterhead.name']='Enter the company name.';
 if(l.gstin&&(typeof l.gstin!=='string'||!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(l.gstin.toUpperCase())||l.gstin.slice(0,2)!==body.sellerState))errors['letterhead.gstin']='Enter a valid GSTIN matching the seller state.';
 if(l.email&&(typeof l.email!=='string'||!/^\S+@[^\s@]+\.[^\s@]+$/.test(l.email)))errors['letterhead.email']='Enter a valid email address.';
 if(typeof body.reason!=='string'||body.reason.trim().length<3||body.reason.length>2000)errors.reason='Enter a reason of 3 to 2,000 characters.';
 return errors;
}
