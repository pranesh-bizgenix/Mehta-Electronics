import {s,validate} from '../../core/schema.js';
import {validationFailed} from '../../core/errors.js';
import {compare,decimal} from '../../../public/money.js';
const exact=s.string({pattern:/^\d{1,14}(?:\.\d{1,6})?$/});
const metadataSchema=s.object({name:s.string({min:1,max:160}),currency:s.string({pattern:/^[A-Z]{3}$/}),effectiveFrom:s.date(),effectiveTo:s.date(),discountPercent:exact});
export function importMetadata(value){
 const parsed=validate(metadataSchema,value,'metadata');
 if(parsed.effectiveTo<parsed.effectiveFrom)throw validationFailed('The end date must be on or after the start date.');
 if(compare(decimal(parsed.discountPercent),decimal('100'))>0)throw validationFailed('List discount must be between 0 and 100.');
 return parsed;
}
/** No file extension guessing, base64 repair, currency, date or price defaults. */
export function importUpload(input){
 if(!input||typeof input!=='object')throw validationFailed('Choose a source file and format.');
 const format=validate(s.enum(['CSV','XLSX','PDF_TABLE']),input.format,'format');
 const filename=validate(s.string({min:1,max:200,pattern:/^[^/\\\x00-\x1f]+$/}),input.filename,'filename');
 const content=input.contentBase64;
 if(typeof content!=='string'||!content.length||content.length>11184812||content.length%4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content))throw validationFailed('Supply a non-empty base64 file of at most 8 MiB.');
 const bytes=Buffer.from(content,'base64');
 if(!bytes.length||bytes.length>8388608||bytes.toString('base64')!==content)throw validationFailed('Invalid file encoding or size.');
 return {format,filename,bytes,sheet:input.sheet};
}
