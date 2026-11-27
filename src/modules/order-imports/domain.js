import {createHash} from 'node:crypto';
import {readPriceWorkbook} from '../pricing/tabular.js';
import {decimal,compare,mul,sub,format} from '../../../public/money.js';
import {scaled} from '../../../public/quotation-math.js';
import {validationFailed} from '../../core/errors.js';
export const PARSER_VERSION='MEHTA_OPEN_ORDERS_1';
export const PENDING_HEADERS=['Material','Description','PO','Item','Document Date','Delivery Date','Plant','Qty','Pending.Qty','Net Price','Total.Value'];
export const PO_HEADERS=['PO Number','PO Line','Material SKU','Material Description','PO Quantity','Open Q.','Source/Vendor','GE required date'];
const text=c=>String(c?.text??'').trim(),norm=s=>String(s).trim().replace(/\s+/g,' ').toLowerCase();
const hasHeaders=(row,headers)=>headers.every((h,i)=>norm(text(row.cells[i]))===norm(h));
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function exactSourceDecimal(value){
 const t=String(value??'').trim();if(!/^\d{1,18}(?:\.\d{1,6})?$/.test(t))return null;
 return format(decimal(t),6);
}
export function excelCalendarDate(value,dateSystem='1900'){
 const t=String(value??'').trim();
 if(/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z?)?$/.test(t)){const date=t.slice(0,10);return Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date?date:null;}
 if(!/^\d{1,5}(?:\.0+)?$/.test(t))return null;const serial=Number(t);
 if(serial<1||serial>73050||dateSystem==='1900'&&serial===60)return null;
 const base=dateSystem==='1904'?Date.UTC(1904,0,1):Date.UTC(1899,11,31),offset=dateSystem==='1900'&&serial>60?serial-1:serial;
 return new Date(base+offset*86400000).toISOString().slice(0,10);
}
export function requiredDate(value,system){const t=norm(value);if(t==='immediate')return {scheduleKind:'IMMEDIATE',requiredDate:null};if(t==='cancel')return {scheduleKind:'CANCEL_REQUEST',requiredDate:null};const date=excelCalendarDate(value,system);return {scheduleKind:date?'DATED':'UNKNOWN',requiredDate:date};}
function lineFacts(cells,layout,system,bucket){
 const t=i=>text(cells[i]);let facts;
 if(layout==='PENDING_REGISTER')facts={kind:'PO_LINE',externalCode:t(0),description:t(1),poNumber:t(2),poLine:t(3),documentDate:excelCalendarDate(t(4),system),...requiredDate(t(5),system),plant:t(6),orderedQuantity:exactSourceDecimal(t(7)),openQuantity:exactSourceDecimal(t(8)),unitPrice:exactSourceDecimal(t(9)),sourceValue:exactSourceDecimal(t(10)),sourceVendor:''};
 else if(layout==='OPEN_PO')facts={kind:'PO_LINE',externalCode:t(2),description:t(3),poNumber:t(0),poLine:t(1),documentDate:null,...requiredDate(t(7),system),plant:'',orderedQuantity:exactSourceDecimal(t(4)),openQuantity:exactSourceDecimal(t(5)),unitPrice:null,sourceValue:null,sourceVendor:t(6)};
 else facts={kind:'SUMMARY',externalCode:t(0),description:t(1),poNumber:null,poLine:null,documentDate:null,...requiredDate(bucket.text,system),plant:'',orderedQuantity:null,openQuantity:exactSourceDecimal(t(bucket.column)),unitPrice:null,sourceValue:null,sourceVendor:''};
 return facts;
}
export function sourceRowIssues(facts,{formula=false,layout}={}){
 const issues=[];if(formula)issues.push('FORMULA_REQUIRES_LITERAL_SOURCE');if(!facts.externalCode)issues.push('MISSING_MATERIAL_CODE');if(!facts.description)issues.push('MISSING_DESCRIPTION');
 if(facts.openQuantity===null)issues.push('MISSING_OR_INVALID_OPEN_QUANTITY');
 if(facts.scheduleKind==='UNKNOWN'||facts.scheduleKind==='DATED'&&!excelCalendarDate(facts.requiredDate))issues.push('MISSING_OR_INVALID_REQUIRED_DATE');
 if(facts.kind==='PO_LINE'){
  if(!facts.poNumber)issues.push('MISSING_PO_NUMBER');if(!facts.poLine)issues.push('MISSING_PO_LINE');
  if(facts.orderedQuantity===null)issues.push('MISSING_OR_INVALID_PO_QUANTITY');
  if(facts.openQuantity!==null&&facts.orderedQuantity!==null&&compare(decimal(facts.openQuantity),decimal(facts.orderedQuantity))>0)issues.push('OPEN_QUANTITY_EXCEEDS_PO_QUANTITY');
  if(layout==='PENDING_REGISTER'){
   if(!facts.documentDate)issues.push('MISSING_OR_INVALID_PO_DATE');if(facts.unitPrice===null||facts.sourceValue===null)issues.push('MISSING_OR_INVALID_SOURCE_VALUE');
   if(facts.unitPrice!==null&&facts.sourceValue!==null&&facts.openQuantity!==null&&format(mul(decimal(facts.openQuantity),decimal(facts.unitPrice)),2)!==format(decimal(facts.sourceValue),2))issues.push('SOURCE_VALUE_DIFFERENCE');
  }
 }
 return issues;
}
export function parseOrderSheets(sheets,dateSystem='1900'){
 const rows=[],layouts=[],skipped=[];
 for(const sheet of sheets){
  const nonempty=sheet.rows.filter(r=>r.cells.some(c=>text(c)));let header,layout,buckets=[];
  for(const r of nonempty.slice(0,12)){
   if(hasHeaders(r,PENDING_HEADERS)){header=r;layout='PENDING_REGISTER';break;}
   if(hasHeaders(r,PO_HEADERS)){header=r;layout='OPEN_PO';break;}
   if(norm(text(r.cells[0]))==='material sku'&&norm(text(r.cells[1]))==='material description'){
    const possible=r.cells.slice(2).map((c,i)=>({column:i+2,text:text(c)})).filter(b=>['immediate','cancel'].includes(norm(b.text))||excelCalendarDate(b.text,dateSystem));
    if(possible.length){header=r;layout='OPEN_ORDER_SUMMARY';buckets=possible;break;}
   }
  }
  if(!header){skipped.push(sheet.sheet);continue;}
  let physicalRows=0;
  for(const row of nonempty.filter(r=>r.number>header.number)){
   if(['grand total','total'].includes(norm(text(row.cells[0])))&&row.cells.slice(1).every(c=>!text(c)||exactSourceDecimal(text(c))!==null)){skipped.push(sheet.sheet+' row '+row.number+' (printed total)');continue;}
   physicalRows++;
   for(const bucket of layout==='OPEN_ORDER_SUMMARY'?buckets:[{column:-1,text:''}]){
    const facts=lineFacts(row.cells,layout,dateSystem,bucket),formula=row.cells.some(c=>c?.formula),issues=sourceRowIssues(facts,{formula,layout});
    rows.push({sheet:sheet.sheet,sourceRow:row.number,sourceColumn:bucket.column,layout,sourceKey:sheet.sheet+':'+row.number+':'+bucket.column,facts,issues,raw:{headers:header.cells.map(c=>text(c)),cells:row.cells.map(c=>c??null),bucket:bucket.column<0?null:bucket.text},fingerprint:digest(facts)});
   }
  }
  layouts.push({sheet:sheet.sheet,layout,headerRow:header.number,physicalRows,summaryOnly:layout==='OPEN_ORDER_SUMMARY'});
 }
 if(!layouts.length)throw validationFailed('No supported PO/open-order layout was found. Keep the column names from the supplied workbook formats.');
 if(rows.length>20000)throw validationFailed('The workbook expands to more than 20,000 schedule rows. Split the source file.');
 const keys=new Map();for(const row of rows.filter(r=>r.facts.kind==='PO_LINE')){const key=businessKey(row.facts);const group=keys.get(key)||[];group.push(row);keys.set(key,group);}
 for(const group of keys.values())if(group.length>1)for(const row of group)row.issues.push('DUPLICATE_PO_LINE_SCHEDULE');
 return {version:PARSER_VERSION,dateSystem,layouts,rows,skipped,summary:{physicalRows:layouts.reduce((n,l)=>n+l.physicalRows,0),poRows:rows.filter(r=>r.facts.kind==='PO_LINE').length,summaryRows:rows.filter(r=>r.facts.kind==='SUMMARY').length,rowsNeedingReview:rows.filter(r=>r.issues.length).length,note:'Source register only. Summary rows do not create another PO; cancellation requests never cancel CRM orders; reported supplied quantities do not confirm physical dispatch.'}};
}
export function readOrderWorkbook(bytes){const meta=readPriceWorkbook(bytes);if(meta.sheets.length>8)throw validationFailed('Use a customer order workbook with at most eight worksheets.');const sheets=[];let count=0;for(const sheet of meta.sheets){const data=readPriceWorkbook(bytes,sheet);count+=data.rows.length;if(count>20100)throw validationFailed('Split workbooks exceeding 20,000 source rows.');sheets.push({...data,sheet});}return parseOrderSheets(sheets,meta.dateSystem);}
export function businessKey(f){return JSON.stringify([f.poNumber,f.poLine,f.externalCode,f.scheduleKind,f.requiredDate]);}
export function suppliedQuantity(f){return f.orderedQuantity===null||f.openQuantity===null?null:format(sub(decimal(f.orderedQuantity),decimal(f.openQuantity)),6);}
export function validatePOLineSchedules(rows){
 const groups=new Map();for(const r of rows){const f=r.effective;if(r.excluded||f.kind!=='PO_LINE'||f.scheduleKind==='CANCEL_REQUEST')continue;const key=JSON.stringify([f.poNumber,f.poLine]),group=groups.get(key)||[];group.push(r);groups.set(key,group);}
 for(const group of groups.values()){
  const codes=new Set(group.map(r=>r.effective.externalCode)),totals=new Set(group.map(r=>r.effective.orderedQuantity));
  if(codes.size>1)for(const r of group)r.issues.push('MULTIPLE_MATERIALS_ON_SAME_PO_LINE');
  if(totals.size>1)for(const r of group)r.issues.push('INCONSISTENT_ORIGINAL_PO_QUANTITY');
  if(totals.size===1&&!totals.has(null)&&group.every(r=>r.effective.openQuantity!==null)){
   const open=group.reduce((sum,r)=>sum+scaled(r.effective.openQuantity),0n);
   if(open>scaled(group[0].effective.orderedQuantity))for(const r of group)r.issues.push('DATED_OPEN_QUANTITIES_EXCEED_PO_LINE');
  }
 }
 return rows;
}
