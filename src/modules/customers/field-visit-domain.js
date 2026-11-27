import {s,validate} from '../../core/schema.js';
import {decimal,compare} from '../../../public/money.js';
import {validationFailed} from '../../core/errors.js';
const coordinate=s.string({pattern:/^-?\d{1,3}(?:\.\d{1,6})?$/});
export const fieldVisitStart=s.object({requestKey:s.uuid(),title:s.string({min:3,max:200}),locationSource:s.enum(['BROWSER','MANUAL_NOTE']),locationNote:s.string({min:3,max:1000}),latitude:coordinate.optional(),longitude:coordinate.optional(),accuracyMetres:s.string({pattern:/^\d{1,6}(?:\.\d{1,2})?$/}).optional(),capturedAt:s.string({max:50}).optional(),reason:s.reason()});
export const fieldVisitEnd=s.object({version:s.int({min:1}),action:s.enum(['COMPLETE','CANCEL']),notes:s.text({min:3,max:10000}),reason:s.reason()});
export const FIELD_VISIT_NOTE='Check-in times are recorded by the server. Browser coordinates are device-provided evidence, not verified attendance or proof that a customer was visited. Manual location notes are labelled separately. No payroll, incentive or attendance decision is made from this record.';
export function validateFieldVisit(input,now=new Date(),{fresh=true}={}){
 const b=validate(fieldVisitStart,input);
 if(Object.values(b).some(v=>typeof v==='string'&&/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)))throw validationFailed('Visit details contain unsupported control characters.');
 if(b.locationSource==='MANUAL_NOTE'){
  if(['latitude','longitude','accuracyMetres','capturedAt'].some(k=>b[k]!==undefined))throw validationFailed('Manual visits must not contain claimed GPS evidence.');
 }else{
  if(!['latitude','longitude','accuracyMetres','capturedAt'].every(k=>b[k]!==undefined))throw validationFailed('Capture a complete browser location or use a manual location note.');
  for(const [key,limit] of [['latitude','90'],['longitude','180']])if(compare(decimal(b[key]),decimal('-'+limit))<0||compare(decimal(b[key]),decimal(limit))>0)throw validationFailed('Browser coordinates are outside their valid range.');
  if(compare(decimal(b.accuracyMetres),decimal('0'))<=0||compare(decimal(b.accuracyMetres),decimal('100000'))>0)throw validationFailed('Browser accuracy must be greater than zero and no more than 100,000 metres.');
  const at=Date.parse(b.capturedAt);if(!/(?:Z|[+-]\d{2}:\d{2})$/.test(b.capturedAt)||!Number.isFinite(at)||fresh&&(at>now.getTime()+30000||now.getTime()-at>300000))throw validationFailed('Capture a fresh browser location before checking in.');
 }
 return b;
}
