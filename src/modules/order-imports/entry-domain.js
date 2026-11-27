import {createHash} from 'node:crypto';
import {s,validate} from '../../core/schema.js';
import {validationFailed} from '../../core/errors.js';
import {readPriceWorkbook} from '../pricing/tabular.js';
import {exactSourceDecimal,excelCalendarDate,requiredDate,sourceRowIssues} from './domain.js';
export const ENTRY_FIELDS=['poNumber','poLine','externalCode','description','orderedQuantity','openQuantity','requiredDate','documentDate','unitPrice','sourceValue','plant','sourceVendor','sourceUom'];
const numbers=['orderedQuantity','openQuantity','unitPrice','sourceValue'];
export const manualRowSchema=s.object(Object.fromEntries([...ENTRY_FIELDS.map(key=>[key,s.string({max:key==='description'?2000:200}).optional()]),['scheduleKind',s.enum(['DATED','IMMEDIATE','CANCEL_REQUEST','UNKNOWN']).optional()]]));
export const manualRowsSchema=s.array(manualRowSchema,{min:1,max:100});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function manualSourceRows(input,key){return validate(manualRowsSchema,input).map((entry,i)=>{
 if(Object.values(entry).some(value=>typeof value==='string'&&/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)))throw validationFailed('Manual row text contains unsupported control characters.');
 const facts={kind:'PO_LINE',...Object.fromEntries(ENTRY_FIELDS.map(field=>[field,entry[field]||''])),scheduleKind:entry.scheduleKind||'UNKNOWN'};
 for(const field of numbers){facts[field]=entry[field]?exactSourceDecimal(entry[field]):null;if(entry[field]&&facts[field]===null)throw validationFailed('Use a non-negative decimal with at most six places for '+field+'.');}
 for(const field of ['requiredDate','documentDate']){facts[field]=entry[field]?excelCalendarDate(entry[field]):null;if(entry[field]&&!facts[field])throw validationFailed('Use a valid calendar date for '+field+'.');}
 if(facts.scheduleKind!=='DATED')facts.requiredDate=null;
 const raw={origin:'MANUAL',headers:ENTRY_FIELDS,cells:ENTRY_FIELDS.map(field=>({text:entry[field]||'',formula:false}))};
 return {sheet:'Manual entry',sourceRow:i+1,sourceColumn:-1,layout:'MANUAL_PO',sourceKey:'manual:'+key+':'+i,facts,raw,issues:sourceRowIssues(facts,{layout:'MANUAL_PO'}),fingerprint:hash({facts,raw})};
});}
export function workbookColumns(bytes){const meta=readPriceWorkbook(bytes);if(meta.sheets.length>8)throw validationFailed('Use at most eight worksheets.');return {dateSystem:meta.dateSystem,sheets:meta.sheets.map(sheet=>{const data=readPriceWorkbook(bytes,sheet);return {name:sheet,rows:data.rows.slice(0,12).map(row=>({number:row.number,cells:row.cells.map(c=>c?.text||'')}))};})};}
export function mappedWorkbook(bytes,mapping){
 const m=validate(s.object({sheet:s.string({min:1,max:100,trim:false}),headerRow:s.int({min:1,max:20000}),columns:s.object(Object.fromEntries(ENTRY_FIELDS.map(field=>[field,s.int({min:0,max:99}).nullable().optional()])))}),mapping);
 const selected=Object.values(m.columns).filter(v=>v!=null);if(new Set(selected).size!==selected.length)throw validationFailed('Map each source column to only one business field.');
 for(const key of ['poNumber','poLine','externalCode','description','orderedQuantity','openQuantity','requiredDate'])if(m.columns[key]==null)throw validationFailed('Map the '+key+' column before importing.');
 const data=readPriceWorkbook(bytes,m.sheet),header=data.rows.find(r=>r.number===m.headerRow);if(!header)throw validationFailed('Select the actual header row.');if(selected.some(c=>c>=header.cells.length))throw validationFailed('Mapped column is outside the selected header.');
 const rows=[];for(const r of data.rows.filter(r=>r.number>m.headerRow&&r.cells.some(c=>c?.text?.trim()))){
  const get=key=>m.columns[key]==null?'':String(r.cells[m.columns[key]]?.text||'').trim(),facts={kind:'PO_LINE',...Object.fromEntries(ENTRY_FIELDS.map(key=>[key,get(key)])),...requiredDate(get('requiredDate'),data.dateSystem)};
  for(const key of numbers)facts[key]=get(key)?exactSourceDecimal(get(key)):null;
  facts.documentDate=excelCalendarDate(get('documentDate'),data.dateSystem);
  const raw={origin:'EXCEL',headers:header.cells.map(c=>c?.text||''),cells:r.cells,mappedColumns:m.columns};
  const issues=sourceRowIssues(facts,{layout:'MAPPED_PO',formula:r.cells.some(c=>c?.formula)});
  facts.invalidFields=numbers.filter(key=>get(key)&&facts[key]===null);for(const key of facts.invalidFields)issues.push('INVALID_'+key.toUpperCase());
  rows.push({sheet:m.sheet,sourceRow:r.number,sourceColumn:-1,layout:'MAPPED_PO',sourceKey:m.sheet+':'+r.number,facts,raw,issues,fingerprint:hash({facts,raw})});
 }
 if(!rows.length)throw validationFailed('No detail rows follow the chosen header.');
 return {version:'MEHTA_MAPPED_PO_1',layouts:[{sheet:m.sheet,layout:'MAPPED_PO',headerRow:m.headerRow,physicalRows:rows.length,summaryOnly:false,columnMapping:m.columns}],rows,skipped:[],summary:{physicalRows:rows.length,poRows:rows.length,summaryRows:0,rowsNeedingReview:rows.filter(r=>r.issues.length).length}};
}
